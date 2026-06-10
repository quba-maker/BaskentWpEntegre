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
    console.log("=== Auditing contaminated leads in database ===");

    // Query leads containing "Tüm Leadler" or "Bilinmeyen Kampanya" in raw_data
    const contaminated = await sql`
      SELECT 
        id, 
        tenant_id, 
        phone_number,
        form_name,
        created_at,
        raw_data
      FROM leads
      WHERE raw_data::text LIKE '%Tüm Leadler%' 
         OR raw_data::text LIKE '%Bilinmeyen Kampanya%'
         OR form_name = 'Bilinmeyen Kampanya';
    `;

    console.log(`Found ${contaminated.length} total contaminated leads (new + updated).`);

    let newCount = 0;
    let updatedCount = 0;

    const newLeads: any[] = [];
    const updatedLeads: any[] = [];

    // Cut-off for created time: 2026-06-10 21:00:00 UTC (11 Haz 00:00 Turkish Time)
    const cutOff = new Date('2026-06-10T21:00:00Z');

    for (const row of contaminated) {
      const createdDate = new Date(row.created_at);
      let rawObj: any = {};
      let tabName = 'unknown';
      try {
        rawObj = typeof row.raw_data === 'string' ? JSON.parse(row.raw_data) : (row.raw_data || {});
        tabName = rawObj._sheet_name || rawObj.sheet_name || 'unknown';
      } catch (e) {}

      const maskedPhone = row.phone_number ? String(row.phone_number).substring(0, 5) + '***' : 'none';

      if (createdDate >= cutOff) {
        newCount++;
        if (newLeads.length < 5) {
          newLeads.push({ id: row.id, maskedPhone, formName: row.form_name, tabName, createdAt: row.created_at });
        }
      } else {
        updatedCount++;
        if (updatedLeads.length < 5) {
          updatedLeads.push({ id: row.id, maskedPhone, formName: row.form_name, tabName, createdAt: row.created_at });
        }
      }
    }

    console.log(`\nNew Leads (created since wrong sync): ${newCount}`);
    console.log(`Examples:`, newLeads);

    console.log(`\nUpdated Leads (pre-existing, but updated by wrong sync): ${updatedCount}`);
    console.log(`Examples:`, updatedLeads);

  } catch (err) {
    console.error("Audit query failed:", err);
  }
}

audit();
