// services/linkedin.js — LinkedIn OAuth + posting service
// Uses the NEW LinkedIn REST Posts API (202501) — NOT the deprecated v2/ugcPosts
const axios = require('axios');
const fs    = require('fs');

const LI_CLIENT_ID     = (process.env.LINKEDIN_CLIENT_ID     || '').trim();
const LI_CLIENT_SECRET = (process.env.LINKEDIN_CLIENT_SECRET || '').trim();
const LI_CALLBACK_URL  = (process.env.LINKEDIN_CALLBACK_URL  || '').trim();

// LinkedIn API version header (YYYYMM format)
// See: https://learn.microsoft.com/en-us/linkedin/shared/api-guide/versioning
const LI_VERSION = '202603';

// LinkedIn OAuth Scopes needed:
//   openid, profile, email  → get user info
//   w_member_social          → post on behalf of user
const SCOPES = ['openid', 'profile', 'email', 'w_member_social'];

/**
 * Build the LinkedIn OAuth authorization URL
 */
function getAuthUrl(state) {
  const params = new URLSearchParams({
    response_type: 'code',
    client_id:     LI_CLIENT_ID,
    redirect_uri:  LI_CALLBACK_URL,
    state:         state,
    scope:         SCOPES.join(' ')
  });
  return `https://www.linkedin.com/oauth/v2/authorization?${params.toString()}`;
}

/**
 * Exchange authorization code for access token
 */
async function exchangeCodeForToken(code) {
  const params = new URLSearchParams({
    grant_type:    'authorization_code',
    code,
    redirect_uri:  LI_CALLBACK_URL,
    client_id:     LI_CLIENT_ID,
    client_secret: LI_CLIENT_SECRET
  });

  const res = await axios.post('https://www.linkedin.com/oauth/v2/accessToken', params.toString(), {
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
  });

  return {
    accessToken:  res.data.access_token,
    expiresIn:    res.data.expires_in,      // seconds
    tokenType:    res.data.token_type,
    scope:        res.data.scope
  };
}

/**
 * Get LinkedIn user profile (OpenID Connect userinfo endpoint)
 */
async function getUserProfile(accessToken) {
  const res = await axios.get('https://api.linkedin.com/v2/userinfo', {
    headers: { Authorization: `Bearer ${accessToken}` }
  });
  const data = res.data;
  return {
    linkedinId: data.sub,
    name:       data.name || `${data.given_name} ${data.family_name}`,
    email:      data.email,
    avatarUrl:  data.picture || null
  };
}

/**
 * Initialize an image upload with LinkedIn and get the upload URL + image URN.
 * Uses the new REST Images API (replaces deprecated v2/assets?action=registerUpload).
 */
async function initializeImageUpload(accessToken, linkedinId) {
  const res = await axios.post(
    'https://api.linkedin.com/rest/images?action=initializeUpload',
    {
      initializeUploadRequest: {
        owner: `urn:li:person:${linkedinId}`
      }
    },
    {
      headers: {
        Authorization:               `Bearer ${accessToken}`,
        'Content-Type':              'application/json',
        'LinkedIn-Version':          LI_VERSION,
        'X-Restli-Protocol-Version': '2.0.0'
      }
    }
  );

  const value = res.data?.value;
  if (!value?.uploadUrl || !value?.image) {
    throw new Error('LinkedIn initializeUpload: missing uploadUrl or image URN in response');
  }

  return {
    uploadUrl: value.uploadUrl,   // PUT binary here
    imageUrn:  value.image        // e.g. "urn:li:image:C5622AQF..."
  };
}

/**
 * Upload an image to LinkedIn and return the image URN.
 * Uses the new REST Images API.
 *
 * IMPORTANT: The uploadUrl is a pre-signed CDN URL (like an S3 signed URL).
 * You must NOT send Authorization or LinkedIn-Version headers on the PUT —
 * those extra headers invalidate the pre-signed signature and cause a 403/400.
 */
