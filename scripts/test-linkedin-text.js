// scripts/test-linkedin-text.js
// Run: node scripts/test-linkedin-text.js
// Tests if LinkedIn REST API correctly stores the full post_text from the DB
require('dotenv').config();
const axios = require('axios');
const { createClient } = require('@supabase/supabase-js');

const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false }
});

const LI_VERSION = '202603';

async function main() {
  // 1. Fetch the post and user from Supabase (same way scheduler does)
  const { data: posts } = await sb.from('posts')
    .select('*')
    .eq('id', '45bfc212-ab55-43bf-9e4a-6e8780b1f0cf'); // the post that was published

  const post = posts[0];
  console.log('=== POST FROM DB ===');
  console.log('post_text length:', post.post_text.length);
  console.log('post_text:', post.post_text);
  console.log('hashtags:', post.hashtags);

  // 2. Build commentary exactly as the scheduler does
  const commentary = post.hashtags
    ? `${post.post_text}\n\n${post.hashtags}`
    : post.post_text;

  console.log('\n=== COMMENTARY ===');
  console.log('Commentary length:', commentary.length);
  console.log('Commentary chars:', [...commentary].length, '(Unicode codepoints)');
  console.log('Commentary JSON length:', JSON.stringify(commentary).length);
  console.log('Commentary:', commentary);

  // 3. Check for any problematic characters
  const problematic = [];
  for (let i = 0; i < commentary.length; i++) {
    const code = commentary.charCodeAt(i);
    if (code === 0) problematic.push({ pos: i, char: 'NULL (U+0000)' });
    if (code === 65533) problematic.push({ pos: i, char: 'REPLACEMENT CHAR (U+FFFD)' });
  }
  if (problematic.length > 0) {
    console.log('\n⚠️  PROBLEMATIC CHARS:', problematic);
  } else {
    console.log('\n✅ No null or replacement characters found');
  }

  // 4. Fetch user's access token
  const { data: users } = await sb.from('users')
    .select('access_token, linkedin_id')
    .eq('id', post.user_id);
  
  const user = users[0];
  console.log('\n=== LINKEDIN API TEST ===');
  console.log('Posting text-only (no image) with full commentary to test truncation...');

  // 5. Post to LinkedIn with just the text (no image) to test if text is received fully
  try {
    const res = await axios.post('https://api.linkedin.com/rest/posts', {
      author: `urn:li:person:${user.linkedin_id}`,
      commentary,
      visibility: 'PUBLIC',
      distribution: { feedDistribution: 'MAIN_FEED' },
      lifecycleState: 'PUBLISHED'
    }, {
      headers: {
        Authorization: `Bearer ${user.access_token}`,
        'Content-Type': 'application/json',
        'LinkedIn-Version': LI_VERSION,
        'X-Restli-Protocol-Version': '2.0.0'
      }
    });
    const postId = res.headers['x-restli-id'] || 'unknown';
    console.log('✅ Posted! LinkedIn post ID:', postId);
    console.log('HTTP status:', res.status);
    console.log('\nNow check LinkedIn — does the FULL text appear?');
  } catch (err) {
    console.error('❌ LinkedIn error:', err.response?.status, JSON.stringify(err.response?.data));
  }
}

main().catch(console.error);
