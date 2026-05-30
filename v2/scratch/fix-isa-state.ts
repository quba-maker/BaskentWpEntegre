import { Pool } from '@neondatabase/serverless';

async function main() {
  const pool = new Pool({
    connectionString: "postgresql://neondb_owner:npg_x1cmTpdio5qa@ep-orange-hill-alm34j6t-pooler.c-3.eu-central-1.aws.neon.tech/neondb?channel_binding=require&sslmode=require"
  });

  const phoneNumber = '905546833306';

  console.log("=== FIXING STATE FOR ISA ===");
  
  // 1. Get conversation details
  const convRes = await pool.query(`
    SELECT id, active_opportunity_id, notes, tenant_id
    FROM conversations
    WHERE phone_number = $1
  `, [phoneNumber]);
  
  if (convRes.rows.length === 0) {
    console.log("Isa conversation not found!");
    await pool.end();
    return;
  }
  
  const convId = convRes.rows[0].id;
  const activeOppId = convRes.rows[0].active_opportunity_id;
  const tenantId = convRes.rows[0].tenant_id;
  
  console.log("Found Conversation:", convId);
  console.log("Active Opportunity:", activeOppId);
  console.log("Tenant ID:", tenantId);
  console.log("Current Conversation Notes:", convRes.rows[0].notes);

  // 2. Fetch the actual latest rolling summary from conversation_memory or opportunities.summary
  const oppRes = await pool.query(`
    SELECT summary FROM opportunities WHERE id = $1
  `, [activeOppId]);
  
  const actualSummary = oppRes.rows[0]?.summary || '';
  console.log("Actual Opportunity Summary:", actualSummary);

  // 3. Reset conversations.notes to match opportunities.summary so they sync
  await pool.query(`
    UPDATE conversations
    SET notes = $1, updated_at = NOW()
    WHERE id = $2
  `, [actualSummary, convId]);
  
  console.log("Updated conversations.notes to match opportunity summary!");

  // 4. Emit a 'memory_updated' event to clear any memory error and refresh the UI
  await pool.query(`
    INSERT INTO ai_events (
      tenant_id, conversation_id, event_type, event_category, payload, severity
    ) VALUES (
      $1, $2, 'memory_updated', 'memory', '{"info": "State synced manually"}'::jsonb, 'info'
    )
  `, [tenantId, convId]);
  
  console.log("Emitted manual memory_updated event to database.");

  await pool.end();
  console.log("=== STATE FIXED SUCCESSFULLY ===");
}

main().catch(console.error);
