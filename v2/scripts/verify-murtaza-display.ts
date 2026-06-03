import { neon } from "@neondatabase/serverless";
import dotenv from "dotenv";
import path from "path";
import { resolvePatientTimeDisplay } from "../src/lib/utils/timezone";

dotenv.config({ path: path.join(__dirname, "../.env.local") });
const appDatabaseUrl = process.env.APP_DATABASE_URL || process.env.DATABASE_URL;

async function main() {
  if (!appDatabaseUrl) {
    console.error("No database URL found in env.");
    process.exit(1);
  }
  const sql = neon(appDatabaseUrl);
  const murtazaPhone = "905546833306";

  console.log("=== MURTAZA LIVE DB QUERY ===");
  const opps = await sql`
    SELECT id, patient_name, phone_number, country, stage, metadata
    FROM opportunities
    WHERE phone_number = ${murtazaPhone}
    ORDER BY created_at DESC
  `;

  if (opps.length === 0) {
    console.log("Murtaza not found in opportunities database!");
    return;
  }

  const murtaza = opps[0];
  console.log("Found opportunity in DB:", {
    id: murtaza.id,
    patient_name: murtaza.patient_name,
    phone_number: murtaza.phone_number,
    country: murtaza.country,
    metadata: murtaza.metadata
  });

  console.log("\n=== RUNNING UI PROJECTION FOR MURTAZA ===");
  const result = resolvePatientTimeDisplay({
    country: murtaza.country || "Amerika", // fallback to country from database/context
    city: murtaza.metadata?.patient_city,
    timezone: murtaza.metadata?.patient_timezone,
    metadata: murtaza.metadata,
    referenceDate: new Date("2026-06-03T12:00:00Z") // fixed reference date for clean output
  });

  console.log("Computed Timezone Display Result:");
  console.log(JSON.stringify(result, null, 2));

  console.log("\n✅ Murtaza Verification Complete!");
}

main().catch(console.error);
