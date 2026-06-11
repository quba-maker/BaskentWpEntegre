import * as dotenv from 'dotenv';
import * as path from 'path';
dotenv.config({ path: path.resolve(__dirname, '../.env.local') });

import { neon } from '@neondatabase/serverless';

async function runCleanup() {
  console.log("=== STARTING QUARANTINE / TEST LEADS CLEANUP ===");

  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) {
    console.error("DATABASE_URL is not set in environment!");
    process.exit(1);
  }

  const sql = neon(dbUrl);

  // 1. Fetch all leads marked as quarantine, or belonging to disallowed/test campaigns
  const query = `
    SELECT id, tenant_id, form_name, stage, created_at, phone_number, patient_name
    FROM leads
    WHERE stage = 'quarantine' 
       OR form_name IN ('Bilinmeyen Kampanya', 'Tüm Leadler', '_webhook_errors', 'unknown')
    ORDER BY created_at DESC
  `;
  
  const leads = await sql.query(query);
  
  console.log(`\nFound ${leads.length} candidate leads for quarantine/test cleanup.`);

  const safeIdsToDelete: string[] = [];
  const unsafeIds: string[] = [];

  for (const lead of leads) {
    const leadId = lead.id;
    const tenantId = lead.tenant_id;
    const phone = lead.phone_number;
    
    // Check if there are linked conversations by phone or lead_id
    const convs = await sql.query(
      `SELECT id FROM conversations WHERE tenant_id = $1 AND (phone_number = $2 OR lead_stage = $3) LIMIT 1`,
      [tenantId, phone, leadId]
    );
    
    // Check if there are outreach logs linked to lead_id
    const outreachLogs = await sql.query(
      `SELECT id FROM outreach_logs WHERE tenant_id::text = $1 AND lead_id = $2 LIMIT 1`,
      [tenantId, leadId]
    );

    // Check if there are messages
    let messagesCount = 0;
    if (convs.length > 0) {
      const msgs = await sql.query(
        `SELECT COUNT(*) as cnt FROM messages WHERE tenant_id = $1 AND conversation_id = $2`,
        [tenantId, convs[0].id]
      );
      messagesCount = parseInt(msgs[0]?.cnt || '0', 10);
    }

    const hasConversation = convs.length > 0;
    const hasOutreach = outreachLogs.length > 0;
    const hasMessages = messagesCount > 0;
    
    const isSafe = !hasConversation && !hasOutreach && !hasMessages;

    if (isSafe) {
      safeIdsToDelete.push(leadId);
    } else {
      unsafeIds.push(leadId);
    }
  }

  console.log(`Safe to hard-delete: ${safeIdsToDelete.length}`);
  console.log(`Unsafe to delete (will be kept in quarantine): ${unsafeIds.length}`);

  if (safeIdsToDelete.length > 0) {
    console.log(`\nExecuting hard-delete for ${safeIdsToDelete.length} safe leads...`);
    // Delete in batches or a single query
    const deleteQuery = `
      DELETE FROM leads 
      WHERE id = ANY($1)
    `;
    const res = await sql.query(deleteQuery, [safeIdsToDelete]);
    console.log("Delete query completed successfully.");
  } else {
    console.log("\nNo safe candidate leads found to delete.");
  }

  console.log("\n=== CLEANUP COMPLETED SUCCESSFULLY ===");
  process.exit(0);
}

runCleanup().catch(err => {
  console.error("Cleanup failed:", err);
  process.exit(1);
});
