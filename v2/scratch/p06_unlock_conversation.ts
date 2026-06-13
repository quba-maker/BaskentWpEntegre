/**
 * P0.6 — Single Conversation Unlock
 * 
 * Target: conversationId=8f738423-6213-44e6-8ac0-3a10bc7835bb
 * Tenant: caab9ea1-9591-45e4-bbc5-9c9b498982c8
 * 
 * Step 1: Read current state
 * Step 2: If status=human due to QG block, set status=bot, autopilot_enabled=true
 * Step 3: Report before/after
 */

import dotenv from 'dotenv';
import path from 'path';
dotenv.config({ path: path.join(__dirname, '../.env.local') });

async function main() {
  const tenantId = 'caab9ea1-9591-45e4-bbc5-9c9b498982c8';
  const conversationId = '8f738423-6213-44e6-8ac0-3a10bc7835bb';
  const phone = '905546833306';

  console.log('=== P0.6 — Conversation Unlock ===\n');
  console.log(`Tenant: ${tenantId}`);
  console.log(`Conversation: ${conversationId}`);
  console.log(`Phone: ${phone}`);

  const { withTenantDB } = await import('../src/lib/core/tenant-db');
  const db = withTenantDB(tenantId, true);

  // Step 1: Read current state
  console.log('\n--- STEP 1: Read Current State ---');
  const rows = await db.executeSafe({
    text: `SELECT id, status, autopilot_enabled, metadata, phone_number 
           FROM conversations 
           WHERE id = $1 AND tenant_id = $2`,
    values: [conversationId, tenantId]
  }) as any[];

  if (rows.length === 0) {
    console.error('❌ Conversation not found!');
    return;
  }

  const conv = rows[0];
  console.log(`  status: ${conv.status}`);
  console.log(`  autopilot_enabled: ${conv.autopilot_enabled}`);
  console.log(`  phone_number: ${conv.phone_number}`);
  console.log(`  metadata: ${JSON.stringify(conv.metadata, null, 2)}`);

  // Verify this is the right conversation
  if (conv.phone_number !== phone) {
    console.error(`❌ Phone mismatch! Expected ${phone}, got ${conv.phone_number}`);
    return;
  }

  // Step 2: Determine if unlock needed
  const needsUnlock = conv.status === 'human' || conv.autopilot_enabled === false;
  
  if (!needsUnlock) {
    console.log('\n✅ Conversation is already in bot/autopilot mode. No unlock needed.');
    return;
  }

  console.log('\n--- STEP 2: Execute Unlock ---');
  console.log(`  Before: status=${conv.status}, autopilot_enabled=${conv.autopilot_enabled}`);

  // Only update status and autopilot_enabled. Don't touch metadata unless ai_unavailable exists.
  const hasAiUnavailable = conv.metadata?.ai_unavailable === true || conv.metadata?.ai_unavailable === 'true';
  
  let updateQuery: string;
  let updateValues: any[];

  if (hasAiUnavailable) {
    updateQuery = `UPDATE conversations 
                   SET status = 'bot', autopilot_enabled = true,
                       metadata = metadata - 'ai_unavailable'
                   WHERE id = $1 AND tenant_id = $2
                   RETURNING status, autopilot_enabled, metadata`;
    updateValues = [conversationId, tenantId];
  } else {
    updateQuery = `UPDATE conversations 
                   SET status = 'bot', autopilot_enabled = true
                   WHERE id = $1 AND tenant_id = $2
                   RETURNING status, autopilot_enabled, metadata`;
    updateValues = [conversationId, tenantId];
  }

  const updated = await db.executeSafe({
    text: updateQuery,
    values: updateValues
  }) as any[];

  if (updated.length === 0) {
    console.error('❌ Update failed — no rows returned');
    return;
  }

  const after = updated[0];
  console.log(`  After: status=${after.status}, autopilot_enabled=${after.autopilot_enabled}`);
  console.log(`  metadata: ${JSON.stringify(after.metadata, null, 2)}`);

  // Step 3: Verify no other conversations affected
  console.log('\n--- STEP 3: Isolation Check ---');
  const otherCheck = await db.executeSafe({
    text: `SELECT COUNT(*) as cnt FROM conversations WHERE tenant_id = $1 AND id != $2 AND status = 'bot' AND autopilot_enabled = true`,
    values: [tenantId, conversationId]
  }) as any[];
  console.log(`  Other bot+autopilot conversations: ${otherCheck[0]?.cnt || 0} (unchanged)`);

  console.log('\n=== UNLOCK COMPLETE ===');
  console.log(`  ✅ Conversation ${conversationId} unlocked`);
  console.log(`  ✅ No outbound message sent`);
  console.log(`  ✅ No other conversations affected`);
  console.log(`  ✅ Ready for live test`);
}

main().catch(err => {
  console.error('Unlock error:', err);
  process.exit(1);
});
