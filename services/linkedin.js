// services/linkedin.js — LinkedIn OAuth + posting service
const axios = require('axios');
const FormData = require('form-data');
const fs = require('fs');

const LI_CLIENT_ID     = (process.env.LINKEDIN_CLIENT_ID     || '').trim();
const LI_CLIENT_SECRET = (process.env.LINKEDIN_CLIENT_SECRET || '').trim();
const LI_CALLBACK_URL  = (process.env.LINKEDIN_CALLBACK_URL  || '').trim();


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
 * Upload an image to LinkedIn and return the asset URN
 */
async function uploadImageToLinkedIn(accessToken, linkedinId, imagePath, mimetype) {
  // Step 1: Register the upload
  const registerRes = await axios.post(
    'https://api.linkedin.com/v2/assets?action=registerUpload',
    {
      registerUploadRequest: {
        owner: `urn:li:person:${linkedinId}`,
        recipes: ['urn:li:digitalmediaRecipe:feedshare-image'],
        serviceRelationships: [{
          identifier: 'urn:li:userGeneratedContent',
          relationshipType: 'OWNER'
        }],
        supportedUploadMechanism: ['SYNCHRONOUS_UPLOAD']
      }
    },
    {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
        'X-Restli-Protocol-Version': '2.0.0'
      }
    }
  );

  const uploadUrl = registerRes.data.value.uploadMechanism
    ['com.linkedin.digitalmedia.uploading.MediaUploadHttpRequest'].uploadUrl;
  const assetUrn = registerRes.data.value.asset;

  // Step 2: Upload the binary image
  const imageBuffer = fs.readFileSync(imagePath);
  await axios.put(uploadUrl, imageBuffer, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': mimetype || 'image/jpeg'
    }
  });

  return assetUrn;
}

/**
 * Publish a post to LinkedIn
 * @param {string} accessToken
 * @param {string} linkedinId
 * @param {string} postText
 * @param {string} hashtags
 * @param {Array<{path, mimetype}>} images - optional
 */
async function publishPost(accessToken, linkedinId, postText, hashtags, images = []) {
  const authorUrn = `urn:li:person:${linkedinId}`;
  const fullText  = hashtags ? `${postText}\n\n${hashtags}` : postText;

  let shareMediaCategory = 'NONE';
  let media = [];

  // Upload images if provided
  if (images && images.length > 0) {
    shareMediaCategory = 'IMAGE';
    for (const img of images) {
      try {
        const assetUrn = await uploadImageToLinkedIn(accessToken, linkedinId, img.path, img.mimetype);
        media.push({
          status: 'READY',
          media:  assetUrn
        });
      } catch (e) {
        console.warn('Image upload failed, posting without image:', e.message);
      }
    }
    if (media.length === 0) shareMediaCategory = 'NONE';
  }

  const ugcPost = {
    author:         authorUrn,
    lifecycleState: 'PUBLISHED',
    specificContent: {
      'com.linkedin.ugc.ShareContent': {
        shareCommentary:    { text: fullText },
        shareMediaCategory,
        ...(media.length > 0 ? { media } : {})
      }
    },
    visibility: {
      'com.linkedin.ugc.MemberNetworkVisibility': 'PUBLIC'
    }
  };

  const res = await axios.post('https://api.linkedin.com/v2/ugcPosts', ugcPost, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
      'X-Restli-Protocol-Version': '2.0.0'
    }
  });

  // The post ID is in the X-RestLi-Id header
  const postId = res.headers['x-restli-id'] || res.data?.id || 'unknown';
  return postId;
}

module.exports = { getAuthUrl, exchangeCodeForToken, getUserProfile, publishPost };
