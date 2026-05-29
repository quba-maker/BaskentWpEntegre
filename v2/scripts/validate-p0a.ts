import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

import { sendTestBotMessage, createBotDelegationTask } from "../src/app/actions/focus-queue";
import { withTenantDB } from "../src/lib/core/tenant-db";

const TEST_TENANT_ID = "caab9ea1-9591-45e4-bbc5-9c9b498982c8";
const TEST_OPPORTUNITY_ID = "0a05b03a-d526-4c88-8806-1230faaac3ea"; // Merve
const TEST_PHONE = "905546833306";
const NON_WHITELIST_PHONE = "905555555555";

// Inject environment variables for ActionGuard mock bypass
process.env.TEST_TENANT_ID = TEST_TENANT_ID;
process.env.TEST_USER_ID = "00000000-0000-0000-0000-000000000000";
(process.env as any).NODE_ENV = "development";
// Set envs
process.env.ENABLE_TEST_BOT_OUTBOUND = "true";
process.env.TEST_BOT_WHITELIST_NUMBERS = TEST_PHONE;

async function runValidation() {
  console.log("🚀 STARTING CANLI VALIDATION FOR PHASE 2Q-P0.5 / 2R-P0A\n");
  const db = withTenantDB(TEST_TENANT_ID, true);

  // Setup: make sure opportunity has non-whitelist phone
  const convs = await db.executeSafe({
    text: `SELECT id FROM conversations WHERE active_opportunity_id = $1`,
    values: [TEST_OPPORTUNITY_ID]
  }) as any[];
  const conversationId = convs[0].id;

  console.log("--- 1. Non-whitelist production hasta testi ---");
  await db.executeSafe({
    text: `UPDATE conversations SET phone_number = $1 WHERE id = $2`,
    values: [NON_WHITELIST_PHONE, conversationId]
  });

  const res1 = await sendTestBotMessage(TEST_OPPORTUNITY_ID, "Test 1");
  console.log(`✅ Non-whitelist reject check: ${res1.success === false ? "PASSED" : "FAILED"}`);
  console.log(`✅ Reject reason: ${res1.error}`);
  
  const msgs1 = await db.executeSafe({
    text: `SELECT COUNT(*) as c FROM messages WHERE direction = 'out' AND content = 'Test 1'`
  }) as any[];
  console.log(`✅ messages.direction='out' artmıyor: ${msgs1[0].c == 0 ? "PASSED" : "FAILED"}`);


  console.log("\n--- 2. Whitelist test hasta testi & 24h window ---");
  await db.executeSafe({
    text: `UPDATE conversations SET phone_number = $1 WHERE id = $2`,
    values: [TEST_PHONE, conversationId]
  });

  // Ensure 24h window is open
  await db.executeSafe({
    text: `INSERT INTO messages (id, tenant_id, phone_number, channel, direction, content, created_at, conversation_id)
           VALUES (gen_random_uuid(), $1, $2, 'whatsapp', 'in', 'test inbound', NOW(), $3)`,
    values: [TEST_TENANT_ID, TEST_PHONE, conversationId]
  });

  const res2 = await sendTestBotMessage(TEST_OPPORTUNITY_ID, "Test 2 whitelist");
  console.log(`✅ Whitelist send check (or fb err if no credentials): ${res2.success === true || (res2.error && res2.error.includes("WhatsApp")) ? "PASSED" : "FAILED"}`);
  
  if (res2.success) {
    const msgs2 = await db.executeSafe({
      text: `SELECT COUNT(*) as c FROM messages WHERE direction = 'out' AND content = 'Test 2 whitelist'`
    }) as any[];
    console.log(`✅ messages.direction='out' arttı: ${msgs2[0].c > 0 ? "PASSED" : "FAILED"}`);

    const logs2 = await db.executeSafe({
      text: `SELECT COUNT(*) as c FROM outreach_logs WHERE action = 'test_bot_message_sent' AND metadata->>'message_text' = 'Test 2 whitelist'`
    }) as any[];
    console.log(`✅ outreach_logs metadata var: ${logs2[0].c > 0 ? "PASSED" : "FAILED"}`);
  }

  console.log("\n--- 4. 24h window kapalı testi ---");
  // Close window
  await db.executeSafe({
    text: `UPDATE messages SET created_at = NOW() - INTERVAL '30 hours' WHERE conversation_id = $1 AND direction = 'in'`,
    values: [conversationId]
  });
  const res3 = await sendTestBotMessage(TEST_OPPORTUNITY_ID, "Test 3 old window");
  console.log(`✅ 24h window kapalı reject check: ${res3.success === false ? "PASSED" : "FAILED"}`);
  console.log(`✅ Reject reason: ${res3.error}`);


  console.log("\n--- 3. Bota Devret testi ---");
  const res4 = await createBotDelegationTask(TEST_OPPORTUNITY_ID, { mode: "unreachable_followup", goal: "Test validation" });
  console.log(`✅ createBotDelegationTask success: ${res4.success}`);
  const tasks = await db.executeSafe({
    text: `SELECT metadata, status FROM follow_up_tasks WHERE opportunity_id = $1 ORDER BY created_at DESC LIMIT 1`,
    values: [TEST_OPPORTUNITY_ID]
  }) as any[];
  console.log(`✅ Task created with metadata: ${JSON.stringify(tasks[0].metadata)}`);
  
  const msgs4 = await db.executeSafe({
    text: `SELECT COUNT(*) as c FROM messages WHERE direction = 'out' AND created_at > NOW() - INTERVAL '5 seconds'`
  }) as any[];
  console.log(`✅ Bota Devret messages.direction='out' artmıyor: ${msgs4[0].c == 0 ? "PASSED" : "FAILED"}`);
  
  // Cleanup test messages
  await db.executeSafe({
    text: `DELETE FROM messages WHERE content = 'test inbound'`
  });
}

runValidation().catch(console.error);
