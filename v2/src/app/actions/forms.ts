"use server";

// sql import removed — all queries use parameterized {text, values} format for proper RLS enforcement
import { withActionGuard } from "@/lib/core/action-guard";
import { logAudit } from "@/lib/audit";
import { FIRST_CONTACT_HARD_DUPLICATE_ACTIONS } from "@/lib/utils/first-contact-status-resolver";

// ==========================================
// QUBA AI — Forms & Leads Actions (Zero-Trust)
// ==========================================

export async function getForms(page: number = 1, search: string = "", source: string = "all", firstContactFilter: string = "all", stageFilter: string = "all") {
  return withActionGuard(
    { actionName: 'getForms', conversationId: 'forms_action_no_conversation' },
    async (ctx) => {
      const limit = 50;
      const offset = (page - 1) * limit;
      const searchFilter = search.trim() ? `%${search.trim()}%` : null;
      const sourceFilter = source !== "all" ? `%${source}%` : null;
      const stageParam = stageFilter !== "all" ? stageFilter : null;
      const firstContactParam = firstContactFilter !== "all" ? firstContactFilter : null;

      // Dynamic WHERE builder matching the cl columns
      const conditions: string[] = [`cl.tenant_id = $1`];
      const params: any[] = [ctx.tenantId];
      let paramIdx = 2;

      if (searchFilter) {
        conditions.push(`(cl.patient_name ILIKE $${paramIdx} OR cl.phone_number ILIKE $${paramIdx} OR cl.email ILIKE $${paramIdx} OR (cl.raw_data IS NOT NULL AND cl.raw_data LIKE $${paramIdx}))`);
        params.push(searchFilter);
        paramIdx++;
      }
      if (sourceFilter) {
        conditions.push(`cl.form_name ILIKE $${paramIdx}`);
        params.push(sourceFilter);
        paramIdx++;
      }
      if (stageParam) {
        conditions.push(`cl.stage = $${paramIdx}`);
        params.push(stageParam);
        paramIdx++;
      }
      if (firstContactParam) {
        if (firstContactParam === 'control_required') {
          conditions.push(`cl.first_contact_status = 'control_required'`);
        } else if (firstContactParam === 'sent') {
          conditions.push(`cl.first_contact_status IN ('manual_greeting_confirmed', 'inbox_greeting_sent') AND COALESCE(cl.stage, '') != 'quarantine'`);
        } else if (firstContactParam === 'blocked_or_invalid') {
          conditions.push(`cl.first_contact_status IN ('blocked_or_invalid', 'out_of_scope') AND COALESCE(cl.stage, '') != 'quarantine'`);
        } else if (firstContactParam === 'no_reply_waiting') {
          conditions.push(`cl.is_no_reply_eligible = true AND COALESCE(cl.stage, '') != 'quarantine'`);
        } else if (firstContactParam !== 'all') {
          conditions.push(`cl.first_contact_status = $${paramIdx}`);
          params.push(firstContactParam);
          paramIdx++;
        }
      }
      if (!firstContactParam || firstContactParam === 'all') {
        conditions.push(`COALESCE(cl.stage, '') != 'quarantine'`);
      }

      params.push(limit, offset);
      const limitIdx = paramIdx;
      const offsetIdx = paramIdx + 1;

      const hardDuplicateActionsSql = FIRST_CONTACT_HARD_DUPLICATE_ACTIONS.map(a => `'${a}'`).join(', ');

      const rows = await ctx.db.executeSafe({
        text: `WITH base_leads AS (
                  SELECT l.*, 
                         COALESCE(c_identity.status, c_phone.status) as conversation_status, 
                         COALESCE(c_identity.lead_stage, c_phone.lead_stage) as conv_lead_stage, 
                         COALESCE(c_identity.id, c_phone.id) as linked_conv_id,
                         COALESCE(c_identity.country, c_phone.conv_country) as conv_country,
                         COALESCE(c_identity.department, c_phone.conv_department) as conv_department,
                         COALESCE(c_identity.autopilot_enabled, c_phone.conv_autopilot_enabled) as conv_autopilot_enabled,
                         COALESCE(c_identity.channel, c_phone.conv_channel) as conv_channel,
                         opp.opp_id,
                         opp.opp_country,
                         opp.opp_department,
                         opp.opp_stage,
                         opp.opp_requester_name,
                         opp.opp_patient_name,
                         opp.opp_patient_relation,
                         ol.last_outreach_action,
                         ol.last_outreach_at,
                         ol.first_greeting_at,
                         COALESCE(ol.any_confirmed, false) as any_confirmed,
                         COALESCE(ol.any_inbox_sent, false) as any_inbox_sent,
                         COALESCE(ol.any_api_sent, false) as any_api_sent,
                         COALESCE(ol.any_opened, false) as any_opened,
                         CASE 
                           WHEN c_identity.id IS NOT NULL THEN 'customer_id'
                           WHEN c_phone.id IS NOT NULL THEN 'phone_unique'
                           ELSE 'none'
                         END as summary_link_method,
                         (
                            SELECT json_build_object(
                              'has_inbound', count(CASE WHEN m_all.direction = 'in' THEN 1 END) > 0,
                              'first_inbound_at', min(CASE WHEN m_all.direction = 'in' THEN m_all.created_at END),
                              'last_inbound_at', max(CASE WHEN m_all.direction = 'in' THEN m_all.created_at END),
                              'last_outbound_at', max(CASE WHEN m_all.direction = 'out' THEN m_all.created_at END),
                              'has_outbound_after_first_inbound', EXISTS (
                                SELECT 1 FROM messages m_out
                                WHERE m_out.conversation_id = COALESCE(c_identity.id, c_phone.id)
                                  AND m_out.tenant_id = l.tenant_id
                                  AND m_out.direction = 'out'
                                  AND m_out.created_at > (
                                    SELECT min(m_in.created_at) FROM messages m_in
                                    WHERE m_in.conversation_id = COALESCE(c_identity.id, c_phone.id)
                                      AND m_in.tenant_id = l.tenant_id
                                      AND m_in.direction = 'in'
                                      AND (m_in.media_metadata IS NULL OR COALESCE(m_in.media_metadata->'native'->>'message_type', '') != 'reaction')
                                  )
                              )
                            )
                            FROM messages m_all
                            WHERE m_all.conversation_id = COALESCE(c_identity.id, c_phone.id)
                              AND m_all.tenant_id = l.tenant_id
                              AND (m_all.media_metadata IS NULL OR COALESCE(m_all.media_metadata->'native'->>'message_type', '') != 'reaction')
                         ) as message_stats,
                         (
                            SELECT json_build_object(
                              'direction', m_last.direction,
                              'content', m_last.content,
                              'created_at', m_last.created_at
                            )
                            FROM messages m_last
                            WHERE m_last.conversation_id = COALESCE(c_identity.id, c_phone.id)
                              AND m_last.tenant_id = l.tenant_id
                              AND m_last.direction != 'system'
                              AND (m_last.media_metadata IS NULL OR COALESCE(m_last.media_metadata->'native'->>'message_type', '') != 'reaction')
                            ORDER BY m_last.created_at DESC
                            LIMIT 1
                          ) as last_message_info
                  FROM leads l
                  -- Layer 1: Safe link via customer_id (identity-based, no ambiguity)
                  LEFT JOIN conversations c_identity ON c_identity.tenant_id = l.tenant_id 
                    AND l.customer_id IS NOT NULL 
                    AND c_identity.customer_id = l.customer_id
                  -- Layer 2: Phone match only if EXACTLY ONE conversation matches (prevents cross-leak)
                  LEFT JOIN LATERAL (
                    SELECT c2.id, c2.status, c2.lead_stage, c2.country as conv_country, c2.department as conv_department, c2.autopilot_enabled as conv_autopilot_enabled, c2.channel as conv_channel
                    FROM conversations c2 
                    WHERE c2.tenant_id = l.tenant_id 
                      AND RIGHT(c2.phone_number, 10) = RIGHT(l.phone_number, 10)
                      AND l.customer_id IS NULL  -- Only use phone fallback when customer_id link unavailable
                      AND (SELECT COUNT(*) FROM conversations cx 
                           WHERE cx.tenant_id = l.tenant_id 
                           AND RIGHT(cx.phone_number, 10) = RIGHT(l.phone_number, 10)) = 1
                    LIMIT 1
                  ) c_phone ON c_identity.id IS NULL
                  -- Layer 4: Active opportunity preferred
                  LEFT JOIN LATERAL (
                    SELECT o.id as opp_id, 
                           o.country as opp_country, o.department as opp_department,
                           o.stage as opp_stage,
                           o.requester_name as opp_requester_name,
                           o.patient_name as opp_patient_name,
                           o.patient_relation as opp_patient_relation
                    FROM opportunities o
                    WHERE o.tenant_id = l.tenant_id
                      AND o.conversation_id = COALESCE(c_identity.id, c_phone.id)
                    ORDER BY 
                      CASE WHEN o.id = COALESCE(c_identity.active_opportunity_id, (SELECT active_opportunity_id FROM conversations WHERE id = c_phone.id AND tenant_id = l.tenant_id)) THEN 0 ELSE 1 END,
                      o.updated_at DESC
                    LIMIT 1
                  ) opp ON COALESCE(c_identity.id, c_phone.id) IS NOT NULL
                  -- Layer 5: Grouped outreach logs aggregation
                  LEFT JOIN LATERAL (
                    SELECT 
                      MAX(created_at) as last_outreach_at,
                      (ARRAY_AGG(action ORDER BY created_at DESC))[1] as last_outreach_action,
                      MAX(CASE WHEN action IN (${hardDuplicateActionsSql}) THEN created_at END) as first_greeting_at,
                      BOOL_OR(action = 'manual_whatsapp_greeting_echo_confirmed') as any_confirmed,
                      BOOL_OR(action = 'inbox_form_greeting_sent') as any_inbox_sent,
                      BOOL_OR(action IN ('greeting_sent', 'template_sent', 'form_greeting_template_sent')) as any_api_sent,
                      BOOL_OR(action = 'whatsapp_app_opened_for_greeting') as any_opened
                    FROM outreach_logs
                    WHERE lead_id = l.id AND tenant_id = l.tenant_id::text
                  ) ol ON true
                ),
                calculated_leads AS (
                   SELECT bl.*,
                          CASE
                            WHEN bl.stage = 'quarantine' THEN 'control_required'
                            -- 1. anyInbound is true
                            WHEN (bl.message_stats->>'has_inbound')::boolean = true THEN
                              CASE
                                -- We responded (either greeting log exists or outbound message exists after first inbound)
                                WHEN bl.first_greeting_at IS NOT NULL 
                                     OR bl.any_confirmed = true 
                                     OR bl.any_inbox_sent = true 
                                     OR bl.any_api_sent = true 
                                     OR (bl.message_stats->>'has_outbound_after_first_inbound')::boolean = true THEN
                                  CASE
                                    -- If patient replied after our last response (max of first_greeting_at and last_outbound_at)
                                    WHEN (bl.message_stats->>'last_inbound_at') IS NOT NULL AND 
                                         (bl.message_stats->>'last_inbound_at')::timestamp > (
                                           CASE 
                                             WHEN bl.first_greeting_at IS NULL THEN (bl.message_stats->>'last_outbound_at')::timestamp
                                             WHEN (bl.message_stats->>'last_outbound_at') IS NULL THEN bl.first_greeting_at
                                             WHEN bl.first_greeting_at > (bl.message_stats->>'last_outbound_at')::timestamp THEN bl.first_greeting_at
                                             ELSE (bl.message_stats->>'last_outbound_at')::timestamp
                                           END
                                         ) THEN 'patient_replied'
                                    WHEN bl.any_confirmed = true THEN 'manual_greeting_confirmed'
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
                          END as first_contact_status,
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
                                OR LOWER(bl.last_message_info->>'content') LIKE '%iyi akşamlar%'
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
                SELECT cl.* 
                FROM calculated_leads cl
                WHERE ${conditions.join(' AND ')}
                ORDER BY cl.created_at DESC LIMIT $${limitIdx} OFFSET $${offsetIdx}`,
        values: params
      });

      const { FirstContactDecisionResolver } = await import("@/lib/services/automation/first-contact-decision-resolver");
      const decisions = await FirstContactDecisionResolver.resolveBulkFormLeadDecisions(ctx.tenantId, rows, ctx.db);

      return rows.map((r: any) => {
        return {
          id: r.id,
          phone_number: r.phone_number,
          patient_name: r.patient_name || "İsimsiz Form",
          current_display_name: r.opp_requester_name || r.opp_patient_name || null,
          email: r.email,
          city: r.city,
          form_name: r.form_name || "Bilinmeyen Form",
          stage: r.conv_lead_stage || r.stage || "new",
          created_at: r.created_at,
          raw_data: r.raw_data ? JSON.parse(r.raw_data) : {},
          country: r.country,
          notes: r.notes || "",
          ai_summary: "", // Lazy loaded on detail modal
          isBotActive: r.conversation_status === 'bot',
          summaryLinkMethod: r.summary_link_method || 'none',
          linked_conversation_id: r.linked_conv_id || null,
          linked_opportunity_id: r.opp_id || null,
          current_country: r.opp_country || r.conv_country || r.country || null,
          current_department: r.opp_department || r.conv_department || null,
          current_stage: r.opp_stage || null,
          current_priority: null, // Lazy loaded on detail modal
          current_intent_type: null, // Lazy loaded on detail modal
          current_travel_date: null, // Lazy loaded on detail modal
          current_next_follow_up_at: null, // Lazy loaded on detail modal
          current_ai_summary: "", // Lazy loaded on detail modal
          patient_relation: r.opp_patient_relation || null,
          link_confidence: r.summary_link_method || 'none',
          last_outreach_action: r.last_outreach_action || null,
          last_outreach_at: r.last_outreach_at || null,
          first_greeting_at: r.first_greeting_at || null,
          inbound_stats: r.inbound_stats || { has_inbound: false },
          firstContactStatus: r.first_contact_status,
          autopilotDecision: decisions[String(r.id)] || {
            source: 'form',
            category: 'not_eligible',
            metaWindow: 'unknown',
            technicalEligible: false,
            finalActionAllowed: false,
            recommendedAction: 'no_action',
            reason: 'internal_error',
            userFriendlyReason: 'Durum hesaplanamadı.'
          },
          noReplyFollowup: {
            is_no_reply_eligible: !!r.is_no_reply_eligible,
            no_reply_hours: r.is_no_reply_eligible && r.no_reply_hours ? parseFloat(r.no_reply_hours) : null,
            last_outbound_at: r.last_outbound_at || null
          }
        };
      });
    }
  ).then(res => res.data || []);
}

