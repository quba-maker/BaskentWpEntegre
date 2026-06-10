import * as dotenv from 'dotenv';
import { neon } from '@neondatabase/serverless';

dotenv.config({ path: '.env.local' });

async function audit() {
  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) {
    console.error("DATABASE_URL is missing in env");
    return;
  }

  const sql = neon(dbUrl);
  try {
    console.log("=== Auditing pre-existing leads updated in the wrong sync window ===");

    // Query pre-existing leads whose raw_data contains the _updated_at timestamp from the sync window
    // (since we don't have an updated_at column in the leads table, we check raw_data -> _updated_at)
    const recentlyUpdated = await sql`
      SELECT 
        id, 
        tenant_id, 
        phone_number,
        form_name,
        created_at,
        raw_data
      FROM leads
      WHERE created_at < '2026-06-10 21:00:00+00'
        AND raw_data::text LIKE '%_updated_at%';
    `;

    console.log(`Found ${recentlyUpdated.length} pre-existing leads with an _updated_at timestamp.`);

    let matchCount = 0;
    const examples: any[] = [];

    // Let's filter in JS for _updated_at within 2026-06-10T21:40:00Z and 2026-06-10T21:45:00Z
    for (const row of recentlyUpdated) {
      try {
        const rawObj = typeof row.raw_data === 'string' ? JSON.parse(row.raw_data) : (row.raw_data || {});
        const updatedAtStr = rawObj._updated_at;
        if (updatedAtStr) {
          const updatedAt = new Date(updatedAtStr);
          if (updatedAt >= new Date('2026-06-10T21:35:00Z') && updatedAt <= new Date('2026-06-10T21:45:00Z')) {
            matchCount++;
            if (examples.length < 5) {
              const maskedPhone = row.phone_number ? String(row.phone_number).substring(0, 5) + '***' : 'none';
              examples.push({
                id: row.id,
                maskedPhone,
                formName: row.form_name,
                updatedAt: updatedAtStr,
                createdAt: row.created_at,
                sheetName: rawObj._sheet_name || rawObj.sheet_name
              });
            }
          }
        }
      } catch (err) {}
    }

    console.log(`\nPre-existing leads updated in the wrong sync window (21:35 - 21:45 UTC): ${matchCount}`);
    console.log(`Examples:`, examples);

  } catch (err) {
    console.error("Audit query failed:", err);
  }
}

audit();
