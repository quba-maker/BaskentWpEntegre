const { Pool } = require('pg');
require('dotenv').config({ path: '.env.local' });
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
async function main() {
  const res = await pool.query('SELECT id, phone_number, tenant_id FROM messages LIMIT 5');
  console.log("Messages:");
  console.log(res.rows);
  const convs = await pool.query('SELECT id, phone_number, tenant_id FROM conversations LIMIT 5');
  console.log("Conversations:");
  console.log(convs.rows);
  pool.end();
}
main();
