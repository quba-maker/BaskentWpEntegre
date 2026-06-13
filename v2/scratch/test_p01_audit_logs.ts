import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
import { neon } from '@neondatabase/serverless';

const TENANT_ID = 'caab9ea1-9591-45e4-bbc5-9c9b498982c8';
const CONV_ID = '8f738423-6213-44e6-8ac0-3a10bc7835bb';

async function run() {
  const sql = neon(process.env.DATABASE_URL!);

  // 1. AI Audit logs for this conversation (last 10)
  console.log('=== AI AUDIT LOGS (last 10) ===');
  try {
    const auditRes = await sql.query(`
      SELECT id, action, LEFT(reasoning_summary, 200) as reasoning, 
             LEFT(result_summary, 300) as result, created_at
      FROM ai_audit_logs
      WHERE tenant_id = $1
        AND (result_summary LIKE '%${CONV_ID}%' OR result_summary LIKE '%905546833306%')
      ORDER BY created_at DESC LIMIT 10
    `, [TENANT_ID]);
    console.table(auditRes.rows || auditRes);
  } catch(e) { console.log('Error:', (e as Error).message); }

  // 2. All audit logs after unlock time
  console.log('\n=== ALL AUDIT LOGS AFTER UNLOCK (20:50 UTC) ===');
  try {
    const auditRes2 = await sql.query(`
      SELECT id, action, LEFT(reasoning_summary, 200) as reasoning, 
             LEFT(result_summary, 300) as result, created_at
      FROM ai_audit_logs
      WHERE tenant_id = $1
        AND created_at > '2026-06-12T20:50:00Z'
      ORDER BY created_at ASC LIMIT 10
    `, [TENANT_ID]);
    console.table(auditRes2.rows || auditRes2);
  } catch(e) { console.log('Error:', (e as Error).message); }

  // 3. Check if escalate_to_human tool was called
  console.log('\n=== ESCALATE_TO_HUMAN TOOL CALLS ===');
  try {
    const escRes = await sql.query(`
      SELECT id, action, LEFT(reasoning_summary, 200) as reasoning,
             LEFT(result_summary, 300) as result, created_at
      FROM ai_audit_logs
      WHERE tenant_id = $1 AND action IN ('escalate_to_human', 'autopilot_disabled', 'handoff')
      ORDER BY created_at DESC LIMIT 5
    `, [TENANT_ID]);
    console.table(escRes.rows || escRes);
  } catch(e) { console.log('Error:', (e as Error).message); }

  // 4. Check the specific outgoing message for 360dialog provider_message_id
  console.log('\n=== OUTBOUND MESSAGE DETAILS ===');
  try {
    const outRes = await sql.query(`
      SELECT id, direction, content, provider_message_id, status, created_at
      FROM messages
      WHERE conversation_id = $1 AND tenant_id = $2 AND direction = 'out'
      ORDER BY created_at DESC LIMIT 3
    `, [CONV_ID, TENANT_ID]);
    const rows = outRes.rows || outRes;
    for (const r of rows) {
      console.log(`[${r.created_at}] direction: ${r.direction} | status: ${r.status}`);
      console.log(`  provider_message_id: ${r.provider_message_id}`);
      console.log(`  content: ${r.content}`);
      console.log('---');
    }
  } catch(e) { console.log('Error:', (e as Error).message); }

  // 5. System messages - check if any have real wamid provider_message_id (sent to WhatsApp)
  console.log('\n=== SYSTEM MESSAGES - WhatsApp SEND CHECK ===');
  try {
    const sysRes = await sql.query(`
      SELECT id, direction, LEFT(content, 100) as content, provider_message_id, status, created_at
      FROM messages
      WHERE conversation_id = $1 AND tenant_id = $2 AND direction = 'system'
        AND (content LIKE '%servis dışı%' OR content LIKE '%AI Unavailable%' OR content LIKE '%Quality Gate%')
      ORDER BY created_at DESC LIMIT 5
    `, [CONV_ID, TENANT_ID]);
    const sysRows = sysRes.rows || sysRes;
    for (const r of sysRows) {
      const sentToWA = r.provider_message_id && r.provider_message_id.startsWith('wamid.');
      console.log(`[${r.created_at}] pid: ${r.provider_message_id} | Sent to WhatsApp: ${sentToWA ? '❌ YES (BUG!)' : '✅ NO (Internal only)'}`);
      console.log(`  Content: ${r.content}`);
    }
  } catch(e) { console.log('Error:', (e as Error).message); }

  // 6. Conversation last update timeline
  console.log('\n=== CONVERSATION UPDATE TIMELINE ===');
  const convRes = await sql.query(`
    SELECT status, autopilot_enabled, metadata, updated_at
    FROM conversations
    WHERE id = $1 AND tenant_id = $2
  `, [CONV_ID, TENANT_ID]);
  const conv = (convRes.rows || convRes)[0];
  console.log(`Current Status: ${conv.status}`);
  console.log(`Current Autopilot: ${conv.autopilot_enabled}`);
  console.log(`Current Metadata: ${JSON.stringify(conv.metadata)}`);
  console.log(`Last Updated: ${conv.updated_at}`);
}

run().catch(console.error);
