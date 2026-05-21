/**
 * ═══════════════════════════════════════════════════════════════
 *  PHASE 2B STEP 2 — POST-DEPLOY VERIFICATION
 *  Verifies dual-read BrainResolver is working correctly
 *  with flag=false (V1 path active)
 * ═══════════════════════════════════════════════════════════════
 */

const { neon } = require("@neondatabase/serverless");
require("dotenv").config({ path: ".env.local" });

async function verify() {
  const sql = neon(process.env.DATABASE_URL);

  console.log("╔═══════════════════════════════════════════════════════════╗");
  console.log("║  PHASE 2B STEP 2 — VERIFICATION                         ║");
  console.log("╚═══════════════════════════════════════════════════════════╝\n");

  // 1. Feature flag check
  console.log("─── 1. Feature Flag State ───");
  const flagValue = process.env.USE_V2_BRAIN_RESOLUTION || 'undefined';
  console.log(`  USE_V2_BRAIN_RESOLUTION = ${flagValue}`);
  console.log(`  Expected: false or undefined (V1 path active)`);
  console.log(`  Status: ${(flagValue === 'false' || flagValue === 'undefined') ? '✅ SAFE' : '⚠️  V2 IS ACTIVE'}\n`);

  // 2. V2 data readiness check
  console.log("─── 2. V2 Data Readiness ───");
  
  const prompts = await sql`
    SELECT cp.name, LENGTH(cp.prompt_text) as chars, MD5(cp.prompt_text) as hash, cp.version,
           cpb.is_active as binding_active, c.provider, c.identifier
    FROM channel_prompt_bindings cpb
    JOIN channel_prompts cp ON cpb.prompt_id = cp.id
    JOIN channels c ON cpb.channel_id = c.id
    ORDER BY c.provider
  `;
  
  prompts.forEach(r => {
    const ok = r.chars > 50 && r.binding_active;
    console.log(`  ${ok ? '✅' : '❌'} ${r.provider} (${r.identifier}) → ${r.name} | chars=${r.chars} | v=${r.version} | active=${r.binding_active}`);
  });

  // 3. V1↔V2 hash match (critical for future flag flip)
  console.log("\n─── 3. V1 ↔ V2 Hash Integrity ───");
  const crossCheck = await sql`
    SELECT 
      s.key, cp.name,
      LENGTH(s.value) as v1_chars, LENGTH(cp.prompt_text) as v2_chars,
      MD5(s.value) as v1_hash, MD5(cp.prompt_text) as v2_hash,
      (MD5(s.value) = MD5(cp.prompt_text)) as match
    FROM settings s
    CROSS JOIN channel_prompts cp
    WHERE s.tenant_id = 'caab9ea1-9591-45e4-bbc5-9c9b498982c8'
      AND (
        (s.key = 'system_prompt_whatsapp' AND cp.name = 'WhatsApp System Prompt')
        OR (s.key = 'system_prompt_tr' AND cp.name = 'Social TR Prompt')
        OR (s.key = 'system_prompt_foreign' AND cp.name = 'Social Foreign Prompt')
      )
  `;

  let allMatch = true;
  crossCheck.forEach(r => {
    console.log(`  ${r.match ? '✅' : '❌'} ${r.key} ↔ ${r.name} | v1=${r.v1_chars} v2=${r.v2_chars} | match=${r.match}`);
    if (!r.match) allMatch = false;
  });

  // 4. AI Profiles check
  console.log("\n─── 4. Channel AI Profiles ───");
  const profiles = await sql`
    SELECT cap.ai_model, cap.max_messages, cap.max_response_tokens, cap.aggression_level,
           cg.name as group_name
    FROM channel_ai_profiles cap
    JOIN channel_groups cg ON cap.group_id = cg.id
    ORDER BY cg.name
  `;
  profiles.forEach(r => {
    console.log(`  ✅ ${r.group_name} | model=${r.ai_model} | maxMsg=${r.max_messages} | maxTokens=${r.max_response_tokens} | aggr=${r.aggression_level}`);
  });

  // 5. Final verdict
  console.log("\n╔═══════════════════════════════════════════════════════════╗");
  if (allMatch && prompts.every(r => r.chars > 50)) {
    console.log("║  ✅ STEP 2 VERIFIED — Ready for flag flip                ║");
  } else {
    console.log("║  ❌ STEP 2 ISSUES — DO NOT flip flag yet                 ║");
  }
  console.log("╚═══════════════════════════════════════════════════════════╝");
}

verify().catch(e => {
  console.error("Verify error:", e);
  process.exit(1);
});
