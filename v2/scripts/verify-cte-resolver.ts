import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

const TENANT_ID = "caab9ea1-9591-45e4-bbc5-9c9b498982c8";

async function runVerification() {
  const { withTenantDB } = await import("../src/lib/core/tenant-db");
  const { resolveFirstContactCore } = await import("../src/lib/utils/first-contact-status-resolver");
  const { FIRST_CONTACT_HARD_DUPLICATE_ACTIONS } = await import("../src/lib/utils/first-contact-status-resolver");

  const db = withTenantDB(TENANT_ID, true);

  console.log("==================================================");
  console.log("🔬 First Contact CTE vs TS Resolver Verification");
  console.log("==================================================");

  // 1. Fetch lead records with CTE computed status
  const hardDuplicateActionsSql = FIRST_CONTACT_HARD_DUPLICATE_ACTIONS.map(a => `'${a}'`).join(', ');

  const sqlQuery = `
    WITH base_leads AS (
      SELECT l.*, 
             COALESCE(c_identity.status, c_phone.status) as conversation_status, 
             COALESCE(c_identity.lead_stage, c_phone.lead_stage) as conv_lead_stage, 
             COALESCE(mem_identity.summary_text, mem_phone.summary_text) as ai_summary,
             COALESCE(c_identity.id, c_phone.id) as linked_conv_id,
             COALESCE(c_identity.country, c_phone.conv_country) as conv_country,
             COALESCE(c_identity.department, c_phone.conv_department) as conv_department,
             (SELECT action FROM outreach_logs WHERE lead_id = l.id AND tenant_id = l.tenant_id::text ORDER BY created_at DESC LIMIT 1) as last_outreach_action,
             (SELECT created_at FROM outreach_logs WHERE lead_id = l.id AND tenant_id = l.tenant_id::text ORDER BY created_at DESC LIMIT 1) as last_outreach_at,
             (
               SELECT created_at 
               FROM outreach_logs 
               WHERE lead_id = l.id AND tenant_id = l.tenant_id::text 
                 AND action IN (${hardDuplicateActionsSql})
               ORDER BY created_at ASC LIMIT 1
             ) as first_greeting_at,
             EXISTS (
               SELECT 1 FROM outreach_logs 
               WHERE lead_id = l.id AND tenant_id = l.tenant_id::text 
                 AND action = 'manual_whatsapp_greeting_echo_confirmed'
             ) as any_confirmed,
             EXISTS (
               SELECT 1 FROM outreach_logs 
               WHERE lead_id = l.id AND tenant_id = l.tenant_id::text 
                 AND action = 'inbox_form_greeting_sent'
             ) as any_inbox_sent,
             EXISTS (
               SELECT 1 FROM outreach_logs 
               WHERE lead_id = l.id AND tenant_id = l.tenant_id::text 
                 AND action IN ('greeting_sent', 'template_sent', 'form_greeting_template_sent')
             ) as any_api_sent,
             EXISTS (
               SELECT 1 FROM outreach_logs 
               WHERE lead_id = l.id AND tenant_id = l.tenant_id::text 
                 AND action = 'whatsapp_app_opened_for_greeting'
             ) as any_opened,
             CASE 
               WHEN c_identity.id IS NOT NULL THEN 'customer_id'
               WHEN c_phone.id IS NOT NULL THEN 'phone_unique'
               ELSE 'none'
             END as summary_link_method,
             (
               SELECT json_build_object(
                 'has_inbound', count(m_all.id) > 0,
                 'first_inbound_at', min(m_all.created_at),
                 'last_inbound_at', max(m_all.created_at)
               )
               FROM conversations c_all
               JOIN messages m_all ON m_all.conversation_id = c_all.id AND m_all.tenant_id = c_all.tenant_id
               WHERE c_all.tenant_id = l.tenant_id
                 AND m_all.direction = 'in'
                 AND (m_all.media_metadata IS NULL OR COALESCE(m_all.media_metadata->'native'->>'message_type', '') != 'reaction')
                 AND (
                   (l.customer_id IS NOT NULL AND c_all.customer_id = l.customer_id)
                   OR
                   RIGHT(c_all.phone_number, 10) = RIGHT(l.phone_number, 10)
                   OR
                   (
                     l.raw_data IS NOT NULL 
                     AND l.raw_data != ''
                     AND l.raw_data LIKE '%_all_phones%'
                     AND (
                       CASE
                         WHEN jsonb_typeof(l.raw_data::jsonb->'_all_phones') = 'array' 
                           THEN (l.raw_data::jsonb->'_all_phones') @> jsonb_build_array(c_all.phone_number)
                         WHEN jsonb_typeof(l.raw_data::jsonb->'_all_phones') = 'string' 
                           THEN (l.raw_data::jsonb->>'_all_phones')::jsonb @> jsonb_build_array(c_all.phone_number)
                         ELSE false
                       END
                     )
                   )
                 )
             ) as inbound_stats
      FROM leads l
      -- Layer 1: Safe link via customer_id (identity-based, no ambiguity)
      LEFT JOIN conversations c_identity ON c_identity.tenant_id = l.tenant_id 
        AND l.customer_id IS NOT NULL 
        AND c_identity.customer_id = l.customer_id
      LEFT JOIN conversation_memory mem_identity ON mem_identity.conversation_id = c_identity.id
      -- Layer 2: Phone match only if EXACTLY ONE conversation matches (prevents cross-leak)
      LEFT JOIN LATERAL (
        SELECT c2.id, c2.status, c2.lead_stage, c2.country as conv_country, c2.department as conv_department
        FROM conversations c2 
        WHERE c2.tenant_id = l.tenant_id 
          AND RIGHT(c2.phone_number, 10) = RIGHT(l.phone_number, 10)
          AND l.customer_id IS NULL  -- Only use phone fallback when customer_id link unavailable
          AND (SELECT COUNT(*) FROM conversations cx 
               WHERE cx.tenant_id = l.tenant_id 
               AND RIGHT(cx.phone_number, 10) = RIGHT(l.phone_number, 10)) = 1
        LIMIT 1
      ) c_phone ON c_identity.id IS NULL
      LEFT JOIN conversation_memory mem_phone ON mem_phone.conversation_id = c_phone.id AND c_identity.id IS NULL
      WHERE l.tenant_id = $1
      ORDER BY l.created_at DESC
      LIMIT 100
    ),
    calculated_leads AS (
      SELECT bl.*,
             CASE
               -- 1. anyInbound is true
               WHEN (bl.inbound_stats->>'has_inbound')::boolean = true THEN
                 CASE
                   -- We greeted them
                   WHEN bl.first_greeting_at IS NOT NULL THEN
                     CASE
                       -- If patient replied after we greeted them
                       WHEN (bl.inbound_stats->>'last_inbound_at') IS NOT NULL AND bl.first_greeting_at < (bl.inbound_stats->>'last_inbound_at')::timestamp THEN 'patient_replied'
                       WHEN bl.any_inbox_sent = true THEN 'inbox_greeting_sent'
                       WHEN bl.any_confirmed = true THEN 'manual_greeting_confirmed'
                       WHEN bl.any_api_sent = true THEN 'inbox_greeting_sent'
                       ELSE 'inbox_greeting_sent'
                     END
                   ELSE 'waiting_inbox_reply'
                 END
               -- 2. no inbound message
               ELSE
                 CASE
                   WHEN bl.any_confirmed = true THEN 'manual_greeting_confirmed'
                   WHEN bl.any_inbox_sent = true THEN 'inbox_greeting_sent'
                   WHEN bl.any_api_sent = true THEN 'inbox_greeting_sent'
                   WHEN bl.any_opened = true THEN 'whatsapp_opened'
                   ELSE
                     CASE
                       WHEN bl.phone_number IS NULL OR bl.phone_number = '' THEN 'blocked_or_invalid'
                       WHEN bl.stage NOT IN ('new', 'contacted') THEN 'out_of_scope'
                       ELSE 'needs_greeting'
                     END
                 END
             END as first_contact_status
      FROM base_leads bl
    )
    SELECT id, patient_name, phone_number, stage, first_contact_status, raw_data
    FROM calculated_leads
  `;

  const leads = await db.executeSafe({
    text: sqlQuery,
    values: [TENANT_ID]
  }) as any[];

  console.log(`Retrieved ${leads.length} leads for validation comparison...\n`);

  let successCount = 0;
  let failCount = 0;

  for (const lead of leads) {
    const dbStatus = lead.first_contact_status;

    // Resolve via TS core function
    const tsResolution = await resolveFirstContactCore(db, TENANT_ID, lead.id);
    const tsStatus = tsResolution.patientLevelStatus;

    if (dbStatus === tsStatus) {
      console.log(`✅ Lead: "${lead.patient_name}" (${lead.phone_number || 'No Phone'}) | CTE: ${dbStatus} | TS: ${tsStatus} - MATCH`);
      successCount++;
    } else {
      console.error(`❌ Lead: "${lead.patient_name}" (${lead.phone_number || 'No Phone'}) | CTE: ${dbStatus} | TS: ${tsStatus} - MISMATCH!`);
      console.error(`   Lead Stage: ${lead.stage}`);
      failCount++;
    }
  }

  console.log("\n==================================================");
  console.log(`📊 Result: Matches: ${successCount} | Mismatches: ${failCount}`);
  console.log("==================================================");

  if (failCount > 0) {
    process.exit(1);
  } else {
    console.log("🎉 SUCCESS: Postgres SQL CTE and TS Resolver are perfectly aligned!");
    process.exit(0);
  }
}

runVerification().catch(err => {
  console.error("Execution error:", err);
  process.exit(1);
});
