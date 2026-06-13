import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

import { neon } from '@neondatabase/serverless';

const TENANT_ID = 'caab9ea1-9591-45e4-bbc5-9c9b498982c8';
const CONV_ID = '8f738423-6213-44e6-8ac0-3a10bc7835bb';
const PHONE = '905546833306';

async function run() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) { console.error('DATABASE_URL is not set'); process.exit(1); }
  const sql = neon(databaseUrl);

  console.log('=== P0.1 FULL DIAGNOSTIC (READ-ONLY) ===\n');

  // 1. Conversation state
  console.log('--- 1. Conversation State ---');
  const convRes = await sql.query(`
    SELECT id, phone_number, status, autopilot_enabled, metadata, 
           phase, temperature, updated_at, created_at
    FROM conversations 
    WHERE id = $1 AND tenant_id = $2
  `, [CONV_ID, TENANT_ID]);
  const conv = convRes.rows?.[0] || convRes[0];
  if (!conv) { console.error('Conversation not found!'); return; }
  console.log(`Status: ${conv.status}`);
  console.log(`Autopilot Enabled: ${conv.autopilot_enabled}`);
  console.log(`Phase: ${conv.phase}`);
  console.log(`Temperature: ${conv.temperature}`);
  console.log(`Updated At: ${conv.updated_at}`);
  console.log(`Metadata:`, JSON.stringify(conv.metadata, null, 2));

  // 2. Last 15 messages (all directions including system)
  console.log('\n--- 2. Last 15 Messages (ALL directions) ---');
  const msgRes = await sql.query(`
    SELECT id, direction, LEFT(content, 100) as content_preview, 
           media_type, provider_message_id, created_at
    FROM messages 
    WHERE conversation_id = $1 AND tenant_id = $2
    ORDER BY created_at DESC LIMIT 15
  `, [CONV_ID, TENANT_ID]);
  const msgs = msgRes.rows || msgRes;
  console.table(msgs);

  // 3. System messages specifically - check if sent via WhatsApp
  console.log('\n--- 3. System/Alert Messages Detail ---');
  const sysRes = await sql.query(`
    SELECT id, direction, LEFT(content, 150) as content_preview, 
           provider_message_id, media_type, created_at
    FROM messages 
    WHERE conversation_id = $1 AND tenant_id = $2
      AND (direction = 'system' OR content LIKE '%servis dışı%' OR content LIKE '%billing_exhausted%' OR content LIKE '%circuit_open%' OR content LIKE '%AI Unavailable%')
    ORDER BY created_at DESC LIMIT 10
  `, [CONV_ID, TENANT_ID]);
  const sysMsgs = sysRes.rows || sysRes;
  console.log(`System/alert messages found: ${sysMsgs.length}`);
  console.table(sysMsgs);

  // 4. Check outreach_logs for system messages
  console.log('\n--- 4. Outreach Logs (last 10) ---');
  try {
    const outreachRes = await sql.query(`
      SELECT id, phone_number, LEFT(message_content, 100) as content_preview, 
             status, provider, provider_message_id, created_at
      FROM outreach_logs
      WHERE phone_number = $1 AND tenant_id = $2
      ORDER BY created_at DESC LIMIT 10
    `, [PHONE, TENANT_ID]);
    const outreach = outreachRes.rows || outreachRes;
    console.table(outreach);
  } catch (e) {
    console.log('outreach_logs table not found or query failed:', (e as Error).message);
  }

  // 5. Check memory/summary context
  console.log('\n--- 5. Memory Summary (if exists) ---');
  try {
    const memRes = await sql.query(`
      SELECT id, LEFT(summary, 200) as summary_preview, LEFT(key_facts, 200) as key_facts_preview, 
             updated_at
      FROM conversation_memory
      WHERE conversation_id = $1 AND tenant_id = $2
      ORDER BY updated_at DESC LIMIT 1
    `, [CONV_ID, TENANT_ID]);
    const mem = memRes.rows || memRes;
    if (mem.length > 0) {
      console.log('Memory found:');
      console.table(mem);
    } else {
      console.log('No memory summary found.');
    }
  } catch (e) {
    console.log('conversation_memory table not found:', (e as Error).message);
  }

  // 6. Check opportunities / lead context for "Cuma 19:00"
  console.log('\n--- 6. Opportunities (for context source) ---');
  try {
    const oppRes = await sql.query(`
      SELECT id, phone_number, stage, LEFT(notes, 200) as notes_preview,
             metadata, appointment_date, updated_at
      FROM opportunities
      WHERE phone_number = $1 AND tenant_id = $2
      ORDER BY updated_at DESC LIMIT 3
    `, [PHONE, TENANT_ID]);
    const opps = oppRes.rows || oppRes;
    console.table(opps);
  } catch (e) {
    console.log('opportunities query failed:', (e as Error).message);
  }

  // 7. Check tasks for follow-up context
  console.log('\n--- 7. Tasks (follow-up context) ---');
  try {
    const taskRes = await sql.query(`
      SELECT id, task_type, LEFT(title, 100) as title, status, LEFT(description, 150) as desc_preview,
             due_date, created_at
      FROM tasks
      WHERE conversation_id = $1 AND tenant_id = $2
      ORDER BY created_at DESC LIMIT 5
    `, [CONV_ID, TENANT_ID]);
    const tasks = taskRes.rows || taskRes;
    console.table(tasks);
  } catch (e) {
    console.log('tasks query failed:', (e as Error).message);
  }

  // 8. Redis circuit state
  console.log('\n--- 8. Redis Circuit Breaker State ---');
  const redisUrl = process.env.UPSTASH_REDIS_REST_URL;
  const redisToken = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (redisUrl && redisToken) {
    const keys = [
      'circuit_breaker:gemini:failures',
      'circuit_breaker:gemini:state',
    ];
    for (const key of keys) {
      const res = await fetch(`${redisUrl}/get/${key}`, {
        headers: { Authorization: `Bearer ${redisToken}` }
      });
      const data = await res.json();
      console.log(`  ${key}: ${data.result}`);
    }
  }

  console.log('\n=== DIAGNOSTIC COMPLETE ===');
}

run().catch(console.error);
