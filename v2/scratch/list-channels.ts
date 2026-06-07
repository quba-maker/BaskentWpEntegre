import dotenv from 'dotenv';
import path from 'path';
dotenv.config({ path: path.join(__dirname, '../.env.local') });

async function main() {
  const tenantId = 'caab9ea1-9591-45e4-bbc5-9c9b498982c8';
  const { withTenantDB } = await import('../src/lib/core/tenant-db');
  const db = withTenantDB(tenantId, true);

  console.log("Listing all channels...");
  const channels = await db.executeSafe({
    text: `SELECT id, identifier, name, provider, status, group_id FROM channels`,
    values: []
  }) as any[];
  
  for (const c of channels) {
    console.log(`Channel: name="${c.name}" identifier="${c.identifier}" provider="${c.provider}" id="${c.id}" group_id="${c.group_id}"`);
  }

  console.log("\nListing all active bindings...");
  const bindings = await db.executeSafe({
    text: `
      SELECT cpb.channel_id, c.identifier, c.name as channel_name, cpb.prompt_id, cpb.is_active, cp.name as prompt_name
      FROM channel_prompt_bindings cpb
      JOIN channels c ON cpb.channel_id = c.id
      JOIN channel_prompts cp ON cpb.prompt_id = cp.id
      WHERE cpb.is_active = true
    `,
    values: []
  }) as any[];
  
  for (const b of bindings) {
    console.log(`Binding: channel="${b.channel_name}" identifier="${b.identifier}" prompt_name="${b.prompt_name}" id="${b.prompt_id}"`);
  }
}

main().catch(err => console.error(err));
