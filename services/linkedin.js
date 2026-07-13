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
 * Upload a video to LinkedIn using the Videos API and return the video URN.
 * API: POST /rest/videos?action=initializeUpload  (LinkedIn-Version: 202603)
 */
async function uploadVideoToLinkedIn(accessToken, linkedinId, videoPath, mimetype) {
  const headers = {
    Authorization:               `Bearer ${accessToken}`,
    'Content-Type':              'application/json',
    'LinkedIn-Version':          LI_VERSION,
    'X-Restli-Protocol-Version': '2.0.0'
  };

  try {
    const videoBuffer = fs.readFileSync(videoPath);
    const fileSizeBytes = videoBuffer.length;

    // Step 1: Initialize the video upload
    const initRes = await axios.post(
      'https://api.linkedin.com/rest/videos?action=initializeUpload',
      {
        initializeUploadRequest: {
          owner:            `urn:li:person:${linkedinId}`,
          fileSizeBytes,
          uploadCaptions:   false,
          uploadThumbnail:  false
        }
      },
      { headers }
    );

    const value      = initRes.data.value;
    const videoUrn   = value?.video;
    const uploadUrls = value?.uploadInstructions?.map(u => u.uploadUrl) || [];
    const singleUrl  = value?.uploadUrl;

    if (!videoUrn) throw new Error('LinkedIn video upload init: missing video URN');

    console.log(`📡 LinkedIn video URN: ${videoUrn}`);

    if (uploadUrls.length > 0) {
      // Chunked upload — split buffer across provided URLs
      const chunkSize = Math.ceil(fileSizeBytes / uploadUrls.length);
      for (let i = 0; i < uploadUrls.length; i++) {
        const chunk = videoBuffer.slice(i * chunkSize, (i + 1) * chunkSize);
        await axios.put(uploadUrls[i], chunk, {
          headers: {
            Authorization:      `Bearer ${accessToken}`,
            'Content-Type':     mimetype || 'video/mp4',
            'LinkedIn-Version': LI_VERSION
          }
        });
        console.log(`📤 Video chunk ${i + 1}/${uploadUrls.length} uploaded`);
      }
    } else if (singleUrl) {
      // Single PUT upload
      await axios.put(singleUrl, videoBuffer, {
        headers: {
          Authorization:      `Bearer ${accessToken}`,
          'Content-Type':     mimetype || 'video/mp4',
          'LinkedIn-Version': LI_VERSION
        }
      });
    } else {
      throw new Error('LinkedIn video upload init: no uploadUrl returned');
    }

    // Step 3: Finalize the upload
    try {
      const etag = (uploadUrls.length > 0)
        ? uploadUrls.map((_, i) => `"chunk-${i}"`) : [];
      await axios.post(
        'https://api.linkedin.com/rest/videos?action=finalizeUpload',
        {
          finalizeUploadRequest: {
            video:             videoUrn,
            uploadToken:       value?.uploadToken || '',
            uploadedPartIds:   etag
          }
        },
        { headers }
      );
    } catch (finalErr) {
      // Finalize may return 200 with empty body — only fail on non-2xx
      if (finalErr.response?.status && finalErr.response.status >= 300) throw finalErr;
    }

    console.log(`✅ Video uploaded to LinkedIn: ${videoUrn}`);
    return videoUrn;

  } catch (err) {
    console.error('LinkedIn Video Upload Error:', {
      msg:    err.message,
      status: err.response?.status,
      data:   JSON.stringify(err.response?.data)
    });
    throw new Error(`LinkedIn Video Upload Failed: ${err.response?.data?.message || err.message}`);
  }
}

/**
 * Sanitize special Rest.li characters in the commentary text.
 * The LinkedIn REST API's commentary field is parsed by Rest.li, which treats
 * special characters like parentheses (), brackets [], braces {}, etc. as control
 * characters (causing silent truncation of the post content from that point).
 * Escaping with backslashes is ignored by the Rest.li parser, so we clean/sanitize
 * them directly by replacing them with safe alternatives (e.g. spaces/dashes/quotes).
 */
function sanitizeCommentary(text) {
  if (!text) return '';
  let sanitized = text
    .replace(/\(/g, ' - ')
    .replace(/\)/g, ' - ')
    .replace(/\[/g, '"')
    .replace(/\]/g, '"')
    .replace(/\{/g, ' - ')
    .replace(/\}/g, ' - ')
    .replace(/\\/g, '/')
    .replace(/[^\S\r\n]+/g, ' '); // collapse consecutive spaces, keep newlines
  return sanitized;
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
  const commentary = sanitizeCommentary(rawCommentary);

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

  // Upload images / videos and attach to post
  if (images && images.length > 0) {
    // Check if any file is a video
    const hasVideo = images.some(img => img.mimetype && img.mimetype.startsWith('video/'));

    if (hasVideo) {
      // LinkedIn only supports one video per post; pick the first video
      const videoFile = images.find(img => img.mimetype && img.mimetype.startsWith('video/'));
      console.log(`📤 Uploading video to LinkedIn: ${videoFile.path}`);
      const videoUrn = await uploadVideoToLinkedIn(accessToken, linkedinId, videoFile.path, videoFile.mimetype);
      postBody.content = {
        media: { id: videoUrn }
      };
    } else {
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
            images: imageUrns.map(id => ({ image: id }))
          }
        };
      }
    }
  }

  console.log(`📝 Posting to LinkedIn REST API...`);
  console.log(`   Author: ${authorUrn}`);
  console.log(`   Commentary length: ${commentary.length} chars`);
  console.log(`   PostBody:`, JSON.stringify(postBody));
  console.log(`   Images: ${images.length}`);

  const res = await axios.post('https://api.linkedin.com/rest/posts', postBody, { headers });

  // The post ID is in the X-RestLi-Id header
  const postId = res.headers['x-restli-id'] || res.data?.id || 'unknown';
  console.log(`✅ Post published to LinkedIn! ID: ${postId}`);
  return postId;
}

module.exports = { getAuthUrl, exchangeCodeForToken, getUserProfile, publishPost };
