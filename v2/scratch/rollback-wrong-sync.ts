import * as dotenv from 'dotenv';
import { neon } from '@neondatabase/serverless';

dotenv.config({ path: '.env.local' });

async function rollback() {
  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) {
    console.error("DATABASE_URL is missing in env");
    return;
  }

  const sql = neon(dbUrl);
  try {
    console.log("=== Auditing target rows for quarantine rollback ===");
    const targetRows = await sql`
      SELECT id, phone_number, form_name, created_at, stage
      FROM leads
      WHERE tenant_id = 'caab9ea1-9591-45e4-bbc5-9c9b498982c8'
        AND created_at >= '2026-06-10 21:00:00+00'
        AND form_name = 'Bilinmeyen Kampanya'
        AND stage != 'quarantine';
    `;

    console.log(`Found ${targetRows.length} target leads to move to quarantine stage.`);

    if (targetRows.length === 0) {
      console.log("No leads found matching criteria. Rollback already performed or no matching leads.");
      return;
    }

    const updateRes = await sql`
      UPDATE leads
      SET stage = 'quarantine'
      WHERE tenant_id = 'caab9ea1-9591-45e4-bbc5-9c9b498982c8'
        AND created_at >= '2026-06-10 21:00:00+00'
        AND form_name = 'Bilinmeyen Kampanya'
        AND stage != 'quarantine'
      RETURNING id;
    `;

    console.log(`Successfully moved ${updateRes.length} leads to quarantine stage.`);

  } catch (err) {
    console.error("Rollback execution failed:", err);
  }
}

rollback();
