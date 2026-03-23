const axios = require('axios');
require('dotenv').config();
const {createClient} = require('@supabase/supabase-js');
const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
async function run() {
  const {data} = await sb.from('users').select('*').neq('access_token', null).limit(1);
  if(!data.length) return console.log('none');
  const t=data[0].access_token;
  const p=data[0].linkedin_id;
  try {
    const urn='urn:li:person:'+p;
    const r=await axios.get('https://api.linkedin.com/v2/ugcPosts?q=authors&authors=List(' + encodeURIComponent(urn) + ')', {
      headers: {Authorization: 'Bearer '+t, 'LinkedIn-Version': '202304', 'X-Restli-Protocol-Version':'2.0.0'}
    });
    console.log(JSON.stringify(r.data, null, 2));
  } catch(e) { console.log(e.response?.data || e.message); }
}
run();
