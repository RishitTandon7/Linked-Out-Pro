require('dotenv').config();
const { supabase, IS_SUPABASE } = require('./database/db');
const { publishDuePosts } = require('./services/scheduler');

async function main() {
  if (!IS_SUPABASE) {
    console.log('Not configured for supabase locally.');
    return;
  }
  
  const { data: posts, error } = await supabase
    .from('posts')
    .select('id, status, scheduled_at, linkedin_post_id, fail_reason')
    .in('status', ['failed', 'scheduled']);

  console.log('Posts:', JSON.stringify(posts, null, 2));
  
  console.log('Running test publishDuePosts() locally...');
  const res = await publishDuePosts();
  console.log('Result:', JSON.stringify(res, null, 2));
}

main();
