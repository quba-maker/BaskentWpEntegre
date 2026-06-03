import { neon } from "@neondatabase/serverless";
import * as dotenv from "dotenv";
import path from "path";

dotenv.config({ path: path.join(__dirname, "../.env.local") });
const appDatabaseUrl = process.env.APP_DATABASE_URL || process.env.DATABASE_URL;

async function main() {
  if (!appDatabaseUrl) {
    console.error("No database URL");
    process.exit(1);
  }
  console.log("Connecting to:", appDatabaseUrl);
  const sql = neon(appDatabaseUrl);
  const res = await sql`SELECT 1 as one`;
  console.log("Result:", res);
}

main().catch(console.error);
