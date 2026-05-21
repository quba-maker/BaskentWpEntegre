const { neon } = require("@neondatabase/serverless");
require("dotenv").config({ path: ".env.local" });

async function audit() {
  const sql = neon(process.env.DATABASE_URL);

  console.log("╔═════════════════════════════════════════════════════════╗");
  console.log("║   PHASE 2B — BRAINRESOLVER V2 PRE-MIGRATION AUDIT      ║");
  console.log("╚═════════════════════════════════════════════════════════╝\n");

  // 1. Settings table — all AI-critical keys
  console.log("─── 1. SETTINGS TABLE (AI-CRITICAL KEYS) ───");
  const settings = await sql`
    SELECT s.key, 
           LEFT(s.value, 60) as value_preview, 
           LENGTH(s.value) as value_length,
           s.tenant_id,
           t.slug
    FROM settings s
    LEFT JOIN tenants t ON s.tenant_id = t.id
    WHERE s.key IN (
      'system_prompt_whatsapp', 'system_prompt_tr', 'system_prompt_foreign',
      'bot_knowledge_prices', 'bot_knowledge_rules',
      'ai_model', 'bot_max_messages', 'bot_max_response_tokens',
      'working_hours', 'bot_aggression_level'
    )
    ORDER BY t.slug, s.key
  `;
  settings.forEach(r => {
    console.log(`  ${r.slug || '(no tenant)'} | ${r.key} | len=${r.value_length} | ${r.value_preview}...`);
  });
  console.log(`  Total AI-critical settings rows: ${settings.length}`);

  // 2. channel_prompts table
  console.log("\n─── 2. CHANNEL_PROMPTS TABLE ───");
  const prompts = await sql`
    SELECT cp.id, cp.name, cp.prompt_type, LEFT(cp.prompt_text, 80) as text_preview,
           LENGTH(cp.prompt_text) as text_length, cp.version,
           cp.group_id, cp.tenant_id,
           t.slug,
           cg.name as group_name
    FROM channel_prompts cp
    LEFT JOIN tenants t ON cp.tenant_id = t.id
    LEFT JOIN channel_groups cg ON cp.group_id = cg.id
    ORDER BY t.slug, cp.name
  `;
  prompts.forEach(r => {
    console.log(`  ${r.slug || '?'} | ${r.name} | type=${r.prompt_type} | len=${r.text_length} | group=${r.group_name || 'NULL'}`);
  });
  console.log(`  Total channel_prompts rows: ${prompts.length}`);

  // 3. channel_ai_profiles table
  console.log("\n─── 3. CHANNEL_AI_PROFILES TABLE ───");
  const profiles = await sql`
    SELECT cap.id, cap.ai_model, cap.temperature, cap.aggression_level,
           cap.language_profile, cap.business_hours_json,
           cap.group_id, cg.name as group_name, t.slug
    FROM channel_ai_profiles cap
    LEFT JOIN channel_groups cg ON cap.group_id = cg.id
    LEFT JOIN tenants t ON cg.tenant_id = t.id
    ORDER BY t.slug
  `;
  profiles.forEach(r => {
    console.log(`  ${r.slug || '?'} | model=${r.ai_model} | temp=${r.temperature} | aggr=${r.aggression_level} | group=${r.group_name}`);
  });
  console.log(`  Total channel_ai_profiles rows: ${profiles.length}`);

  // 4. channel_prompt_bindings table
  console.log("\n─── 4. CHANNEL_PROMPT_BINDINGS TABLE ───");
  const bindings = await sql`
    SELECT cpb.id, cpb.channel_id, cpb.prompt_id, cpb.priority, cpb.is_active,
           c.provider, c.identifier, cp.name as prompt_name
    FROM channel_prompt_bindings cpb
    LEFT JOIN channels c ON cpb.channel_id = c.id
    LEFT JOIN channel_prompts cp ON cpb.prompt_id = cp.id
    ORDER BY c.provider
  `;
  bindings.forEach(r => {
    console.log(`  ${r.provider} (${r.identifier}) → ${r.prompt_name} | priority=${r.priority} | active=${r.is_active}`);
  });
  console.log(`  Total bindings rows: ${bindings.length}`);

  // 5. Channels overview
  console.log("\n─── 5. CHANNELS (for binding mapping) ───");
  const channels = await sql`
    SELECT c.id, c.provider, c.identifier, cg.name as group_name, t.slug
    FROM channels c
    JOIN channel_groups cg ON c.group_id = cg.id
    JOIN tenants t ON cg.tenant_id = t.id
    WHERE t.slug = 'baskent'
    ORDER BY c.provider
  `;
  channels.forEach(r => {
    console.log(`  ${r.provider} | id=${r.id} | identifier=${r.identifier} | group=${r.group_name}`);
  });

  console.log("\n═══════════════════════════════════════════════════════════");
  console.log("  AUDIT COMPLETE");
  console.log("═══════════════════════════════════════════════════════════");
}

audit().catch(e => console.error("Audit error:", e));
