import { neon } from "@neondatabase/serverless";
import dotenv from "dotenv";
import path from "path";

dotenv.config({ path: path.join(__dirname, "../.env.local") });
const appDatabaseUrl = process.env.APP_DATABASE_URL || process.env.DATABASE_URL;

async function main() {
  if (!appDatabaseUrl) {
    console.error("No database URL");
    process.exit(1);
  }
  const sql = neon(appDatabaseUrl);

  const names = ["Aysu", "Ömer"];
  for (const name of names) {
    console.log(`\n=================== ${name} ===================`);
    const opps = await sql`
      SELECT id, patient_name, stage, phone_number
      FROM opportunities
      WHERE patient_name LIKE ${'%' + name + '%'}
    `;
    console.log("Opps:", opps);
    for (const opp of opps) {
      const tasks = await sql`
        SELECT id, task_type, title, status, due_at, created_at, metadata
        FROM follow_up_tasks
        WHERE opportunity_id = ${opp.id}
        ORDER BY created_at DESC
      `;
      console.log(`Tasks for Opp ${opp.patient_name} (${opp.id}):`, tasks);
    }
  }
}

main().catch(console.error);
