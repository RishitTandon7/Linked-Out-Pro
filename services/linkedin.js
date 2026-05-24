// services/linkedin.js — LinkedIn OAuth + posting service
// Uses the new LinkedIn REST Posts API (202603) instead of deprecated UGC Posts API
const axios = require('axios');
const fs    = require('fs');

const LI_CLIENT_ID     = (process.env.LINKEDIN_CLIENT_ID     || '').trim();
const LI_CLIENT_SECRET = (process.env.LINKEDIN_CLIENT_SECRET || '').trim();
const LI_CALLBACK_URL  = (process.env.LINKEDIN_CALLBACK_URL  || '').trim();
const LI_VERSION       = '202603';  // LinkedIn API version header

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
 * Upload an image to LinkedIn using the new Images API and return the image URN.
 * New API: POST /rest/images?action=initializeUpload  (LinkedIn-Version: 202603)
 */
async function uploadImageToLinkedIn(accessToken, linkedinId, imagePath, mimetype) {
  const headers = {
    Authorization:               `Bearer ${accessToken}`,
    'Content-Type':              'application/json',
    'LinkedIn-Version':          LI_VERSION,
    'X-Restli-Protocol-Version': '2.0.0'
  };

  try {
    // Step 1: Initialize the upload
    const initRes = await axios.post(
      'https://api.linkedin.com/rest/images?action=initializeUpload',
      { initializeUploadRequest: { owner: `urn:li:person:${linkedinId}` } },
      { headers }
    );

    const uploadUrl = initRes.data.value?.uploadUrl;
    const imageUrn  = initRes.data.value?.image;

    if (!uploadUrl || !imageUrn) {
      throw new Error('LinkedIn image upload init: missing uploadUrl or image URN in response');
    }

    console.log(`📡 LinkedIn image URN: ${imageUrn}`);

    // Step 2: Upload the binary image
    const imageBuffer = fs.readFileSync(imagePath);
    await axios.put(uploadUrl, imageBuffer, {
      headers: {
        Authorization:      `Bearer ${accessToken}`,
        'Content-Type':     mimetype || 'image/jpeg',
        'LinkedIn-Version': LI_VERSION
      }
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
 * Escape special Rest.li characters in the commentary text.
 * The LinkedIn REST API's commentary field is parsed by Rest.li, which treats
 * special characters like parentheses (), brackets [], braces {}, etc. as control
 * characters, causing silent truncation of the post content from that point.
 */
function escapeCommentary(text) {
  if (!text) return '';
  return text.replace(/[\\()\[\]{}<>@|~_*]/g, (x) => '\\' + x);
}

/**
 * Publish a post to LinkedIn using the new REST Posts API.
 * Supports: text-only, single image, and multi-image posts.
 *
 * @param {string} accessToken
 * @param {string} linkedinId
 * @param {string} postText
 * @param {string} hashtags
 * @param {Array<{path, mimetype}>} images  - optional
 */
async function publishPost(accessToken, linkedinId, postText, hashtags, images = []) {
  const authorUrn  = `urn:li:person:${linkedinId}`;
  const rawCommentary = hashtags ? `${postText}\n\n${hashtags}` : postText;
  const commentary = escapeCommentary(rawCommentary);

  const headers = {
    Authorization:               `Bearer ${accessToken}`,
    'Content-Type':              'application/json',
    'LinkedIn-Version':          LI_VERSION,
    'X-Restli-Protocol-Version': '2.0.0'
  };

  // Build base post body
  const postBody = {
    author:         authorUrn,
    commentary,
    visibility:     'PUBLIC',
    distribution:   { feedDistribution: 'MAIN_FEED' },
    lifecycleState: 'PUBLISHED'
  };

  // Upload images and attach to post
  if (images && images.length > 0) {
    const imageUrns = [];

    for (const img of images) {
      try {
        console.log(`📤 Uploading image to LinkedIn: ${img.path}`);
        const urn = await uploadImageToLinkedIn(accessToken, linkedinId, img.path, img.mimetype);
        imageUrns.push(urn);
      } catch (e) {
        console.error('❌ LinkedIn image upload failed:', e.message);
        throw e; // Stop — don't post text if images were intended but failed
      }
    }

    if (imageUrns.length === 1) {
      // Single image
      postBody.content = {
        media: { id: imageUrns[0] }
      };
    } else {
      // Multi-image carousel
      postBody.content = {
        multiImage: {
          images: imageUrns.map(id => ({ id }))
        }
      };
    }
  }

  console.log(`📝 Posting to LinkedIn REST API...`);
  console.log(`   Author: ${authorUrn}`);
  console.log(`   Commentary length: ${commentary.length} chars`);
  console.log(`   Images: ${images.length}`);

  const res = await axios.post('https://api.linkedin.com/rest/posts', postBody, { headers });

  // The post ID is in the X-RestLi-Id header
  const postId = res.headers['x-restli-id'] || res.data?.id || 'unknown';
  console.log(`✅ Post published to LinkedIn! ID: ${postId}`);
  return postId;
}

module.exports = { getAuthUrl, exchangeCodeForToken, getUserProfile, publishPost };
