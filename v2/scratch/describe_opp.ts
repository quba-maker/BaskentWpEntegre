import { neon } from "@neondatabase/serverless";
import dotenv from "dotenv";
import path from "path";

dotenv.config({ path: path.join(__dirname, "../.env.local") });
const appDatabaseUrl = process.env.APP_DATABASE_URL || process.env.DATABASE_URL;

async function main() {
  if (!appDatabaseUrl) {
    console.error("No database URL found in env.");
    process.exit(1);
  }
  const sql = neon(appDatabaseUrl);

  console.log("=== OPPORTUNITIES COLUMNS ===");
  const oppCols = await sql`
    SELECT column_name, data_type, is_nullable, column_default
    FROM information_schema.columns
    WHERE table_name = 'opportunities'
    ORDER BY ordinal_position
  `;
  console.log(JSON.stringify(oppCols, null, 2));

  console.log("\n=== FOLLOW_UP_TASKS COLUMNS ===");
  const taskCols = await sql`
    SELECT column_name, data_type, is_nullable, column_default
    FROM information_schema.columns
    WHERE table_name = 'follow_up_tasks'
    ORDER BY ordinal_position
  `;
  console.log(JSON.stringify(taskCols, null, 2));
}

main().catch(console.error);
