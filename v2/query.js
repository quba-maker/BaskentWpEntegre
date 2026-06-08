require('dotenv').config({ path: '.env.local' });
const { Pool } = require('@neondatabase/serverless');
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
async function run() {
  const convs = await pool.query(`
    SELECT c.id, c.patient_name, c.phone_number,
           (SELECT COUNT(*)::int FROM messages m WHERE m.conversation_id = c.id AND m.direction = 'in') as inbound_count
    FROM conversations c
    WHERE c.patient_name ILIKE '%yapa%' 
       OR c.phone_number ILIKE '%yapa%'
       OR EXISTS (SELECT 1 FROM messages m WHERE m.conversation_id = c.id AND m.content ILIKE '%yapa%');
  `);
  console.log("Matching Conversations:");
  console.log(convs.rows);
  pool.end();
}
run();
