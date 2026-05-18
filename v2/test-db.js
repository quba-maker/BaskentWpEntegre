const { neon } = require('@neondatabase/serverless');
require('dotenv').config({ path: '.env.local' });

const sql = neon(process.env.DATABASE_URL);

async function test() {
  const q = await sql`
    SELECT id, phone_number, content, tenant_id FROM messages LIMIT 5
  `;
  console.log("Messages:", q);

  const q2 = await sql`
    SELECT id, phone_number, patient_name, tenant_id FROM conversations LIMIT 5
  `;
  console.log("Conversations:", q2);
}
test().catch(console.error);
