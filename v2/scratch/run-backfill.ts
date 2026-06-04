require("dotenv").config({ path: ".env.local" });
const { neon } = require("@neondatabase/serverless");

async function run() {
  const sql = neon(process.env.DATABASE_URL);
  console.log("--- BACKFILLING LAST MESSAGE MODEL ---");
  const result = await sql`
    UPDATE conversations c
    SET last_message_model = m.model_used
    FROM (
      SELECT DISTINCT ON (phone_number, tenant_id) phone_number, tenant_id, model_used
      FROM messages 
      WHERE direction != 'system'
      ORDER BY phone_number, tenant_id, created_at DESC
    ) m
    WHERE c.phone_number = m.phone_number 
      AND c.tenant_id = m.tenant_id 
      AND c.last_message_model IS NULL
  `;
  console.log("✅ Backfill completed.");
}
run().catch(console.error);
