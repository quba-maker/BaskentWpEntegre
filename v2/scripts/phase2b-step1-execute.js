/**
 * ═══════════════════════════════════════════════════════════════
 *  PHASE 2B — STEP 1: PROMPT DATA MIGRATION
 *  Copy production prompts from V1 settings → V2 channel_prompts
 * ═══════════════════════════════════════════════════════════════
 * 
 *  WHAT THIS DOES:
 *    Overwrites placeholder text in channel_prompts with full
 *    production prompts from the settings table.
 * 
 *  WHAT THIS DOES NOT:
 *    - Does NOT modify bindings
 *    - Does NOT modify channels or groups
 *    - Does NOT change runtime code
 *    - Does NOT delete any rows
 *    - Does NOT touch schema
 * 
 *  SAFE TO RUN: Yes — production reads from settings (V1),
 *  not channel_prompts (V2). This only pre-stages V2 data.
 * ═══════════════════════════════════════════════════════════════
 */

const { neon } = require("@neondatabase/serverless");
require("dotenv").config({ path: ".env.local" });

const BASKENT_TENANT_ID = 'caab9ea1-9591-45e4-bbc5-9c9b498982c8';

// Exact V2 prompt IDs from pre-migration audit
const PROMPT_IDS = {
  whatsapp:       '9b736e84-5a70-4eed-a398-249863201962',
  social_tr:      '98255b9e-a526-4767-95dd-45877ad5abec',
  social_foreign: 'e8194c41-dc4b-41fd-a4ab-43ca52b08f02'
};

// V1 settings keys that map to each V2 prompt
const SETTINGS_MAP = {
  whatsapp:       'system_prompt_whatsapp',
  social_tr:      'system_prompt_tr',
  social_foreign: 'system_prompt_foreign'
};