export async function getFormDetailData(leadId: number) {
  return withActionGuard(
    { actionName: 'getFormDetailData', conversationId: 'forms_action_no_conversation' },
    async (ctx) => {
      const rows = await ctx.db.executeSafe({
        text: `SELECT 
                 COALESCE(mem_identity.summary_text, mem_phone.summary_text) as ai_summary,
                 opp.opp_id,
                 opp.opp_priority,
                 opp.opp_intent_type,
                 opp.opp_travel_date,
                 opp.opp_next_follow_up_at,
                 opp.opp_summary,
                 opp.opp_patient_relation
               FROM leads l
               -- Layer 1: Safe link via customer_id
               LEFT JOIN conversations c_identity ON c_identity.tenant_id = l.tenant_id 
                 AND l.customer_id IS NOT NULL 
                 AND c_identity.customer_id = l.customer_id
               LEFT JOIN conversation_memory mem_identity ON mem_identity.conversation_id = c_identity.id
               -- Layer 2: Phone match fallback
               LEFT JOIN LATERAL (
                 SELECT c2.id
                 FROM conversations c2 
                 WHERE c2.tenant_id = l.tenant_id 
                   AND RIGHT(c2.phone_number, 10) = RIGHT(l.phone_number, 10)
                   AND l.customer_id IS NULL
                   AND (SELECT COUNT(*) FROM conversations cx 
                        WHERE cx.tenant_id = l.tenant_id 
                        AND RIGHT(cx.phone_number, 10) = RIGHT(l.phone_number, 10)) = 1
                 LIMIT 1
               ) c_phone ON c_identity.id IS NULL
               LEFT JOIN conversation_memory mem_phone ON mem_phone.conversation_id = c_phone.id AND c_identity.id IS NULL
               -- Layer 4: Active opportunity preferred
               LEFT JOIN LATERAL (
                 SELECT o.id as opp_id, 
                        o.priority as opp_priority,
                        o.intent_type as opp_intent_type,
                        o.travel_date as opp_travel_date,
                        o.next_follow_up_at as opp_next_follow_up_at,
                        o.summary as opp_summary,
                        o.patient_relation as opp_patient_relation
                 FROM opportunities o
                 WHERE o.tenant_id = l.tenant_id
                   AND o.conversation_id = COALESCE(c_identity.id, c_phone.id)
                 ORDER BY 
                   CASE WHEN o.id = COALESCE(c_identity.active_opportunity_id, (SELECT active_opportunity_id FROM conversations WHERE id = c_phone.id AND tenant_id = l.tenant_id)) THEN 0 ELSE 1 END,
                   o.updated_at DESC
                 LIMIT 1
               ) opp ON opp_id IS NOT NULL OR COALESCE(c_identity.id, c_phone.id) IS NOT NULL
               WHERE l.id = $1 AND l.tenant_id = $2`,
        values: [leadId, ctx.tenantId]
      });

      if (rows.length === 0) {
        throw new Error("Kayıt bulunamadı.");
      }

      const r = rows[0];
      return {
        ai_summary: r.ai_summary || "",
        current_priority: r.opp_priority || null,
        current_intent_type: r.opp_intent_type || null,
        current_travel_date: r.opp_travel_date || null,
        current_next_follow_up_at: r.opp_next_follow_up_at || null,
        current_ai_summary: r.opp_summary || "",
        patient_relation: r.opp_patient_relation || null,
        linked_opportunity_id: r.opp_id || null
      };
    }
  ).then(res => {
    if (!res.success) throw new Error(res.error || "Detay yüklenemedi.");
    return res.data;
  });
}

