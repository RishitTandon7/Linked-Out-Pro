
require('dotenv').config();
const { supabase } = require('./database/db');
const axios = require('axios');
async function testLinkedIn() {
  const { data: user } = await supabase.from('users').select('access_token').limit(1).single();
  const urnEncoded = encodeURIComponent('urn:li:share:7451583793062232064');
  try {
    const res = await axios.get('https://api.linkedin.com/rest/posts/' + urnEncoded, {
      headers: {
        Authorization: 'Bearer ' + user.access_token,
        'LinkedIn-Version': '202603',
        'X-Restli-Protocol-Version': '2.0.0'
      }
    });
    console.log('LinkedIn commentary length:', res.data?.commentary?.length);
    console.log('LinkedIn commentary:', res.data?.commentary);
  } catch (e) { console.log('Err:', e.response?.data || e.message); }
}
testLinkedIn();

