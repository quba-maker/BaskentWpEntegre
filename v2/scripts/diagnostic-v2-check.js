const { neon } = require("@neondatabase/serverless");
require("dotenv").config({ path: ".env.local" });

async function run() {
  const sql = neon(process.env.DATABASE_URL);
  try {
    console.log("=== V2 ENTITIES AUDIT ===");
    
    const channelGroups = await sql`
      SELECT cg.id, cg.tenant_id, t.slug as tenant_slug, cg.name, cg.status
      FROM channel_groups cg
      JOIN tenants t ON cg.tenant_id = t.id
    `;
    console.log("\n--- Channel Groups in DB ---");
    console.log(JSON.stringify(channelGroups, null, 2));

    const channels = await sql`
      SELECT c.id, c.group_id, cg.name as group_name, t.slug as tenant_slug, c.provider, c.identifier, c.name
      FROM channels c
      JOIN channel_groups cg ON c.group_id = cg.id
      JOIN tenants t ON cg.tenant_id = t.id
    `;
    console.log("\n--- Channels in DB ---");
    console.log(JSON.stringify(channels, null, 2));

    const integrations = await sql`
      SELECT ci.id, ci.channel_id, c.provider, c.identifier, t.slug as tenant_slug, ci.health_status, ci.last_sync_at
      FROM channel_integrations ci
      JOIN channels c ON ci.channel_id = c.id
      JOIN channel_groups cg ON c.group_id = cg.id
      JOIN tenants t ON cg.tenant_id = t.id
    `;
    console.log("\n--- Channel Integrations in DB ---");
    console.log(JSON.stringify(integrations, null, 2));

    const aiProfiles = await sql`
      SELECT cap.id, cap.group_id, cg.name as group_name, t.slug as tenant_slug, cap.ai_model, cap.language_profile
      FROM channel_ai_profiles cap
      JOIN channel_groups cg ON cap.group_id = cg.id
      JOIN tenants t ON cg.tenant_id = t.id
    `;
    console.log("\n--- AI Profiles in DB ---");
    console.log(JSON.stringify(aiProfiles, null, 2));

    const prompts = await sql`
      SELECT cp.id, cp.group_id, cp.tenant_id, t.slug as tenant_slug, cp.name, cp.prompt_type
      FROM channel_prompts cp
      LEFT JOIN tenants t ON cp.tenant_id = t.id
    `;
    console.log("\n--- Prompts in DB ---");
    console.log(JSON.stringify(prompts, null, 2));

    const bindings = await sql`
      SELECT cpb.id, cpb.channel_id, c.name as channel_name, cpb.prompt_id, cp.name as prompt_name
      FROM channel_prompt_bindings cpb
      JOIN channels c ON cpb.channel_id = c.id
      JOIN channel_prompts cp ON cpb.prompt_id = cp.id
    `;
    console.log("\n--- Prompt Bindings in DB ---");
    console.log(JSON.stringify(bindings, null, 2));

    const pipelines = await sql`
      SELECT ip.id, ip.tenant_id, t.slug as tenant_slug, ip.name, ip.provider, ip.is_active, ip.config
      FROM ingestion_pipelines ip
      JOIN tenants t ON ip.tenant_id = t.id
    `;
    console.log("\n--- Ingestion Pipelines (Google Sheets, etc.) in DB ---");
    console.log(JSON.stringify(pipelines, null, 2));

  } catch (e) {
    console.error("Diagnostic error:", e);
  }
}

run();
