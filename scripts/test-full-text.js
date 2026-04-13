// scripts/test-full-text.js
// Test if LinkedIn API stores the full commentary (using new unique text to avoid dupe rejection)
require('dotenv').config();
const axios = require('axios');
const { createClient } = require('@supabase/supabase-js');

const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false }
});
const LI_VERSION = '202603';

async function main() {
  // Get the user's token
  const { data: users } = await sb.from('users').select('access_token, linkedin_id').limit(1);
  const user = users[0];

  const testText = `🔬 Diagnostic test post — ${new Date().toISOString()}

Paragraph 1: This is the first paragraph of a long test post to verify that LinkedIn's REST API correctly stores and displays all paragraphs. If you can read this, paragraph 1 is working.

Paragraph 2: This is the second paragraph. The post should have exactly four paragraphs plus hashtags. If this paragraph is visible, the text is not being truncated after paragraph 1.

Paragraph 3: This is the third paragraph. A common issue with LinkedIn API integration is that long posts get silently truncated. If you can read paragraph 3, the truncation issue has been confirmed as a display bug.

Paragraph 4: This is the fourth and final paragraph. Followed by hashtags below.`;

  const hashtags = '#Test #LinkedOutPro #Diagnostic';
  const commentary = `${testText}\n\n${hashtags}`;

  console.log('Commentary length (JS):', commentary.length);
  console.log('Commentary Unicode codepoints:', [...commentary].length);

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
    console.log('\n✅ TEST POST PUBLISHED! LinkedIn ID:', postId);
    console.log('\n👉 Check LinkedIn NOW — do you see ALL 4 paragraphs?');
    console.log('   If yes → the issue was specific to the HackerRank post text');
    console.log('   If no  → Vercel has a text truncation bug in the API call');
  } catch (err) {
    console.error('❌ Failed:', err.response?.status, JSON.stringify(err.response?.data));
    if (err.response?.status === 401) console.log('→ Token expired. User needs to re-login to LinkedIn via the app.');
    if (err.response?.status === 429) console.log('→ Rate limited. Wait a few minutes and try again.');
  }
}

main().catch(console.error);
