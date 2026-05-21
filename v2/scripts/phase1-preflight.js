const { neon } = require("@neondatabase/serverless");
require("dotenv").config({ path: ".env.local" });

async function preflight() {
  const sql = neon(process.env.DATABASE_URL);
  const results = {};
  let allClear = true;

  function check(name, pass, detail) {
    results[name] = { pass, detail };
    if (!pass) allClear = false;
    console.log(`${pass ? '✅' : '❌'} ${name}: ${typeof detail === 'object' ? JSON.stringify(detail) : detail}`);
  }

  try {
    console.log("╔══════════════════════════════════════════════════════╗");
    console.log("║   PHASE 1 PRE-FLIGHT SAFETY CHECK                  ║");
    console.log("╚══════════════════════════════════════════════════════╝\n");

    // ──────────────────────────────────────────────
    // CHECK 1: Both tenants exist
    // ──────────────────────────────────────────────
    console.log("─── 1. TENANT INVENTORY ───");
    const tenants = await sql`
      SELECT id, slug, name, status, schema_version 
      FROM tenants ORDER BY slug
    `;
    console.log(JSON.stringify(tenants, null, 2));
    
    const realTenant = tenants.find(t => t.slug === 'baskent');
    const shadowTenant = tenants.find(t => t.slug === 'baskent-shadow');
    
    check("Real tenant exists", !!realTenant, realTenant?.id || 'NOT FOUND');
    check("Shadow tenant exists", !!shadowTenant, shadowTenant?.id || 'NOT FOUND');

    const REAL_ID = realTenant?.id;
    const SHADOW_ID = shadowTenant?.id;

    // ──────────────────────────────────────────────
    // CHECK 2: Prompt cross-wiring confirmation
    // ──────────────────────────────────────────────
    console.log("\n─── 2. PROMPT CROSS-WIRING ───");
    const prompts = await sql`
      SELECT cp.id, cp.tenant_id, t.slug as tenant_slug, cp.group_id, 
             cg.name as group_name, cgt.slug as group_tenant_slug,
             cp.name, cp.prompt_type
      FROM channel_prompts cp
      LEFT JOIN tenants t ON cp.tenant_id = t.id
      LEFT JOIN channel_groups cg ON cp.group_id = cg.id
      LEFT JOIN tenants cgt ON cg.tenant_id = cgt.id
    `;
    console.log(JSON.stringify(prompts, null, 2));

    const crossWired = prompts.filter(p => p.tenant_slug !== p.group_tenant_slug);
    check("Cross-wired prompts found", crossWired.length > 0, `${crossWired.length} prompts pointing to shadow while group points to real`);
    
    const promptsOnShadow = prompts.filter(p => p.tenant_id === SHADOW_ID);
    check("Prompts needing migration", promptsOnShadow.length > 0, `${promptsOnShadow.length} prompts on shadow tenant`);

    // ──────────────────────────────────────────────
    // CHECK 3: Prompt bindings integrity
    // ──────────────────────────────────────────────
    console.log("\n─── 3. PROMPT BINDINGS ───");
    const bindings = await sql`
      SELECT cpb.id, cpb.channel_id, cpb.prompt_id, 
             c.name as channel_name, c.provider,
             cp.name as prompt_name, cp.tenant_id as prompt_tenant_id
      FROM channel_prompt_bindings cpb
      JOIN channels c ON cpb.channel_id = c.id
      JOIN channel_prompts cp ON cpb.prompt_id = cp.id
    `;
    console.log(JSON.stringify(bindings, null, 2));
    check("Bindings exist", bindings.length > 0, `${bindings.length} bindings`);

    // ──────────────────────────────────────────────
    // CHECK 4: Channel groups + orphan detection
    // ──────────────────────────────────────────────
    console.log("\n─── 4. CHANNEL GROUPS & ORPHAN DETECTION ───");
    const groups = await sql`
      SELECT cg.id, cg.name, cg.tenant_id, cg.status, t.slug as tenant_slug,
             (SELECT COUNT(*) FROM channels WHERE group_id = cg.id) as channel_count,
             (SELECT COUNT(*) FROM channel_ai_profiles WHERE group_id = cg.id) as ai_profile_count,
             (SELECT COUNT(*) FROM channel_prompts WHERE group_id = cg.id) as prompt_count
      FROM channel_groups cg
      JOIN tenants t ON cg.tenant_id = t.id
      ORDER BY cg.name
    `;
    console.log(JSON.stringify(groups, null, 2));

    const orphanGroups = groups.filter(g => parseInt(g.channel_count) === 0);
    console.log(`\nOrphan groups (zero channels): ${orphanGroups.length}`);
    orphanGroups.forEach(g => {
      console.log(`  - ${g.id} | "${g.name}" | prompts=${g.prompt_count} | ai_profiles=${g.ai_profile_count}`);
    });

    // ──────────────────────────────────────────────
    // CHECK 5: FK dependencies on shadow tenant
    // ──────────────────────────────────────────────
    console.log("\n─── 5. SHADOW TENANT FK DEPENDENCIES ───");
    
    if (SHADOW_ID) {
      const shadowGroups = await sql`SELECT COUNT(*) as c FROM channel_groups WHERE tenant_id = ${SHADOW_ID}`;
      check("Shadow has channel_groups", true, `${shadowGroups[0].c} groups`);

      const shadowPrompts = await sql`SELECT COUNT(*) as c FROM channel_prompts WHERE tenant_id = ${SHADOW_ID}`;
      check("Shadow has channel_prompts", true, `${shadowPrompts[0].c} prompts`);

      const shadowConversations = await sql`SELECT COUNT(*) as c FROM conversations WHERE tenant_id = ${SHADOW_ID}`;
      check("Shadow conversations", true, `${shadowConversations[0].c} conversations`);

      const shadowMessages = await sql`SELECT COUNT(*) as c FROM messages WHERE tenant_id = ${SHADOW_ID}`;
      check("Shadow messages", true, `${shadowMessages[0].c} messages`);

      const shadowSettings = await sql`SELECT COUNT(*) as c FROM settings WHERE tenant_id = ${SHADOW_ID}`;
      check("Shadow settings", true, `${shadowSettings[0].c} settings`);

      const shadowUsers = await sql`SELECT COUNT(*) as c FROM users WHERE tenant_id = ${SHADOW_ID}`;
      check("Shadow users", true, `${shadowUsers[0].c} users`);

      const shadowLeads = await sql`SELECT COUNT(*) as c FROM leads WHERE tenant_id = ${SHADOW_ID}`;
      check("Shadow leads", true, `${shadowLeads[0].c} leads`);

      // Check customer_profiles if exists
      try {
        const shadowCustomers = await sql`SELECT COUNT(*) as c FROM customer_profiles WHERE tenant_id = ${SHADOW_ID}`;
        check("Shadow customer_profiles", true, `${shadowCustomers[0].c} customer profiles`);
      } catch(e) {
        check("Shadow customer_profiles", true, "table may not exist");
      }
    }

    // ──────────────────────────────────────────────
    // CHECK 6: Ingestion pipelines current state
    // ──────────────────────────────────────────────
    console.log("\n─── 6. INGESTION PIPELINES ───");
    const pipelines = await sql`
      SELECT * FROM ingestion_pipelines
    `;
    check("Ingestion pipelines empty", pipelines.length === 0, `${pipelines.length} rows`);

    // Check if google_sheets_config exists in settings
    const sheetsConfig = await sql`
      SELECT key, LENGTH(value) as value_length, tenant_id, t.slug
      FROM settings s
      JOIN tenants t ON s.tenant_id = t.id
      WHERE key = 'google_sheets_config'
    `;
    check("Google Sheets config in settings", sheetsConfig.length > 0, 
      sheetsConfig.length > 0 ? `Found for tenant: ${sheetsConfig[0].slug}, value length: ${sheetsConfig[0].value_length}` : 'NOT FOUND');
    
    if (sheetsConfig.length > 0) {
      // Show actual config content for verification
      const fullConfig = await sql`SELECT value FROM settings WHERE key = 'google_sheets_config' AND tenant_id = ${REAL_ID}`;
      if (fullConfig.length > 0) {
        try {
          const parsed = JSON.parse(fullConfig[0].value);
          console.log("  Google Sheets Config Preview:", JSON.stringify(parsed, null, 2).substring(0, 500));
        } catch(e) {
          console.log("  Config is not valid JSON:", fullConfig[0].value?.substring(0, 200));
        }
      }
    }

    // ──────────────────────────────────────────────
    // CHECK 7: ingestion_pipelines table schema
    // ──────────────────────────────────────────────
    console.log("\n─── 7. INGESTION_PIPELINES TABLE SCHEMA ───");
    try {
      const cols = await sql`
        SELECT column_name, data_type, is_nullable, column_default 
        FROM information_schema.columns 
        WHERE table_name = 'ingestion_pipelines' 
        ORDER BY ordinal_position
      `;
      console.log(JSON.stringify(cols, null, 2));
      check("ingestion_pipelines table exists", cols.length > 0, `${cols.length} columns`);
    } catch(e) {
      check("ingestion_pipelines table exists", false, "TABLE DOES NOT EXIST");
    }

    // ──────────────────────────────────────────────
    // SUMMARY
    // ──────────────────────────────────────────────
    console.log("\n╔══════════════════════════════════════════════════════╗");
    console.log(`║   PREFLIGHT RESULT: ${allClear ? '✅ ALL CLEAR' : '⚠️  REVIEW NEEDED'}                    ║`);
    console.log("╚══════════════════════════════════════════════════════╝\n");

    console.log("REAL TENANT ID:", REAL_ID);
    console.log("SHADOW TENANT ID:", SHADOW_ID);

  } catch (e) {
    console.error("❌ PREFLIGHT FAILED:", e.message);
    console.error(e);
  }
}

preflight();