export async function updateLeadNotes(id: number, notes: string) {
  return withActionGuard(
    { actionName: 'updateLeadNotes', conversationId: 'forms_action_no_conversation' },
    async (ctx) => {
      const lead = await ctx.db.executeSafe({
        text: `SELECT phone_number FROM leads WHERE id = $1 AND tenant_id = $2`,
        values: [id, ctx.tenantId]
      });
      if (lead.length === 0) throw new Error("Kayıt bulunamadı.");

      await ctx.db.executeSafe({
        text: `UPDATE leads SET notes = $1 WHERE id = $2 AND tenant_id = $3`,
        values: [notes, id, ctx.tenantId]
      });

      const SHEET_URL = process.env.GOOGLE_SHEET_UPDATE_URL || process.env.GOOGLE_SHEET_URL;
      if (SHEET_URL && lead.length > 0) {
        try {
          await fetch(SHEET_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              action: 'updateNoteByPhone',
              phone: lead[0].phone_number,
              note: notes
            })
          });
        } catch (sheetErr) {
          const { logger: formsLogger } = await import("@/lib/core/logger");
          formsLogger.withContext({ module: 'Forms' }).warn("Google Sheets note sync failed", { error: String(sheetErr) });
        }
      }

      return { success: true };
    }
  ).then(res => {
    if (!res.success) return { success: false, error: res.error };
    return { success: true };
  });
}