async function execute() {
  const sql = neon(process.env.DATABASE_URL);

  console.log("╔═══════════════════════════════════════════════════════════╗");
  console.log("║  PHASE 2B STEP 1 — PROMPT DATA MIGRATION (EXECUTE)      ║");
  console.log("╚═══════════════════════════════════════════════════════════╝\n");

  // ─── PRE-FLIGHT: Capture BEFORE state ───
  console.log("─── PRE-FLIGHT: Before State ───");
  const before = await sql`
    SELECT id, name, LENGTH(prompt_text) as chars, MD5(prompt_text) as hash, version
    FROM channel_prompts
    WHERE id IN (${PROMPT_IDS.whatsapp}, ${PROMPT_IDS.social_tr}, ${PROMPT_IDS.social_foreign})
    ORDER BY name
  `;
  before.forEach(r => {
    console.log(`  BEFORE | ${r.name} | chars=${r.chars} | md5=${r.hash} | v=${r.version}`);
  });

  // ─── PRE-FLIGHT: Verify V1 source exists ───
  console.log("\n─── PRE-FLIGHT: V1 Source Verification ───");
  const sources = await sql`
    SELECT key, LENGTH(value) as chars, MD5(value) as hash
    FROM settings
    WHERE tenant_id = ${BASKENT_TENANT_ID}
      AND key IN ('system_prompt_whatsapp', 'system_prompt_tr', 'system_prompt_foreign')
    ORDER BY key
  `;
  if (sources.length !== 3) {
    console.error("  ❌ ABORT: Expected 3 V1 source rows, found " + sources.length);
    process.exit(1);
  }
  sources.forEach(r => {
    console.log(`  SOURCE | ${r.key} | chars=${r.chars} | md5=${r.hash}`);
  });

  // ─── EXECUTE: Copy prompts ───
  console.log("\n─── EXECUTING MIGRATION ───");

  for (const [label, promptId] of Object.entries(PROMPT_IDS)) {
    const settingsKey = SETTINGS_MAP[label];
    
    // Fetch full prompt text from settings
    const sourceRows = await sql`
      SELECT value FROM settings 
      WHERE tenant_id = ${BASKENT_TENANT_ID} AND key = ${settingsKey}
    `;
    
    if (!sourceRows[0]?.value) {
      console.error(`  ❌ ABORT: No value found for ${settingsKey}`);
      process.exit(1);
    }

    const fullPrompt = sourceRows[0].value;

    // Update channel_prompts with full production text
    const result = await sql`
      UPDATE channel_prompts 
      SET prompt_text = ${fullPrompt},
          version = version + 1,
          updated_at = NOW()
      WHERE id = ${promptId}
      RETURNING id, name, LENGTH(prompt_text) as chars, version
    `;

    if (result.length === 0) {
      console.error(`  ❌ ABORT: UPDATE returned 0 rows for ${promptId}`);
      process.exit(1);
    }

    const r = result[0];
    console.log(`  ✅ ${r.name} | chars=${r.chars} | version=${r.version}`);
  }

  // ─── POST-FLIGHT: Verify AFTER state ───
  console.log("\n─── POST-FLIGHT: After State ───");
  const after = await sql`
    SELECT id, name, LENGTH(prompt_text) as chars, MD5(prompt_text) as hash, version
    FROM channel_prompts
    WHERE id IN (${PROMPT_IDS.whatsapp}, ${PROMPT_IDS.social_tr}, ${PROMPT_IDS.social_foreign})
    ORDER BY name
  `;
  after.forEach(r => {
    console.log(`  AFTER  | ${r.name} | chars=${r.chars} | md5=${r.hash} | v=${r.version}`);
  });

  // ─── CROSS-VALIDATION: V1 vs V2 hash comparison ───
  console.log("\n─── CROSS-VALIDATION: V1 vs V2 Hash Match ───");

  const crossCheck = await sql`
    SELECT 
      s.key as settings_key,
      cp.name as prompt_name,
      LENGTH(s.value) as v1_chars,
      LENGTH(cp.prompt_text) as v2_chars,
      MD5(s.value) as v1_hash,
      MD5(cp.prompt_text) as v2_hash,
      (MD5(s.value) = MD5(cp.prompt_text)) as hashes_match
    FROM settings s
    CROSS JOIN channel_prompts cp
    WHERE s.tenant_id = ${BASKENT_TENANT_ID}
      AND (
        (s.key = 'system_prompt_whatsapp' AND cp.id = ${PROMPT_IDS.whatsapp})
        OR (s.key = 'system_prompt_tr' AND cp.id = ${PROMPT_IDS.social_tr})
        OR (s.key = 'system_prompt_foreign' AND cp.id = ${PROMPT_IDS.social_foreign})
      )
    ORDER BY s.key
  `;

  let allMatch = true;
  crossCheck.forEach(r => {
    const icon = r.hashes_match ? '✅' : '❌';
    console.log(`  ${icon} ${r.settings_key} → ${r.prompt_name}`);
    console.log(`     V1: chars=${r.v1_chars} md5=${r.v1_hash}`);
    console.log(`     V2: chars=${r.v2_chars} md5=${r.v2_hash}`);
    console.log(`     Match: ${r.hashes_match}`);
    if (!r.hashes_match) allMatch = false;
  });

  // ─── FINAL VERDICT ───
  console.log("\n╔═══════════════════════════════════════════════════════════╗");
  if (allMatch) {
    console.log("║  ✅ MIGRATION SUCCESSFUL — ALL HASHES MATCH             ║");
  } else {
    console.log("║  ❌ MIGRATION FAILED — HASH MISMATCH DETECTED           ║");
  }
  console.log("╚═══════════════════════════════════════════════════════════╝");

  // ─── BINDINGS INTEGRITY CHECK ───
  console.log("\n─── BINDINGS INTEGRITY (must be unchanged) ───");
  const bindingsCheck = await sql`
    SELECT cpb.id, c.provider, c.identifier, cp.name, cpb.is_active
    FROM channel_prompt_bindings cpb
    JOIN channels c ON cpb.channel_id = c.id
    JOIN channel_prompts cp ON cpb.prompt_id = cp.id
    ORDER BY c.provider
  `;
  bindingsCheck.forEach(r => {
    console.log(`  ✅ ${r.provider} (${r.identifier}) → ${r.name} | active=${r.is_active}`);
  });
}

execute().catch(e => {
  console.error("❌ FATAL ERROR:", e.message);
  process.exit(1);
});
