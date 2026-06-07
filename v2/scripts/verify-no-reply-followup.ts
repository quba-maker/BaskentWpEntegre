import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

const TENANT_ID = "caab9ea1-9591-45e4-bbc5-9c9b498982c8";

async function runVerification() {
  const { withTenantDB } = await import("../src/lib/core/tenant-db");
  const { resolveFirstContactCore } = await import("../src/lib/utils/first-contact-status-resolver");
  const { FIRST_CONTACT_HARD_DUPLICATE_ACTIONS } = await import("../src/lib/utils/first-contact-status-resolver");

  const db = withTenantDB(TENANT_ID, true);

  console.log("==================================================");
  console.log("🔬 NoReply Followup CTE vs TS Resolver Verification");
  console.log("==================================================");

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
               ORDER BY created_at DESC LIMIT 1
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
                 'direction', m_last.direction,
                 'content', m_last.content,
                 'created_at', m_last.created_at
               )
               FROM conversations c_last
               JOIN messages m_last ON m_last.conversation_id = c_last.id AND m_last.tenant_id = c_last.tenant_id
               WHERE c_last.tenant_id = l.tenant_id
                 AND m_last.direction != 'system'
                 AND (m_last.media_metadata IS NULL OR COALESCE(m_last.media_metadata->'native'->>'message_type', '') != 'reaction')
                 AND (
                   (l.customer_id IS NOT NULL AND c_last.customer_id = l.customer_id)
                   OR
                   RIGHT(c_last.phone_number, 10) = RIGHT(l.phone_number, 10)
                   OR
                   (
                     l.raw_data IS NOT NULL 
                     AND l.raw_data != ''
                     AND l.raw_data LIKE '%_all_phones%'
                     AND (
                       CASE
                         WHEN jsonb_typeof(l.raw_data::jsonb->'_all_phones') = 'array' 
                           THEN (l.raw_data::jsonb->'_all_phones') @> jsonb_build_array(c_last.phone_number)
                         WHEN jsonb_typeof(l.raw_data::jsonb->'_all_phones') = 'string' 
                           THEN (l.raw_data::jsonb->>'_all_phones')::jsonb @> jsonb_build_array(c_last.phone_number)
                         ELSE false
                       END
                     )
                   )
                 )
               ORDER BY m_last.created_at DESC
               LIMIT 1
             ) as last_message_info
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
             COALESCE(
               (bl.last_message_info->>'direction') = 'out'
               AND bl.stage NOT IN ('lost', 'not_qualified', 'arrived')
               AND (
                 -- 1. Blacklist check (closing keywords)
                 NOT (
                   LOWER(bl.last_message_info->>'content') LIKE '%teşekkür ederiz%'
                   OR LOWER(bl.last_message_info->>'content') LIKE '%teşekkürler%'
                   OR LOWER(bl.last_message_info->>'content') LIKE '%iyi günler%'
                   OR LOWER(bl.last_message_info->>'content') LIKE '%randevunuz onaylandı%'
                   OR LOWER(bl.last_message_info->>'content') LIKE '%görüşmeniz tamamlandı%'
                   OR LOWER(bl.last_message_info->>'content') LIKE '%yine bekleriz%'
                   OR LOWER(bl.last_message_info->>'content') LIKE '%talebiniz alınmıştır%'
                   OR LOWER(bl.last_message_info->>'content') LIKE '%iyi akşamlar%'
                   OR LOWER(bl.last_message_info->>'content') LIKE '%geçmiş olsun%'
                   OR LOWER(bl.last_message_info->>'content') LIKE '%iyi bayramlar%'
                   OR LOWER(bl.last_message_info->>'content') LIKE '%mutlu günler%'
                   OR LOWER(bl.last_message_info->>'content') LIKE '%başarılar dileriz%'
                   OR LOWER(bl.last_message_info->>'content') LIKE '%yardımcı olabildiysek ne mutlu%'
                   OR LOWER(bl.last_message_info->>'content') LIKE '%hoşçakalın%'
                   OR LOWER(bl.last_message_info->>'content') LIKE '%kendinize iyi bakın%'
                   OR LOWER(bl.last_message_info->>'content') LIKE '%thank you%'
                   OR LOWER(bl.last_message_info->>'content') LIKE '%thanks%'
                   OR LOWER(bl.last_message_info->>'content') LIKE '%have a nice day%'
                   OR LOWER(bl.last_message_info->>'content') LIKE '%good day%'
                   OR LOWER(bl.last_message_info->>'content') LIKE '%stay safe%'
                   OR LOWER(bl.last_message_info->>'content') LIKE '%iyi günler dileriz%'
                   OR LOWER(bl.last_message_info->>'content') LIKE '%görüşmek üzere%'
                   OR LOWER(bl.last_message_info->>'content') LIKE '%sağlıklı günler%'
                   OR LOWER(bl.last_message_info->>'content') LIKE '%randevunuz oluşturuldu%'
                   OR LOWER(bl.last_message_info->>'content') LIKE '%hayirli pazarlar%'
                   OR LOWER(bl.last_message_info->>'content') LIKE '%hayırlı günler%'
                 )
                 -- 2. Whitelist / Expects Reply keywords check
                 AND (
                   bl.last_message_info->>'content' LIKE '%?%'
                   OR LOWER(bl.last_message_info->>'content') LIKE '%ne zaman%'
                   OR LOWER(bl.last_message_info->>'content') LIKE '%uygun olduğunuz%'
                   OR LOWER(bl.last_message_info->>'content') LIKE '%paylaşabilir misiniz%'
                   OR LOWER(bl.last_message_info->>'content') LIKE '%ister misiniz%'
                   OR LOWER(bl.last_message_info->>'content') LIKE '%gelmeyi düşünüyor musunuz%'
                   OR LOWER(bl.last_message_info->>'content') LIKE '%telefon görüşmesi%'
                   OR LOWER(bl.last_message_info->>'content') LIKE '%randevu planlam%'
                   OR LOWER(bl.last_message_info->>'content') LIKE '%uygun saat%'
                   OR LOWER(bl.last_message_info->>'content') LIKE '%ne zaman arayalım%'
                   OR LOWER(bl.last_message_info->>'content') LIKE '%ne zaman görüşelim%'
                   OR LOWER(bl.last_message_info->>'content') LIKE '%arama saati%'
                   OR LOWER(bl.last_message_info->>'content') LIKE '%ne zaman müsait%'
                   OR LOWER(bl.last_message_info->>'content') LIKE '%görüşme saati%'
                   OR LOWER(bl.last_message_info->>'content') LIKE '%müsait olduğunuz%'
                   OR LOWER(bl.last_message_info->>'content') LIKE '%nereden%'
                   OR LOWER(bl.last_message_info->>'content') LIKE '%nerede yaşıyorsunuz%'
                   OR LOWER(bl.last_message_info->>'content') LIKE '%hangi ülkede%'
                   OR LOWER(bl.last_message_info->>'content') LIKE '%nerede ikamet%'
                   OR LOWER(bl.last_message_info->>'content') LIKE '%yaşadığınız yer%'
                   OR LOWER(bl.last_message_info->>'content') LIKE '%teyit%'
                   OR LOWER(bl.last_message_info->>'content') LIKE '%randevu saati%'
                   OR LOWER(bl.last_message_info->>'content') LIKE '%randevu tarihi%'
                   OR LOWER(bl.last_message_info->>'content') LIKE '%geliyor musunuz%'
                   OR LOWER(bl.last_message_info->>'content') LIKE '%gelecek misiniz%'
                   OR LOWER(bl.last_message_info->>'content') LIKE '%katılım durumunuz%'
                   OR LOWER(bl.last_message_info->>'content') LIKE '%şikayetiniz nedir%'
                   OR LOWER(bl.last_message_info->>'content') LIKE '%rahatsızlığınız nedir%'
                   OR LOWER(bl.last_message_info->>'content') LIKE '%ağrınız ne%'
                   OR LOWER(bl.last_message_info->>'content') LIKE '%ağrınız var mı%'
                   OR LOWER(bl.last_message_info->>'content') LIKE '%tedavi için ne zaman%'
                   OR LOWER(bl.last_message_info->>'content') LIKE '%ameliyat için ne zaman%'
                   OR LOWER(bl.last_message_info->>'content') LIKE '%hastalık geçmişiniz nedir%'
                   OR LOWER(bl.last_message_info->>'content') LIKE '%hastalık geçmişinizi paylaşır%'
                   OR (
                     (
                       LOWER(bl.last_message_info->>'content') LIKE '%paylaşır mısınız%'
                       OR LOWER(bl.last_message_info->>'content') LIKE '%gönderebilir misiniz%'
                       OR LOWER(bl.last_message_info->>'content') LIKE '%iletebilir misiniz%'
                       OR LOWER(bl.last_message_info->>'content') LIKE '%var mı%'
                       OR LOWER(bl.last_message_info->>'content') LIKE '%yollar mısınız%'
                       OR LOWER(bl.last_message_info->>'content') LIKE '%gönderir misiniz%'
                     )
                     AND (
                       LOWER(bl.last_message_info->>'content') LIKE '%rapor%'
                       OR LOWER(bl.last_message_info->>'content') LIKE '%röntgen%'
                       OR LOWER(bl.last_message_info->>'content') LIKE '%mr%'
                       OR LOWER(bl.last_message_info->>'content') LIKE '%film%'
                       OR LOWER(bl.last_message_info->>'content') LIKE '%tetkik%'
                       OR LOWER(bl.last_message_info->>'content') LIKE '%sonuç%'
                       OR LOWER(bl.last_message_info->>'content') LIKE '%belge%'
                       OR LOWER(bl.last_message_info->>'content') LIKE '%fotoğraf%'
                     )
                   )
                 )
               )
             , false) as is_no_reply_eligible,
             ROUND(EXTRACT(EPOCH FROM (NOW() - (bl.last_message_info->>'created_at')::timestamp)) / 3600.0, 1) as no_reply_hours,
             (bl.last_message_info->>'created_at')::timestamp as last_outbound_at
      FROM base_leads bl
    )
    SELECT id, patient_name, phone_number, stage, is_no_reply_eligible, no_reply_hours, last_outbound_at
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
    const dbEligible = !!lead.is_no_reply_eligible;
    const dbHours = dbEligible && lead.no_reply_hours ? parseFloat(lead.no_reply_hours) : null;

    // Resolve via TS core function
    const tsResolution = await resolveFirstContactCore(db, TENANT_ID, lead.id);
    const tsEligible = tsResolution.noReplyFollowup.is_no_reply_eligible;
    const tsHours = tsResolution.noReplyFollowup.no_reply_hours;

    // We allow a small difference in hours elapsed due to query-vs-execution clock drift
    const hoursMatch = dbHours === null && tsHours === null 
      ? true 
      : (dbHours !== null && tsHours !== null && Math.abs(dbHours - tsHours) <= 0.2);

    if (dbEligible === tsEligible && hoursMatch) {
      console.log(`✅ Lead: "${lead.patient_name}" (${lead.phone_number || 'No Phone'}) | CTE: ${dbEligible} (${dbHours}h) | TS: ${tsEligible} (${tsHours}h) - MATCH`);
      successCount++;
    } else {
      console.error(`❌ Lead: "${lead.patient_name}" (${lead.phone_number || 'No Phone'}) | CTE: ${dbEligible} (${dbHours}h) | TS: ${tsEligible} (${tsHours}h) - MISMATCH!`);
      failCount++;
    }
  }

  console.log("\n==================================================");
  console.log(`📊 Result: Matches: ${successCount} | Mismatches: ${failCount}`);
  console.log("==================================================");

  if (failCount > 0) {
    process.exit(1);
  } else {
    console.log("🎉 SUCCESS: Postgres SQL CTE and TS Resolver NoReplyFollowupState are perfectly aligned!");
    process.exit(0);
  }
}

runVerification().catch(err => {
  console.error("Execution error:", err);
  process.exit(1);
});
