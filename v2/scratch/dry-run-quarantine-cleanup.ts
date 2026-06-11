import * as dotenv from 'dotenv';
import * as path from 'path';
dotenv.config({ path: path.resolve(__dirname, '../.env.local') });

import { neon } from '@neondatabase/serverless';

async function runDryRun() {
  console.log("=== STARTING DRY-RUN QUARANTINE / TEST LEADS DETECTION ===");

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

  let safeToDeleteCount = 0;
  let unsafeCount = 0;
  const safeCandidates: any[] = [];
  const unsafeCandidates: any[] = [];

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
    
    // We also check if patient name or formName indicates it's a test (e.g. name contains "test", "demo", "Deneme")
    const isExplicitTest = 
      (lead.patient_name && /test|demo|deneme/i.test(lead.patient_name)) ||
      (lead.form_name && /test|demo|deneme/i.test(lead.form_name));

    // A lead is safe to delete ONLY if:
    // - No conversation exists
    // - No outreach logs exist
    // - No messages exist
    const isSafe = !hasConversation && !hasOutreach && !hasMessages;

    // Mask PII for logs
    const maskedPhone = phone ? phone.substring(0, 4) + '***' + phone.substring(phone.length - 2) : 'N/A';
    const maskedName = lead.patient_name ? lead.patient_name.charAt(0) + '***' : 'N/A';
    
    const candidateInfo = {
      id: leadId,
      tenant_id: tenantId,
      form_name: lead.form_name,
      stage: lead.stage,
      created_at: lead.created_at,
      maskedPhone,
      maskedName,
      hasConversation,
      hasOutreach,
      hasMessages,
      messagesCount,
      isExplicitTest
    };

    if (isSafe) {
      safeToDeleteCount++;
      safeCandidates.push(candidateInfo);
    } else {
      unsafeCount++;
      unsafeCandidates.push(candidateInfo);
    }
  }

  console.log("\n=== DRY-RUN REPORT SUMMARY ===");
  console.log(`Total Candidate Leads: ${leads.length}`);
  console.log(`Safe to delete (0 linked records): ${safeToDeleteCount}`);
  console.log(`Unsafe to delete (linked records exist): ${unsafeCount}`);

  console.log("\n--- SAFE CANDIDATES (First 10) ---");
  safeCandidates.slice(0, 10).forEach(c => {
    console.log(`ID: ${c.id} | Tenant: ${c.tenant_id} | Form: ${c.form_name} | Stage: ${c.stage} | Phone: ${c.maskedPhone} | Name: ${c.maskedName} | Test: ${c.isExplicitTest}`);
  });

  console.log("\n--- UNSAFE CANDIDATES (First 10) ---");
  unsafeCandidates.slice(0, 10).forEach(c => {
    console.log(`ID: ${c.id} | Tenant: ${c.tenant_id} | Form: ${c.form_name} | Stage: ${c.stage} | Phone: ${c.maskedPhone} | HasConv: ${c.hasConversation} | HasOutreach: ${c.hasOutreach} | Msgs: ${c.messagesCount}`);
  });

  console.log("\n=== DRY-RUN COMPLETED SUCCESSFULLY ===");
  process.exit(0);
}

runDryRun().catch(err => {
  console.error("Dry-run failed:", err);
  process.exit(1);
});