export async function deleteAllLeads() {
  return withActionGuard(
    { 
      actionName: 'deleteAllLeads',
      roles: ['owner', 'admin', 'platform_admin'],
      conversationId: 'forms_action_no_conversation'
    },
    async (ctx) => {
      await ctx.db.executeSafe({ text: `DELETE FROM leads WHERE tenant_id = $1`, values: [ctx.tenantId] });
      
      logAudit({
        tenantId: ctx.tenantId,
        userId: ctx.userId,
        userEmail: ctx.email,
        action: "leads_bulk_delete",
        entityType: "lead",
        entityId: "bulk",
      });

      return { success: true, message: "Firma lead kayıtları başarıyla silindi." };
    }
  ).then(res => {
    if (!res.success) return { success: false, error: res.error };
    return { success: true, message: res.data?.message };
  });
}

export async function getCampaignNames() {
  return withActionGuard(
    { actionName: 'getCampaignNames', conversationId: 'forms_action_no_conversation' },
    async (ctx) => {
      const campaigns = await ctx.db.executeSafe({
        text: `SELECT DISTINCT form_name FROM leads WHERE tenant_id = $1 AND form_name IS NOT NULL AND form_name != '' ORDER BY form_name ASC`,
        values: [ctx.tenantId]
      });
      return campaigns.map((c: any) => c.form_name);
    }
  ).then(res => res.data || []);
}

