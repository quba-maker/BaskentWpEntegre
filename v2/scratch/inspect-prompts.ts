import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
import { withTenantDB } from '../src/lib/core/tenant-db';

async function main() {
  const tenantId = 'caab9ea1-9591-45e4-bbc5-9c9b498982c8';
  const db = withTenantDB(tenantId);

  console.log("DATABASE_URL:", process.env.DATABASE_URL ? "SET" : "NOT SET");
  console.log("APP_DATABASE_URL:", process.env.APP_DATABASE_URL ? "SET" : "NOT SET");

  console.log("Fetching active prompt bindings...");
  const bindings = await db.executeSafe({
    text: `
      SELECT cpb.channel_id, c.identifier, cp.id as prompt_id, cp.name as prompt_name, cp.version, LEFT(cp.prompt_text, 100) as text_preview, LENGTH(cp.prompt_text) as len
      FROM channel_prompt_bindings cpb
      JOIN channel_prompts cp ON cpb.prompt_id = cp.id
      JOIN channels c ON cpb.channel_id = c.id
      WHERE cp.tenant_id = $1 AND cpb.is_active = true
    `,
    values: [tenantId]
  }) as any[];

  console.log("Active prompt bindings found:", bindings.length);
  for (const b of bindings) {
    console.log(`Channel Identifier: ${b.identifier}`);
    console.log(`Channel ID: ${b.channel_id}`);
    console.log(`Prompt ID: ${b.prompt_id}`);
    console.log(`Prompt Name: ${b.prompt_name} (v${b.version})`);
    console.log(`Length: ${b.len}`);
    console.log(`Preview: ${b.text_preview}...\n`);
  }

  // Also query settings table system prompts just in case V1 fallback is used
  const settingsPrompts = await db.executeSafe({
    text: `SELECT key, value FROM settings WHERE tenant_id = $1 AND key LIKE '%prompt%'`,
    values: [tenantId]
  }) as any[];
  console.log("Settings table prompts found:", settingsPrompts.length);
  for (const s of settingsPrompts) {
    console.log(`Key: ${s.key}, Length: ${s.value?.length || 0}`);
  }
}

main().catch(err => {
  console.error("Error:", err);
});
