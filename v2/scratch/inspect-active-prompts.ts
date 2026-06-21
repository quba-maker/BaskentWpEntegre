import './preload';
import { Pool } from '@neondatabase/serverless';
import * as dotenv from 'dotenv';

const tenantId = 'caab9ea1-9591-45e4-bbc5-9c9b498982c8';
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function main() {
  console.log("=== ENVIRONMENT FLAGS ===");
  console.log("USE_V2_BRAIN_RESOLUTION:", process.env.USE_V2_BRAIN_RESOLUTION);
  console.log("USE_V1_FALLBACK:", process.env.USE_V1_FALLBACK);
  console.log("USE_STRICT_V2:", process.env.USE_STRICT_V2);

  // 1. Fetch from settings (V1)
  console.log("\n=== V1 SETTINGS PROMPTS ===");
  const settingsRes = await pool.query(
    `SELECT key, SUBSTRING(value, 1, 100) as value_preview, LENGTH(value) as len 
     FROM settings 
     WHERE tenant_id = $1 AND key LIKE 'system_prompt%'`,
    [tenantId]
  );
  console.table(settingsRes.rows);

  // 2. Fetch from V2 channel bindings and prompts
  console.log("\n=== V2 CHANNEL BINDINGS & PROMPTS ===");
  const bindingsRes = await pool.query(
    `SELECT cpb.channel_id, cpb.is_active, cpb.priority, cp.id as prompt_id, cp.name as prompt_name, cp.version, LENGTH(cp.prompt_text) as len, SUBSTRING(cp.prompt_text, 1, 100) as prompt_preview
     FROM channel_prompt_bindings cpb
     JOIN channel_prompts cp ON cpb.prompt_id = cp.id
     WHERE cp.tenant_id = $1`,
    [tenantId]
  );
  console.table(bindingsRes.rows);

  // 3. Fetch all channel prompts for this tenant
  console.log("\n=== ALL CHANNEL PROMPTS ===");
  const promptsRes = await pool.query(
    `SELECT id, name, prompt_type, version, LENGTH(prompt_text) as len, SUBSTRING(prompt_text, 1, 100) as prompt_preview
     FROM channel_prompts
     WHERE tenant_id = $1`,
    [tenantId]
  );
  console.table(promptsRes.rows);

  await pool.end();
}

main().catch(console.error);
