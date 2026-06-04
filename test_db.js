
require('dotenv').config();
const { supabase } = require('./database/db');
async function run() {
  const { data, error } = await supabase.from('posts').select('id, post_text').order('created_at', { ascending: false }).limit(20);
  if (error) console.error('Error:', error);
  else {
    const found = data.filter(p => p.post_text && p.post_text.indexOf('That\\'s why') !== -1);
    console.log('Posts:', found.length);
  }
}
run();

