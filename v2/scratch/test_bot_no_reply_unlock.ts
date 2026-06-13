import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

import { neon } from '@neondatabase/serverless';

async function run() {
  const envTenantId = process.env.TENANT_ID;
  const envConvId = process.env.CONVERSATION_ID;
  const envPhone = process.env.PHONE;
  const executeUnlockEnv = process.env.EXECUTE_UNLOCK;

  console.log(`=== P0.1 BOT UNLOCK SCRIPT (stop_rule re-lock) ===`);
  console.log(`Input Tenant ID: ${envTenantId}`);
  console.log(`Input Conversation ID: ${envConvId}`);
  console.log(`Input Phone: ${envPhone}`);
  console.log(`EXECUTE_UNLOCK: ${executeUnlockEnv}`);

  // Safe allowlist validation — hardcoded to prevent any other target
  const ALLOWED_TENANT = 'caab9ea1-9591-45e4-bbc5-9c9b498982c8';
  const ALLOWED_CONV = '8f738423-6213-44e6-8ac0-3a10bc7835bb';
  const ALLOWED_PHONE = '905546833306';

  if (envTenantId !== ALLOWED_TENANT || envConvId !== ALLOWED_CONV || envPhone !== ALLOWED_PHONE) {
    console.error('❌ SAFETY ERROR: Target parameters do not match the allowed target conversation!');
    process.exit(1);
  }

  const isExecute = executeUnlockEnv === 'true';
  console.log(`Mode: ${isExecute ? 'EXECUTE (LIVE WRITES)' : 'DRY RUN (READ-ONLY)'}`);

  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    console.error('DATABASE_URL is not set');
    process.exit(1);
  }

  const sql = neon(databaseUrl);

  // 1. Fetch target conversation — pre-unlock snapshot
  const convRes = await sql.query(
    'SELECT id, phone_number, tenant_id, status, autopilot_enabled, metadata FROM conversations WHERE id = $1 AND tenant_id = $2 LIMIT 1',
    [envConvId, envTenantId]
  );
  const conv = convRes.rows?.[0] || convRes[0];
  if (!conv) {
    console.error(`❌ ERROR: Conversation not found for ID: ${envConvId}`);
    process.exit(1);
  }

  console.log('\n--- PRE-UNLOCK Conversation State ---');
  console.log(`ID: ${conv.id}`);
  console.log(`Phone: ${conv.phone_number}`);
  console.log(`Tenant: ${conv.tenant_id}`);
  console.log(`Status: ${conv.status}`);
  console.log(`Autopilot Enabled: ${conv.autopilot_enabled}`);
  console.log(`Metadata:`, JSON.stringify(conv.metadata, null, 2));

  // Safety assertions
  if (conv.phone_number !== ALLOWED_PHONE) {
    console.error('❌ SAFETY ERROR: Fetched conversation phone number mismatch!');
    process.exit(1);
  }
  if (conv.tenant_id !== ALLOWED_TENANT) {
    console.error('❌ SAFETY ERROR: Fetched conversation tenant mismatch!');
    process.exit(1);
  }
  // This time: conversation is locked by stop_rule (status=human, autopilot=false, metadata={})
  if (conv.status !== 'human') {
    console.error(`❌ SAFETY ERROR: Conversation status is "${conv.status}", expected "human"!`);
    process.exit(1);
  }
  if (conv.autopilot_enabled !== false) {
    console.error(`❌ SAFETY ERROR: autopilot_enabled is "${conv.autopilot_enabled}", expected false!`);
    process.exit(1);
  }

  console.log('✅ Safety verification passed. Target matches stop_rule re-lock scenario.');

  // 2. Check other conversations to prove we won't affect them
  const otherConvCount = await sql.query(
    'SELECT COUNT(*) as cnt FROM conversations WHERE tenant_id = $1 AND id != $2',
    [ALLOWED_TENANT, ALLOWED_CONV]
  );
  const otherCount = (otherConvCount.rows?.[0] || otherConvCount[0])?.cnt;
  console.log(`Other conversations in tenant (will NOT be touched): ${otherCount}`);

  // 3. Perform DB Unlock
  if (isExecute) {
    console.log('\n--- EXECUTING UNLOCK ---');
    
    // Simple status + autopilot reset. Metadata stays as-is ({}) since no ai_unavailable keys exist
    await sql.query(`
      UPDATE conversations 
      SET status = 'bot',
          autopilot_enabled = true
      WHERE id = $1 AND tenant_id = $2
    `, [conv.id, envTenantId]);
    
    console.log('✅ Database update completed.');

    // Verify the update
    const updatedRes = await sql.query(
      'SELECT status, autopilot_enabled, metadata FROM conversations WHERE id = $1 AND tenant_id = $2 LIMIT 1',
      [conv.id, envTenantId]
    );
    const updated = updatedRes.rows?.[0] || updatedRes[0];
    console.log('\n--- POST-UNLOCK Conversation State ---');
    console.log(`  Status: ${updated.status}`);
    console.log(`  Autopilot Enabled: ${updated.autopilot_enabled}`);
    console.log(`  Metadata: ${JSON.stringify(updated.metadata)}`);

    // Verify other conversations were NOT affected
    const verifyOther = await sql.query(`
      SELECT COUNT(*) as cnt FROM conversations 
      WHERE tenant_id = $1 AND id != $2 AND status = 'bot' AND autopilot_enabled = true
    `, [ALLOWED_TENANT, ALLOWED_CONV]);
    const otherBotCount = (verifyOther.rows?.[0] || verifyOther[0])?.cnt;
    console.log(`\nOther conversations in bot mode (cross-check): ${otherBotCount}`);
  } else {
    console.log('\n[Dry-run] Would execute:');
    console.log(`  UPDATE conversations SET status = 'bot', autopilot_enabled = true WHERE id = '${conv.id}' AND tenant_id = '${envTenantId}'`);
  }

  // 4. Redis Circuit Breaker Check (read-only, no reset needed this time)
  const redisUrl = process.env.UPSTASH_REDIS_REST_URL;
  const redisToken = process.env.UPSTASH_REDIS_REST_TOKEN;

  if (redisUrl && redisToken) {
    console.log('\n--- Redis Circuit State (read-only) ---');
    const keys = [
      'circuit_breaker:gemini:failures',
      'circuit_breaker:gemini:state',
    ];
    for (const key of keys) {
      const res = await fetch(`${redisUrl}/get/${key}`, {
        headers: { Authorization: `Bearer ${redisToken}` }
      });
      const data = await res.json();
      console.log(`  ${key}: ${data.result ?? 'null (clean)'}`);
    }
  }

  console.log('\n=== DONE ===');
}

run().catch(console.error);
