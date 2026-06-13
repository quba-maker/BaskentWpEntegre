import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

import { neon } from '@neondatabase/serverless';

async function run() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    console.error('DATABASE_URL is not set in .env.local');
    process.exit(1);
  }

  console.log('Connecting to database:', databaseUrl.split('@')[1] || databaseUrl);
  const sql = neon(databaseUrl);

  try {
    // 1. Get Tenants
    const tenantsResult = await sql.query('SELECT id, slug, name FROM tenants');
    const tenants = tenantsResult.rows || tenantsResult;
    console.log('\n--- Tenants ---');
    console.table(tenants);

    for (const tenant of tenants) {
      console.log(`\n================ Tenant: ${tenant.slug} (${tenant.id}) ================`);
      
      // 2. Count conversations by status & autopilot
      const countsResult = await sql.query(`
        SELECT 
          status, 
          autopilot_enabled, 
          COUNT(*) as count 
        FROM conversations 
        WHERE tenant_id = $1 
        GROUP BY status, autopilot_enabled
      `, [tenant.id]);
      const counts = countsResult.rows || countsResult;
      console.log('Conversation status counts:');
      console.table(counts);

      // 3. Find conversations with ai_unavailable in metadata
      const aiUnavailableResult = await sql.query(`
        SELECT 
          id, 
          phone_number, 
          status, 
          autopilot_enabled, 
          metadata->>'ai_unavailable' as ai_unavailable,
          metadata->>'ai_unavailable_reason' as reason,
          metadata->>'ai_unavailable_at' as unavailable_at,
          updated_at
        FROM conversations
        WHERE tenant_id = $1 AND (metadata->>'ai_unavailable' = 'true' OR status = 'human')
        ORDER BY updated_at DESC
        LIMIT 10
      `, [tenant.id]);
      const aiUnavailable = aiUnavailableResult.rows || aiUnavailableResult;
      console.log('Conversations with ai_unavailable or status = human (last 10):');
      console.table(aiUnavailable);

      // 4. Find recent messages with system_alert or error warnings
      const systemAlertsResult = await sql.query(`
        SELECT 
          id,
          conversation_id,
          phone_number,
          direction,
          LEFT(content, 60) as content,
          created_at
        FROM messages
        WHERE tenant_id = $1 AND (direction = 'system' OR provider_message_id = 'system_alert')
        ORDER BY created_at DESC
        LIMIT 10
      `, [tenant.id]);
      const systemAlerts = systemAlertsResult.rows || systemAlertsResult;
      console.log('Recent system messages/alerts:');
      console.table(systemAlerts);
    }
  } catch (err) {
    console.error('Error executing query:', err);
  }
}

run().catch(console.error);
