import { sql } from '../src/lib/db';
import { resolvePatientTimeDisplay } from '../src/lib/utils/timezone';

async function runAudit() {
  console.log("=== STARTING PATIENT LOCATION AUDIT ===\n");
  
  const rows = await sql`
    SELECT 
      id,
      metadata,
      country,
      phone_number
    FROM opportunities
    WHERE stage NOT IN ('closed', 'closed_lost')
  `;
  
  console.log(`Found ${rows.length} active opportunities to analyze.\n`);
  
  let mismatchCount = 0;
  let multipleTimezoneCount = 0;
  let cleanCount = 0;
  let fallbackCount = 0;
  let totalAnalyzed = 0;
  
  const mismatchExamples = [];
  const multipleTimezoneExamples = [];
  
  for (const row of rows) {
    const timeDisplay = resolvePatientTimeDisplay({
      country: row.country,
      city: row.metadata?.patient_city,
      timezone: row.metadata?.patient_timezone,
      phoneNumber: row.phone_number,
      metadata: row.metadata,
      oppMetadata: row.metadata
    });
    
    totalAnalyzed++;
    
    if (timeDisplay.warning === 'country_timezone_source_mismatch') {
      mismatchCount++;
      if (mismatchExamples.length < 5) {
        mismatchExamples.push({
          id: row.id,
          residence_country: timeDisplay.residenceCountryLabel,
          phone_country: timeDisplay.phoneCountryLabel,
          timezone: row.metadata?.patient_timezone,
          reason: timeDisplay.sourceMismatch ? "Source Mismatch Detected" : "Invalid Timezone for Country"
        });
      }
    } else if (timeDisplay.warning === 'country_has_multiple_timezones') {
      multipleTimezoneCount++;
      if (multipleTimezoneExamples.length < 5) {
        multipleTimezoneExamples.push({
          id: row.id,
          residence_country: timeDisplay.residenceCountryLabel,
          city: row.metadata?.patient_city || 'None',
        });
      }
    } else if (timeDisplay.warning === 'fallback_turkey_time') {
      fallbackCount++;
    } else {
      cleanCount++;
    }
  }
  
  console.log("=== AUDIT RESULTS ===");
  console.log(`Total Analyzed: ${totalAnalyzed}`);
  console.log(`Clean (Valid Timezone Display): ${cleanCount}`);
  console.log(`Fallback (Unknown Country/Time): ${fallbackCount}`);
  console.log(`Source Mismatches (Polluted Data): ${mismatchCount}`);
  console.log(`Multiple Timezones (Missing City): ${multipleTimezoneCount}`);
  
  if (mismatchExamples.length > 0) {
    console.log("\n=== MISMATCH EXAMPLES (Polluted DB Records) ===");
    console.table(mismatchExamples);
  }
  
  if (multipleTimezoneExamples.length > 0) {
    console.log("\n=== MULTIPLE TIMEZONE EXAMPLES (Requires City) ===");
    console.table(multipleTimezoneExamples);
  }
  
  process.exit(0);
}

runAudit().catch(console.error);