export async function updateLeadStage(id: number, stage: string) {
  return withActionGuard(
    { actionName: 'updateLeadStage', conversationId: 'forms_action_no_conversation' },
    async (ctx) => {
      const lead = await ctx.db.executeSafe({
        text: `SELECT phone_number, raw_data FROM leads WHERE id = $1 AND tenant_id = $2`,
        values: [id, ctx.tenantId]
      });
      if (lead.length === 0) throw new Error("Kayıt bulunamadı.");

      // Route through UnifiedStageService (maps lead stage → opp stage internally)
      const { UnifiedStageService } = await import('@/lib/services/unified-stage.service');
      const { LEAD_TO_OPP_MAP } = await import('@/lib/config/stage-mapping');
      
      // Convert lead-system stage to opportunity-system stage for unified service
      const oppTargetStage = LEAD_TO_OPP_MAP[stage] || stage;
      
      const result = await UnifiedStageService.update({
        tenantId: ctx.tenantId,
        source: 'forms',
        leadId: id,
        phoneNumber: lead[0].phone_number,
        targetStage: oppTargetStage,
        actorId: ctx.userId,
      });

      // Google Sheets sync (non-blocking, post-transaction)
      if (result.success || result.legacyFallback) {
        const SHEET_URL = process.env.GOOGLE_SHEET_UPDATE_URL || process.env.GOOGLE_SHEET_URL;
        if (SHEET_URL) {
          try {
            const { LEAD_STAGE_LABELS } = await import('@/lib/config/stage-mapping');
            await fetch(SHEET_URL, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                action: 'updateStatusByPhone',
                phone: lead[0].phone_number,
                status: LEAD_STAGE_LABELS[result.mirrorLeadStage || stage] || stage
              })
            });
          } catch (sheetErr) {
            const { logger: formsLogger } = await import("@/lib/core/logger");
            formsLogger.withContext({ module: 'Forms' }).warn("Google Sheets status sync failed", { error: String(sheetErr) });
          }
        }
      }

      return result;
    }
  ).then(res => {
    if (!res.success) return { success: false, error: res.error, blocked: res.data?.blocked, blockReason: res.data?.blockReason };
    return res.data || { success: true };
  });
}