async function uploadImageToLinkedIn(accessToken, linkedinId, imagePath, mimetype) {
  try {
    // Step 1: Initialize upload — get the pre-signed upload URL and image URN
    const { uploadUrl, imageUrn } = await initializeImageUpload(accessToken, linkedinId);
    console.log(`📡 LinkedIn image URN allocated: ${imageUrn}`);

    // Step 2: PUT the raw binary to the pre-signed URL.
    //         Only Content-Type goes here — NO Authorization or LinkedIn-Version.
    const imageBuffer = fs.readFileSync(imagePath);
    console.log(`📦 Uploading ${imageBuffer.length} bytes (${mimetype || 'image/jpeg'}) to CDN...`);

    const putRes = await axios.put(uploadUrl, imageBuffer, {
      headers: {
        'Content-Type': mimetype || 'image/jpeg'
      },
      maxBodyLength:    Infinity,
      maxContentLength: Infinity
    });
    console.log(`📤 CDN PUT status: ${putRes.status}`);

    console.log(`✅ Image uploaded to LinkedIn: ${imageUrn}`);
    return imageUrn;

  } catch (err) {
    console.error('LinkedIn Image Upload Error:', {
      msg:    err.message,
      status: err.response?.status,
      data:   JSON.stringify(err.response?.data)
    });
    throw new Error(`LinkedIn Image Upload Failed (${err.response?.status}): ${err.response?.data?.message || err.message}`);
  }
}

/**
 * Publish a post to LinkedIn using the new REST Posts API.
 * Replaces deprecated v2/ugcPosts.
 *
 * @param {string} accessToken
 * @param {string} linkedinId
 * @param {string} postText
 * @param {string} hashtags
 * @param {Array<{path, mimetype}>} images - optional
 */
async function publishPost(accessToken, linkedinId, postText, hashtags, images = []) {
  const authorUrn  = `urn:li:person:${linkedinId}`;
  const commentary = hashtags ? `${postText}\n\n${hashtags}` : postText;

  // Upload images first (if any)
  const imageUrns = [];
  if (images && images.length > 0) {
    for (const img of images) {
      console.log(`📤 Uploading image to LinkedIn: ${img.path}`);
      const urn = await uploadImageToLinkedIn(accessToken, linkedinId, img.path, img.mimetype);
      imageUrns.push(urn);
    }
  }

  // Build the post body per the new REST Posts API schema.
  // IMPORTANT: Do NOT include targetEntities or thirdPartyDistributionChannels
  // as empty arrays — LinkedIn returns 422 for empty optional arrays.
  // Only include fields that have actual values.
  const postBody = {
    author:         authorUrn,
    commentary,
    visibility:     'PUBLIC',
    distribution: {
      feedDistribution: 'MAIN_FEED'
      // targetEntities and thirdPartyDistributionChannels omitted when not targeting
    },
    lifecycleState: 'PUBLISHED'
    // isReshareDisabledByAuthor omitted (optional, defaults to false)
  };

  if (imageUrns.length === 1) {
    // Single image post
    postBody.content = {
      media: { id: imageUrns[0] }
    };
  } else if (imageUrns.length > 1) {
    // Multi-image post (LinkedIn supports up to 9 images)
    postBody.content = {
      multiImage: {
        images: imageUrns.map(id => ({ id, altText: '' }))
      }
    };
  }
  // No content key => text-only post

  console.log(`📝 Posting to LinkedIn REST API as ${authorUrn}, images: ${imageUrns.length}`);
  console.log('📦 POST body:', JSON.stringify(postBody));

  let res;
  try {
    res = await axios.post(
      'https://api.linkedin.com/rest/posts',
      postBody,
      {
        headers: {
          Authorization:               `Bearer ${accessToken}`,
          'Content-Type':              'application/json',
          'LinkedIn-Version':          LI_VERSION,
          'X-Restli-Protocol-Version': '2.0.0'
        }
      }
    );
  } catch (err) {
    // Log the full LinkedIn error response for Vercel log inspection
    console.error('❌ LinkedIn POST /rest/posts failed:', {
      status:  err.response?.status,
      headers: JSON.stringify(err.response?.headers),
      body:    JSON.stringify(err.response?.data)
    });
    throw new Error(
      `LinkedIn API error ${err.response?.status}: ` +
      JSON.stringify(err.response?.data || err.message)
    );
  }

  // The post ID is in the x-restli-id header
  const postId = res.headers['x-restli-id'] || res.data?.id || 'unknown';
  console.log(`✅ LinkedIn post created: ${postId}`);
  return postId;
}

module.exports = { getAuthUrl, exchangeCodeForToken, getUserProfile, publishPost };
