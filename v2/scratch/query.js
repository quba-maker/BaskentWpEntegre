const { neon } = require('@neondatabase/serverless');
require('dotenv').config({ path: '.env.local' });
const sql = neon(process.env.DATABASE_URL);

async function run() {
  const c = await sql`SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'messages'`;
  console.log(c);
}
run();
