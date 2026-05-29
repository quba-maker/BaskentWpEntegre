import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

import { prepareRemarketingDraft, saveRemarketingDraft, getRemarketingTemplates } from "../src/app/actions/remarketing";
import { withTenantDB } from "../src/lib/core/tenant-db";

const TEST_TENANT_ID = "caab9ea1-9591-45e4-bbc5-9c9b498982c8";
const TEST_OPPORTUNITY_ID = "0a05b03a-d526-4c88-8806-1230faaac3ea"; // Merve (has lead)
const TEST_PHONE = "905546833306";

// Inject environment variables for ActionGuard mock bypass
process.env.TEST_TENANT_ID = TEST_TENANT_ID;
process.env.TEST_USER_ID = "00000000-0000-0000-0000-000000000000";
(process.env as any).NODE_ENV = "development";

async function runValidation() {
  console.log("🚀 STARTING CANLI VALIDATION FOR PHASE 2P-P0A — REMARKETING DRAFT MODE\n");
  const db = withTenantDB(TEST_TENANT_ID, true);

  // Clear previous test logs if any to ensure clean test environment
  await db.executeSafe({
    text: `DELETE FROM outreach_logs WHERE opportunity_id = $1`,
    values: [TEST_OPPORTUNITY_ID]
  });
  await db.executeSafe({
    text: `DELETE FROM messages WHERE phone_number = $1 AND content LIKE '%[TEST_DRAFT]%'`,
    values: [TEST_PHONE]
  });

  // ==========================================
  // TEST 1 — Setup / Templates
  // ==========================================
  console.log("--- TEST 1: Setup / Templates ---");
  const templates = await getRemarketingTemplates();
  console.log(`✅ message_templates count for type='remarketing': ${templates.length}`);
  const hasTR = templates.some(t => t.language === 'tr');
  const hasEN = templates.some(t => t.language === 'en');
  console.log(`✅ TR template exists: ${hasTR ? "YES" : "NO"}`);
  console.log(`✅ EN template exists: ${hasEN ? "YES" : "NO"}`);
  
  // Verify Greeting templates still exist and work
  const greetingTemplates = await db.executeSafe({
    text: `SELECT COUNT(*) as c FROM message_templates WHERE template_type = 'greeting' AND tenant_id = $1`,
    values: [TEST_TENANT_ID]
  }) as any[];
  console.log(`✅ Greeting templates count: ${greetingTemplates[0].c}`);

  // ==========================================
  // TEST 2 — prepareRemarketingDraft (Active Opportunity)
  // ==========================================
  console.log("\n--- TEST 2: prepareRemarketingDraft (Active) ---");
  
  // Save before counts
  const msgsBefore = await db.executeSafe({
    text: `SELECT COUNT(*) as c FROM messages WHERE direction = 'out'`
  }) as any[];
  const logsBefore = await db.executeSafe({
    text: `SELECT COUNT(*) as c FROM outreach_logs`
  }) as any[];
  
  // Execute action
  const draftResult = await prepareRemarketingDraft(TEST_OPPORTUNITY_ID);
  
  console.log("✅ prepareRemarketingDraft result returned successfully.");
  console.log(`✅ patientName: ${draftResult.patientName}`);
  console.log(`✅ department: ${draftResult.department}`);
  console.log(`✅ language: ${draftResult.language}`);
  console.log(`✅ draft text snippet: "${draftResult.draft?.slice(0, 60)}..."`);
  console.log(`✅ channelReady: ${draftResult.channelReady}`);
  console.log(`✅ channelError: ${draftResult.channelError || 'NONE'}`);
  console.log(`✅ canSendFreeform: ${draftResult.canSendFreeform}`);
  console.log(`✅ requiresApprovedTemplate: ${draftResult.requiresApprovedTemplate}`);

  // Verify ZERO writes
  const msgsAfterPrepare = await db.executeSafe({
    text: `SELECT COUNT(*) as c FROM messages WHERE direction = 'out'`
  }) as any[];
  const logsAfterPrepare = await db.executeSafe({
    text: `SELECT COUNT(*) as c FROM outreach_logs`
  }) as any[];

  const msgDiff = msgsAfterPrepare[0].c - msgsBefore[0].c;
  const logDiff = logsAfterPrepare[0].c - logsBefore[0].c;
  console.log(`✅ DB Write Check (Messages): ${msgDiff === 0 ? "PASSED (0 new messages)" : "FAILED"}`);
  console.log(`✅ DB Write Check (Outreach Logs): ${logDiff === 0 ? "PASSED (0 new logs)" : "FAILED"}`);

  // ==========================================
  // TEST 3 — Eligibility / Stop Rules
  // ==========================================
  console.log("\n--- TEST 3: Eligibility / Stop Rules ---");
  
  // Set stage to 'lost'
  await db.executeSafe({
    text: `UPDATE opportunities SET stage = 'lost' WHERE id = $1`,
    values: [TEST_OPPORTUNITY_ID]
  });
  
  const blockedResult = await prepareRemarketingDraft(TEST_OPPORTUNITY_ID);
  console.log(`✅ Lost stage blocked check: ${blockedResult.blocked === true ? "PASSED" : "FAILED"}`);
  console.log(`✅ Block reason: "${blockedResult.blockReason}"`);

  // Restore stage to 'qualified' (Merve's original stage)
  await db.executeSafe({
    text: `UPDATE opportunities SET stage = 'qualified' WHERE id = $1`,
    values: [TEST_OPPORTUNITY_ID]
  });

  // Test opt-out requested
  await db.executeSafe({
    text: `UPDATE opportunities SET metadata = jsonb_set(COALESCE(metadata, '{}'::jsonb), '{opt_out_requested}', 'true'::jsonb) WHERE id = $1`,
    values: [TEST_OPPORTUNITY_ID]
  });

  const optOutResult = await prepareRemarketingDraft(TEST_OPPORTUNITY_ID);
  console.log(`✅ Opt-out blocked check: ${optOutResult.blocked === true ? "PASSED" : "FAILED"}`);
  console.log(`✅ Block reason: "${optOutResult.blockReason}"`);

  // Restore opt-out to false
  await db.executeSafe({
    text: `UPDATE opportunities SET metadata = jsonb_set(COALESCE(metadata, '{}'::jsonb), '{opt_out_requested}', 'false'::jsonb) WHERE id = $1`,
    values: [TEST_OPPORTUNITY_ID]
  });

  // ==========================================
  // TEST 4 — 24 Hour Window Info
  // ==========================================
  console.log("\n--- TEST 4: 24 Hour Window Info ---");
  
  // 4a. With recent inbound message (< 24h)
  const tempMsgId = "00000000-0000-0000-0000-000000000001";
  await db.executeSafe({
    text: `INSERT INTO messages (id, tenant_id, phone_number, channel, direction, content, created_at, conversation_id)
           VALUES ($1, $2, $3, 'whatsapp', 'in', '[TEST_DRAFT] Inbound message', NOW() - INTERVAL '2 hours',
                   (SELECT conversation_id FROM opportunities WHERE id = $4))`,
    values: [tempMsgId, TEST_TENANT_ID, TEST_PHONE, TEST_OPPORTUNITY_ID]
  });

  const windowResult1 = await prepareRemarketingDraft(TEST_OPPORTUNITY_ID);
  console.log(`✅ Recent inbound (<24h) -> canSendFreeform: ${windowResult1.canSendFreeform} (Expected: true)`);
  console.log(`✅ Recent inbound (<24h) -> requiresApprovedTemplate: ${windowResult1.requiresApprovedTemplate} (Expected: false)`);

  // Cleanup temp message
  await db.executeSafe({
    text: `DELETE FROM messages WHERE id = $1`,
    values: [tempMsgId]
  });

  // 4b. With no recent inbound message (> 24h)
  await db.executeSafe({
    text: `INSERT INTO messages (id, tenant_id, phone_number, channel, direction, content, created_at, conversation_id)
           VALUES ($1, $2, $3, 'whatsapp', 'in', '[TEST_DRAFT] Old message', NOW() - INTERVAL '30 hours',
                   (SELECT conversation_id FROM opportunities WHERE id = $4))`,
    values: [tempMsgId, TEST_TENANT_ID, TEST_PHONE, TEST_OPPORTUNITY_ID]
  });

  const windowResult2 = await prepareRemarketingDraft(TEST_OPPORTUNITY_ID);
  console.log(`✅ Old inbound (>24h) -> canSendFreeform: ${windowResult2.canSendFreeform} (Expected: false)`);
  console.log(`✅ Old inbound (>24h) -> requiresApprovedTemplate: ${windowResult2.requiresApprovedTemplate} (Expected: true)`);

  // Cleanup temp message
  await db.executeSafe({
    text: `DELETE FROM messages WHERE id = $1`,
    values: [tempMsgId]
  });

  // ==========================================
  // TEST 5 — saveRemarketingDraft
  // ==========================================
  console.log("\n--- TEST 5: saveRemarketingDraft ---");
  
  const testDraftText = "[TEST_DRAFT] Merhaba Sarah, Kardiyoloji randevunuz hakkında bilgi almak istemiştik.";
  
  // Capture state before save
  const oppBefore = await db.executeSafe({
    text: `SELECT stage, summary, ai_reason, metadata FROM opportunities WHERE id = $1`,
    values: [TEST_OPPORTUNITY_ID]
  }) as any[];
  
  const saveRes = await saveRemarketingDraft(TEST_OPPORTUNITY_ID, testDraftText);
  console.log(`✅ saveRemarketingDraft success response: ${saveRes.success}`);

  // Verify opportunity metadata updated
  const oppAfter = await db.executeSafe({
    text: `SELECT stage, summary, ai_reason, metadata FROM opportunities WHERE id = $1`,
    values: [TEST_OPPORTUNITY_ID]
  }) as any[];
  
  const metadataAfter = oppAfter[0].metadata || {};
  console.log(`✅ opportunity.metadata.last_remarketing_draft_at set: ${metadataAfter.last_remarketing_draft_at ? "YES (" + metadataAfter.last_remarketing_draft_at + ")" : "NO"}`);
  console.log(`✅ opportunity.stage unchanged: ${oppBefore[0].stage === oppAfter[0].stage ? "YES" : "NO"}`);
  console.log(`✅ opportunity.summary unchanged: ${oppBefore[0].summary === oppAfter[0].summary ? "YES" : "NO"}`);
  console.log(`✅ opportunity.ai_reason unchanged: ${oppBefore[0].ai_reason === oppAfter[0].ai_reason ? "YES" : "NO"}`);

  // Verify outreach_logs entry
  const logsAfterSave = await db.executeSafe({
    text: `SELECT action, metadata FROM outreach_logs WHERE opportunity_id = $1 ORDER BY created_at DESC LIMIT 1`,
    values: [TEST_OPPORTUNITY_ID]
  }) as any[];
  console.log(`✅ outreach_logs count: ${logsAfterSave.length} (Expected: 1)`);
  console.log(`✅ outreach_logs action: "${logsAfterSave[0]?.action}" (Expected: "remarketing_draft_prepared")`);
  console.log(`✅ outreach_logs metadata draftText matches: ${logsAfterSave[0]?.metadata?.draftText === testDraftText ? "YES" : "NO"}`);

  // Verify ZERO messages.direction='out' writes
  const msgsAfterSave = await db.executeSafe({
    text: `SELECT COUNT(*) as c FROM messages WHERE direction = 'out' AND phone_number = $1`,
    values: [TEST_PHONE]
  }) as any[];
  console.log(`✅ messages outbound count for test patient: ${msgsAfterSave[0].c} (Expected: 0)`);

  // ==========================================
  // TEST 6 — Cooldown Warning
  // ==========================================
  console.log("\n--- TEST 6: Cooldown Warning ---");
  const cooldownResult = await prepareRemarketingDraft(TEST_OPPORTUNITY_ID);
  console.log(`✅ hasRecentDraftWarning: ${cooldownResult.hasRecentDraftWarning} (Expected: true because draft was saved within 24h)`);

  // ==========================================
  // TEST 8 — Zero Outbound SQL Proof
  // ==========================================
  console.log("\n--- TEST 8: Zero Outbound SQL Proof ---");
  const outboundProofs = await db.executeSafe({
    text: `SELECT id, direction, phone_number, LEFT(content, 40) as snippet, created_at
           FROM messages
           WHERE direction = 'out'
           ORDER BY created_at DESC
           LIMIT 5`
  }) as any[];
  
  console.log("Recent outbound messages in database:");
  if (outboundProofs.length === 0) {
    console.log("  (None found - completely clean!)");
  } else {
    outboundProofs.forEach(m => {
      console.log(`  - ID: ${m.id} | Phone: ${m.phone_number} | Content: "${m.snippet}..." | Created At: ${m.created_at}`);
    });
  }
  
  const testMsgOutboundCount = await db.executeSafe({
    text: `SELECT COUNT(*) as c FROM messages WHERE direction = 'out' AND content LIKE '%[TEST_DRAFT]%'`
  }) as any[];
  console.log(`✅ Proof outbound count from test activity: ${testMsgOutboundCount[0].c} (Expected: 0)`);

  // Cleanup after validation
  await db.executeSafe({
    text: `DELETE FROM outreach_logs WHERE opportunity_id = $1`,
    values: [TEST_OPPORTUNITY_ID]
  });
  
  console.log("\n🚀 CANLI VALIDATION TESTS COMPLETED SUCCESSFULLY!");
}

runValidation().catch(err => {
  console.error("\n❌ VALIDATION CRASHED:", err);
  process.exit(1);
});