export async function syncGoogleSheets() {
  console.log('[SYNC_ACTION_ENTRY] syncGoogleSheets called');
  
  return withActionGuard(
    { actionName: 'syncGoogleSheets', roles: ['owner', 'admin'], conversationId: 'manual_sync_no_conversation' },
    async (ctx) => {
      console.log('[SYNC_START] tenantId:', ctx.tenantId);

      // ── 1. Load Google Sheets credentials ──
      const integrations = await ctx.db.executeSafe({
        text: `SELECT credentials FROM tenant_integrations WHERE tenant_id = $1 AND provider = 'google_sheets' LIMIT 1`,
        values: [ctx.tenantId]
      });

      if (integrations.length === 0) {
        return { success: false, error: "Google Sheets entegrasyonu bulunamadı. Lütfen Ayarlar → Entegrasyonlar'dan kurulum yapın." };
      }

      let payload;
      try {
        const { decryptPayload } = await import('@/lib/core/encryption');
        payload = decryptPayload(integrations[0].credentials);
      } catch (e: any) {
        console.error('[SYNC_DECRYPT_ERROR]', e?.message);
        return { success: false, error: `Kimlik bilgileri çözülemedi: ${e?.message}` };
      }

      const SHEETS_API_KEY = payload.apiKey;
      const SPREADSHEET_ID = payload.spreadsheetId;
      const configActiveSheets: string[] = payload.activeSheets || [];

      if (!SHEETS_API_KEY || !SPREADSHEET_ID) {
        return { success: false, error: "Google Sheets API Key veya Spreadsheet ID eksik." };
      }

      // ── 2. Load pipeline routing config ──
      let outboundChannelId: string | null = null;
      let greetingGroupId: string | null = null;
      let tenantName: string | null = null;

      try {
        const pipeRes = await ctx.db.executeSafe({
          text: `SELECT greeting_group_id, outbound_channel_id FROM ingestion_pipelines WHERE tenant_id = $1 AND provider = 'google_sheets' LIMIT 1`,
          values: [ctx.tenantId]
        });
        if (pipeRes.length > 0) {
          greetingGroupId = pipeRes[0].greeting_group_id || null;
          outboundChannelId = pipeRes[0].outbound_channel_id || null;
        }
      } catch (_) {}

      try {
        const { resolveTenantDisplayName } = await import('@/lib/services/meta/tenant-display-name-resolver');
        tenantName = await resolveTenantDisplayName(ctx.db, ctx.tenantId);
      } catch (_) {}

      // ── 3. Delegate to shared ingestion service ──
      const { ingestSheetBatch, updateSheetsHealthStatus } = await import('@/lib/services/sheets-ingestion.service');
      
      const result = await ingestSheetBatch({
        tenantId: ctx.tenantId,
        tenantName: tenantName || undefined,
        apiKey: SHEETS_API_KEY,
        spreadsheetId: SPREADSHEET_ID,
        activeSheets: configActiveSheets,
        outboundChannelId,
        greetingGroupId,
        skipAutoMessage: true, // Batch sync: never send auto-messages
        source: 'manual_sync',
        maxRowsPerRun: 2000,
        timeBudgetMs: 45_000,
      });

      // ── 4. Health status update ──
      await updateSheetsHealthStatus(
        ctx.tenantId,
        result.errors > 0 ? 'warning' : 'healthy',
        'manual_sync',
        { created: result.created, duplicates: result.duplicates, errors: result.errors }
      );

      // ── 5. Audit log ──
      const stats = {
        totalRows: result.totalRows,
        created: result.created,
        updated: result.updated,
        unchanged: result.unchanged || 0,
        duplicates: result.duplicates,
        errors: result.errors,
        controlRequired: result.controlRequired || 0,
        skippedUnknownTab: result.skippedUnknownTab || 0,
        partial: result.partial
      };
      const telemetry = result.telemetry || {
        authDurationMs: 0,
        readDurationMs: 0,
        parseDurationMs: 0,
        dupDetectionDurationMs: 0,
        dbDurationMs: 0,
        totalDurationMs: 0
      };
      console.log('[SYNC_COMPLETED]', stats, telemetry);

      logAudit({
        tenantId: ctx.tenantId,
        userId: ctx.userId,
        userEmail: ctx.email,
        action: 'google_sheets_sync_completed',
        entityType: 'integration',
        entityId: 'google_sheets',
        details: { stats, telemetry }
      });

      return {
        success: true,
        message: result.message,
        stats,
        telemetry
      };
    }
  ).then(res => {
    console.log('[SYNC_ACTION_RETURN]', JSON.stringify(res).slice(0, 300));
    if (!res.success || res.data?.success === false) {
      return { success: false, error: res.error || res.data?.error || "Google Sheets senkronizasyonu başarısız." };
    }
    return { 
      success: true, 
      message: res.data?.message, 
      stats: res.data?.stats,
      telemetry: res.data?.telemetry
    };
  });
}

