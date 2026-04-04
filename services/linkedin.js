// services/linkedin.js — LinkedIn OAuth + posting service
// Uses the NEW LinkedIn REST Posts API (202501) — NOT the deprecated v2/ugcPosts
const axios = require('axios');
const fs    = require('fs');

const LI_CLIENT_ID     = (process.env.LINKEDIN_CLIENT_ID     || '').trim();
const LI_CLIENT_SECRET = (process.env.LINKEDIN_CLIENT_SECRET || '').trim();
const LI_CALLBACK_URL  = (process.env.LINKEDIN_CALLBACK_URL  || '').trim();

// LinkedIn API version header (YYYYMM format)
// See: https://learn.microsoft.com/en-us/linkedin/shared/api-guide/versioning
const LI_VERSION = '202501';

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
 */
async function uploadImageToLinkedIn(accessToken, linkedinId, imagePath, mimetype) {
  try {
    // Step 1: Initialize upload — get upload URL and image URN
    const { uploadUrl, imageUrn } = await initializeImageUpload(accessToken, linkedinId);
    console.log(`📡 LinkedIn image URN allocated: ${imageUrn}`);

    // Step 2: Upload the binary image via PUT
    const imageBuffer = fs.readFileSync(imagePath);
    await axios.put(uploadUrl, imageBuffer, {
      headers: {
        Authorization:      `Bearer ${accessToken}`,
        'Content-Type':     mimetype || 'image/jpeg',
        'LinkedIn-Version': LI_VERSION
      },
      maxBodyLength: Infinity,
      maxContentLength: Infinity
    });

    console.log(`✅ Image uploaded to LinkedIn: ${imageUrn}`);
    return imageUrn;

  } catch (err) {
    console.error('LinkedIn Image Upload Error:', {
      msg:    err.message,
      status: err.response?.status,
      data:   JSON.stringify(err.response?.data)
    });
    throw new Error(`LinkedIn Image Upload Failed: ${err.response?.data?.message || err.message}`);
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
  const authorUrn = `urn:li:person:${linkedinId}`;
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

  // Build the post body per the new REST Posts API schema
  // Docs: https://learn.microsoft.com/en-us/linkedin/marketing/community-management/shares/posts-api
  const postBody = {
    author:         authorUrn,
    commentary,
    visibility:     'PUBLIC',
    distribution: {
      feedDistribution:             'MAIN_FEED',
      targetEntities:               [],
      thirdPartyDistributionChannels: []
    },
    lifecycleState:              'PUBLISHED',
    isReshareDisabledByAuthor:   false
  };

  if (imageUrns.length === 1) {
    // Single image post
    postBody.content = {
      media: {
        id: imageUrns[0]
      }
    };
  } else if (imageUrns.length > 1) {
    // Multi-image post (up to 9 images)
    postBody.content = {
      multiImage: {
        images: imageUrns.map(id => ({ id, altText: '' }))
      }
    };
  }
  // No content key = text-only post

  console.log(`📝 Posting to LinkedIn REST API as ${authorUrn}`);

  const res = await axios.post(
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

  // The post ID is returned in the x-restli-id header (or the id field)
  const postId = res.headers['x-restli-id'] || res.data?.id || 'unknown';
  console.log(`✅ Post created on LinkedIn: ${postId}`);
  return postId;
}

module.exports = { getAuthUrl, exchangeCodeForToken, getUserProfile, publishPost };
