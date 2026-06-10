import * as dotenv from 'dotenv';
import { neon } from '@neondatabase/serverless';
import * as path from 'path';

dotenv.config({ path: '.env.local' });

async function audit() {
  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) {
    console.error("DATABASE_URL is missing in env");
    return;
  }

  const sql = neon(dbUrl);
  try {
    console.log("=== Auditing leads from recent sync runs ===");

    // Fetch leads created since June 10, 2026 21:00 UTC (June 11, 2026 00:00 Turkish Time)
    const recentLeads = await sql`
      SELECT 
        id, 
        tenant_id, 
        phone_number,
        form_name,
        created_at,
        raw_data
      FROM leads
      WHERE created_at >= '2026-06-10 21:00:00+00'
      ORDER BY created_at DESC;
    `;

    console.log(`Found ${recentLeads.length} leads created since 2026-06-10 21:00:00 UTC.`);

    const report: Record<string, { count: number; tabs: Set<string>; campaignNames: Set<string>; examples: any[] }> = {};

    for (const row of recentLeads) {
      let rawObj: any = {};
      let tabName = 'unknown';
      try {
        rawObj = typeof row.raw_data === 'string' ? JSON.parse(row.raw_data) : (row.raw_data || {});
        tabName = rawObj._sheet_name || rawObj.sheet_name || rawObj._sheetName || 'unknown';
      } catch (err) {
        // Safe fallback
      }

      const tenantId = row.tenant_id;
      if (!report[tenantId]) {
        report[tenantId] = {
          count: 0,
          tabs: new Set<string>(),
          campaignNames: new Set<string>(),
          examples: []
        };
      }

      const maskedPhone = row.phone_number ? String(row.phone_number).substring(0, 5) + '***' : 'none';
      const fp = rawObj._google_sheets_fingerprint || 'none';
      const fpPrefix = fp !== 'none' ? fp.substring(0, 6) + '...' : 'none';

      report[tenantId].count++;
      report[tenantId].tabs.add(tabName);
      report[tenantId].campaignNames.add(row.form_name || 'none');

      if (report[tenantId].examples.length < 5) {
        report[tenantId].examples.push({
          id: row.id,
          maskedPhone,
          formName: row.form_name,
          tabName,
          fpPrefix,
          createdAt: row.created_at
        });
      }
    }

    Object.keys(report).forEach(tenantId => {
      console.log(`\nTenant ID: ${tenantId}`);
      console.log(`Total Leads: ${report[tenantId].count}`);
      console.log(`Tabs found:`, Array.from(report[tenantId].tabs));
      console.log(`Campaign Names:`, Array.from(report[tenantId].campaignNames));
      console.log(`Examples (first 5):`, report[tenantId].examples);
    });

  } catch (err) {
    console.error("Audit query failed:", err);
  }
}

audit();
