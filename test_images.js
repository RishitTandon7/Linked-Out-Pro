require('dotenv').config();
const { supabase } = require('./database/db');

async function main() {
  const { data } = await supabase.from('post_images').select('*').eq('post_id', '2ef5467c-1460-4531-92fa-099a24fec07c');
  console.log(data);
}
main();