export async function getFormStatusCounts() {
  return withActionGuard(
    { actionName: 'getFormStatusCounts', conversationId: 'forms_action_no_conversation' },
    async (ctx) => {
      // Build lightweight query for counts
      const countsSql = `
        WITH base_leads AS (
          SELECT l.id, l.phone_number, l.stage,
                 COALESCE(ol.any_confirmed, false) as any_confirmed,
                 COALESCE(ol.any_inbox_sent, false) as any_inbox_sent,
                 COALESCE(ol.any_api_sent, false) as any_api_sent,
                 COALESCE(ol.any_opened, false) as any_opened,
                 ol.first_greeting_at,
                 COALESCE(c.id, c_phone.id) as linked_conv_id
          FROM leads l
          LEFT JOIN conversations c ON c.tenant_id = l.tenant_id AND l.customer_id IS NOT NULL AND c.customer_id = l.customer_id
          LEFT JOIN LATERAL (
            SELECT c2.id
            FROM conversations c2 
            WHERE c2.tenant_id = l.tenant_id 
              AND RIGHT(c2.phone_number, 10) = RIGHT(l.phone_number, 10)
              AND l.customer_id IS NULL
              AND (SELECT COUNT(*) FROM conversations cx 
                   WHERE cx.tenant_id = l.tenant_id 
                   AND RIGHT(cx.phone_number, 10) = RIGHT(l.phone_number, 10)) = 1
            LIMIT 1
          ) c_phone ON c.id IS NULL
          LEFT JOIN LATERAL (
            SELECT 
              MAX(created_at) as last_outreach_at,
              MAX(CASE WHEN action IN ('greeting_sent', 'template_sent', 'form_greeting_template_sent', 'manual_whatsapp_greeting_echo_confirmed', 'inbox_form_greeting_sent', 'whatsapp_app_opened_for_greeting') THEN created_at END) as first_greeting_at,
              BOOL_OR(action = 'manual_whatsapp_greeting_echo_confirmed') as any_confirmed,
              BOOL_OR(action = 'inbox_form_greeting_sent') as any_inbox_sent,
              BOOL_OR(action IN ('greeting_sent', 'template_sent', 'form_greeting_template_sent')) as any_api_sent,
              BOOL_OR(action = 'whatsapp_app_opened_for_greeting') as any_opened
            FROM outreach_logs
            WHERE lead_id = l.id AND tenant_id = l.tenant_id::text
          ) ol ON true
          WHERE l.tenant_id = $1
        ),
        base_messages AS (
          SELECT bl.id,
                 EXISTS(SELECT 1 FROM messages m WHERE m.conversation_id = bl.linked_conv_id AND m.direction = 'in') as has_inbound,
                 (SELECT MAX(created_at) FROM messages m WHERE m.conversation_id = bl.linked_conv_id AND m.direction = 'in') as last_inbound_at,
                 (SELECT MAX(created_at) FROM messages m WHERE m.conversation_id = bl.linked_conv_id AND m.direction = 'out') as last_outbound_at,
                 (SELECT direction FROM messages m WHERE m.conversation_id = bl.linked_conv_id ORDER BY created_at DESC LIMIT 1) as last_message_direction,
                 (SELECT content FROM messages m WHERE m.conversation_id = bl.linked_conv_id ORDER BY created_at DESC LIMIT 1) as last_message_content
          FROM base_leads bl
          WHERE bl.linked_conv_id IS NOT NULL
        ),
        calculated_leads AS (
          SELECT bl.*,
                 COALESCE(bm.has_inbound, false) as has_inbound,
                 bm.last_inbound_at,
                 bm.last_outbound_at,
                 CASE
                   WHEN bl.stage = 'quarantine' THEN 'control_required'
                   WHEN bm.has_inbound = true THEN
                     CASE
                       WHEN bl.first_greeting_at IS NOT NULL 
                            OR bl.any_confirmed = true 
                            OR bl.any_inbox_sent = true 
                            OR bl.any_api_sent = true 
                            OR bm.last_outbound_at IS NOT NULL THEN
                         CASE
                           WHEN bm.last_inbound_at IS NOT NULL AND 
                                (bm.last_inbound_at > COALESCE(bm.last_outbound_at, '1970-01-01'::timestamp) AND bm.last_inbound_at > COALESCE(bl.first_greeting_at, '1970-01-01'::timestamp)) THEN 'patient_replied'
                           WHEN bl.any_confirmed = true THEN 'manual_greeting_confirmed'
                           ELSE 'inbox_greeting_sent'
                         END
                       ELSE 'waiting_inbox_reply'
                     END
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
                 END as first_contact_status,
                 COALESCE(
                   bm.last_message_direction = 'out'
                   AND bl.stage NOT IN ('lost', 'not_qualified', 'arrived')
                   AND (
                     bm.last_message_content LIKE '%?%'
                     OR LOWER(bm.last_message_content) LIKE '%ne zaman%'
                     OR LOWER(bm.last_message_content) LIKE '%uygun olduğunuz%'
                     OR LOWER(bm.last_message_content) LIKE '%paylaşabilir misiniz%'
                     OR LOWER(bm.last_message_content) LIKE '%ister misiniz%'
                     OR LOWER(bm.last_message_content) LIKE '%gelmeyi düşünüyor musunuz%'
                     OR LOWER(bm.last_message_content) LIKE '%telefon görüşmesi%'
                     OR LOWER(bm.last_message_content) LIKE '%randevu planlam%'
                     OR LOWER(bm.last_message_content) LIKE '%uygun saat%'
                   )
                 , false) as is_no_reply_eligible
          FROM base_leads bl
          LEFT JOIN base_messages bm ON bm.id = bl.id
        )
        SELECT 
          COUNT(CASE WHEN stage != 'quarantine' THEN 1 END) as total,
          COUNT(CASE WHEN first_contact_status = 'needs_greeting' AND is_no_reply_eligible = false AND stage != 'quarantine' THEN 1 END) as needs_greeting,
          COUNT(CASE WHEN first_contact_status = 'waiting_inbox_reply' AND is_no_reply_eligible = false AND stage != 'quarantine' THEN 1 END) as waiting_inbox_reply,
          COUNT(CASE WHEN first_contact_status = 'whatsapp_opened' AND is_no_reply_eligible = false AND stage != 'quarantine' THEN 1 END) as whatsapp_opened,
          COUNT(CASE WHEN is_no_reply_eligible = true AND stage != 'quarantine' THEN 1 END) as no_reply_waiting,
          COUNT(CASE WHEN first_contact_status IN ('manual_greeting_confirmed', 'inbox_greeting_sent') AND is_no_reply_eligible = false AND stage != 'quarantine' THEN 1 END) as sent,
          COUNT(CASE WHEN first_contact_status = 'patient_replied' AND is_no_reply_eligible = false AND stage != 'quarantine' THEN 1 END) as patient_replied,
          COUNT(CASE WHEN first_contact_status IN ('blocked_or_invalid', 'out_of_scope') AND stage != 'quarantine' THEN 1 END) as blocked_or_invalid,
          COUNT(CASE WHEN stage = 'quarantine' THEN 1 END) as control_required
        FROM calculated_leads
      `;

      const rows = await ctx.db.executeSafe({
        text: countsSql,
        values: [ctx.tenantId]
      });

      const r = rows[0] || {};
      return {
        all: parseInt(r.total || '0', 10),
        needs_greeting: parseInt(r.needs_greeting || '0', 10),
        waiting_inbox_reply: parseInt(r.waiting_inbox_reply || '0', 10),
        whatsapp_opened: parseInt(r.whatsapp_opened || '0', 10),
        no_reply_waiting: parseInt(r.no_reply_waiting || '0', 10),
        sent: parseInt(r.sent || '0', 10),
        patient_replied: parseInt(r.patient_replied || '0', 10),
        blocked_or_invalid: parseInt(r.blocked_or_invalid || '0', 10),
        control_required: parseInt(r.control_required || '0', 10),
      };
    }
  ).then(res => {
    if (!res.success) return { all: 0, needs_greeting: 0, waiting_inbox_reply: 0, whatsapp_opened: 0, no_reply_waiting: 0, sent: 0, patient_replied: 0, blocked_or_invalid: 0, control_required: 0 };
    return res.data;
  });
}

