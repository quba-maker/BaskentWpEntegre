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
  const tenantId = 'caab9ea1-9591-45e4-bbc5-9c9b498982c8';
  console.log("Connecting directly to database...");
  const sql = neon(appDatabaseUrl);

  console.log("Fetching active prompt bindings...");
  const bindings = await sql.query(`
    SELECT cpb.channel_id, c.identifier, cp.id as prompt_id, cp.name as prompt_name, cp.version, cp.prompt_text, LENGTH(cp.prompt_text) as len
    FROM channel_prompt_bindings cpb
    JOIN channel_prompts cp ON cpb.prompt_id = cp.id
    JOIN channels c ON cpb.channel_id = c.id
    WHERE cp.tenant_id = $1 AND cpb.is_active = true
  `, [tenantId]);

  console.log("Active prompt bindings found:", bindings.length);
  for (const b of bindings) {
    console.log(`-----------------------------------------------`);
    console.log(`Channel Identifier: ${b.identifier}`);
    console.log(`Channel ID: ${b.channel_id}`);
    console.log(`Prompt ID: ${b.prompt_id}`);
    console.log(`Prompt Name: ${b.prompt_name} (v${b.version})`);
    console.log(`Length: ${b.len}`);
    console.log(`Prompt Text:\n${b.prompt_text}\n`);
  }

  // Also query settings table system prompts just in case V1 fallback is used
  const settingsPrompts = await sql.query(`
    SELECT key, value FROM settings WHERE tenant_id = $1 AND key LIKE '%prompt%'
  `, [tenantId]);
  console.log("Settings table prompts found:", settingsPrompts.length);
  for (const s of settingsPrompts) {
    console.log(`Key: ${s.key}, Length: ${s.value?.length || 0}`);
    console.log(`Value:\n${s.value}\n`);
  }
}

main().catch(err => {
  console.error("Error:", err);
});
