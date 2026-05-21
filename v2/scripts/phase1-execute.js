const { neon } = require("@neondatabase/serverless");
require("dotenv").config({ path: ".env.local" });

const REAL_TENANT = 'caab9ea1-9591-45e4-bbc5-9c9b498982c8';
const SHADOW_TENANT = '7ac1432a-a432-497a-8526-9394f51d0e2a';
const ORPHAN_GROUP = '771a6359-448b-4579-a626-249f432987e4';

async function executePhase1() {
  const sql = neon(process.env.DATABASE_URL);
  const report = { op1: null, op2: null, op3: null };

  try {
    // ════════════════════════════════════════════
    // OP1: Fix Prompt Cross-Wiring
    // ════════════════════════════════════════════
    console.log("═══════════════════════════════════════");
    console.log("  OP1: Fix Prompt Cross-Wiring");
    console.log("═══════════════════════════════════════");

    // Pre-check: How many prompts on shadow?
    const preOp1 = await sql`
      SELECT id, tenant_id, name FROM channel_prompts
      WHERE tenant_id = ${SHADOW_TENANT}
    `;
    console.log(`[PRE] Prompts on shadow tenant: ${preOp1.length}`);
    preOp1.forEach(p => console.log(`  - ${p.id} | ${p.name}`));

    if (preOp1.length === 0) {
      console.log("⚠️ No prompts to migrate. Already done?");
      report.op1 = { status: 'SKIPPED', reason: 'No prompts on shadow', rows: 0 };
    } else {
      // Execute migration
      const result = await sql`
        UPDATE channel_prompts
        SET tenant_id = ${REAL_TENANT}
        WHERE tenant_id = ${SHADOW_TENANT}
      `;
      console.log(`[EXEC] Updated rows:`, result);

      // Verify
      const postOp1 = await sql`
        SELECT cp.id, cp.tenant_id, t.slug as tenant_slug,
               cp.group_id, cg.name as group_name, cgt.slug as group_tenant_slug,
               cp.name
        FROM channel_prompts cp
        JOIN tenants t ON cp.tenant_id = t.id
        JOIN channel_groups cg ON cp.group_id = cg.id
        JOIN tenants cgt ON cg.tenant_id = cgt.id
      `;

      const stillCrossWired = postOp1.filter(p => p.tenant_slug !== p.group_tenant_slug);
      const stillOnShadow = postOp1.filter(p => p.tenant_id === SHADOW_TENANT);

      console.log(`[VERIFY] Total prompts: ${postOp1.length}`);
      console.log(`[VERIFY] Cross-wired: ${stillCrossWired.length}`);
      console.log(`[VERIFY] Still on shadow: ${stillOnShadow.length}`);
      postOp1.forEach(p => console.log(`  ✅ ${p.id} | tenant=${p.tenant_slug} | group_tenant=${p.group_tenant_slug} | ${p.name}`));

      if (stillCrossWired.length === 0 && stillOnShadow.length === 0) {
        console.log("✅ OP1 SUCCESS");
        report.op1 = { status: 'SUCCESS', rows: preOp1.length, crossWired: 0, onShadow: 0 };
      } else {
        console.log("❌ OP1 VERIFICATION FAILED");
        report.op1 = { status: 'FAILED', crossWired: stillCrossWired.length, onShadow: stillOnShadow.length };
      }
    }

    // ════════════════════════════════════════════
    // OP2: Create Ingestion Pipeline
    // ════════════════════════════════════════════
    console.log("\n═══════════════════════════════════════");
    console.log("  OP2: Create Ingestion Pipeline");
    console.log("═══════════════════════════════════════");

    // Pre-check: Is table empty?
    const preOp2 = await sql`SELECT COUNT(*) as c FROM ingestion_pipelines`;
    console.log(`[PRE] Existing pipelines: ${preOp2[0].c}`);

    if (parseInt(preOp2[0].c) > 0) {
      console.log("⚠️ Pipeline already exists. Skipping.");
      report.op2 = { status: 'SKIPPED', reason: 'Pipeline already exists', rows: parseInt(preOp2[0].c) };
    } else {
      // Fetch Google Sheets config from settings
      const sheetsConfig = await sql`
        SELECT value FROM settings
        WHERE key = 'google_sheets_config' AND tenant_id = ${REAL_TENANT}
        LIMIT 1
      `;

      if (sheetsConfig.length === 0) {
        console.log("❌ No google_sheets_config found in settings!");
        report.op2 = { status: 'FAILED', reason: 'No config in settings' };
      } else {
        let configJson;
        try {
          configJson = JSON.parse(sheetsConfig[0].value);
        } catch (e) {
          console.log("❌ Config is not valid JSON:", sheetsConfig[0].value);
          report.op2 = { status: 'FAILED', reason: 'Invalid JSON in settings' };
          throw new Error("Invalid config JSON");
        }

        console.log(`[PRE] Config: ${JSON.stringify(configJson)}`);

        // Execute INSERT
        await sql`
          INSERT INTO ingestion_pipelines (tenant_id, name, provider, config, is_active)
          VALUES (
            ${REAL_TENANT},
            'Google Sheets Lead Ingestion',
            'google_sheets',
            ${JSON.stringify(configJson)}::jsonb,
            'true'
          )
        `;

        // Verify
        const postOp2 = await sql`
          SELECT ip.id, ip.tenant_id, t.slug, ip.name, ip.provider, ip.is_active, ip.config
          FROM ingestion_pipelines ip
          JOIN tenants t ON ip.tenant_id = t.id
        `;

        console.log(`[VERIFY] Pipelines after insert: ${postOp2.length}`);
        postOp2.forEach(p => console.log(`  ✅ ${p.id} | tenant=${p.slug} | provider=${p.provider} | active=${p.is_active} | config=${JSON.stringify(p.config)}`));

        if (postOp2.length === 1 && postOp2[0].provider === 'google_sheets' && postOp2[0].slug === 'baskent') {
          console.log("✅ OP2 SUCCESS");
          report.op2 = { status: 'SUCCESS', pipelineId: postOp2[0].id, config: postOp2[0].config };
        } else {
          console.log("❌ OP2 VERIFICATION FAILED");
          report.op2 = { status: 'FAILED', rows: postOp2.length };
        }
      }
    }

    // ════════════════════════════════════════════
    // OP3: Archive Orphan Channel Group
    // ════════════════════════════════════════════
    console.log("\n═══════════════════════════════════════");
    console.log("  OP3: Archive Orphan Channel Group");
    console.log("═══════════════════════════════════════");

    // Pre-check: Verify orphan has zero children
    const preOp3Channels = await sql`SELECT COUNT(*) as c FROM channels WHERE group_id = ${ORPHAN_GROUP}`;
    const preOp3Prompts = await sql`SELECT COUNT(*) as c FROM channel_prompts WHERE group_id = ${ORPHAN_GROUP}`;
    const preOp3Profiles = await sql`SELECT COUNT(*) as c FROM channel_ai_profiles WHERE group_id = ${ORPHAN_GROUP}`;
    const preOp3Status = await sql`SELECT id, name, status FROM channel_groups WHERE id = ${ORPHAN_GROUP}`;

    console.log(`[PRE] Group: ${preOp3Status[0]?.name} | status=${preOp3Status[0]?.status}`);
    console.log(`[PRE] Channels: ${preOp3Channels[0].c} | Prompts: ${preOp3Prompts[0].c} | AI Profiles: ${preOp3Profiles[0].c}`);

    if (preOp3Status[0]?.status === 'archived') {
      console.log("⚠️ Group already archived. Skipping.");
      report.op3 = { status: 'SKIPPED', reason: 'Already archived' };
    } else if (parseInt(preOp3Channels[0].c) > 0) {
      console.log("❌ ABORT: Orphan group has channels! Not safe to archive.");
      report.op3 = { status: 'ABORTED', reason: `Has ${preOp3Channels[0].c} channels` };
    } else {
      // Execute with safety guard
      const result = await sql`
        UPDATE channel_groups
        SET status = 'archived'
        WHERE id = ${ORPHAN_GROUP}
          AND (SELECT COUNT(*) FROM channels WHERE group_id = ${ORPHAN_GROUP}) = 0
      `;
      console.log(`[EXEC] Result:`, result);

      // Verify both WhatsApp TR groups
      const postOp3 = await sql`
        SELECT cg.id, cg.name, cg.status,
          (SELECT COUNT(*) FROM channels WHERE group_id = cg.id) as channels
        FROM channel_groups cg
        WHERE cg.name = 'WhatsApp TR'
        ORDER BY cg.status
      `;

      console.log(`[VERIFY] WhatsApp TR groups:`);
      postOp3.forEach(g => console.log(`  ${g.status === 'active' ? '✅' : '📦'} ${g.id} | "${g.name}" | status=${g.status} | channels=${g.channels}`));

      const orphanArchived = postOp3.find(g => g.id === ORPHAN_GROUP && g.status === 'archived');
      const realUntouched = postOp3.find(g => g.id !== ORPHAN_GROUP && g.status === 'active');

      if (orphanArchived && realUntouched) {
        console.log("✅ OP3 SUCCESS");
        report.op3 = { status: 'SUCCESS', orphanStatus: 'archived', realStatus: 'active' };
      } else {
        console.log("❌ OP3 VERIFICATION FAILED");
        report.op3 = { status: 'FAILED', groups: postOp3 };
      }
    }

    // ════════════════════════════════════════════
    // FINAL REPORT
    // ════════════════════════════════════════════
    console.log("\n╔══════════════════════════════════════════════════════╗");
    console.log("║   PHASE 1 EXECUTION REPORT                         ║");
    console.log("╚══════════════════════════════════════════════════════╝");
    console.log(`OP1 (Prompt Fix):       ${report.op1?.status}`);
    console.log(`OP2 (Pipeline Create):  ${report.op2?.status}`);
    console.log(`OP3 (Archive Orphan):   ${report.op3?.status}`);

    const allSuccess = [report.op1, report.op2, report.op3].every(
      r => r?.status === 'SUCCESS' || r?.status === 'SKIPPED'
    );
    console.log(`\nOVERALL: ${allSuccess ? '✅ ALL OPERATIONS SUCCESSFUL' : '❌ SOME OPERATIONS FAILED'}`);

  } catch (e) {
    console.error("❌ PHASE 1 EXECUTION ERROR:", e.message);
    console.error(e);
  }
}

executePhase1();
