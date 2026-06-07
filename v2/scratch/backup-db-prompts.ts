import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';
dotenv.config({ path: path.join(__dirname, '../.env.local') });

async function main() {
  const tenantId = 'caab9ea1-9591-45e4-bbc5-9c9b498982c8';
  const { withTenantDB } = await import('../src/lib/core/tenant-db');
  const db = withTenantDB(tenantId, true);

  console.log("Fetching active prompt for Başkent 360dialog Live...");
  const bindings = await db.executeSafe({
    text: `
      SELECT cp.id as prompt_id, cp.name as prompt_name, cp.version, cp.prompt_text
      FROM channel_prompt_bindings cpb
      JOIN channel_prompts cp ON cpb.prompt_id = cp.id
      JOIN channels c ON cpb.channel_id = c.id
      WHERE cp.tenant_id = $1 AND cpb.is_active = true AND c.identifier = '203576826173902'
    `,
    values: [tenantId]
  }) as any[];

  if (bindings.length === 0) {
    console.error("No active prompt found for WhatsApp channel!");
    return;
  }

  const prompt = bindings[0];
  const backupPath = path.join(__dirname, 'backup_baskent_whatsapp_db_prompt.txt');
  fs.writeFileSync(backupPath, prompt.prompt_text, 'utf-8');
  console.log(`Successfully backed up prompt to: ${backupPath}`);
  console.log(`Prompt ID: ${prompt.prompt_id}, Name: ${prompt.prompt_name}, Version: ${prompt.version}`);
}

main().catch(err => {
  console.error("Error:", err);
});
