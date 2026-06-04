require('dotenv').config();
const { supabase } = require('./database/db');
const { publishPost } = require('./services/linkedin');
const path = require('path');

async function runTest() {
  const { data: user } = await supabase.from('users').select('access_token, linkedin_id').limit(1).single();
  const img = { path: path.join(__dirname, 'uploads/42786995-4c0a-4ba3-87ce-f0eae8e93e5e.jpeg'), mimetype: 'image/jpeg' };
  try {
    const id = await publishPost(user.access_token, user.linkedin_id, "There's a unique satisfaction in officially validating a foundational skill. I've successfully completed the HackerRank assessment for Java (Basic)", '#Java #Coding', [img]);
    console.log('LinkedIn post successful! ID:', id);
  } catch (e) {
    console.error('LinkedIn Error:', e.response?.data || e.message);
  }
}
runTest();
