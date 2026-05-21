const { neon } = require("@neondatabase/serverless");
require("dotenv").config({ path: ".env.local" });

async function verify() {
  const sql = neon(process.env.DATABASE_URL);

  console.log("╔══════════════════════════════════════════════════════╗");
  console.log("║   PHASE 1 POST-MIGRATION VERIFICATION              ║");
  console.log("╚══════════════════════════════════════════════════════╝\n");

  // 1. Prompt Ownership
  console.log("─── 1. PROMPT OWNERSHIP ───");
  const prompts = await sql`
    SELECT cp.id, cp.tenant_id, t.slug as prompt_tenant,
           cg.tenant_id as group_tenant_id, cgt.slug as group_tenant
    FROM channel_prompts cp
    JOIN tenants t ON cp.tenant_id = t.id
    JOIN channel_groups cg ON cp.group_id = cg.id
    JOIN tenants cgt ON cg.tenant_id = cgt.id
  `;
  const crossWired = prompts.filter(p => p.prompt_tenant !== p.group_tenant);
  console.log(`Total prompts: ${prompts.length}`);
  console.log(`Cross-wired: ${crossWired.length}`);
  console.log(`Result: ${crossWired.length === 0 ? '✅ CLEAN' : '❌ STILL CROSS-WIRED'}`);

  // 2. Ingestion Pipelines
  console.log("\n─── 2. INGESTION PIPELINES ───");
  const pipelines = await sql`
    SELECT ip.id, t.slug, ip.provider, ip.is_active, ip.config
    FROM ingestion_pipelines ip JOIN tenants t ON ip.tenant_id = t.id
  `;
  console.log(`Pipelines: ${pipelines.length}`);
  pipelines.forEach(p => console.log(`  ${p.is_active === 'true' ? '✅' : '⚠️'} ${p.slug} | ${p.provider} | active=${p.is_active}`));
  console.log(`Result: ${pipelines.length >= 1 ? '✅ EXISTS' : '❌ MISSING'}`);

  // 3. Channel Groups
  console.log("\n─── 3. CHANNEL GROUPS ───");
  const groups = await sql`
    SELECT cg.id, cg.name, cg.status, t.slug,
      (SELECT COUNT(*) FROM channels WHERE group_id = cg.id) as ch
    FROM channel_groups cg JOIN tenants t ON cg.tenant_id = t.id
    ORDER BY cg.status, cg.name
  `;
  groups.forEach(g => console.log(`  ${g.status === 'active' ? '✅' : '📦'} "${g.name}" | ${g.status} | channels=${g.ch} | tenant=${g.slug}`));
  
  const orphanActive = groups.filter(g => g.id === '771a6359-448b-4579-a626-249f432987e4' && g.status === 'active');
  console.log(`Orphan archived: ${orphanActive.length === 0 ? '✅ YES' : '❌ NO'}`);

  // 4. Shadow Tenant State (should still be active, OP4 not executed)
  console.log("\n─── 4. SHADOW TENANT STATE ───");
  const shadow = await sql`SELECT id, slug, status FROM tenants WHERE slug = 'baskent-shadow'`;
  console.log(`Shadow status: ${shadow[0]?.status}`);
  console.log(`Result: ${shadow[0]?.status === 'active' ? '✅ UNTOUCHED (OP4 skipped as ordered)' : '⚠️ UNEXPECTED STATE'}`);

  // 5. Shadow prompt references (should be ZERO after OP1)
  console.log("\n─── 5. SHADOW PROMPT REFERENCES ───");
  const shadowPrompts = await sql`
    SELECT COUNT(*) as c FROM channel_prompts
    WHERE tenant_id = '7ac1432a-a432-497a-8526-9394f51d0e2a'
  `;
  console.log(`Prompts still on shadow: ${shadowPrompts[0].c}`);
  console.log(`Result: ${parseInt(shadowPrompts[0].c) === 0 ? '✅ ZERO' : '❌ STILL REFERENCED'}`);

  // 6. Full V2 Entity Integrity
  console.log("\n─── 6. V2 ENTITY INTEGRITY ───");
  const fullCheck = await sql`
    SELECT
      (SELECT COUNT(*) FROM channel_groups WHERE status = 'active') as active_groups,
      (SELECT COUNT(*) FROM channels) as channels,
      (SELECT COUNT(*) FROM channel_integrations) as integrations,
      (SELECT COUNT(*) FROM channel_ai_profiles) as ai_profiles,
      (SELECT COUNT(*) FROM channel_prompts) as prompts,
      (SELECT COUNT(*) FROM channel_prompt_bindings) as bindings,
      (SELECT COUNT(*) FROM ingestion_pipelines) as pipelines
  `;
  const c = fullCheck[0];
  console.log(`  Active Groups:  ${c.active_groups}`);
  console.log(`  Channels:       ${c.channels}`);
  console.log(`  Integrations:   ${c.integrations}`);
  console.log(`  AI Profiles:    ${c.ai_profiles}`);
  console.log(`  Prompts:        ${c.prompts}`);
  console.log(`  Bindings:       ${c.bindings}`);
  console.log(`  Pipelines:      ${c.pipelines}`);

  // 7. Conversation & Message counts (ensure no data loss)
  console.log("\n─── 7. DATA INTEGRITY ───");
  const data = await sql`
    SELECT
      (SELECT COUNT(*) FROM conversations WHERE tenant_id = 'caab9ea1-9591-45e4-bbc5-9c9b498982c8') as conversations,
      (SELECT COUNT(*) FROM messages WHERE tenant_id = 'caab9ea1-9591-45e4-bbc5-9c9b498982c8') as messages,
      (SELECT COUNT(*) FROM leads WHERE tenant_id = 'caab9ea1-9591-45e4-bbc5-9c9b498982c8') as leads
  `;
  console.log(`  Conversations: ${data[0].conversations}`);
  console.log(`  Messages:      ${data[0].messages}`);
  console.log(`  Leads:         ${data[0].leads}`);
  console.log(`  Result: ${parseInt(data[0].conversations) > 0 ? '✅ DATA INTACT' : '⚠️ CHECK MANUALLY'}`);

  console.log("\n╔══════════════════════════════════════════════════════╗");
  console.log("║   VERIFICATION COMPLETE                             ║");
  console.log("╚══════════════════════════════════════════════════════╝");
}

verify().catch(e => console.error("Verification error:", e));
