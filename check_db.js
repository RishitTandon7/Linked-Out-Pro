require('dotenv').config();
const { supabase, IS_SUPABASE } = require('./database/db');

async function main() {
  if (!IS_SUPABASE) {
    console.log("Not configured for supabase locally.");
    return;
  }
  const { data: posts, error } = await supabase
    .from('posts')
    .select('*')
    .eq('status', 'failed')
    .order('updated_at', { ascending: false })
    .limit(5);

  if (error) {
    console.error("DB Error:", error);
    return;
  }

  console.log("Failed Posts:");
  for (const post of posts) {
    console.log(`- ID: ${post.id}`);
    console.log(`  Fail Reason: ${post.fail_reason}`);
    
    const { data: images } = await supabase.from('post_images').select('*').eq('post_id', post.id);
    console.log(`  Images: ${images ? images.length : 0}`);
    if (images && images.length) {
      images.forEach(img => {
         console.log(`   - File: ${img.filename}, Storage path: ${img.storage_path}, Storage url: ${img.storage_url}`);
      });
    }
  }
}

main();
