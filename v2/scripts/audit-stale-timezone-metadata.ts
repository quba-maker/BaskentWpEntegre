import { neon } from "@neondatabase/serverless";
import dotenv from "dotenv";
import path from "path";

dotenv.config({ path: path.join(__dirname, "../.env.local") });
const appDatabaseUrl = process.env.APP_DATABASE_URL || process.env.DATABASE_URL;

const MULTI_TZ_COUNTRIES = [
  'abd', 'usa', 'us', 'united states', 'america', 'amerika', 'amerika birleşik devletleri',
  'kanada', 'canada', 'ca',
  'rusya', 'russia', 'ru',
  'avustralya', 'australia', 'au',
  'brezilya', 'brazil', 'br',
  'endonezya', 'indonesia', 'id',
  'meksika', 'mexico', 'mx',
  'kazakistan', 'kazakhstan', 'kz'
];

async function main() {
  if (!appDatabaseUrl) {
    console.error("No database URL found in env.");
    process.exit(1);
  }
  const sql = neon(appDatabaseUrl);

  console.log("=== STARTING STALE TIMEZONE METADATA READ-ONLY AUDIT ===\n");

  // Fetch all opportunities with non-null metadata
  const rows = await sql`
    SELECT id, patient_name, phone_number, country, created_at, metadata
    FROM opportunities
    WHERE metadata IS NOT NULL
  `;

  const staleRecords: any[] = [];

  for (const row of rows) {
    const countryLower = (row.country || '').trim().toLowerCase();
    if (!countryLower) continue;

    if (MULTI_TZ_COUNTRIES.includes(countryLower)) {
      const meta = row.metadata || {};
      const patientTimezone = meta.patient_timezone;
      const timezoneSource = meta.timezone_source;
      const needsClarification = meta.needs_timezone_clarification;

      // Match criteria:
      // - patient_timezone IS NOT NULL
      // - timezone_source = 'country'
      // - needs_timezone_clarification = false or falsy
      if (patientTimezone && timezoneSource === 'country' && needsClarification !== true) {
        staleRecords.push({
          id: row.id,
          patientName: row.patient_name,
          phoneNumber: row.phone_number,
          country: row.country,
          createdAt: row.created_at,
          metadata: meta
        });
      }
    }
  }

  console.log(`Found ${staleRecords.length} stale record(s):\n`);
  staleRecords.forEach((r, idx) => {
    console.log(`[${idx + 1}] ID: ${r.id}`);
    console.log(`    Name: ${r.patientName} (${r.phoneNumber})`);
    console.log(`    Country: ${r.country}`);
    console.log(`    Metadata:`, JSON.stringify(r.metadata, null, 2));
    console.log("------------------------------------------");
  });

  console.log("\n=== DRY-RUN CLEANUP PROPOSAL ===");
  console.log("For each identified stale record, we propose updating their metadata to enforce clarification:");
  console.log("1. set needs_timezone_clarification = true");
  console.log("2. timezone_source -> 'country_ambiguous' (or 'unknown')");
  console.log("3. patient_timezone -> Keep it in metadata for reference, but since needs_timezone_clarification = true, resolver will automatically ignore it and return null for display.");
  console.log("\n✅ Audit complete.");
}

main().catch(console.error);
