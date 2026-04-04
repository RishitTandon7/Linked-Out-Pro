/**
 * test-linkedin.js
 * Tests the new LinkedIn REST Posts API end-to-end.
 * Run: node test-linkedin.js
 */
require('dotenv').config();
const axios = require('axios');
const { createClient } = require('@supabase/supabase-js');

const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
const LI_VERSION = '202401';

async function run() {
  console.log('\n🔍 Fetching user from Supabase...');
  const { data: users, error } = await sb
    .from('users')
    .select('id, name, linkedin_id, access_token, token_expires')
    .not('access_token', 'is', null)
    .limit(1);

  if (error) { console.error('❌ Supabase error:', error.message); process.exit(1); }
  if (!users?.length) { console.log('❌ No users found with an access_token.'); process.exit(1); }

  const user = users[0];
  const now  = Math.floor(Date.now() / 1000);
  console.log(`✅ User: ${user.name} (linkedin_id: ${user.linkedin_id})`);
  console.log(`   Token expires: ${new Date(user.token_expires * 1000).toISOString()} | ${user.token_expires > now ? '✅ VALID' : '❌ EXPIRED'}`);

  if (user.token_expires <= now) {
    console.error('\n❌ Access token is expired! Re-authenticate via LinkedIn OAuth first.');
    process.exit(1);
  }

  // ── 1. Test token validity ──────────────────────────────────────────────────
  console.log('\n📡 Step 1: Verifying token via /userinfo...');
  try {
    const r = await axios.get('https://api.linkedin.com/v2/userinfo', {
      headers: { Authorization: `Bearer ${user.access_token}` }
    });
    console.log(`✅ Token valid. LinkedIn name: ${r.data.name}`);
  } catch (e) {
    console.error('❌ Token invalid:', e.response?.status, JSON.stringify(e.response?.data));
    process.exit(1);
  }

  // ── 2. Test text post via new REST Posts API ────────────────────────────────
  console.log('\n📝 Step 2: Posting a test text post via REST Posts API...');
  const postBody = {
    author:         `urn:li:person:${user.linkedin_id}`,
    commentary:     `🤖 LinkedOut Pro test post — ${new Date().toISOString()}`,
    visibility:     'PUBLIC',
    distribution: {
      feedDistribution: 'MAIN_FEED'
    },
    lifecycleState: 'PUBLISHED'
  };

  console.log('   Payload:', JSON.stringify(postBody, null, 2));

  try {
    const r = await axios.post(
      'https://api.linkedin.com/rest/posts',
      postBody,
      {
        headers: {
          Authorization:               `Bearer ${user.access_token}`,
          'Content-Type':              'application/json',
          'LinkedIn-Version':          LI_VERSION,
          'X-Restli-Protocol-Version': '2.0.0'
        }
      }
    );
    const postId = r.headers['x-restli-id'] || r.data?.id || 'unknown';
    console.log(`✅ Post created! ID: ${postId}`);
    console.log(`   Response status: ${r.status}`);
  } catch (e) {
    console.error('❌ Post failed!');
    console.error('   Status:', e.response?.status);
    console.error('   Body:  ', JSON.stringify(e.response?.data, null, 2));
    console.error('   Headers:', JSON.stringify(e.response?.headers, null, 2));
    process.exit(1);
  }

  // ── 3. Check scheduled/failed posts in DB ──────────────────────────────────
  console.log('\n📊 Step 3: Checking scheduled/failed posts in DB...');
  const { data: scheduled } = await sb
    .from('posts')
    .select('id, post_text, scheduled_at, status, fail_reason')
    .in('status', ['scheduled', 'failed'])
    .order('scheduled_at');

  if (!scheduled?.length) {
    console.log('   No scheduled or failed posts found.');
  } else {
    console.log(`   Found ${scheduled.length} post(s):`);
    for (const p of scheduled) {
      console.log(`   [${p.status.toUpperCase()}] id=${p.id}`);
      console.log(`     scheduled_at: ${new Date(p.scheduled_at * 1000).toISOString()}`);
      console.log(`     overdue: ${p.scheduled_at <= now ? '⚠️  YES' : 'no'}`);
      console.log(`     text: ${(p.post_text || '').slice(0, 60)}...`);
      if (p.fail_reason) console.log(`     ❌ fail_reason: ${p.fail_reason}`);
    }
  }

  console.log('\n✅ All tests passed!\n');
}

run().catch(e => { console.error('Fatal:', e.message); process.exit(1); });