export async function getFormsSyncMetadata() {
  return withActionGuard(
    { actionName: 'getFormsSyncMetadata', conversationId: 'forms_action_no_conversation' },
    async (ctx) => {
      let lastManual = null;
      let lastAuto = null;

      try {
        const manualLog = await ctx.db.executeSafe({
          text: `SELECT created_at FROM audit_logs 
                 WHERE tenant_id = $1 AND action = 'google_sheets_sync_completed' AND user_id IS NOT NULL
                 ORDER BY created_at DESC LIMIT 1`,
          values: [ctx.tenantId]
        });
        if (manualLog && manualLog.length > 0) {
          lastManual = manualLog[0].created_at;
        }
      } catch (e) {
        console.warn("Failed to get manual sync log:", e);
      }

      let cron_last_run_at = null;
      let webhook_last_received_at = null;

      try {
        const res = await ctx.db.executeSafe({
          text: `SELECT cron_last_run_at FROM tenant_integrations WHERE tenant_id = $1 AND provider = 'google_sheets' LIMIT 1`,
          values: [ctx.tenantId]
        });
        if (res && res.length > 0) cron_last_run_at = res[0].cron_last_run_at;
      } catch (_) {}

      try {
        const res = await ctx.db.executeSafe({
          text: `SELECT webhook_last_received_at FROM tenant_integrations WHERE tenant_id = $1 AND provider = 'google_sheets' LIMIT 1`,
          values: [ctx.tenantId]
        });
        if (res && res.length > 0) webhook_last_received_at = res[0].webhook_last_received_at;
      } catch (_) {}

      const autoCandidates = [cron_last_run_at, webhook_last_received_at].filter(Boolean);
      if (autoCandidates.length > 0) {
        try {
          lastAuto = new Date(Math.max(...autoCandidates.map((d: any) => new Date(d).getTime()))).toISOString();
        } catch (_) {
          lastAuto = null;
        }
      } else {
        lastAuto = null;
      }

      return {
        lastManualSync: lastManual ? new Date(lastManual).toISOString() : null,
        lastAutoSync: lastAuto ? new Date(lastAuto).toISOString() : null
      };
    }
  ).then(res => {
    if (!res.success) return { lastManualSync: null, lastAutoSync: null };
    return res.data;
  });
}

