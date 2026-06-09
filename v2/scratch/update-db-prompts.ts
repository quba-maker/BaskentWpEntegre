import { Pool } from '@neondatabase/serverless';
import * as dotenv from 'dotenv';
import * as fs from 'fs';
import * as path from 'path';
import { whatsappPrompt, turkcePrompt, foreignPrompt } from '../src/lib/domain/conversation/prompts';

dotenv.config({ path: '.env.local' });

const tenantId = 'caab9ea1-9591-45e4-bbc5-9c9b498982c8';
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function main() {
  const commit = process.argv.includes('--commit');
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupFile = path.join(__dirname, `prompts_backup_${timestamp}.json`);
  const rollbackSqlFile = path.join(__dirname, `prompts_rollback_${timestamp}.sql`);

  console.log(`=== DB PROMPT MIGRATION SCRIPT (${commit ? 'EXECUTION' : 'DRY-RUN'}) ===`);
  console.log(`Timestamp: ${timestamp}`);

  // 1. Fetch current settings prompts
  console.log("\nFetching current settings (V1) from database...");
  const settingsRes = await pool.query(
    `SELECT key, value FROM settings WHERE tenant_id = $1 AND key IN ('system_prompt_whatsapp', 'system_prompt_tr', 'system_prompt_foreign')`,
    [tenantId]
  );
  
  // 2. Fetch current channel prompts (V2)
  console.log("Fetching current channel_prompts (V2) from database...");
  const channelPromptsRes = await pool.query(
    `SELECT id, name, prompt_text, version FROM channel_prompts WHERE tenant_id = $1 AND name IN ('WhatsApp System Prompt', 'Social TR Prompt', 'Social Foreign Prompt')`,
    [tenantId]
  );

  const dbState = {
    settings: settingsRes.rows,
    channelPrompts: channelPromptsRes.rows
  };

  // 3. Save backup
  fs.writeFileSync(backupFile, JSON.stringify(dbState, null, 2), 'utf-8');
  console.log(`✔ Created local backup of current DB prompts: ${backupFile}`);

  // 4. Show Dry-Run Diff
  console.log("\n=== DRY-RUN DIFF ANALYSIS ===");
  
  // Whatsapp Prompt
  const currentWhatsAppDb = channelPromptsRes.rows.find(p => p.name === 'WhatsApp System Prompt');
  const currentWhatsAppSettings = settingsRes.rows.find(s => s.key === 'system_prompt_whatsapp');
  analyzeDiff('WhatsApp System Prompt (V2)', currentWhatsAppDb?.prompt_text, whatsappPrompt);
  analyzeDiff('system_prompt_whatsapp (V1)', currentWhatsAppSettings?.value, whatsappPrompt);

  // TR Prompt
  const currentTrDb = channelPromptsRes.rows.find(p => p.name === 'Social TR Prompt');
  const currentTrSettings = settingsRes.rows.find(s => s.key === 'system_prompt_tr');
  analyzeDiff('Social TR Prompt (V2)', currentTrDb?.prompt_text, turkcePrompt);
  analyzeDiff('system_prompt_tr (V1)', currentTrSettings?.value, turkcePrompt);

  // Foreign Prompt
  const currentForeignDb = channelPromptsRes.rows.find(p => p.name === 'Social Foreign Prompt');
  const currentForeignSettings = settingsRes.rows.find(s => s.key === 'system_prompt_foreign');
  analyzeDiff('Social Foreign Prompt (V2)', currentForeignDb?.prompt_text, foreignPrompt);
  analyzeDiff('system_prompt_foreign (V1)', currentForeignSettings?.value, foreignPrompt);

  // 5. Build Rollback SQL
  let rollbackSql = `-- ROLLBACK SCRIPT FOR MIGRATION ${timestamp}\n`;
  
  // Add rollback for settings
  settingsRes.rows.forEach(row => {
    rollbackSql += `UPDATE settings SET value = ${escapeSqlString(row.value)} WHERE tenant_id = '${tenantId}' AND key = '${row.key}';\n`;
  });

  // Add rollback for channel_prompts
  channelPromptsRes.rows.forEach(row => {
    rollbackSql += `UPDATE channel_prompts SET prompt_text = ${escapeSqlString(row.prompt_text)}, version = ${row.version} WHERE id = '${row.id}' AND tenant_id = '${tenantId}';\n`;
  });

  fs.writeFileSync(rollbackSqlFile, rollbackSql, 'utf-8');
  console.log(`✔ Generated rollback SQL file: ${rollbackSqlFile}`);

  if (!commit) {
    console.log("\nDry-run complete. Run with '--commit' to apply changes to the database.");
    await pool.end();
    return;
  }

  // 6. Apply Updates
  console.log("\nApplying updates to the database...");

  // Update Settings V1
  const settingsUpdates = [
    { key: 'system_prompt_whatsapp', value: whatsappPrompt },
    { key: 'system_prompt_tr', value: turkcePrompt },
    { key: 'system_prompt_foreign', value: foreignPrompt }
  ];

  for (const update of settingsUpdates) {
    const exists = settingsRes.rows.some(r => r.key === update.key);
    if (exists) {
      await pool.query(
        `UPDATE settings SET value = $1 WHERE tenant_id = $2 AND key = $3`,
        [update.value, tenantId, update.key]
      );
      console.log(`  ✔ Updated settings table key: ${update.key}`);
    } else {
      await pool.query(
        `INSERT INTO settings (tenant_id, key, value) VALUES ($1, $2, $3)`,
        [tenantId, update.key, update.value]
      );
      console.log(`  ✔ Inserted settings table key: ${update.key}`);
    }
  }

  // Update Channel Prompts V2
  const channelUpdates = [
    { name: 'WhatsApp System Prompt', value: whatsappPrompt },
    { name: 'Social TR Prompt', value: turkcePrompt },
    { name: 'Social Foreign Prompt', value: foreignPrompt }
  ];

  for (const update of channelUpdates) {
    const currentPrompt = channelPromptsRes.rows.find(p => p.name === update.name);
    if (currentPrompt) {
      const nextVersion = (currentPrompt.version || 0) + 1;
      await pool.query(
        `UPDATE channel_prompts SET prompt_text = $1, version = $2 WHERE id = $3 AND tenant_id = $4`,
        [update.value, nextVersion, currentPrompt.id, tenantId]
      );
      console.log(`  ✔ Updated channel_prompts table row: "${update.name}" (ID: ${currentPrompt.id}) to version ${nextVersion}`);
    } else {
      console.log(`  ⚠ Row "${update.name}" not found in channel_prompts for tenant ${tenantId}. Skipping V2 update for this name.`);
    }
  }

  console.log("\n✔ Database prompt update completed successfully.");
  await pool.end();
}

function analyzeDiff(name: string, before: string | undefined, after: string) {
  if (!before) {
    console.log(`- ${name}: [NEW ENTRY] (length: ${after.length} characters)`);
    return;
  }
  if (before === after) {
    console.log(`- ${name}: [NO CHANGE]`);
    return;
  }
  console.log(`- ${name}: [MODIFIED] Before: ${before.length} chars, After: ${after.length} chars`);
}

function escapeSqlString(str: string): string {
  if (str === null || str === undefined) return 'NULL';
  return `'` + str.replace(/'/g, "''") + `'`;
}

main().catch(async (err) => {
  console.error("Migration failed:", err);
  await pool.end();
});
