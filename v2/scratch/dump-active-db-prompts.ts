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
  const sql = neon(appDatabaseUrl);

  try {
    console.log("Querying channel_prompt_bindings...");
    const res1 = await sql.query(`SELECT * FROM channel_prompt_bindings LIMIT 1`);
    console.log("channel_prompt_bindings success:", res1.length);
  } catch (e) {
    console.error("channel_prompt_bindings error:", e);
  }

  try {
    console.log("Querying channel_prompts...");
    const res2 = await sql.query(`SELECT * FROM channel_prompts LIMIT 1`);
    console.log("channel_prompts success:", res2.length);
  } catch (e) {
    console.error("channel_prompts error:", e);
  }
}

main().catch(err => {
  console.error(err);
});
