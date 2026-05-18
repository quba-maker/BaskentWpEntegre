import { neon } from "@neondatabase/serverless";
require('dotenv').config({ path: '.env.local' });
async function main() {
  const sql = neon(process.env.DATABASE_URL || "");
  try {
    const ctx = { tenantId: '1' };
    const searchFilter = null;
    const stageFilter = null;
    const limit = 10;
    const offset = 0;
    const rows = await sql`
        SELECT 
          c.phone_number as id
        FROM conversations c
        LEFT JOIN LATERAL (
          SELECT content
          FROM messages 
          WHERE phone_number = c.phone_number AND (tenant_id = ${ctx.tenantId} OR tenant_id IS NULL)
          ORDER BY created_at DESC 
          LIMIT 1
        ) m ON c.last_message_content IS NULL
        WHERE (c.tenant_id = ${ctx.tenantId} OR c.tenant_id IS NULL)
        ORDER BY c.last_message_at DESC NULLS LAST
        LIMIT 1
      `;
    console.log("Success:", rows);
  } catch(e) {
    console.error("DB Error:", e);
  }
}
main();
