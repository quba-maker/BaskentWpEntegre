import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
import { neon } from '@neondatabase/serverless';

const TENANT_ID = 'caab9ea1-9591-45e4-bbc5-9c9b498982c8';
const CONV_ID = '8f738423-6213-44e6-8ac0-3a10bc7835bb';
const PHONE = '905546833306';

async function run() {
  const sql = neon(process.env.DATABASE_URL!);

  // 1. Full last 20 messages (chronological)
  console.log('=== LAST 20 MESSAGES (ALL DIRECTIONS) ===');
  const msgs = await sql.query(`
    SELECT id, direction, LEFT(content, 120) as content_preview, 
           provider_message_id, created_at
    FROM messages 
    WHERE conversation_id = $1 AND tenant_id = $2
    ORDER BY created_at DESC LIMIT 20
  `, [CONV_ID, TENANT_ID]);
  const rows = msgs.rows || msgs;
  for (const r of rows) {
    const dir = r.direction.padEnd(7);
    const pid = r.provider_message_id ? r.provider_message_id.substring(0, 20) : 'null';
    console.log(`[${r.created_at}] ${dir} | pid:${pid}... | ${r.content_preview}`);
  }

  // 2. Memory table schema
  console.log('\n=== CONVERSATION_MEMORY SCHEMA ===');
  try {
    const schema = await sql.query(`
      SELECT column_name, data_type FROM information_schema.columns
      WHERE table_name = 'conversation_memory' ORDER BY ordinal_position
    `);
    console.table(schema.rows || schema);
  } catch(e) { console.log('No conversation_memory table'); }

  // 3. Opportunity data (fixed)
  console.log('\n=== OPPORTUNITIES ===');
  try {
    const opps = await sql.query(`
      SELECT id, phone_number, stage, appointment_date,
             metadata::text as metadata_text, updated_at
      FROM opportunities
      WHERE phone_number = $1 AND tenant_id = $2
      ORDER BY updated_at DESC LIMIT 3
    `, [PHONE, TENANT_ID]);
    console.table(opps.rows || opps);
  } catch(e) { console.log('Error:', (e as Error).message); }

  // 4. Recent bot reply and subsequent status changes
  console.log('\n=== POST-UNLOCK MESSAGES (after 20:50 UTC) ===');
  const postUnlock = await sql.query(`
    SELECT id, direction, LEFT(content, 150) as content_preview, 
           provider_message_id, created_at
    FROM messages
    WHERE conversation_id = $1 AND tenant_id = $2
      AND created_at > '2026-06-12T20:50:00Z'
    ORDER BY created_at ASC
  `, [CONV_ID, TENANT_ID]);
  const postRows = postUnlock.rows || postUnlock;
  for (const r of postRows) {
    const dir = r.direction.padEnd(7);
    const pid = r.provider_message_id ? r.provider_message_id.substring(0, 30) : 'null';
    console.log(`[${r.created_at}] ${dir} | pid:${pid}... | ${r.content_preview}`);
  }

  // 5. Check how autopilot was re-locked: look for system messages after unlock
  console.log('\n=== SYSTEM MESSAGES AFTER UNLOCK ===');
  const postSys = await sql.query(`
    SELECT id, direction, LEFT(content, 150) as content_preview,
           provider_message_id, created_at
    FROM messages
    WHERE conversation_id = $1 AND tenant_id = $2
      AND created_at > '2026-06-12T20:50:00Z'
      AND direction = 'system'
    ORDER BY created_at ASC
  `, [CONV_ID, TENANT_ID]);
  console.table(postSys.rows || postSys);

  // 6. Memory table contents
  console.log('\n=== MEMORY CONTENTS ===');
  try {
    const memCols = await sql.query(`
      SELECT column_name FROM information_schema.columns
      WHERE table_name = 'conversation_memory' ORDER BY ordinal_position
    `);
    const cols = (memCols.rows || memCols).map((r: any) => r.column_name);
    console.log('Columns:', cols.join(', '));
    
    if (cols.length > 0) {
      const mem = await sql.query(`
        SELECT * FROM conversation_memory
        WHERE conversation_id = $1 AND tenant_id = $2
        ORDER BY updated_at DESC LIMIT 1
      `, [CONV_ID, TENANT_ID]);
      const memRows = mem.rows || mem;
      if (memRows.length > 0) {
        for (const [k, v] of Object.entries(memRows[0])) {
          const val = typeof v === 'string' && v.length > 200 ? v.substring(0, 200) + '...' : v;
          console.log(`  ${k}: ${JSON.stringify(val)}`);
        }
      } else {
        console.log('No memory record found.');
      }
    }
  } catch(e) { console.log('Error:', (e as Error).message); }
}

run().catch(console.error);
