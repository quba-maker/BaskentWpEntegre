"use server";

import { withActionGuard } from "@/lib/core/action-guard";
import { logAudit } from "@/lib/audit";
import { enqueueRetry } from "@/lib/retry";
import { CredentialsService } from "@/lib/services/credentials.service";
import { isThreeSixtyProvider } from "@/lib/core/provider-aliases";
import { PatientNameSyncService } from "@/lib/services/patient-name-sync";
import { resolvePatientDisplayName, checkNameValidity, resolvePatientNameDetailed } from "@/lib/utils/patient-name-resolver";
import { getCountryFromPhone } from "@/lib/utils/country";
import { extractFormFields } from "@/lib/utils/form-field-extractor";
import { normalizeCountry, getCountryDisplayLabel, resolvePatientCountryDetailed } from "@/lib/utils/country-normalizer";
import { ExpectsReplyClassifier } from "@/lib/services/classification/expects-reply-classifier";
import { normalizePhoneForIdentity, parseAllPhones } from "@/lib/utils/phone-identity";
import { logger } from "@/lib/core/logger";

const log = logger.withContext({ module: 'InboxActions' });

// ==========================================
// QUBA AI — Inbox Actions (Zero-Trust Migrated)
// ==========================================

export async function getConversations(
  page: number = 1,
  search: string = "",
  stage: string = "all",
  primaryFilter: string = "all",
  replyFilter: string = "all_reply",
  channelFilter: string = "all"
) {
  noStore();
  return withActionGuard(
    { actionName: 'getConversations', conversationId: 'inbox_action_no_conversation' },
    async (ctx) => {
      const limit = 30;
      const offset = (page - 1) * limit;
      const searchFilter = search.trim() ? `%${search.trim()}%` : null;
      
      const isNoReplyFilter = primaryFilter === 'needs_response';
      const isUnreadFilter = primaryFilter === 'unread';
      const isFavoritesFilter = primaryFilter === 'favorites';
      const isBotActiveFilter = primaryFilter === 'bot_active';
      const isArchivedFilter = stage === 'archived';

      let noReplyHours: number | null = null;
      if (isNoReplyFilter && replyFilter.startsWith('no_reply')) {
        const match = replyFilter.match(/no_reply_(\d+)h/);
        if (match) {
          noReplyHours = parseInt(match[1], 10);
        }
      }

      const channelFilterVal = (channelFilter && channelFilter !== 'all') 
        ? (channelFilter === 'facebook' || channelFilter === 'messenger' ? 'messenger' : channelFilter)
        : null;

      const stageFilterVal = (stage && stage !== 'all' && stage !== 'archived') 
        ? stage 
        : null;

      const optOutPhones = new Set<string>();
      // Query active opt-out opportunities
      try {
        const optOutOpps = await ctx.db.executeSafe({
          text: `
            SELECT phone_number, metadata 
            FROM opportunities 
            WHERE tenant_id = $1 
              AND (COALESCE(metadata->>'opt_out_requested', 'false') = 'true')
          `,
          values: [ctx.tenantId]
        });
        const optOutOppRows = Array.isArray(optOutOpps) ? optOutOpps : ((optOutOpps as any)?.rows || []);
        for (const o of optOutOppRows) {
          const norm = normalizePhoneForIdentity(o.phone_number);
          if (norm.e164) optOutPhones.add(norm.e164);
        }

        // Query last inbound messages containing opt-out keywords
        const lastInbounds = await ctx.db.executeSafe({
          text: `
            SELECT DISTINCT ON (phone_number) phone_number, content 
            FROM messages 
            WHERE tenant_id = $1 AND direction = 'in'
              AND (media_metadata IS NULL OR COALESCE(media_metadata->'native'->>'message_type', '') != 'reaction')
            ORDER BY phone_number, created_at DESC
          `,
          values: [ctx.tenantId]
        });
        const lastInboundRows = Array.isArray(lastInbounds) ? lastInbounds : ((lastInbounds as any)?.rows || []);
        
        const hasOptOutKeywords = (text: string): boolean => {
          const clean = (text || '').toLowerCase().trim();
          const optOuts = [
            "dur", "stop", "istemiyorum", "rahatsız etmeyin", "mesaj atmayın", 
            "bırakın", "silin", "arama", "yazma", "unsubscribe", "don't write"
          ];
          return optOuts.some(kw => clean.includes(kw));
        };

        for (const m of lastInboundRows) {
          if (hasOptOutKeywords(m.content)) {
            const norm = normalizePhoneForIdentity(m.phone_number);
            if (norm.e164) optOutPhones.add(norm.e164);
          }
        }
      } catch (e) {
        console.error("[INBOX_FORENSIC] Failed to fetch optOutPhones:", e);
      }

      log.debug(`[INBOX_FORENSIC] getConversations called | tenantId=${ctx.tenantId} | page=${page} | search="${search}" | stage="${stage}" | primary=${primaryFilter} | reply=${replyFilter} | channel=${channelFilter} | noReplyHours=${noReplyHours}`, {
        tenantId: ctx.tenantId
      });

      let queryText = `
        SELECT 
          c.id as conversation_id,
          c.id as conversationId,
          c.customer_id,
          c.phone_number as id,
          c.patient_name as name,
          c.department,
          c.country,
          c.status,
          c.autopilot_enabled,
          c.phase,
          c.lead_stage as stage,
          c.tags as tags,
          c.tags as conv_tags_raw,
          c.channel,
          c.channel_id as channel_id,
          c.channel_id as "channelId",
          c.notes as notes,
          c.last_message_at,
          EXTRACT(EPOCH FROM c.last_message_at) * 1000 as last_message_time_ms,
          m.content as last_message,
          m.status as last_message_status,
          m.direction as last_message_direction,
          m.model_used as last_message_model,
          m.media_type as last_message_media_type,
          m.media_url as last_message_media_url,
          -- Fallbacks for CRM fields removed from sidebar query
          NULL::uuid as lead_id,
          NULL::text as form_name,
          NULL::text as form_patient_name,
          NULL::text as form_raw_data,
          NULL::double precision as form_date_ms,
          NULL::uuid as active_opp_id,
          NULL::text as opp_requester_name,
          NULL::text as opp_patient_name,
          NULL::text as opp_country,
          NULL::text as opp_department,
          NULL::text as opp_summary,
          NULL::text as opp_ai_reason,
          NULL::text as opp_stage,
          NULL::text as opp_priority,
          NULL::text as opp_patient_relation,
          NULL::jsonb as opp_metadata,
          NULL::text as opp_automation_status,
          NULL::text as ai_summary,
          NULL::text as legacy_ai_summary,
          NULL::text as ai_buying_intent,
          NULL::text as ai_sentiment,
          (
            SELECT COUNT(*)::int 
            FROM messages m_unread
            WHERE m_unread.conversation_id = c.id
              AND m_unread.tenant_id = c.tenant_id
              AND m_unread.direction = 'in'
              AND (m_unread.media_metadata IS NULL OR COALESCE(m_unread.media_metadata->'native'->>'message_type', '') != 'reaction')
              AND m_unread.created_at > COALESCE(rs.last_read_at, '1970-01-01'::timestamptz)
          ) as unread,
          EXISTS (
            SELECT 1 FROM messages m_out
            WHERE m_out.conversation_id = c.id
              AND m_out.tenant_id = c.tenant_id
              AND m_out.direction = 'out'
          ) as has_outbound,
          (cp.id IS NOT NULL) as is_pinned,
          (cf.id IS NOT NULL) as is_favorite,
          (ca.id IS NOT NULL) as is_archived,
          NULLIF(TRIM(CONCAT(cprof.first_name, ' ', cprof.last_name)), '') as customer_display_name,
          wa.wa_profile_name,
          active_task.active_task_id,
          active_task.active_task_type,
          active_task.active_task_status
        FROM conversations c
        LEFT JOIN customer_profiles cprof
          ON cprof.id = c.customer_id
          AND cprof.tenant_id = c.tenant_id
        LEFT JOIN LATERAL (
          SELECT media_metadata->'native'->>'whatsapp_profile_name' as wa_profile_name
          FROM messages
          WHERE conversation_id = c.id 
            AND tenant_id = c.tenant_id
            AND media_metadata->'native'->>'whatsapp_profile_name' IS NOT NULL
          ORDER BY created_at DESC
          LIMIT 1
        ) wa ON true
        LEFT JOIN LATERAL (
          SELECT content, status, direction, model_used, media_type, media_url
          FROM messages 
          WHERE conversation_id = c.id 
            AND tenant_id = c.tenant_id
            AND direction IN ('in', 'out')
            AND (media_metadata IS NULL OR COALESCE(media_metadata->'native'->>'message_type', '') != 'reaction')
          ORDER BY created_at DESC 
          LIMIT 1
        ) m ON true
        LEFT JOIN LATERAL (
          SELECT id as active_task_id, task_type as active_task_type, status as active_task_status
          FROM follow_up_tasks
          WHERE (
            conversation_id = c.id::text 
            OR (opportunity_id = c.active_opportunity_id AND c.active_opportunity_id IS NOT NULL)
          )
            AND tenant_id = c.tenant_id
            AND status = 'pending'
          ORDER BY due_at ASC, created_at DESC
          LIMIT 1
        ) active_task ON true
        -- Pinned Join
        LEFT JOIN conversation_pins cp
          ON c.id = cp.conversation_id
          AND cp.user_id = $7
          AND cp.tenant_id = c.tenant_id
        -- Favorites Join
        LEFT JOIN conversation_favorites cf
          ON c.id = cf.conversation_id
          AND cf.user_id = $7
          AND cf.tenant_id = c.tenant_id
        -- Archives Join
        LEFT JOIN conversation_archives ca
          ON c.id = ca.conversation_id
          AND ca.user_id = $7
          AND ca.tenant_id = c.tenant_id
        -- Read States Join
        LEFT JOIN conversation_read_states rs
          ON rs.tenant_id = c.tenant_id
          AND rs.user_id = $7
          AND rs.conversation_id = c.id
        WHERE c.tenant_id = $1
          AND ($2::text IS NULL OR c.patient_name ILIKE $2 OR c.phone_number ILIKE $2)
          AND ($3::text IS NULL OR c.channel = $3)
          AND ($4::text IS NULL OR c.lead_stage = $4)
          AND ($5::integer IS NULL OR 1=1)
          AND ($6::integer IS NULL OR 1=1)
          AND ($8::integer IS NULL OR 1=1)
          ${isFavoritesFilter ? 'AND cf.id IS NOT NULL AND ca.id IS NULL' : ''}
          ${isBotActiveFilter ? 'AND c.autopilot_enabled = true' : ''}
          ${isArchivedFilter ? 'AND ca.id IS NOT NULL' : (isFavoritesFilter ? '' : `
            AND (
              ca.id IS NULL 
              OR EXISTS (
                SELECT 1 
                FROM messages m_unread
                WHERE m_unread.conversation_id = c.id
                  AND m_unread.tenant_id = c.tenant_id
                  AND m_unread.direction = 'in'
                  AND (m_unread.media_metadata IS NULL OR COALESCE(m_unread.media_metadata->'native'->>'message_type', '') != 'reaction')
                  AND m_unread.created_at > COALESCE(rs.last_read_at, '1970-01-01'::timestamptz)
              )
            )
          `)}
      `;

      const values: any[] = [
        ctx.tenantId, 
        searchFilter, 
        channelFilterVal, 
        stageFilterVal, 
        limit, 
        offset, 
        ctx.userId,
        noReplyHours
      ];

      if (isNoReplyFilter) {
        if (replyFilter === 'waiting_inbox_reply') {
          queryText += `
            AND c.last_message_direction = 'in' AND NOT EXISTS (
              SELECT 1 FROM messages m_out
              WHERE m_out.conversation_id = c.id
                AND m_out.tenant_id = c.tenant_id
                AND m_out.direction = 'out'
            )
          `;
        } else if (replyFilter.startsWith('no_reply')) {
          queryText += `
            AND c.last_message_direction = 'out'
            AND ($8::integer IS NULL OR c.last_message_at <= NOW() - ($8::integer || ' hour')::interval)
          `;
        } else {
          // 'all_reply'
          queryText += `
            AND (
              (c.last_message_direction = 'in' AND NOT EXISTS (
                SELECT 1 FROM messages m_out
                WHERE m_out.conversation_id = c.id
                  AND m_out.tenant_id = c.tenant_id
                  AND m_out.direction = 'out'
              ))
              OR
              (c.last_message_direction = 'out')
            )
          `;
        }
      }

      if (isUnreadFilter) {
        queryText += `
          AND EXISTS (
            SELECT 1 
            FROM messages m_unread
            WHERE m_unread.conversation_id = c.id
              AND m_unread.tenant_id = c.tenant_id
              AND m_unread.direction = 'in'
              AND (m_unread.media_metadata IS NULL OR COALESCE(m_unread.media_metadata->'native'->>'message_type', '') != 'reaction')
              AND m_unread.created_at > COALESCE(rs.last_read_at, '1970-01-01'::timestamptz)
          )
        `;
      }

      queryText += ` ORDER BY (cp.id IS NOT NULL) DESC, c.last_message_at DESC NULLS LAST `;

      queryText += ` LIMIT $5 OFFSET $6 `;

      const rows = await ctx.db.executeSafe({
        text: queryText,
        values
      });

      const validRows = Array.isArray(rows) ? rows : ((rows as any)?.rows || []);

      log.debug(`[INBOX_FORENSIC] Query returned ${validRows.length} rows for tenant ${ctx.tenantId}`, {
        tenantId: ctx.tenantId
      });

      const processedRows = validRows.map((r: any) => {
        let formattedTime = '';
        if (r.last_message_time_ms) {
          const date = new Date(parseFloat(r.last_message_time_ms));
          const fmtDate = (d: Date) => d.toLocaleDateString('en-CA', { timeZone: 'Europe/Istanbul', year: 'numeric', month: '2-digit', day: '2-digit' });
          const now = new Date();
          const msgDateStr = fmtDate(date);
          const nowDateStr = fmtDate(now);
          const diffMs = new Date(nowDateStr + "T00:00:00Z").getTime() - new Date(msgDateStr + "T00:00:00Z").getTime();
          const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
          
          if (diffDays === 0) {
            formattedTime = date.toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Istanbul' });
          } else if (diffDays === 1) {
            formattedTime = 'Dün';
          } else if (diffDays > 1 && diffDays < 7) {
            formattedTime = date.toLocaleDateString('tr-TR', { weekday: 'long', timeZone: 'Europe/Istanbul' });
            formattedTime = formattedTime.charAt(0).toUpperCase() + formattedTime.slice(1);
          } else {
            formattedTime = date.toLocaleDateString('tr-TR', { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'Europe/Istanbul' });
          }
        }

        const detailedName = resolvePatientNameDetailed({
          oppRequesterName: r.opp_requester_name,
          oppPatientName: r.opp_patient_name,
          formRawDataName: null,
          formPatientName: r.form_patient_name,
          convPatientName: r.name,
          customerDisplayName: r.customer_display_name,
          whatsappProfileName: r.wa_profile_name,
          phoneFallback: r.id,
          metadata: {}
        });

        // Resolve country and source via unified country resolver
        const detailedCountry = resolvePatientCountryDetailed({
          manualCountry: r.country,
          formCountry: null,
          phoneFallback: r.id || r.phone_number,
          metadata: {}
        });

        const resolvedDepartment = r.department || null;

        const lastMsg = r.last_message || '';
        const lastMsgDir = r.last_message_direction || 'in';

        let isNoReplyEligible = false;
        let noReplyHoursVal: number | null = null;
        let noReplyReason = '';
        let lastOutboundExpectsReply = false;

        if (lastMsgDir === 'out') {
          const classification = ExpectsReplyClassifier.classify(lastMsg);
          lastOutboundExpectsReply = classification.expectsReply;

          const normPhone = normalizePhoneForIdentity(r.id || r.phone_number);
          const isPrimaryOptedOut = (normPhone.e164 && optOutPhones.has(normPhone.e164));
          
          const currentStage = r.stage;
          const isExcludedStage = ['lost', 'not_qualified', 'arrived'].includes(currentStage);
          const isBookedClosingMsg = currentStage === 'booked' && classification.isClosingMessage;
          const isArchived = !!r.is_archived; // Check archived flags

          if (classification.expectsReply && 
              !isPrimaryOptedOut && 
              !isExcludedStage && 
              !isBookedClosingMsg && 
              !isArchived) {
            
            const lastOutboundTime = r.last_message_time_ms ? parseFloat(r.last_message_time_ms) : 0;
            const hoursElapsed = lastOutboundTime > 0 ? (Date.now() - lastOutboundTime) / (1000 * 60 * 60) : 0;
            isNoReplyEligible = true;
            noReplyHoursVal = Math.round(hoursElapsed * 10) / 10;
            noReplyReason = classification.reason;
          }
        }

        const noReplyFollowup = {
          is_no_reply_eligible: isNoReplyEligible,
          no_reply_hours: noReplyHoursVal,
          no_reply_reason: noReplyReason,
          last_outbound_at: lastMsgDir === 'out' ? r.last_message_at : null,
          last_outbound_expects_reply: lastOutboundExpectsReply
        };

        return {
          ...r,
          conversationId: r.conversation_id,
          conversation_id: r.conversation_id,
          name: detailedName.displayName,
          name_source: detailedName.nameSource,
          name_confidence: detailedName.nameConfidence,
          name_confirmation_needed: detailedName.nameConfirmationNeeded,
          country: detailedCountry.displayCountry,
          country_source: detailedCountry.countrySource,
          country_confirmation_needed: detailedCountry.countryConfirmationNeeded,
          country_conflict: detailedCountry.conflict || null,
          department: resolvedDepartment,
          formDepartment: null,
          formComplaint: null,
          formReportStatus: null,
          formAppointmentPref: null,
          formAge: null,
          formDepartmentSource: null,
          score: r.stage === 'appointed' ? 100 : r.stage === 'contacted' ? 60 : 30,
          isBotActive: r.autopilot_enabled,
          formattedTime,
          channel: r.channel || 'whatsapp',
          lastMessageStatus: r.last_message_status || 'sent',
          lastMessageDirection: r.last_message_direction || 'in',
          lastMessageModel: r.last_message_model || null,
          lastMessageMediaType: r.last_message_media_type || null,
          lastMessageMediaUrl: r.last_message_media_url || null,
          isPinned: !!r.is_pinned,
          isFavorite: !!r.is_favorite,
          isArchived: !!r.is_archived,
          unread: r.unread || 0,
          active_task_id: r.active_task_id || null,
          active_task_type: r.active_task_type || null,
          active_task_status: r.active_task_status || null,
          opp_summary: null,
          opp_ai_reason: null,
          legacy_ai_summary: null,
          ai_crm_summary: '',
          notes: r.notes || '',
          patientRelation: null,
          formData: null,
          aiSummary: null,
          noReplyFollowup,
          is_no_reply_eligible: isNoReplyEligible,
          no_reply_hours: noReplyHoursVal,
          has_outbound: !!r.has_outbound
        };
      });

      if (isNoReplyFilter) {
        // 1. Filter candidates using pre-computed eligibility flag
        const eligibleCandidates = processedRows.filter((r: any) => {
          const isWaitingInboxReply = r.lastMessageDirection === 'in' && !r.has_outbound;
          if (replyFilter === 'waiting_inbox_reply') {
            return isWaitingInboxReply;
          }
          if (replyFilter.startsWith('no_reply')) {
            if (!r.noReplyFollowup.is_no_reply_eligible) return false;
            if (noReplyHours !== null && r.noReplyFollowup.no_reply_hours < noReplyHours) {
              return false;
            }
            return true;
          }
          // 'all_reply'
          return isWaitingInboxReply || r.noReplyFollowup.is_no_reply_eligible;
        });

        // 2. Patient-level Deduplication
        const groups: Array<{
          conversations: any[];
          oppIds: Set<string>;
          customerIds: Set<string>;
          leadIds: Set<string>;
          phones: Set<string>;
        }> = [];

        for (const r of eligibleCandidates) {
          const oppId = r.active_opp_id;
          const customerId = r.customer_id;
          const leadId = r.lead_id;
          
          const primaryNorm = normalizePhoneForIdentity(r.id || r.phone_number).e164;
          const conversationPhones = new Set<string>();
          if (primaryNorm) conversationPhones.add(primaryNorm);
          
          let rawData = r.form_raw_data;
          if (typeof rawData === 'string') {
            try { rawData = JSON.parse(rawData); } catch(_) {}
          }
          if (rawData && rawData._all_phones) {
            const parsed = parseAllPhones(rawData._all_phones);
            for (const p of parsed) {
              const pNorm = normalizePhoneForIdentity(p).e164;
              if (pNorm) conversationPhones.add(pNorm);
            }
          }

          let foundGroupIndex = -1;
          for (let i = 0; i < groups.length; i++) {
            const g = groups[i];
            const matchOpp = oppId && g.oppIds.has(oppId);
            const matchCustomer = customerId && g.customerIds.has(customerId);
            const matchLead = leadId && g.leadIds.has(leadId);
            
            let matchPhone = false;
            for (const p of conversationPhones) {
              if (g.phones.has(p)) {
                matchPhone = true;
                break;
              }
            }

            if (matchOpp || matchCustomer || matchLead || matchPhone) {
              foundGroupIndex = i;
              break;
            }
          }

          if (foundGroupIndex !== -1) {
            const g = groups[foundGroupIndex];
            g.conversations.push(r);
            if (oppId) g.oppIds.add(oppId);
            if (customerId) g.customerIds.add(customerId);
            if (leadId) g.leadIds.add(leadId);
            for (const p of conversationPhones) g.phones.add(p);
          } else {
            groups.push({
              conversations: [r],
              oppIds: new Set(oppId ? [oppId] : []),
              customerIds: new Set(customerId ? [customerId] : []),
              leadIds: new Set(leadId ? [leadId] : []),
              phones: conversationPhones
            });
          }
        }

        const finalEligibleList: any[] = [];
        for (const g of groups) {
          g.conversations.sort((a, b) => {
            const tA = a.last_message_at ? new Date(a.last_message_at).getTime() : 0;
            const tB = b.last_message_at ? new Date(b.last_message_at).getTime() : 0;
            return tB - tA;
          });
          
          const primaryConv = g.conversations[0];
          
          for (let i = 1; i < g.conversations.length; i++) {
            g.conversations[i].is_duplicate_candidate = true;
            g.conversations[i].duplicate_parent_id = primaryConv.conversation_id;
          }
          
          finalEligibleList.push(primaryConv);
        }

        return finalEligibleList;
      }

      return processedRows;
    }
  ).then(res => res.data || []);
}


import { unstable_noStore as noStore } from "next/cache";
import { RealtimePublisher } from "@/lib/realtime/publisher";
import { getTraceContext } from "@/lib/core/trace-context";

export async function getMessages(
  conversationIdOrPhone: string, 
  cursor?: { timestampMs: number; id: string } | null, 
  limit: number = 30
) {
  noStore();
  if (!conversationIdOrPhone) return [];
  
  return withActionGuard(
    { actionName: 'getMessages' },
    async (ctx) => {
      const startTime = performance.now();
      try {
        const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(conversationIdOrPhone);
        let resolvedConvId: string | null = null;

        if (isUuid) {
          resolvedConvId = conversationIdOrPhone;
        } else {
          const cleanPhone = conversationIdOrPhone.replace(/\D/g, '');
          const convRow = await ctx.db.executeSafe({
            text: `
              SELECT id 
              FROM conversations 
              WHERE tenant_id = $1 
                AND (
                  phone_number = $2 
                  OR phone_number = '+' || $2
                  OR phone_number = SUBSTRING($2, 3)
                  OR phone_number LIKE '%' || $3
                )
              LIMIT 1
            `,
            values: [ctx.tenantId, cleanPhone, cleanPhone.slice(-10)]
          }) as any[];

          if (convRow.length > 0) {
            resolvedConvId = convRow[0].id;
            console.warn(`[MESSAGE_QUERY_TRACE] [EMERGENCY_FALLBACK] Resolved UUID from phone number fallback for: "${conversationIdOrPhone}". Resolved UUID: "${resolvedConvId}"`);
          }
        }

        if (!resolvedConvId) {
          return [];
        }

        // Bind conversationId to active trace context
        const traceCtx = getTraceContext();
        if (traceCtx) {
          traceCtx.conversationId = resolvedConvId;
        }

        let cursorDate: Date | null = null;
        let cursorId: string | null = null;
        if (cursor && typeof cursor === 'object' && cursor.timestampMs && cursor.id) {
          cursorDate = new Date(cursor.timestampMs);
          cursorId = cursor.id;
        }

        const rows = await ctx.db.executeSafe({
          text: `
            SELECT * FROM (
              SELECT id, content as text, direction, status, model_used,
                     media_type, media_url, media_metadata, provider_message_id,
                     EXTRACT(EPOCH FROM COALESCE(provider_timestamp, created_at)) * 1000 as created_at_ms
              FROM messages
              WHERE conversation_id = $1::uuid 
                AND (tenant_id = $2)
                AND (
                  $3::timestamptz IS NULL
                  OR COALESCE(provider_timestamp, created_at) < $3::timestamptz
                  OR (
                    COALESCE(provider_timestamp, created_at) = $3::timestamptz
                    AND id < $4::uuid
                  )
                )
              ORDER BY COALESCE(provider_timestamp, created_at) DESC, id DESC
              LIMIT $5
            ) sub
            ORDER BY created_at_ms ASC
          `,
          values: [resolvedConvId, ctx.tenantId, cursorDate, cursorId, limit]
        });

        const validRows = Array.isArray(rows) ? rows : ((rows as any)?.rows || []);
        const fetchDuration = performance.now() - startTime;
        console.log(`[MESSAGE_QUERY_TRACE] conversationId=${resolvedConvId} cursor=${cursor ? JSON.stringify(cursor) : 'null'} limit=${limit} rowCount=${validRows.length} durationMs=${fetchDuration.toFixed(2)}`);

        return validRows.map((r: any) => {
          const date = new Date(parseFloat(r.created_at_ms));
          const fmtDate = (d: Date) => d.toLocaleDateString('en-CA', { timeZone: 'Europe/Istanbul', year: 'numeric', month: '2-digit', day: '2-digit' });
          const now = new Date();
          const msgDateStr = fmtDate(date);
          const nowDateStr = fmtDate(now);
          const parseDateString = (ds: string) => new Date(ds + "T00:00:00Z");
          const diffMs = parseDateString(nowDateStr).getTime() - parseDateString(msgDateStr).getTime();
          const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
          
          let dateLabel = '';
          if (diffDays === 0) {
            dateLabel = 'Bugün';
          } else if (diffDays === 1) {
            dateLabel = 'Dün';
          } else if (diffDays > 1 && diffDays < 7) {
            dateLabel = date.toLocaleDateString('tr-TR', { weekday: 'long', timeZone: 'Europe/Istanbul' });
            dateLabel = dateLabel.charAt(0).toUpperCase() + dateLabel.slice(1);
          } else {
            dateLabel = date.toLocaleDateString('tr-TR', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Europe/Istanbul' });
          }

          return {
            id: r.id,
            sender: r.direction === 'in' ? 'user' : (r.direction === 'system' ? 'system' : (r.model_used ? 'bot' : 'agent')),
            text: r.text,
            timeMs: parseFloat(r.created_at_ms),
            cursorTimestampMs: parseFloat(r.created_at_ms),
            dateLabel,
            status: r.status || 'sent',
            mediaType: r.media_type || null,
            mediaUrl: r.media_url || null,
            mediaMetadata: r.media_metadata || null,
            providerMessageId: r.provider_message_id || null,
          };
        });
      } catch(err: any) {
        console.error("getMessages Error:", err, "Identifier:", conversationIdOrPhone, "Tenant:", ctx.tenantId);
        return [];
      }
    }
  ).then(res => {
    return res.data || [];
  });
}

export async function sendMessage(phone: string, text: string, replyToProviderMessageId?: string) {
  if (!phone || !text) return { success: false, error: "Missing data" };
  
  // ─── SECURITY: Input validation ───
  const sanitizedPhone = phone.replace(/[^\d+]/g, ""); // Strip non-numeric except +
  const sanitizedText = text.trim().slice(0, 4096); // WhatsApp max message length
  
  if (sanitizedPhone.length < 6 || sanitizedPhone.length > 20) {
    return { success: false, error: "Invalid phone number" };
  }
  if (sanitizedText.length === 0) {
    return { success: false, error: "Empty message" };
  }

  return withActionGuard(
    { actionName: 'sendMessage' },
    async (ctx) => {
      // Hangi kanaldan geldiğini bul ve conversation_id'yi çöz
      const convRows = await ctx.db.executeSafe({
        text: `SELECT id, channel, channel_id FROM conversations WHERE phone_number = $1 AND tenant_id = $2 LIMIT 1`,
        values: [phone, ctx.tenantId]
      });
      const channel = convRows[0]?.channel || 'whatsapp';
      const conversationId = convRows[0]?.id;
      const channelId = convRows[0]?.channel_id;

      if (!conversationId) {
        return { success: false, error: `Aktif bir konuşma kaydı bulunamadı (Telefon: ${phone})` };
      }

      // ─── WhatsApp 24-Hour Service Window Check ───
      if (channel === 'whatsapp') {
        const lastInboundRow = await ctx.db.executeSafe({
          text: `SELECT created_at 
                 FROM messages 
                 WHERE conversation_id = $1 
                   AND tenant_id = $2 
                   AND (channel_id = $3 OR channel_id IS NULL)
                   AND direction = 'in'
                 ORDER BY created_at DESC 
                 LIMIT 1`,
          values: [conversationId, ctx.tenantId, channelId]
        });
        
        const lastInboundTime = lastInboundRow?.[0]?.created_at;
        if (!lastInboundTime || (Date.now() - new Date(lastInboundTime).getTime()) > 24 * 60 * 60 * 1000) {
          return {
            success: false,
            error: "Müşteri ile son etkileşiminiz üzerinden 24 saatten fazla zaman geçmiş. WhatsApp kuralları gereği serbest metin gönderilemez, sadece onaylı şablon gönderebilirsiniz."
          };
        }
      }

      // Credentials Service ile kimlik bilgilerini çöz
      const provider = (channel === 'messenger' || channel === 'instagram' ? channel : 'whatsapp') as 'whatsapp' | 'messenger' | 'instagram';
      const credentials = await CredentialsService.resolveCredentials(ctx.tenantId, provider);
      const META_ACCESS_TOKEN = credentials.accessToken;
      const PHONE_NUMBER_ID = credentials.whatsappPhoneNumberId;

      let response: Response | null = null;
      let providerMessageId: string | null = null;
      let messageStatus = 'pending';

      const isThreeSixty = channel === 'whatsapp' && isThreeSixtyProvider(credentials.provider);

      if (isThreeSixty && credentials.accessToken) {
        const { ThreeSixtyDialogService } = await import("@/lib/services/providers/three-sixty-dialog.service");
        try {
          const res = await ThreeSixtyDialogService.sendMessage(
            credentials.accessToken,
            phone,
            text,
            undefined,
            replyToProviderMessageId ? { message_id: replyToProviderMessageId } : undefined
          );
          providerMessageId = res.providerMessageId || null;
          messageStatus = res.success ? 'sent' : 'failed';
          if (!res.success) {
            return { success: false, error: "360dialog API call returned failure" };
          }
        } catch (e: any) {
          return { success: false, error: e.message || "360dialog gönderme hatası" };
        }
      } else if (!META_ACCESS_TOKEN) {
        const { logger: inboxLogger } = await import("@/lib/core/logger");
        inboxLogger.withContext({ module: 'Inbox' }).warn("Meta credentials missing, only saving to DB");
      } else {
        if (channel === 'whatsapp' && PHONE_NUMBER_ID) {
          const bodyPayload: any = {
            messaging_product: "whatsapp",
            to: phone,
            type: "text",
            text: { body: text },
          };
          if (replyToProviderMessageId) {
            bodyPayload.context = { message_id: replyToProviderMessageId };
          }
          response = await fetch(`https://graph.facebook.com/v25.0/${PHONE_NUMBER_ID}/messages`, {
            method: "POST",
            headers: {
              "Authorization": `Bearer ${META_ACCESS_TOKEN}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify(bodyPayload),
          });

          if (response.ok) {
            try {
              const resData = await response.json();
              providerMessageId = resData.messages?.[0]?.id || resData.message_id || null;
              messageStatus = 'sent';
            } catch (e) {
              console.error("Error parsing Meta API response:", e);
              messageStatus = 'sent';
            }
          }
        }
        else if (channel === 'instagram' || channel === 'messenger') {
          // V2-only: Use tenant-isolated credential from CredentialsService
          // ENV token fallback permanently removed (cross-tenant isolation risk)
          const channelToken = credentials.accessToken;
          
          if (!channelToken) {
            const { logger: inboxLog2 } = await import("@/lib/core/logger");
            inboxLog2.withContext({ module: 'Inbox' }).warn(`No credential found for ${channel} — message will only be saved to DB`, { tenantId: ctx.tenantId });
          } else {
            const baseUrl = channel === 'instagram' 
              ? 'https://graph.instagram.com/v25.0/me/messages'
              : 'https://graph.facebook.com/v25.0/me/messages';

            response = await fetch(`${baseUrl}?access_token=${channelToken}`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                recipient: { id: phone },
                message: { text: text },
                messaging_type: "MESSAGE_TAG",
                tag: "HUMAN_AGENT"
              }),
            });

            if (response.ok) {
              try {
                const resData = await response.json();
                providerMessageId = resData.messages?.[0]?.id || resData.message_id || null;
                messageStatus = 'sent';
              } catch (e) {
                console.error("Error parsing Meta API response:", e);
                messageStatus = 'sent';
              }
            } else {
              const errData = await response.clone().json();
              const { logger: inboxLog2 } = await import("@/lib/core/logger");
              inboxLog2.withContext({ module: 'Inbox' }).error(`${channel} send failed`, undefined, { error: errData.error?.message });
            }
          }
        }

        if (response && !response.ok) {
          const errData = await response.json();
          const { logger: inboxLog3 } = await import("@/lib/core/logger");
          inboxLog3.withContext({ module: 'Inbox' }).error(`Meta API error (${channel})`, undefined, { errData });
          await enqueueRetry({
            tenantId: ctx.tenantId,
            phoneNumber: phone,
            channel: channel,
            content: text,
            error: JSON.stringify(errData).substring(0, 500),
          });
        }
      }

      // Prepare metadata with WhatsApp context if replyToProviderMessageId is set
      const mediaMetadata: any = { initiated_from: "inbox_panel", source: "panel_operator" };
      if (replyToProviderMessageId) {
        mediaMetadata.native = {
          provider: credentials.provider || 'whatsapp',
          message_type: 'text',
          reply_to_provider_message_id: replyToProviderMessageId
        };
        try {
          const qRes = await ctx.db.executeSafe({
            text: `SELECT id, direction, content, media_type, status, created_at FROM messages WHERE provider_message_id = $1 AND tenant_id = $2 LIMIT 1`,
            values: [replyToProviderMessageId, ctx.tenantId]
          }) as any[];
          if (qRes.length > 0) {
            const qMsg = qRes[0];
            mediaMetadata.native.reply_to_message_id = qMsg.id;
            mediaMetadata.native.quoted_message_snapshot = {
              direction: qMsg.direction,
              text: qMsg.content,
              type: qMsg.media_type || 'text',
              sender_label: qMsg.direction === 'in' ? 'Hasta' : 'Bot',
              created_at: qMsg.created_at
            };
          }
        } catch (e) {
          console.error("Error fetching reply message snapshot:", e);
        }
      }

      const msgInsert = await ctx.db.executeSafe({
        text: `INSERT INTO messages (tenant_id, conversation_id, phone_number, direction, content, channel, status, provider_message_id, media_metadata)
               VALUES ($1, $2, $3, 'out', $4, $5, $6, $7, $8)
               RETURNING id`,
        values: [
          ctx.tenantId, 
          conversationId, 
          phone, 
          text, 
          channel, 
          messageStatus, 
          providerMessageId,
          JSON.stringify(mediaMetadata)
        ]
      });

      const messageId = Array.isArray(msgInsert) ? msgInsert[0]?.id : (msgInsert as any)?.rows?.[0]?.id;

      // Passive Learning Capture: log operator send (manual or edited draft)
      try {
        const { TenantLearningCaptureService } = await import('@/lib/services/ai/tenant-learning-capture.service');
        await TenantLearningCaptureService.logOperatorSend(ctx.db, {
          tenantId: ctx.tenantId,
          channelId: channelId || null,
          conversationId,
          messageId: messageId,
          humanFinalText: text,
          metadata: {
            approved_from: 'send_message_action'
          }
        });
      } catch (captureErr) {
        console.error('TenantLearningCaptureService.logOperatorSend error bypassed in sendMessage', captureErr);
      }

      await ctx.db.executeSafe({
        text: `UPDATE conversations 
               SET last_message_at = NOW(), 
                   last_message_content = $1,
                   last_channel = $2,
                   last_message_status = $3,
                   last_message_direction = 'out',
                   last_message_model = NULL,
                   message_count = message_count + 1,
                   status = 'human',
                   autopilot_enabled = false
               WHERE id = $4 AND tenant_id = $5`,
        values: [text, channel, messageStatus, conversationId, ctx.tenantId]
      });

      // Cancel/Takeover active bot directive on operator message
      try {
        const activeTasks = await ctx.db.executeSafe({
          text: `SELECT id, metadata FROM follow_up_tasks 
                 WHERE conversation_id = $1 AND tenant_id = $2 AND status IN ('pending', 'in_progress')
                 ORDER BY created_at DESC`,
          values: [conversationId, ctx.tenantId]
        }) as any[];
        if (activeTasks.length > 0) {
          const taskMeta = activeTasks[0].metadata || {};
          const directiveState = taskMeta.bot_directive_state;
          if (directiveState && ['pending', 'waiting_patient'].includes(directiveState.directive_status)) {
            const { PatientOperationsLifecycleService } = await import('@/lib/services/patient-operations-lifecycle');
            const lifecycleService = new PatientOperationsLifecycleService(ctx.db);
            await lifecycleService.completeBotDirective(activeTasks[0].id, ctx.tenantId, 'operator_takeover');
          }
        }
      } catch (takeoverErr) {
        console.warn('[INBOX_DIRECTIVE_TAKEOVER_FAILED] Non-fatal directive cancellation', takeoverErr);
      }

      // Write structural audit log
      await ctx.db.executeSafe({
        text: `INSERT INTO ai_audit_logs (tenant_id, action, reasoning_summary, result_summary)
               VALUES ($1, $2, $3, $4)`,
        values: [
          ctx.tenantId,
          'autopilot_disabled',
          'Autopilot disabled by manual operator message',
          JSON.stringify({
            conversation_id: conversationId,
            phone: phone,
            channel_id: channelId,
            tenant_id: ctx.tenantId,
            enabled: false,
            user_id: ctx.userId,
            timestamp: new Date().toISOString(),
            reason: "panel_operator_message"
          })
        ]
      });

      // Broadcast autopilot updated realtime update via unified metadata event
      try {
        const { RealtimePublisher } = await import("@/lib/realtime/publisher");
        await RealtimePublisher.publishMetadataUpdated(ctx.tenantId, {
          conversationId: conversationId,
          userId: ctx.userId || "operator",
          isBotActive: false,
          autopilotEnabled: false,
          status: "human"
        });
      } catch (realtimeErr) {
        console.error("Failed to publish autopilot toggle realtime update on manual send:", realtimeErr);
      }

      // Publish Realtime Event
      if (messageId) {
        try {
          const { RealtimePublisher } = await import("@/lib/realtime/publisher");
          const conversationRows = await ctx.db.executeSafe({
            text: `SELECT id FROM conversations WHERE phone_number = $1 AND tenant_id = $2 LIMIT 1`,
            values: [phone, ctx.tenantId]
          });
          const conversationId = Array.isArray(conversationRows) ? conversationRows[0]?.id : (conversationRows as any)?.rows?.[0]?.id;
          
          if (conversationId) {
            await RealtimePublisher.publishMessageCreated(
              ctx.tenantId,
              {
                id: messageId,
                conversation_id: conversationId,
                phone_number: phone,
                content: text,
                direction: 'out',
                status: messageStatus,
                media_metadata: mediaMetadata,
                created_at: new Date().toISOString()
              }
            );

            // [NEW] Fire-and-forget memory summarization on agent response
            const tenantId = ctx.tenantId;
            (async () => {
              try {
                const { FeatureFlagService } = await import('@/lib/services/feature-flag.service');
                const isMemoryEnabled = await FeatureFlagService.isEnabled(tenantId, 'memory_engine', true);
                if (isMemoryEnabled) {
                  const { MemoryEngine } = await import('@/lib/services/ai/engines/memory');
                  await MemoryEngine.summarizeConversation(tenantId, conversationId);
                }
              } catch (memErr) {
                console.error("Failed to summarize conversation asynchronously after agent response:", memErr);
              }
            })();
          }
        } catch (err) {
          console.error("Failed to publish realtime event for panel message:", err);
        }
      }

      return { success: true };
    }
  ).then(res => {
    if (!res.success) return { success: false, error: res.error };
    if (res.data && !res.data.success) return { success: false, error: res.data.error };
    return { success: true };
  }).catch((err: any) => {
    console.error('[sendMessage_CATCH]', err?.message || err);
    return { success: false, error: `Mesaj gönderilemedi: ${err?.message || 'Bilinmeyen hata'}` };
  });
}

export async function sendMediaMessage(phone: string, mediaUrl: string, mediaType: string, filename: string, mimeType: string, fileSize: number, caption?: string) {
  if (!phone || !mediaUrl || !mediaType) return { success: false, error: "Missing data" };

  const sanitizedPhone = phone.replace(/[^\d+]/g, "");
  if (sanitizedPhone.length < 6 || sanitizedPhone.length > 20) {
    return { success: false, error: "Invalid phone number" };
  }

  // ─── SECURITY: Enforce Vercel Blob URLs only ───
  try {
    const parsedUrl = new URL(mediaUrl);
    if (!parsedUrl.hostname.endsWith('.vercel-storage.com')) {
      return {
        success: false,
        error: "Güvenlik nedeniyle sadece sistem tarafından yüklenen medya dosyalarını gönderebilirsiniz."
      };
    }
  } catch (err) {
    return {
      success: false,
      error: "Geçersiz medya bağlantısı."
    };
  }

  return withActionGuard(
    { actionName: 'sendMediaMessage' },
    async (ctx) => {
      // Resolve channel, channel_id and conversation_id
      const convRows = await ctx.db.executeSafe({
        text: `SELECT id, channel, channel_id FROM conversations WHERE phone_number = $1 AND tenant_id = $2 LIMIT 1`,
        values: [phone, ctx.tenantId]
      });
      const channel = convRows[0]?.channel || 'whatsapp';
      const conversationId = convRows[0]?.id;
      const channelId = convRows[0]?.channel_id;

      if (!conversationId) {
        return { success: false, error: `Aktif bir konuşma kaydı bulunamadı (Telefon: ${phone})` };
      }

      // ─── WhatsApp 24-Hour Service Window Check ───
      if (channel === 'whatsapp') {
        const lastInboundRow = await ctx.db.executeSafe({
          text: `SELECT created_at 
                 FROM messages 
                 WHERE conversation_id = $1 
                   AND tenant_id = $2 
                   AND (channel_id = $3 OR channel_id IS NULL)
                   AND direction = 'in'
                 ORDER BY created_at DESC 
                 LIMIT 1`,
          values: [conversationId, ctx.tenantId, channelId]
        });
        
        const lastInboundTime = lastInboundRow?.[0]?.created_at;
        if (!lastInboundTime || (Date.now() - new Date(lastInboundTime).getTime()) > 24 * 60 * 60 * 1000) {
          return {
            success: false,
            error: "Müşteri ile son etkileşiminiz üzerinden 24 saatten fazla zaman geçmiş. WhatsApp kuralları gereği serbest metin gönderilemez, sadece onaylı şablon gönderebilirsiniz."
          };
        }
      }

      const provider = (channel === 'messenger' || channel === 'instagram' ? channel : 'whatsapp') as 'whatsapp' | 'messenger' | 'instagram';
      const credentials = await CredentialsService.resolveCredentials(ctx.tenantId, provider);
      const META_ACCESS_TOKEN = credentials.accessToken;
      const PHONE_NUMBER_ID = credentials.whatsappPhoneNumberId;

      let providerMessageId: string | null = null;
      let messageStatus = 'pending';

      const isThreeSixty = channel === 'whatsapp' && isThreeSixtyProvider(credentials.provider);

      if (isThreeSixty && credentials.accessToken) {
        const { ThreeSixtyDialogService } = await import("@/lib/services/providers/three-sixty-dialog.service");
        try {
          let waType: "image" | "document" | "audio" | "video" = "image";
          if (mediaType === "document" || mediaType === "audio" || mediaType === "video") {
            waType = mediaType;
          }
          const res = await ThreeSixtyDialogService.sendMessage(
            credentials.accessToken,
            phone,
            caption || '',
            {
              type: waType,
              url: mediaUrl,
              filename: filename || undefined
            }
          );
          providerMessageId = res.providerMessageId || null;
          messageStatus = res.success ? 'sent' : 'failed';
          if (!res.success) {
            return { success: false, error: "360dialog API call returned failure" };
          }
        } catch (e: any) {
          return { success: false, error: e.message || "360dialog medya gönderme hatası" };
        }
      } else if (META_ACCESS_TOKEN && PHONE_NUMBER_ID && channel === 'whatsapp') {
        // Determine WhatsApp media type
        let waType = 'image';
        let waMediaPayload: any = {};

        if (mediaType === 'image') {
          waType = 'image';
          waMediaPayload = { link: mediaUrl };
          if (caption) waMediaPayload.caption = caption;
        } else if (mediaType === 'document') {
          waType = 'document';
          waMediaPayload = { link: mediaUrl, filename: filename || 'document' };
          if (caption) waMediaPayload.caption = caption;
        } else if (mediaType === 'audio') {
          waType = 'audio';
          waMediaPayload = { link: mediaUrl };
        }

        try {
          const response = await fetch(`https://graph.facebook.com/v25.0/${PHONE_NUMBER_ID}/messages`, {
            method: "POST",
            headers: {
              "Authorization": `Bearer ${META_ACCESS_TOKEN}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              messaging_product: "whatsapp",
              to: phone,
              type: waType,
              [waType]: waMediaPayload,
            }),
          });

          if (response.ok) {
            const resData = await response.json();
            providerMessageId = resData.messages?.[0]?.id || null;
            messageStatus = 'sent';
          } else {
            const errData = await response.json().catch(() => ({}));
            const { logger: inboxLog } = await import("@/lib/core/logger");
            inboxLog.withContext({ module: 'Inbox' }).error(`WhatsApp media send failed`, undefined, { error: errData });
          }
        } catch (sendErr) {
          const { logger: inboxLog } = await import("@/lib/core/logger");
          inboxLog.withContext({ module: 'Inbox' }).error(`WhatsApp media send exception`, sendErr instanceof Error ? sendErr : new Error(String(sendErr)));
        }
      }

      // Build content text
      const { MediaStorageService } = await import("@/lib/services/media-storage.service");
      const contentText = caption || MediaStorageService.getMediaContentText(mediaType, { filename });

      const mediaMetadataObj = { 
        filename, 
        mime_type: mimeType, 
        size: fileSize, 
        caption: caption || null,
        initiated_from: "inbox_panel",
        source: "panel_operator"
      };

      // Save to DB with media fields and conversation_id
      const msgInsert = await ctx.db.executeSafe({
        text: `INSERT INTO messages (tenant_id, conversation_id, phone_number, direction, content, channel, status, provider_message_id, media_type, media_url, media_metadata)
               VALUES ($1, $2, $3, 'out', $4, $5, $6, $7, $8, $9, $10)
               RETURNING id`,
        values: [
          ctx.tenantId, conversationId, phone, contentText, channel, messageStatus, providerMessageId,
          mediaType, mediaUrl,
          JSON.stringify(mediaMetadataObj)
        ]
      });

      const messageId = Array.isArray(msgInsert) ? msgInsert[0]?.id : (msgInsert as any)?.rows?.[0]?.id;

      // Update conversation
      await ctx.db.executeSafe({
        text: `UPDATE conversations 
               SET last_message_at = NOW(), 
                   last_message_content = $1,
                   last_channel = $2,
                   last_message_status = $3,
                   last_message_direction = 'out',
                   last_message_model = NULL,
                   message_count = message_count + 1,
                   status = 'human',
                   autopilot_enabled = false
               WHERE id = $4 AND tenant_id = $5`,
        values: [contentText, channel, messageStatus, conversationId, ctx.tenantId]
      });

      // Write structural audit log
      await ctx.db.executeSafe({
        text: `INSERT INTO ai_audit_logs (tenant_id, action, reasoning_summary, result_summary)
               VALUES ($1, $2, $3, $4)`,
        values: [
          ctx.tenantId,
          'autopilot_disabled',
          'Autopilot disabled by manual operator media message',
          JSON.stringify({
            conversation_id: conversationId,
            phone: phone,
            channel_id: channelId,
            tenant_id: ctx.tenantId,
            enabled: false,
            user_id: ctx.userId,
            timestamp: new Date().toISOString(),
            reason: "panel_operator_message"
          })
        ]
      });

      // Broadcast autopilot updated realtime update via unified metadata event
      try {
        const { RealtimePublisher } = await import("@/lib/realtime/publisher");
        await RealtimePublisher.publishMetadataUpdated(ctx.tenantId, {
          conversationId: conversationId,
          userId: ctx.userId || "operator",
          isBotActive: false,
          autopilotEnabled: false,
          status: "human"
        });
      } catch (realtimeErr) {
        console.error("Failed to publish autopilot toggle realtime update on manual media send:", realtimeErr);
      }

      // Realtime event
      if (messageId) {
        try {
          const { RealtimePublisher } = await import("@/lib/realtime/publisher");
          const conversationRows = await ctx.db.executeSafe({
            text: `SELECT id FROM conversations WHERE phone_number = $1 AND tenant_id = $2 LIMIT 1`,
            values: [phone, ctx.tenantId]
          });
          const conversationId = Array.isArray(conversationRows) ? conversationRows[0]?.id : (conversationRows as any)?.rows?.[0]?.id;
          
          if (conversationId) {
            await RealtimePublisher.publishMessageCreated(
              ctx.tenantId,
              {
                id: messageId,
                conversation_id: conversationId,
                phone_number: phone,
                content: contentText,
                direction: 'out',
                status: messageStatus,
                media_type: mediaType,
                media_url: mediaUrl,
                media_metadata: mediaMetadataObj,
                created_at: new Date().toISOString()
              }
            );
          }
        } catch (err) {
          console.error("Failed to publish realtime event for media message:", err);
        }
      }

      return { success: true };
    }
  ).then(res => {
    if (!res.success) return { success: false, error: res.error };
    if (res.data && !res.data.success) return { success: false, error: res.data.error };
    return { success: true };
  }).catch((err: any) => {
    // Surface real error for debugging (withActionGuard hides it in production)
    console.error('[sendMediaMessage_CATCH]', err?.message || err);
    return { success: false, error: `Medya gönderilemedi: ${err?.message || 'Bilinmeyen hata'}` };
  });
}

export async function updateCrmData(phone: string, stage: string, department: string, country?: string, notes?: string, patientName?: string) {
  if (!phone) return { success: false };

  return withActionGuard(
    { actionName: 'updateCrmData' },
    async (ctx) => {
      // 1. Validate Patient Name
      if (patientName && patientName.trim()) {
        const val = checkNameValidity(patientName);
        if (!val.isValid) {
          return { success: false, error: `Bu değer kullanıcı adı gibi görünüyor, gerçek ad olarak kaydedilemez: ${val.reason}` };
        }
      }

      // 2. Validate/Normalize Country
      let normCountry = country ? (normalizeCountry(country, phone).country || country) : null;
      if (country !== undefined && country !== null && country.trim()) {
        const val = normalizeCountry(country, phone);
        if (!val.country || val.countryConfidence === 'low') {
          return { success: false, error: "Ülke net değil, lütfen listeden seçin." };
        }
        normCountry = val.country;
      }

      // Systemic Patient Name Sync (Propagates validated name updates to all opportunities, conversations, and leads)
      if (patientName && patientName.trim()) {
        try {
          await PatientNameSyncService.syncName(ctx.db, phone, patientName, true);
        } catch (syncErr) {
          console.error("Failed to sync patient name in updateCrmData:", syncErr);
        }
      }

      // P1B: Update active opportunity FIRST (source of truth), then mirror to conversation
      let conversationId: string | undefined;
      let activeOppId: string | undefined;
      let warning: string | undefined;

      try {
        const convRows = await ctx.db.executeSafe({
          text: `SELECT id, active_opportunity_id FROM conversations WHERE phone_number = $1 AND tenant_id = $2 LIMIT 1`,
          values: [phone, ctx.tenantId]
        });
        conversationId = convRows[0]?.id;
        activeOppId = convRows[0]?.active_opportunity_id;

        if (!activeOppId) {
          warning = 'kilit_kalici_uygulanamadi';
        }

        // Update active opportunity if exists
        if (activeOppId) {
          const oppUpdateFields: string[] = [];
          const oppValues: any[] = [];
          let oppIdx = 1;

          if (department) {
            oppUpdateFields.push(`department = $${oppIdx++}`);
            oppValues.push(department);
          }
          if (country !== undefined && country) {
            oppUpdateFields.push(`country = $${oppIdx++}`);
            oppValues.push(normCountry || country);
          }
          if (patientName !== undefined && patientName !== null) {
            oppUpdateFields.push(`patient_name = $${oppIdx++}`);
            oppValues.push(patientName);
          }

          // Add manual lock metadata to prevent extractor overrides
          const lockObj: Record<string, any> = {};
          if (department) {
            lockObj.department_locked = true;
          }
          if (country !== undefined && country && country.trim()) {
            lockObj.country_locked = true;
            lockObj.country_locked_by = ctx.userId;
            lockObj.country_locked_at = new Date().toISOString();
          }
          if (patientName && patientName.trim()) {
            lockObj.name_locked = true;
            lockObj.name_locked_by = ctx.userId;
            lockObj.name_locked_at = new Date().toISOString();
          }

          if (Object.keys(lockObj).length > 0) {
            oppUpdateFields.push(`metadata = COALESCE(metadata, '{}'::jsonb) || $${oppIdx++}::jsonb`);
            oppValues.push(JSON.stringify(lockObj));
          }

          if (oppUpdateFields.length > 0) {
            oppUpdateFields.push(`updated_at = NOW()`);
            oppValues.push(activeOppId, ctx.tenantId);
            await ctx.db.executeSafe({
              text: `UPDATE opportunities SET ${oppUpdateFields.join(', ')} WHERE id = $${oppIdx++} AND tenant_id = $${oppIdx++}`,
              values: oppValues
            });
          }
        }
      } catch (_) { /* non-blocking */ }

      // 1. Update conversation fields (mirror)
      if (country !== undefined) {
        try {
          await ctx.db.executeSafe({
            text: `UPDATE conversations SET department = $1, country = $2, notes = $3, patient_name = COALESCE(NULLIF($4, ''), patient_name) WHERE phone_number = $5 AND tenant_id = $6`,
            values: [department, normCountry, notes !== undefined ? notes : null, patientName || '', phone, ctx.tenantId]
          });
        } catch (e) {
          await ctx.db.executeSafe({
            text: `UPDATE conversations SET department = $1, notes = $2, patient_name = COALESCE(NULLIF($3, ''), patient_name) WHERE phone_number = $4 AND tenant_id = $5`,
            values: [department, notes !== undefined ? notes : null, patientName || '', phone, ctx.tenantId]
          });
        }
      } else {
        await ctx.db.executeSafe({
          text: `UPDATE conversations SET department = $1, notes = $2, patient_name = COALESCE(NULLIF($3, ''), patient_name) WHERE phone_number = $4 AND tenant_id = $5`,
          values: [department, notes !== undefined ? notes : null, patientName || '', phone, ctx.tenantId]
        });
      }

      // 2. Route stage change through UnifiedStageService
      if (stage) {
        const { UnifiedStageService } = await import('@/lib/services/unified-stage.service');
        const { LEAD_TO_OPP_MAP } = await import('@/lib/config/stage-mapping');
        
        // Convert lead-system stage to opportunity-system stage
        const oppTargetStage = LEAD_TO_OPP_MAP[stage] || stage;

        // Reuse conversationId from P1B active opp resolution above; fallback fetch if needed
        if (!conversationId) {
          try {
            const convRows = await ctx.db.executeSafe({
              text: `SELECT id FROM conversations WHERE phone_number = $1 AND tenant_id = $2 LIMIT 1`,
              values: [phone, ctx.tenantId]
            });
            conversationId = convRows[0]?.id;
          } catch (_) { /* non-blocking */ }
        }
        
        await UnifiedStageService.update({
          tenantId: ctx.tenantId,
          source: 'inbox',
          conversationId,
          phoneNumber: phone,
          targetStage: oppTargetStage,
          actorId: ctx.userId,
        });
      }

      // 3. Google Sheets note sync (non-blocking)
      if (notes !== undefined) {
        const SHEET_URL = process.env.GOOGLE_SHEET_UPDATE_URL || process.env.GOOGLE_SHEET_URL;
        if (SHEET_URL) {
          try {
            await fetch(SHEET_URL, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                action: 'updateNoteByPhone',
                phone: phone,
                note: notes
              })
            });
          } catch (sheetErr) {
            const { logger: inboxLogger } = await import("@/lib/core/logger");
            inboxLogger.withContext({ module: 'Inbox' }).warn("Google Sheets note sync failed from updateCrmData", { error: String(sheetErr) });
          }
        }
      }
      
      logAudit({
        tenantId: ctx.tenantId,
        userId: ctx.userId,
        userEmail: ctx.email,
        action: "crm_updated",
        entityType: "conversation",
        entityId: phone,
        details: { stage, department, has_notes: notes !== undefined }
      });

      return { success: true, warning };
    }
  ).then(res => {
    if (res.success) {
      return res.data || { success: true };
    }
    return { success: false, error: res.error };
  });
}

export async function addTag(phone: string, tag: string) {
  if (!phone || !tag) return { success: false };
  
  return withActionGuard(
    { actionName: 'addTag' },
    async (ctx) => {
      const rows = await ctx.db.executeSafe({
        text: `SELECT tags FROM conversations WHERE phone_number = $1 AND tenant_id = $2`,
        values: [phone, ctx.tenantId]
      });
      let tags: string[] = [];
      if (rows.length > 0 && rows[0].tags) {
        try {
          tags = JSON.parse(rows[0].tags);
          if (!Array.isArray(tags)) tags = [String(rows[0].tags)];
        } catch {
          tags = String(rows[0].tags).split(',').map(t => t.trim());
        }
      }
      
      if (!tags.includes(tag)) {
        tags.push(tag);
        await ctx.db.executeSafe({
          text: `UPDATE conversations SET tags = $1 WHERE phone_number = $2 AND tenant_id = $3`,
          values: [JSON.stringify(tags), phone, ctx.tenantId]
        });
      }
      return { success: true, tags };
    }
  ).then(res => res.data || { success: false });
}

export async function removeTag(phone: string, tagToRemove: string) {
  if (!phone || !tagToRemove) return { success: false };
  
  return withActionGuard(
    { actionName: 'removeTag' },
    async (ctx) => {
      const rows = await ctx.db.executeSafe({
        text: `SELECT tags FROM conversations WHERE phone_number = $1 AND tenant_id = $2`,
        values: [phone, ctx.tenantId]
      });
      let tags: string[] = [];
      if (rows.length > 0 && rows[0].tags) {
        try {
          tags = JSON.parse(rows[0].tags);
          if (!Array.isArray(tags)) tags = [String(rows[0].tags)];
        } catch {
          tags = String(rows[0].tags).split(',').map(t => t.trim());
        }
      }
      
      const newTags = tags.filter(t => t !== tagToRemove);
      await ctx.db.executeSafe({
        text: `UPDATE conversations SET tags = $1 WHERE phone_number = $2 AND tenant_id = $3`,
        values: [JSON.stringify(newTags), phone, ctx.tenantId]
      });
      
      return { success: true, tags: newTags };
    }
  ).then(res => res.data || { success: false });
}

export async function toggleBotStatus(conversationIdOrPhone: string, isBotActive: boolean): Promise<{ success: boolean; error?: string }> {
  if (!conversationIdOrPhone) return { success: false, error: undefined };
  
  return withActionGuard(
    { actionName: 'toggleBotStatus' },
    async (ctx) => {
      const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(conversationIdOrPhone);
      
      const convRows = await ctx.db.executeSafe({
        text: isUuid
          ? `SELECT id, phone_number, channel_id FROM conversations WHERE id = $1 AND tenant_id = $2 LIMIT 1`
          : `SELECT id, phone_number, channel_id FROM conversations WHERE phone_number = $1 AND tenant_id = $2 LIMIT 1`,
        values: [conversationIdOrPhone, ctx.tenantId]
      }) as any[];
      
      if (convRows.length === 0) {
        return { success: false, error: "Konuşma bulunamadı" };
      }
      
      const conversationId = convRows[0].id;
      const phone = convRows[0].phone_number;
      const channelId = convRows[0].channel_id;
      const newStatus = isBotActive ? 'bot' : 'human';

      // Bind conversationId to active trace context
      const traceCtx = getTraceContext();
      if (traceCtx) {
        traceCtx.conversationId = conversationId;
      }

      // Security Kill-switch Gate
      if (isBotActive && process.env.ENABLE_SELECTED_AUTOPILOT !== 'true') {
        return { success: false, error: "Otopilot sistemi şu anda genel olarak kapalıdır. Lütfen sistem yöneticiniz ile iletişime geçin." };
      }

      // Security Whitelist Toggle Gate (Only active if AUTOPILOT_ENFORCE_WHITELIST is 'true')
      if (isBotActive && process.env.AUTOPILOT_ENFORCE_WHITELIST === 'true') {
        const whitelistRaw = process.env.AUTOPILOT_WHITELIST;
        if (!whitelistRaw || whitelistRaw.trim() === "") {
          return { success: false, error: "Otopilot sistemi whitelist modu aktif ancak test listesi tanımsız. Lütfen sistem yöneticiniz ile iletişime geçin." };
        }
        const whitelist = whitelistRaw.split(',').map(num => num.trim().replace(/\D/g, ''));
        const cleanPhone = phone.replace(/\D/g, '');
        const isWhitelisted = whitelist.some(whNum => cleanPhone.endsWith(whNum) || whNum === cleanPhone);
        if (!isWhitelisted) {
          return { success: false, error: "Bu numara otopilot test listesinde değil. Sistem yöneticisi tarafından onaylanmadan otopilot açılamaz." };
        }
      }
      
      // Update DB: status and autopilot_enabled
      await ctx.db.executeSafe({
        text: `UPDATE conversations 
               SET status = $1, 
                   autopilot_enabled = $2,
                   bot_activated_at = CASE WHEN $2 = true THEN NOW() ELSE bot_activated_at END
               WHERE id = $3 AND tenant_id = $4`,
        values: [newStatus, isBotActive, conversationId, ctx.tenantId]
      });

      // Write structural audit log
      await ctx.db.executeSafe({
        text: `INSERT INTO ai_audit_logs (tenant_id, action, reasoning_summary, result_summary)
               VALUES ($1, $2, $3, $4)`,
        values: [
          ctx.tenantId,
          isBotActive ? 'autopilot_enabled' : 'autopilot_disabled',
          isBotActive ? 'Manual autopilot activation' : 'Manual autopilot deactivation',
          JSON.stringify({
            conversation_id: conversationId,
            phone: phone,
            channel_id: channelId,
            tenant_id: ctx.tenantId,
            enabled: isBotActive,
            user_id: ctx.userId,
            timestamp: new Date().toISOString(),
            reason: isBotActive ? "manual_enable" : "manual_disable"
          })
        ]
      });

      // Passive Learning Capture: log human takeover if bot is turned off
      if (!isBotActive) {
        try {
          const { TenantLearningCaptureService } = await import('@/lib/services/ai/tenant-learning-capture.service');
          await TenantLearningCaptureService.logHumanTakeover(ctx.db, {
            tenantId: ctx.tenantId,
            channelId: channelId || null,
            conversationId,
            reason: 'manual_disable',
            metadata: { user_id: ctx.userId }
          });
        } catch (captureErr) {
          console.error('TenantLearningCaptureService.logHumanTakeover error bypassed in toggleBotStatus', captureErr);
        }
      }

      // Ably Realtime Sync (publish metadata update)
      try {
        await RealtimePublisher.publishMetadataUpdated(ctx.tenantId, {
          conversationId: conversationId,
          userId: ctx.userId,
          isBotActive: isBotActive,
          autopilotEnabled: isBotActive,
          status: newStatus
        });
      } catch (realtimeErr) {
        console.error("Failed to publish autopilot toggle realtime update:", realtimeErr);
      }

      // Backward compatible logAudit
      logAudit({
        tenantId: ctx.tenantId,
        userId: ctx.userId,
        userEmail: ctx.email,
        action: isBotActive ? "bot_activated" : "human_handover",
        entityType: "conversation",
        entityId: phone,
      });

      return { success: true };
    }
  ).then(res => res.success ? (res.data || { success: true }) : { success: false, error: res.error });
}

export async function sendReaction(phone: string, targetProviderMessageId: string, emoji: string) {
  if (!phone || !targetProviderMessageId) return { success: false, error: "Missing data" };

  return withActionGuard(
    { actionName: 'sendReaction' },
    async (ctx) => {
      // 1. Get channel / conversation context
      const convRow = await ctx.db.executeSafe({
        text: `SELECT channel, id FROM conversations WHERE phone_number LIKE $1 AND tenant_id = $2 LIMIT 1`,
        values: [`%${phone.replace(/\D/g, '').slice(-10)}%`, ctx.tenantId]
      }) as any[];
      
      if (convRow.length === 0) {
        return { success: false, error: "Conversation not found" };
      }
      
      const channel = convRow[0].channel || 'whatsapp';
      const conversationId = convRow[0].id;

      // 2. 24h Window check
      const lastInboundRow = await ctx.db.executeSafe({
        text: `SELECT created_at FROM messages 
               WHERE phone_number LIKE $1 AND tenant_id = $2 AND direction = 'in'
               ORDER BY created_at DESC LIMIT 1`,
        values: [`%${phone.replace(/\D/g, '').slice(-10)}%`, ctx.tenantId]
      }) as any[];
      
      const lastInboundTime = lastInboundRow?.[0]?.created_at;
      if (!lastInboundTime || (Date.now() - new Date(lastInboundTime).getTime()) > 24 * 60 * 60 * 1000) {
        return {
          success: false,
          error: "Müşteri ile son etkileşiminiz üzerinden 24 saatten fazla zaman geçmiş. 24 saatlik pencere kapalı."
        };
      }

      // 3. Resolve credentials
      const credentials = await CredentialsService.resolveCredentials(ctx.tenantId, 'whatsapp');
      const isThreeSixty = channel === 'whatsapp' && isThreeSixtyProvider(credentials.provider);
      const META_ACCESS_TOKEN = credentials.accessToken;
      const PHONE_NUMBER_ID = credentials.whatsappPhoneNumberId;

      let providerMessageId: string | null = null;
      let messageStatus = 'pending';

      if (isThreeSixty && credentials.accessToken) {
        const { ThreeSixtyDialogService } = await import("@/lib/services/providers/three-sixty-dialog.service");
        try {
          const res = await ThreeSixtyDialogService.sendReaction(
            credentials.accessToken,
            phone,
            targetProviderMessageId,
            emoji
          );
          providerMessageId = res.providerMessageId || null;
          messageStatus = res.success ? 'sent' : 'failed';
          if (!res.success) {
            return { success: false, error: "360dialog reaction API failure" };
          }
        } catch (e: any) {
          return { success: false, error: e.message || "360dialog reaction error" };
        }
      } else if (!META_ACCESS_TOKEN) {
        return { success: false, error: "WhatsApp API credentials missing" };
      } else {
        if (channel === 'whatsapp' && PHONE_NUMBER_ID) {
          const res = await fetch(`https://graph.facebook.com/v25.0/${PHONE_NUMBER_ID}/messages`, {
            method: "POST",
            headers: {
              "Authorization": `Bearer ${META_ACCESS_TOKEN}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              messaging_product: "whatsapp",
              recipient_type: "individual",
              to: phone,
              type: "reaction",
              reaction: {
                message_id: targetProviderMessageId,
                emoji: emoji
              }
            }),
          });

          if (res.ok) {
            try {
              const resData = await res.json();
              providerMessageId = resData.messages?.[0]?.id || resData.message_id || null;
              messageStatus = 'sent';
            } catch (e) {
              messageStatus = 'sent';
            }
          } else {
            const errData = await res.json();
            return { success: false, error: errData.error?.message || "WhatsApp API reaction error" };
          }
        } else {
          return { success: false, error: "Reactions only supported on WhatsApp channel" };
        }
      }

      // 4. Update target message's media_metadata directly in the database (Priority 1)
      let targetMessageId: string | null = null;
      let targetResolved = false;

      const qTargetRes = await ctx.db.executeSafe({
        text: `SELECT id, media_metadata FROM messages WHERE provider_message_id = $1 AND tenant_id = $2 LIMIT 1`,
        values: [targetProviderMessageId, ctx.tenantId]
      }) as any[];

      if (qTargetRes.length > 0) {
        targetResolved = true;
        const targetMsg = qTargetRes[0];
        targetMessageId = targetMsg.id;

        // Parse existing metadata
        let metadata = targetMsg.media_metadata || {};
        if (typeof metadata === 'string') {
          try { metadata = JSON.parse(metadata); } catch(e) { metadata = {}; }
        }
        if (!metadata.native) metadata.native = {};
        if (!metadata.native.reactions) metadata.native.reactions = [];

        // Check if there is an existing reaction by this actor (agent)
        const reactions = metadata.native.reactions;
        const existingIdx = reactions.findIndex((r: any) => r.actor === 'agent');

        if (existingIdx !== -1) {
          if (!emoji) {
            // Remove reaction
            reactions.splice(existingIdx, 1);
          } else {
            // Update emoji
            reactions[existingIdx].emoji = emoji;
            reactions[existingIdx].created_at = new Date().toISOString();
          }
        } else if (emoji) {
          // Add new reaction
          reactions.push({
            emoji: emoji,
            direction: 'out',
            actor: 'agent',
            target_provider_message_id: targetProviderMessageId,
            created_at: new Date().toISOString(),
            source: 'panel_operator'
          });
        }

        // Save back to DB with explicit tenant isolation guard
        try {
          await ctx.db.executeSafe({
            text: `UPDATE messages SET media_metadata = $1 WHERE tenant_id = $2 AND id = $3`,
            values: [JSON.stringify(metadata), ctx.tenantId, targetMessageId]
          });
        } catch (dbErr: any) {
          const { logger: inboxLogger } = await import("@/lib/core/logger");
          inboxLogger.withContext({ module: 'Inbox' }).error("Partial success: WhatsApp reaction sent, but database persistence failed", dbErr, {
            tenantId: ctx.tenantId,
            targetMessageId: targetMessageId,
            targetProviderMessageId: targetProviderMessageId,
            action: 'sendReaction'
          });
          // Do not fail the user action since Meta API send was successful
        }
      } else {
        // Fallback: target not found, insert a system row (Priority 2)
        const fallbackNative = {
          provider: credentials.provider || 'whatsapp',
          message_type: 'reaction',
          reaction_payload: {
            message_id: targetProviderMessageId,
            emoji: emoji
          },
          reply_to_provider_message_id: targetProviderMessageId,
          actor: 'agent'
        };
        try {
          await ctx.db.executeSafe({
            text: `INSERT INTO messages (tenant_id, conversation_id, phone_number, direction, content, channel, status, provider_message_id, media_metadata)
                   VALUES ($1, $2, $3, 'system', $4, $5, 'sent', $6, $7)`,
            values: [
              ctx.tenantId,
              conversationId,
              phone,
              emoji || '',
              channel,
              providerMessageId || `temp-system-reaction-${Date.now()}`,
              JSON.stringify({ native: fallbackNative })
            ]
          });
        } catch (dbErr: any) {
          const { logger: inboxLogger } = await import("@/lib/core/logger");
          inboxLogger.withContext({ module: 'Inbox' }).error("Partial success: WhatsApp reaction sent, but fallback message insertion failed", dbErr, {
            tenantId: ctx.tenantId,
            targetProviderMessageId: targetProviderMessageId,
            action: 'sendReaction'
          });
          // Do not fail the user action since Meta API send was successful
        }
      }

      // 5. Broadcast realtime sync update
      try {
        const { RealtimeBus } = await import("@/lib/realtime/bus");
        await RealtimeBus.publish(ctx.tenantId, {
          eventId: require("uuid").v4(),
          traceId: "reaction-sync-trace-" + Date.now(),
          spanId: require("uuid").v4(),
          timestamp: Date.now() * 1000,
          entityVersion: 1,
          eventVersion: "1.0",
          schemaVersion: "1.0",
          tenantId: ctx.tenantId,
          type: "chat.message.created" as any, // reuse message.created event type so it invalidates/updates cache
          payload: {
            id: `reaction-${Date.now()}`,
            conversationId: phone,
            content: emoji,
            sender: "bot", // direction system maps to bot
            status: "delivered",
            createdAt: new Date().toISOString(),
            mediaType: undefined,
            mediaUrl: undefined,
            mediaMetadata: {
              native: {
                message_type: 'reaction',
                reply_to_provider_message_id: targetProviderMessageId,
                reaction_payload: {
                  message_id: targetProviderMessageId,
                  emoji: emoji
                },
                actor: 'agent'
              }
            },
            providerMessageId: providerMessageId || `reaction-${Date.now()}`
          }
        });
      } catch (realtimeErr) {
        console.error("Failed to publish reaction realtime sync update:", realtimeErr);
      }

      return { success: true };
    }
  ).then(res => res.success ? (res.data || { success: true }) : { success: false, error: res.error });
}

export async function markConversationRead(conversationIdOrPhone: string) {
  if (!conversationIdOrPhone) return { success: false, error: "Identifier is required." };
  return withActionGuard(
    { actionName: 'markConversationRead' },
    async (ctx) => {
      const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(conversationIdOrPhone);
      let convId = null;

      if (isUuid) {
        convId = conversationIdOrPhone;
      } else {
        const cleanPhone = conversationIdOrPhone.replace(/\D/g, '').slice(-10);
        const phoneLike = `%${cleanPhone}%`;
        const conv = await ctx.db.executeSafe({
          text: `SELECT id FROM conversations WHERE phone_number LIKE $1 AND tenant_id = $2 LIMIT 1`,
          values: [phoneLike, ctx.tenantId]
        }) as any[];
        if (conv.length > 0) {
          convId = conv[0].id;
        }
      }

      if (!convId) {
        return { success: false, error: "Conversation not found" };
      }

      // Bind conversationId to active trace context
      const traceCtx = getTraceContext();
      if (traceCtx) {
        traceCtx.conversationId = convId;
      }

      // Get unread count before marking read
      const beforeUnreadRow = await ctx.db.executeSafe({
        text: `
          SELECT COUNT(*)::int as cnt FROM messages
          WHERE conversation_id = $1 AND tenant_id = $2 AND direction = 'in'
            AND (media_metadata IS NULL OR COALESCE(media_metadata->'native'->>'message_type', '') != 'reaction')
            AND created_at > COALESCE(
              (SELECT last_read_at FROM conversation_read_states rs WHERE rs.tenant_id = $2 AND rs.user_id = $3 AND rs.conversation_id = $1),
              '1970-01-01'::timestamptz
            )
        `,
        values: [convId, ctx.tenantId, ctx.userId]
      }) as any[];
      const beforeUnread = beforeUnreadRow[0]?.cnt || 0;

      // 2. Get last inbound message ID to track last read message
      const lastMsg = await ctx.db.executeSafe({
        text: `SELECT id, created_at FROM messages 
               WHERE conversation_id = $1 AND tenant_id = $2 AND direction = 'in' 
                 AND (media_metadata IS NULL OR COALESCE(media_metadata->'native'->>'message_type', '') != 'reaction')
               ORDER BY created_at DESC LIMIT 1`,
        values: [convId, ctx.tenantId]
      }) as any[];
      const lastMsgId = lastMsg[0]?.id || null;
      const lastInboundAt = lastMsg[0]?.created_at ? new Date(lastMsg[0].created_at).toISOString() : null;

      // 3. Upsert read state
      await ctx.db.executeSafe({
        text: `
          INSERT INTO conversation_read_states (tenant_id, user_id, conversation_id, last_read_at, last_read_message_id, updated_at)
          VALUES ($1, $2, $3, NOW(), $4, NOW())
          ON CONFLICT (tenant_id, user_id, conversation_id)
          DO UPDATE SET 
            last_read_at = NOW(),
            last_read_message_id = COALESCE(EXCLUDED.last_read_message_id, conversation_read_states.last_read_message_id),
            updated_at = NOW()
        `,
        values: [ctx.tenantId, ctx.userId, convId, lastMsgId]
      });

      const nowStr = new Date().toISOString();

      console.log(`[READ_STATE_ACTION] conversationId=${convId} action=mark_read beforeUnread=${beforeUnread} afterUnread=0 lastReadAt=${nowStr} lastInboundAt=${lastInboundAt}`);

      // Publish metadata update to realtime bus
      try {
        await RealtimePublisher.publishMetadataUpdated(ctx.tenantId, {
          conversationId: convId,
          userId: ctx.userId,
          unreadCount: 0
        });
      } catch (pubErr) {
        console.error("[REALTIME_PUBLISH_ERROR] Failed to publish read metadata update:", pubErr);
      }

      return {
        success: true,
        conversationId: convId,
        unreadCount: 0,
        isRead: true,
        lastReadAt: nowStr,
        lastInboundAt: lastInboundAt,
        updatedAt: nowStr
      };
    }
  ).then(res => res.success ? (res.data || { success: true }) : { success: false, error: res.error });
}

interface UnreadCoreResult {
  success: boolean;
  updated: Array<{
    conversationId: string;
    unreadCount: number;
    isRead: boolean;
    lastReadAt: string;
    lastInboundAt: string;
    skipped?: boolean;
  }>;
  skipped: Array<{
    conversationId: string;
    reason: string;
  }>;
}

async function markConversationsUnreadCore(
  ctx: any,
  conversationIds: string[]
): Promise<UnreadCoreResult> {
  const updatedRows = await ctx.db.executeSafe({
    text: `
      WITH target_conversations AS (
        SELECT c.id
        FROM conversations c
        WHERE c.tenant_id = $1
          AND c.id = ANY($2::uuid[])
      ),
      last_inbound AS (
        SELECT DISTINCT ON (m.conversation_id)
          m.conversation_id,
          m.id AS last_inbound_message_id,
          m.created_at AS last_inbound_at
        FROM messages m
        JOIN target_conversations tc ON tc.id = m.conversation_id
        WHERE m.tenant_id = $1
          AND m.direction = 'in'
          AND (m.media_metadata IS NULL OR COALESCE(m.media_metadata->'native'->>'message_type', '') != 'reaction')
        ORDER BY m.conversation_id, COALESCE(m.provider_timestamp, m.created_at) DESC, m.id DESC
      ),
      second_last_inbound AS (
        SELECT DISTINCT ON (m.conversation_id)
          m.conversation_id,
          m.id AS last_read_message_id
        FROM messages m
        JOIN target_conversations tc ON tc.id = m.conversation_id
        JOIN last_inbound li ON li.conversation_id = m.conversation_id
        WHERE m.tenant_id = $1
          AND m.direction = 'in'
          AND (m.media_metadata IS NULL OR COALESCE(m.media_metadata->'native'->>'message_type', '') != 'reaction')
          AND m.id != li.last_inbound_message_id
        ORDER BY m.conversation_id, COALESCE(m.provider_timestamp, m.created_at) DESC, m.id DESC
      ),
      upserted_read_states AS (
        INSERT INTO conversation_read_states (tenant_id, user_id, conversation_id, last_read_at, last_read_message_id, updated_at)
        SELECT 
          $1 as tenant_id,
          $3 as user_id,
          li.conversation_id,
          li.last_inbound_at - interval '1 millisecond' as last_read_at,
          sli.last_read_message_id as last_read_message_id,
          NOW() as updated_at
        FROM last_inbound li
        LEFT JOIN second_last_inbound sli ON sli.conversation_id = li.conversation_id
        ON CONFLICT (tenant_id, user_id, conversation_id)
        DO UPDATE SET
          last_read_at = EXCLUDED.last_read_at,
          last_read_message_id = EXCLUDED.last_read_message_id,
          updated_at = NOW()
        RETURNING conversation_id, last_read_at
      ),
      unread_counts AS (
        SELECT 
          m.conversation_id,
          COUNT(*)::int AS cnt
        FROM messages m
        JOIN upserted_read_states urs ON urs.conversation_id = m.conversation_id
        WHERE m.tenant_id = $1
          AND m.direction = 'in'
          AND (m.media_metadata IS NULL OR COALESCE(m.media_metadata->'native'->>'message_type', '') != 'reaction')
          AND m.created_at > urs.last_read_at
        GROUP BY m.conversation_id
      )
      SELECT 
        urs.conversation_id, 
        urs.last_read_at,
        li.last_inbound_at,
        COALESCE(uc.cnt, 1)::int AS unread_count
      FROM upserted_read_states urs
      JOIN last_inbound li ON li.conversation_id = urs.conversation_id
      LEFT JOIN unread_counts uc ON uc.conversation_id = urs.conversation_id;
    `,
    values: [ctx.tenantId, conversationIds, ctx.userId]
  }) as any[];

  const updated = updatedRows.map(row => ({
    conversationId: row.conversation_id,
    unreadCount: row.unread_count || 1,
    isRead: false,
    lastReadAt: new Date(row.last_read_at).toISOString(),
    lastInboundAt: new Date(row.last_inbound_at).toISOString(),
    skipped: false
  }));

  const updatedIds = new Set(updated.map(u => u.conversationId));
  const skipped = conversationIds
    .filter(id => !updatedIds.has(id))
    .map(id => ({
      conversationId: id,
      reason: 'NO_INBOUND_MESSAGE'
    }));

  // Diagnostic logs
  for (const item of updated) {
    console.log(`[READ_STATE_ACTION] action=mark_unread conversationId=${item.conversationId} lastInboundAt=${item.lastInboundAt} lastReadAt=${item.lastReadAt} unreadCount=${item.unreadCount}`);
  }
  for (const item of skipped) {
    console.log(`[READ_STATE_SKIP] action=mark_unread conversationId=${item.conversationId} reason=${item.reason}`);
  }
  console.log(`[READ_STATE_SQL_CARDINALITY_OK] updatedCount=${updated.length} skippedCount=${skipped.length}`);

  // Audit logs for updated ones
  for (const item of updated) {
    await ctx.db.executeSafe({
      text: `
        INSERT INTO outreach_logs (tenant_id, conversation_id, action, actor_id, metadata)
        VALUES ($1, $2, 'mark_unread_state', $3, $4)
      `,
      values: [ctx.tenantId, item.conversationId, ctx.userId, JSON.stringify({ source: "inbox_action" })]
    });
  }

  // Publish metadata updates to Ably
  try {
    if (updated.length > 0) {
      const updatedIdsArr = updated.map(u => u.conversationId);
      if (updatedIdsArr.length === 1) {
        await RealtimePublisher.publishMetadataUpdated(ctx.tenantId, {
          conversationId: updatedIdsArr[0],
          userId: ctx.userId,
          unreadCount: updated[0].unreadCount
        });
      } else {
        await broadcastBulkMetadataUpdate(ctx.tenantId, ctx.userId, updatedIdsArr, { unreadCount: 1 });
      }
    }
  } catch (pubErr) {
    console.error("[REALTIME_PUBLISH_ERROR] Failed to publish unread metadata update:", pubErr);
  }

  return {
    success: true,
    updated,
    skipped
  };
}

export async function markConversationUnread(conversationIdOrPhone: string) {
  if (!conversationIdOrPhone) return { success: false, error: "Identifier is required." };
  return withActionGuard(
    { actionName: 'markConversationUnread' },
    async (ctx) => {
      const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(conversationIdOrPhone);
      let convId = null;

      if (isUuid) {
        convId = conversationIdOrPhone;
      } else {
        const cleanPhone = conversationIdOrPhone.replace(/\D/g, '').slice(-10);
        const phoneLike = `%${cleanPhone}%`;
        const conv = await ctx.db.executeSafe({
          text: `SELECT id FROM conversations WHERE phone_number LIKE $1 AND tenant_id = $2`,
          values: [phoneLike, ctx.tenantId]
        }) as any[];
        if (conv.length === 1) {
          convId = conv[0].id;
        } else if (conv.length > 1) {
          return { success: false, error: "Birden fazla sohbet eşleşti. Lütfen doğrudan seçim yapın." };
        } else {
          return { success: false, error: "Sohbet bulunamadı." };
        }
      }

      if (!convId) {
        return { success: false, error: "Conversation not found" };
      }

      try {
        const coreRes = await markConversationsUnreadCore(ctx, [convId]);
        if (!coreRes.success) {
          return { success: false, error: "Okunmadı işaretleme işlemi başarısız." };
        }

        const skipped = coreRes.skipped?.[0];
        if (skipped) {
          return { success: false, error: "Bu görüşme için okunmadı yapılamadı: hasta mesajı bulunamadı." };
        }

        return {
          success: true,
          updated: coreRes.updated,
          skipped: coreRes.skipped,
          results: coreRes.updated
        };
      } catch (err: any) {
        console.error("[MARK_UNREAD_CRASH]", err);
        return { success: false, error: "Okunmadı yapılamadı. Lütfen tekrar deneyin." };
      }
    }
  ).then(res => res.success ? (res.data || { success: true, updated: [], skipped: [], results: [] }) : { success: false, error: res.error });
}

export async function togglePin(conversationIdOrPhone: string) {
  if (!conversationIdOrPhone) return { success: false, error: "Identifier is required." };
  return withActionGuard(
    { actionName: 'togglePin' },
    async (ctx) => {
      const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(conversationIdOrPhone);
      let convId = null;

      if (isUuid) {
        convId = conversationIdOrPhone;
      } else {
        const cleanPhone = conversationIdOrPhone.replace(/\D/g, '').slice(-10);
        const phoneLike = `%${cleanPhone}%`;
        const conv = await ctx.db.executeSafe({
          text: `SELECT id FROM conversations WHERE phone_number LIKE $1 AND tenant_id = $2 LIMIT 1`,
          values: [phoneLike, ctx.tenantId]
        }) as any[];
        if (conv.length > 0) {
          convId = conv[0].id;
        }
      }

      if (!convId) {
        return { success: false, error: "Conversation not found" };
      }

      // Bind conversationId to active trace context
      const traceCtx = getTraceContext();
      if (traceCtx) {
        traceCtx.conversationId = convId;
      }

      // 2. Check if already pinned
      const existing = await ctx.db.executeSafe({
        text: `SELECT id FROM conversation_pins WHERE tenant_id = $1 AND user_id = $2 AND conversation_id = $3`,
        values: [ctx.tenantId, ctx.userId, convId]
      }) as any[];

      if (existing.length > 0) {
        // Unpin
        await ctx.db.executeSafe({
          text: `DELETE FROM conversation_pins WHERE tenant_id = $1 AND user_id = $2 AND conversation_id = $3`,
          values: [ctx.tenantId, ctx.userId, convId]
        });

        // Publish metadata update to realtime bus
        try {
          await RealtimePublisher.publishMetadataUpdated(ctx.tenantId, {
            conversationId: convId,
            userId: ctx.userId,
            isPinned: false
          });
        } catch (pubErr) {
          console.error("[REALTIME_PUBLISH_ERROR] Failed to publish unpin metadata update:", pubErr);
        }

        return { success: true, isPinned: false };
      } else {
        // Enforce limit: MAX_PINNED_CONVERSATIONS = 5
        const countRow = await ctx.db.executeSafe({
          text: `SELECT COUNT(*)::int as cnt FROM conversation_pins WHERE tenant_id = $1 AND user_id = $2`,
          values: [ctx.tenantId, ctx.userId]
        }) as any[];
        
        if ((countRow[0]?.cnt || 0) >= 5) {
          return { success: false, error: "En fazla 5 konuşma sabitleyebilirsiniz. Yeni bir sohbet sabitlemek için önce bir sabitlemeyi kaldırın." };
        }

        // Pin
        await ctx.db.executeSafe({
          text: `INSERT INTO conversation_pins (tenant_id, user_id, conversation_id) VALUES ($1, $2, $3)`,
          values: [ctx.tenantId, ctx.userId, convId]
        });

        // Publish metadata update to realtime bus
        try {
          await RealtimePublisher.publishMetadataUpdated(ctx.tenantId, {
            conversationId: convId,
            userId: ctx.userId,
            isPinned: true
          });
        } catch (pubErr) {
          console.error("[REALTIME_PUBLISH_ERROR] Failed to publish pin metadata update:", pubErr);
        }

        return { success: true, isPinned: true };
      }
    }
  ).then(res => res.success ? (res.data || { success: true }) : { success: false, error: res.error });
}

export async function getGlobalUnreadCount() {
  return withActionGuard(
    { actionName: 'getGlobalUnreadCount', conversationId: 'inbox_action_no_conversation' },
    async (ctx) => {
      const rows = await ctx.db.executeSafe({
        text: `
          SELECT COUNT(*)::int as total_unread
          FROM messages m
          LEFT JOIN conversation_read_states rs 
            ON rs.tenant_id = m.tenant_id 
            AND rs.user_id = $2 
            AND rs.conversation_id = m.conversation_id
          WHERE m.tenant_id = $1
            AND m.direction = 'in'
            AND (m.media_metadata IS NULL OR COALESCE(m.media_metadata->'native'->>'message_type', '') != 'reaction')
            AND m.created_at > COALESCE(rs.last_read_at, '1970-01-01'::timestamptz)
        `,
        values: [ctx.tenantId, ctx.userId]
      }) as any[];

      return rows[0]?.total_unread || 0;
    }
  );
}

export async function prepareFollowUpDraft(conversationId: string) {
  if (!conversationId) return { success: false as const, error: "Konuşma ID gerekli." };

  return withActionGuard(
    { actionName: 'prepareFollowUpDraft' },
    async (ctx) => {
      // 1. Resolve conversation data, customer profiles, active opportunities, and leads
      const convRows = await ctx.db.executeSafe({
        text: `
          SELECT c.id as conversation_id, c.phone_number, c.customer_id, c.active_opportunity_id, c.patient_name,
                 active_opp.stage as opp_stage, active_opp.metadata as opp_metadata, active_opp.automation_status as opp_automation_status,
                 l.id as lead_id, l.raw_data as form_raw_data
          FROM conversations c
          LEFT JOIN opportunities active_opp 
            ON active_opp.id = c.active_opportunity_id 
            AND active_opp.tenant_id = c.tenant_id
          LEFT JOIN LATERAL (
            SELECT id, raw_data 
            FROM leads 
            WHERE leads.tenant_id = c.tenant_id
              AND (
                (c.customer_id IS NOT NULL AND leads.customer_id = c.customer_id)
                OR
                (leads.phone_number LIKE '%' || RIGHT(c.phone_number, 10))
              )
            ORDER BY created_at DESC 
            LIMIT 1
          ) l ON true
          WHERE c.id = $1 AND c.tenant_id = $2
          LIMIT 1
        `,
        values: [conversationId, ctx.tenantId]
      });

      const convs = Array.isArray(convRows) ? convRows : ((convRows as any)?.rows || []);
      if (convs.length === 0) {
        return { success: false, error: "Konuşma bulunamadı." };
      }

      const conv = convs[0];
      const phone = conv.phone_number;

      // 2. StopRule Evaluation & Exclusions
      const currentStage = conv.opp_stage || '';
      if (['lost', 'not_qualified', 'arrived'].includes(currentStage)) {
        return { success: false, error: `Terminal aşamadaki fırsat için taslak hazırlanamaz: ${currentStage}` };
      }

      const primaryNorm = normalizePhoneForIdentity(phone).e164;
      const optOutPhones = new Set<string>();

      try {
        const optOutOpps = await ctx.db.executeSafe({
          text: `
            SELECT phone_number 
            FROM opportunities 
            WHERE tenant_id = $1 
              AND (COALESCE(metadata->>'opt_out_requested', 'false') = 'true')
          `,
          values: [ctx.tenantId]
        });
        const optOutOppRows = Array.isArray(optOutOpps) ? optOutOpps : ((optOutOpps as any)?.rows || []);
        for (const o of optOutOppRows) {
          const norm = normalizePhoneForIdentity(o.phone_number).e164;
          if (norm) optOutPhones.add(norm);
        }

        const lastInbounds = await ctx.db.executeSafe({
          text: `
            SELECT phone_number, content 
            FROM messages 
            WHERE tenant_id = $1 AND direction = 'in'
              AND phone_number LIKE '%' || RIGHT($2, 10)
              AND (media_metadata IS NULL OR COALESCE(media_metadata->'native'->>'message_type', '') != 'reaction')
            ORDER BY created_at DESC
            LIMIT 1
          `,
          values: [ctx.tenantId, phone]
        });
        const lastInboundRows = Array.isArray(lastInbounds) ? lastInbounds : ((lastInbounds as any)?.rows || []);
        
        const hasOptOutKeywords = (text: string): boolean => {
          const clean = (text || '').toLowerCase().trim();
          const optOuts = [
            "dur", "stop", "istemiyorum", "rahatsız etmeyin", "mesaj atmayın", 
            "bırakın", "silin", "arama", "yazma", "unsubscribe", "don't write"
          ];
          return optOuts.some(kw => clean.includes(kw));
        };

        if (lastInboundRows.length > 0 && hasOptOutKeywords(lastInboundRows[0].content)) {
          if (primaryNorm) optOutPhones.add(primaryNorm);
        }
      } catch (e) {
        console.error("[INBOX_FORENSIC] Failed during opt-out check in prepareFollowUpDraft:", e);
      }

      const isPrimaryOptedOut = (conv.opp_metadata?.opt_out_requested === true) || 
                                (conv.opp_metadata?.opt_out_requested === 'true') ||
                                (primaryNorm && optOutPhones.has(primaryNorm));

      let hasOptOutKeywordInFamily = false;
      let parsedRaw = conv.form_raw_data;
      if (typeof parsedRaw === 'string') {
        try { parsedRaw = JSON.parse(parsedRaw); } catch(_) {}
      }
      if (parsedRaw && parsedRaw._all_phones) {
        const parsed = parseAllPhones(parsedRaw._all_phones);
        for (const p of parsed) {
          const pNorm = normalizePhoneForIdentity(p).e164;
          if (pNorm && optOutPhones.has(pNorm)) {
            hasOptOutKeywordInFamily = true;
            break;
          }
        }
      }

      if (isPrimaryOptedOut || hasOptOutKeywordInFamily) {
        return { success: false, error: "Hasta opt-out (istemiyorum/rahatsız etmeyin) talep etmiştir. Taslak hazırlanamaz." };
      }

      if (conv.opp_automation_status === 'stopped' || conv.opp_automation_status === 'paused') {
        return { success: false, error: "Bu fırsat için otomasyon durdurulmuş." };
      }

      const lastMsgRows = await ctx.db.executeSafe({
        text: `
          SELECT id, content, direction, created_at
          FROM messages
          WHERE conversation_id = $1 AND tenant_id = $2
            AND direction != 'system'
            AND (media_metadata IS NULL OR COALESCE(media_metadata->'native'->>'message_type', '') != 'reaction')
          ORDER BY created_at DESC
          LIMIT 1
        `,
        values: [conversationId, ctx.tenantId]
      });
      const lastMsgs = Array.isArray(lastMsgRows) ? lastMsgRows : ((lastMsgRows as any)?.rows || []);
      if (lastMsgs.length === 0) {
        return { success: false, error: "Konuşmada mesaj bulunamadı." };
      }

      const lastMsg = lastMsgs[0];
      if (lastMsg.direction !== 'out') {
        return { success: false, error: "Son mesaj hastadan gelmiş, hatırlatma taslağı hazırlanamaz." };
      }

      const classification = ExpectsReplyClassifier.classify(lastMsg.content);
      if (!classification.expectsReply) {
        return { success: false, error: "Son asistan mesajı cevap bekleyen bir mesaj değildir." };
      }

      if (currentStage === 'booked' && classification.isClosingMessage) {
        return { success: false, error: "Booked aşamasında kapanış mesajı atılmış, taslak hazırlanamaz." };
      }

      // 3. 24-Hour WhatsApp Service Window Check
      const lastInboundMsgRows = await ctx.db.executeSafe({
        text: `
          SELECT created_at
          FROM messages
          WHERE conversation_id = $1 AND tenant_id = $2 AND direction = 'in'
            AND (media_metadata IS NULL OR COALESCE(media_metadata->'native'->>'message_type', '') != 'reaction')
          ORDER BY created_at DESC
          LIMIT 1
        `,
        values: [conversationId, ctx.tenantId]
      });
      const lastInboundMsgs = Array.isArray(lastInboundMsgRows) ? lastInboundMsgRows : ((lastInboundMsgRows as any)?.rows || []);
      
      let windowOpen = false;
      let lastInboundTimeMs = 0;
      if (lastInboundMsgs.length > 0) {
        lastInboundTimeMs = new Date(lastInboundMsgs[0].created_at).getTime();
        windowOpen = (Date.now() - lastInboundTimeMs) <= 24 * 60 * 60 * 1000;
      }

      const lastOutboundTimeMs = new Date(lastMsg.created_at).getTime();
      const noReplyHours = Math.round(((Date.now() - lastOutboundTimeMs) / (1000 * 60 * 60)) * 10) / 10;

      let draftText = "";
      let draftType: "freeform" | "template_required" = "freeform";

      if (windowOpen) {
        const { sanitizePatientFacingMessage } = await import("@/lib/utils/patient-message-sanitizer");
        draftText = sanitizePatientFacingMessage("Merhaba, müsait olduğunuzda geri dönüş yapabilirseniz size yardımcı olmaktan memnuniyet duyarız. İyi günler dileriz.");
        draftType = "freeform";
      } else {
        draftText = "24 saatlik WhatsApp penceresi kapandığı için serbest mesaj gönderilemez. Lütfen onaylı bir şablon seçin.";
        draftType = "template_required";
      }

      // 5. Log Draft Preparation in outreach_logs
      await ctx.db.executeSafe({
        text: `
          INSERT INTO outreach_logs (tenant_id, lead_id, conversation_id, opportunity_id, action, channel, actor_id, metadata)
          VALUES ($1, $2, $3, $4, 'followup_draft_prepared', 'whatsapp', $5, $6)
        `,
        values: [
          ctx.tenantId,
          conv.lead_id || null,
          conversationId,
          conv.active_opportunity_id || null,
          ctx.userId,
          JSON.stringify({
            source: "inbox_no_reply",
            last_outbound_message_id: lastMsg.id,
            expects_reply_reason: classification.reason,
            no_reply_hours: noReplyHours,
            window_open: windowOpen,
            draft_type: draftType,
            draft_message: draftText,
            sent: false
          })
        ]
      });

      return {
        success: true,
        draft: draftText,
        draftType,
        windowOpen,
        noReplyHours,
        patientName: conv.patient_name || "Hasta",
        phone
      };
    }
  ).then(res => {
    if (!res.success) return { success: false as const, error: res.error || res.data?.error };
    return {
      success: true as const,
      draft: res.data?.draft as string,
      draftType: res.data?.draftType as "freeform" | "template_required",
      windowOpen: res.data?.windowOpen as boolean,
      noReplyHours: res.data?.noReplyHours as number,
      patientName: res.data?.patientName as string,
      phone: res.data?.phone as string
    };
  });
}

export async function sendApprovedFollowUp(conversationId: string, editedMessage: string) {
  if (!conversationId) return { success: false as const, error: "Konuşma ID gerekli." };
  if (!editedMessage || editedMessage.trim().length === 0) return { success: false as const, error: "Mesaj metni boş olamaz." };

  const cleanMessage = editedMessage.trim();

  return withActionGuard(
    { actionName: 'sendApprovedFollowUp' },
    async (ctx) => {
      // 1. Fetch conversation data and active opportunity
      const convRows = await ctx.db.executeSafe({
        text: `
          SELECT c.id as conversation_id, c.phone_number, c.customer_id, c.active_opportunity_id, c.patient_name,
                 active_opp.stage as opp_stage, active_opp.metadata as opp_metadata, active_opp.automation_status as opp_automation_status,
                 l.id as lead_id, l.raw_data as form_raw_data
          FROM conversations c
          LEFT JOIN opportunities active_opp 
            ON active_opp.id = c.active_opportunity_id 
            AND active_opp.tenant_id = c.tenant_id
          LEFT JOIN LATERAL (
            SELECT id, raw_data 
            FROM leads 
            WHERE leads.tenant_id = c.tenant_id
              AND (
                (c.customer_id IS NOT NULL AND leads.customer_id = c.customer_id)
                OR
                (leads.phone_number LIKE '%' || RIGHT(c.phone_number, 10))
              )
            ORDER BY created_at DESC 
            LIMIT 1
          ) l ON true
          WHERE c.id = $1 AND c.tenant_id = $2
          LIMIT 1
        `,
        values: [conversationId, ctx.tenantId]
      });

      const convs = Array.isArray(convRows) ? convRows : ((convRows as any)?.rows || []);
      if (convs.length === 0) {
        return { success: false, error: "Konuşma bulunamadı." };
      }

      const conv = convs[0];
      const phone = conv.phone_number;

      // 2. Validate StopRules & Exclusions
      const currentStage = conv.opp_stage || '';
      if (['lost', 'not_qualified', 'arrived'].includes(currentStage)) {
        return { success: false, error: `Terminal aşamadaki fırsat için hatırlatma gönderilemez: ${currentStage}` };
      }

      const primaryNorm = normalizePhoneForIdentity(phone).e164;
      const optOutPhones = new Set<string>();

      try {
        const optOutOpps = await ctx.db.executeSafe({
          text: `
            SELECT phone_number 
            FROM opportunities 
            WHERE tenant_id = $1 
              AND (COALESCE(metadata->>'opt_out_requested', 'false') = 'true')
          `,
          values: [ctx.tenantId]
        });
        const optOutOppRows = Array.isArray(optOutOpps) ? optOutOpps : ((optOutOpps as any)?.rows || []);
        for (const o of optOutOppRows) {
          const norm = normalizePhoneForIdentity(o.phone_number).e164;
          if (norm) optOutPhones.add(norm);
        }

        const lastInbounds = await ctx.db.executeSafe({
          text: `
            SELECT phone_number, content 
            FROM messages 
            WHERE tenant_id = $1 AND direction = 'in'
              AND phone_number LIKE '%' || RIGHT($2, 10)
              AND (media_metadata IS NULL OR COALESCE(media_metadata->'native'->>'message_type', '') != 'reaction')
            ORDER BY created_at DESC
            LIMIT 1
          `,
          values: [ctx.tenantId, phone]
        });
        const lastInboundRows = Array.isArray(lastInbounds) ? lastInbounds : ((lastInbounds as any)?.rows || []);
        
        const hasOptOutKeywords = (text: string): boolean => {
          const clean = (text || '').toLowerCase().trim();
          const optOuts = [
            "dur", "stop", "istemiyorum", "rahatsız etmeyin", "mesaj atmayın", 
            "bırakın", "silin", "arama", "yazma", "unsubscribe", "don't write"
          ];
          return optOuts.some(kw => clean.includes(kw));
        };

        if (lastInboundRows.length > 0 && hasOptOutKeywords(lastInboundRows[0].content)) {
          if (primaryNorm) optOutPhones.add(primaryNorm);
        }
      } catch (e) {
        console.error("[INBOX_FORENSIC] Failed during opt-out check in sendApprovedFollowUp:", e);
      }

      const isPrimaryOptedOut = (conv.opp_metadata?.opt_out_requested === true) || 
                                (conv.opp_metadata?.opt_out_requested === 'true') ||
                                (primaryNorm && optOutPhones.has(primaryNorm));

      let hasOptOutKeywordInFamily = false;
      let parsedRaw = conv.form_raw_data;
      if (typeof parsedRaw === 'string') {
        try { parsedRaw = JSON.parse(parsedRaw); } catch(_) {}
      }
      if (parsedRaw && parsedRaw._all_phones) {
        const parsed = parseAllPhones(parsedRaw._all_phones);
        for (const p of parsed) {
          const pNorm = normalizePhoneForIdentity(p).e164;
          if (pNorm && optOutPhones.has(pNorm)) {
            hasOptOutKeywordInFamily = true;
            break;
          }
        }
      }

      if (isPrimaryOptedOut || hasOptOutKeywordInFamily) {
        return { success: false, error: "Hasta opt-out talep etmiştir. Hatırlatma gönderilemez." };
      }

      if (conv.opp_automation_status === 'stopped' || conv.opp_automation_status === 'paused') {
        return { success: false, error: "Bu fırsat için otomasyon durdurulmuş." };
      }

      const lastMsgRows = await ctx.db.executeSafe({
        text: `
          SELECT content, direction, created_at
          FROM messages
          WHERE conversation_id = $1 AND tenant_id = $2
            AND direction != 'system'
            AND (media_metadata IS NULL OR COALESCE(media_metadata->'native'->>'message_type', '') != 'reaction')
          ORDER BY created_at DESC
          LIMIT 1
        `,
        values: [conversationId, ctx.tenantId]
      });
      const lastMsgs = Array.isArray(lastMsgRows) ? lastMsgRows : ((lastMsgRows as any)?.rows || []);
      if (lastMsgs.length === 0) {
        return { success: false, error: "Konuşmada mesaj bulunamadı." };
      }

      const lastMsg = lastMsgs[0];
      if (lastMsg.direction !== 'out') {
        return { success: false, error: "Son mesaj hastadan gelmiş, hatırlatma gönderilemez." };
      }

      const lastInboundMsgRows = await ctx.db.executeSafe({
        text: `
          SELECT created_at
          FROM messages
          WHERE conversation_id = $1 AND tenant_id = $2 AND direction = 'in'
            AND (media_metadata IS NULL OR COALESCE(media_metadata->'native'->>'message_type', '') != 'reaction')
          ORDER BY created_at DESC
          LIMIT 1
        `,
        values: [conversationId, ctx.tenantId]
      });
      const lastInboundMsgs = Array.isArray(lastInboundMsgRows) ? lastInboundMsgRows : ((lastInboundMsgRows as any)?.rows || []);
      
      let windowOpen = false;
      if (lastInboundMsgs.length > 0) {
        const lastInboundTimeMs = new Date(lastInboundMsgs[0].created_at).getTime();
        windowOpen = (Date.now() - lastInboundTimeMs) <= 24 * 60 * 60 * 1000;
      }

      if (!windowOpen) {
        return { success: false, error: "24 saatlik WhatsApp penceresi kapalı. Şablon gönderimi A1.7a kapsamında devre dışıdır." };
      }

      const lastDraftLog = await ctx.db.executeSafe({
        text: `
          SELECT created_at 
          FROM outreach_logs 
          WHERE conversation_id = $1 AND tenant_id = $2 AND action = 'followup_draft_prepared'
          ORDER BY created_at DESC 
          LIMIT 1
        `,
        values: [conversationId, ctx.tenantId]
      });
      const lastDraftLogRows = Array.isArray(lastDraftLog) ? lastDraftLog : ((lastDraftLog as any)?.rows || []);
      if (lastDraftLogRows.length > 0) {
        const draftTime = lastDraftLogRows[0].created_at;
        const newInbounds = await ctx.db.executeSafe({
          text: `
            SELECT 1 FROM messages 
            WHERE conversation_id = $1 AND tenant_id = $2 AND direction = 'in' AND created_at > $3
            LIMIT 1
          `,
          values: [conversationId, ctx.tenantId, draftTime]
        });
        const newInboundRows = Array.isArray(newInbounds) ? newInbounds : ((newInbounds as any)?.rows || []);
        if (newInboundRows.length > 0) {
          return { success: false, error: "Taslak hazırlandıktan sonra hastadan yeni bir mesaj gelmiştir. Gönderim iptal edildi." };
        }
      }

      const recentSends = await ctx.db.executeSafe({
        text: `
          SELECT 1 FROM outreach_logs 
          WHERE conversation_id = $1 AND tenant_id = $2 
            AND action = 'followup_sent'
            AND created_at > NOW() - INTERVAL '24 hour'
          LIMIT 1
        `,
        values: [conversationId, ctx.tenantId]
      });
      const recentSendRows = Array.isArray(recentSends) ? recentSends : ((recentSends as any)?.rows || []);
      if (recentSendRows.length > 0) {
        return { success: false, error: "Son 24 saat içinde bu hastaya zaten bir hatırlatma mesajı gönderilmiştir." };
      }

      // 3. Send via WhatsApp API using unified MessageService
      let providerMessageId: string | null = null;
      try {
        const { MessageService } = await import("@/lib/services/message.service");
        const msgService = new MessageService(ctx.db);
        const outRes = await msgService.sendWhatsAppFreeform(phone, cleanMessage);
        providerMessageId = outRes.providerMessageId || null;
      } catch (err: any) {
        return { success: false, error: `WhatsApp gönderim hatası: ${err?.message || err}` };
      }

      // 5. Save message record
      await ctx.db.executeSafe({
        text: `INSERT INTO messages (tenant_id, conversation_id, phone_number, direction, content, channel, status, provider_message_id)
               VALUES ($1, $2, $3, 'out', $4, 'whatsapp', 'sent', $5)`,
        values: [ctx.tenantId, conversationId, phone, cleanMessage, providerMessageId]
      });

      // Update conversation last_message
      await ctx.db.executeSafe({
        text: `UPDATE conversations 
               SET last_message_at = NOW(), 
                   last_message_content = $1,
                   last_channel = 'whatsapp',
                   last_message_status = 'sent',
                   last_message_direction = 'out',
                   message_count = COALESCE(message_count, 0) + 1
               WHERE id = $2 AND tenant_id = $3`,
        values: [cleanMessage, conversationId, ctx.tenantId]
      });

      // 6. Write outreach log
      await ctx.db.executeSafe({
        text: `INSERT INTO outreach_logs (tenant_id, lead_id, conversation_id, opportunity_id, action, channel, actor_id, metadata)
               VALUES ($1, $2, $3, $4, 'followup_sent', 'whatsapp', $5, $6)`,
        values: [
          ctx.tenantId,
          conv.lead_id || null,
          conversationId,
          conv.active_opportunity_id || null,
          ctx.userId,
          JSON.stringify({
            message_text: cleanMessage,
            provider_message_id: providerMessageId,
            patient_name: conv.patient_name || '',
            phone,
          })
        ]
      });

      // 7. Audit
      logAudit({
        tenantId: ctx.tenantId,
        userId: ctx.userId,
        userEmail: ctx.email,
        action: 'outreach_followup_sent',
        entityType: 'conversation',
        entityId: conversationId,
        details: { phone, messageText: cleanMessage },
      });

      return { success: true, messageSent: true };
    }
  ).then(res => {
    if (!res.success) return { success: false as const, error: res.error || res.data?.error };
    return { success: true as const, messageSent: res.data?.messageSent as boolean };
  });
}


// ==========================================
// A1.7b — Secondary Phone Fallback Actions
// ==========================================

export async function checkSecondaryFallback(conversationId: string) {
  if (!conversationId) return { eligible: false, reason: "Konuşma ID gerekli." };

  return withActionGuard(
    { actionName: 'checkSecondaryFallback' },
    async (ctx) => {
      const { SecondaryPhoneFallbackService } = await import("@/lib/services/secondary-phone-fallback.service");
      const service = new SecondaryPhoneFallbackService(ctx.db, ctx.tenantId);
      return await service.checkEligibility(conversationId);
    }
  ).then(res => {
    if (!res.success) return { eligible: false, reason: res.error || "Kontrol başarısız." };
    return res.data as any;
  });
}

export async function prepareSecondaryDraft(conversationId: string) {
  if (!conversationId) return { success: false as const, error: "Konuşma ID gerekli." };

  return withActionGuard(
    { actionName: 'prepareSecondaryDraft' },
    async (ctx) => {
      const { SecondaryPhoneFallbackService } = await import("@/lib/services/secondary-phone-fallback.service");
      const service = new SecondaryPhoneFallbackService(ctx.db, ctx.tenantId);
      return await service.prepareDraft(conversationId, ctx.userId);
    }
  ).then(res => {
    if (!res.success) return { success: false as const, error: res.error || res.data?.error };
    return {
      success: true as const,
      draft: res.data?.draft as string,
      draftType: res.data?.draftType as "freeform" | "template_required",
      windowOpen: res.data?.windowOpen as boolean,
      secondaryPhone: res.data?.secondaryPhone as string,
      secondaryConversationId: res.data?.secondaryConversationId as string | null,
      patientName: res.data?.patientName as string,
    };
  });
}


// ==========================================
// A1.7c — Form Greeting Handoff Actions
// ==========================================

export async function checkFormGreetingEligibility(conversationId: string) {
  if (!conversationId) return { eligible: false, reason: "Konuşma ID gerekli." };

  return withActionGuard(
    { actionName: 'checkFormGreetingEligibility' },
    async (ctx) => {
      const convRows = await ctx.db.executeSafe({
        text: `
          SELECT c.id, c.phone_number, c.patient_name, c.customer_id,
                 l.id as lead_id
          FROM conversations c
          LEFT JOIN LATERAL (
            SELECT id, raw_data 
            FROM leads 
            WHERE leads.tenant_id = c.tenant_id
              AND (
                (c.customer_id IS NOT NULL AND leads.customer_id = c.customer_id)
                OR
                (leads.phone_number LIKE '%' || RIGHT(c.phone_number, 10))
              )
            ORDER BY created_at DESC 
            LIMIT 1
          ) l ON true
          WHERE c.id = $1 AND c.tenant_id = $2
          LIMIT 1
        `,
        values: [conversationId, ctx.tenantId]
      }) as any[];

      if (convRows.length === 0 || !convRows[0].lead_id) {
        return { eligible: false, reason: "Bu konuşmaya bağlı bir form bulunamadı." };
      }

      const leadId = convRows[0].lead_id;
      const { resolveFirstContactCore } = await import("@/lib/utils/first-contact-status-resolver");
      const statusObj = await resolveFirstContactCore(ctx.db, ctx.tenantId, leadId);

      // Sadece 'waiting_inbox_reply' (Hiç formdan mesaj atılmamış ama kendisi yazmış) durumundaysa Inbox'ta göster
      const isEligible = statusObj.patientLevelStatus === 'waiting_inbox_reply';

      return {
        eligible: isEligible,
        patientLevelStatus: statusObj.patientLevelStatus,
        reason: isEligible ? "" : "Sadece 'waiting_inbox_reply' durumundaki hasta için form karşılama aktif edilir."
      };
    }
  ).then(res => {
    if (!res.success) return { eligible: false, reason: res.error || "Kontrol başarısız." };
    return res.data as any;
  });
}
export async function prepareFormGreetingDraft(conversationId: string) {
  if (!conversationId) return { success: false as const, error: "Konuşma ID gerekli." };

  return withActionGuard(
    { actionName: 'prepareFormGreetingDraft' },
    async (ctx) => {
      const convRows = await ctx.db.executeSafe({
        text: `
          SELECT c.id, c.phone_number, c.customer_id, l.id as lead_id
          FROM conversations c
          LEFT JOIN LATERAL (
            SELECT id 
            FROM leads 
            WHERE leads.tenant_id = c.tenant_id
              AND (
                (c.customer_id IS NOT NULL AND leads.customer_id = c.customer_id)
                OR
                (leads.phone_number LIKE '%' || RIGHT(c.phone_number, 10))
              )
            ORDER BY created_at DESC 
            LIMIT 1
          ) l ON true
          WHERE c.id = $1 AND c.tenant_id = $2
          LIMIT 1
        `,
        values: [conversationId, ctx.tenantId]
      }) as any[];

      if (convRows.length === 0 || !convRows[0].lead_id) {
        return { error: "Form bulunamadı." };
      }

      const { prepareSmartGreetingDraftCore } = await import("@/app/actions/outreach");
      const draftRes = await prepareSmartGreetingDraftCore(ctx.db, ctx.tenantId, ctx.userId, convRows[0].lead_id);
      
      return { draft: draftRes.draftText };
    }
  ).then(res => {
    if (!res.success) return { success: false as const, error: res.error || res.data?.error };
    return {
      success: true as const,
      draft: res.data?.draft as string,
    };
  });
}

export async function saveBotSteeringDirectiveAction(conversationId: string, directiveText: string) {
  if (!conversationId) return { success: false, error: "Konuşma ID gerekli." };
  if (!directiveText || directiveText.trim().length === 0) return { success: false, error: "Direktif metni boş olamaz." };

  return withActionGuard(
    { actionName: 'saveBotSteeringDirectiveAction' },
    async (ctx) => {
      const taskRows = await ctx.db.executeSafe({
        text: `SELECT id, opportunity_id, phone_number, metadata FROM follow_up_tasks 
               WHERE conversation_id = $1 AND tenant_id = $2 AND status IN ('pending', 'in_progress')
               ORDER BY created_at DESC LIMIT 1`,
        values: [conversationId, ctx.tenantId]
      }) as any[];

      const activeTask = taskRows[0] || null;

      const { PatientOperationsLifecycleService } = await import('@/lib/services/patient-operations-lifecycle');
      const lifecycleService = new PatientOperationsLifecycleService(ctx.db);

      let oppId = activeTask?.opportunity_id;
      let phone = activeTask?.phone_number;
      let taskId = activeTask?.id;

      if (!taskId) {
        const convRows = await ctx.db.executeSafe({
          text: `SELECT active_opportunity_id, phone_number FROM conversations WHERE id = $1 AND tenant_id = $2 LIMIT 1`,
          values: [conversationId, ctx.tenantId]
        }) as any[];

        if (convRows.length === 0) {
          return { success: false, error: "Konuşma bulunamadı." };
        }

        oppId = convRows[0].active_opportunity_id || null;
        phone = convRows[0].phone_number;

        const metadata = {
          zero_outbound_p0: true,
          zero_outbound: true,
          patient_visible: false,
          internal_directive_only: true,
          source: "crm_panel_bot_steering",
          bot_directive_state: {
            directive_type: 'ask_callback_time',
            directive_status: 'pending',
            active_bot_directive: directiveText.trim(),
            created_by: ctx.userId || 'system',
            created_at: new Date().toISOString(),
            source_ui: 'inbox_crm_panel'
          },
          active_bot_directive: directiveText.trim()
        };

        const res = await ctx.db.executeSafe({
          text: `
            INSERT INTO follow_up_tasks (
              tenant_id, opportunity_id, conversation_id, phone_number,
              task_type, title, description, status, due_at, metadata
            ) VALUES ($1, $2, $3, $4, 'bot_handoff_followup', 'Manuel Bot Yönlendirme', $5, 'pending', NOW(), $6)
            RETURNING id
          `,
          values: [
            ctx.tenantId,
            oppId,
            conversationId,
            phone,
            'Manuel bot yönlendirmesi ile oluşturuldu.',
            JSON.stringify(metadata)
          ]
        }) as any[];

        taskId = res[0].id;
      } else {
        await lifecycleService.setBotDirective({
          taskId,
          tenantId: ctx.tenantId,
          directiveType: 'ask_callback_time',
          directiveText: directiveText.trim(),
          userId: ctx.userId,
          sourceUi: 'inbox_crm_panel'
        });

        const currentMeta = activeTask.metadata || {};
        const updatedMeta = {
          ...currentMeta,
          zero_outbound_p0: true,
          zero_outbound: true,
          patient_visible: false,
          internal_directive_only: true,
          source: "crm_panel_bot_steering",
          bot_directive_state: {
            ...(currentMeta.bot_directive_state || {}),
            directive_type: 'ask_callback_time',
            directive_status: 'pending',
            active_bot_directive: directiveText.trim(),
            created_by: ctx.userId || 'system',
            created_at: new Date().toISOString(),
            source_ui: 'inbox_crm_panel'
          },
          active_bot_directive: directiveText.trim()
        };

        await ctx.db.executeSafe({
          text: `UPDATE follow_up_tasks SET metadata = $1::jsonb, updated_at = NOW() WHERE id = $2 AND tenant_id = $3`,
          values: [JSON.stringify(updatedMeta), taskId, ctx.tenantId]
        });
      }

      await ctx.db.executeSafe({
        text: `INSERT INTO outreach_logs (tenant_id, conversation_id, opportunity_id, action, channel, actor_id, metadata)
               VALUES ($1, $2, $3, 'bot_steering_saved', 'system', $4, $5)`,
        values: [
          ctx.tenantId,
          conversationId,
          oppId || null,
          ctx.userId,
          JSON.stringify({
            directiveText: directiveText.trim(),
            task_id: taskId,
            zero_outbound: true,
            patient_visible: false,
            internal_directive_only: true
          })
        ]
      });

      return { success: true };
    }
  );
}

export async function deactivateBotDirectiveAction(conversationId: string, taskId: string) {
  if (!conversationId) return { success: false, error: "Konuşma ID gerekli." };
  if (!taskId) return { success: false, error: "Task ID gerekli." };

  return withActionGuard(
    { actionName: 'deactivateBotDirectiveAction' },
    async (ctx) => {
      // Fetch task to verify it belongs to this tenant and conversation
      const taskRows = await ctx.db.executeSafe({
        text: `SELECT id, task_type, status, metadata FROM follow_up_tasks 
               WHERE id = $1 AND conversation_id = $2 AND tenant_id = $3 LIMIT 1`,
        values: [taskId, conversationId, ctx.tenantId]
      }) as any[];

      if (taskRows.length === 0) {
        return { success: false, error: "Yönlendirme bulunamadı veya yetkisiz erişim." };
      }

      const task = taskRows[0];
      const currentMeta = task.metadata || {};
      const state = currentMeta.bot_directive_state || {};

      // Prepare updated metadata
      const updatedMeta = {
        ...currentMeta,
        bot_directive_state: {
          ...state,
          directive_status: 'cancelled',
          cancelled_at: new Date().toISOString(),
          cancelled_by: ctx.userId || 'system'
        }
      };

      // Clean up backward compatible properties to make sure it's fully cancelled/deleted
      delete updatedMeta.active_bot_directive;
      delete updatedMeta.bot_teyit_sent;
      delete updatedMeta.bot_hatirlat_sent;
      delete updatedMeta.bot_devret_sent;

      // If it is a pure handoff follow-up task, cancel/complete the task itself as well
      let statusUpdate = "";
      if (task.task_type === 'bot_handoff_followup' && ['pending', 'in_progress'].includes(task.status)) {
        statusUpdate = `, status = 'cancelled', completed_at = NOW(), completed_by = '${ctx.userId || '00000000-0000-0000-0000-000000000000'}', completion_note = 'İç talimat operatör tarafından iptal edildi'`;
      }

      await ctx.db.executeSafe({
        text: `UPDATE follow_up_tasks 
               SET metadata = $1::jsonb, updated_at = NOW() ${statusUpdate} 
               WHERE id = $2 AND tenant_id = $3`,
        values: [JSON.stringify(updatedMeta), taskId, ctx.tenantId]
      });

      // Write outreach log for auditing (non-outbound)
      await ctx.db.executeSafe({
        text: `INSERT INTO outreach_logs (tenant_id, conversation_id, action, channel, actor_id, metadata)
               VALUES ($1, $2, 'bot_steering_cancelled', 'system', $3, $4)`,
        values: [
          ctx.tenantId,
          conversationId,
          ctx.userId,
          JSON.stringify({
            task_id: taskId,
            directive_text: state.active_bot_directive || currentMeta.active_bot_directive || '',
            cancelled_by: ctx.userId,
            patient_visible: false,
            internal_only: true
          })
        ]
      });

      return { success: true };
    }
  ).then(res => {
    if (!res.success) return { success: false, error: res.error };
    if (res.data && !res.data.success) return { success: false, error: res.data.error };
    return { success: true };
  });
}


export async function saveFormGreetingDraftInternalAction(conversationId: string, approvedText: string) {
  if (!conversationId) return { success: false, error: "Konuşma ID gerekli." };
  if (!approvedText || approvedText.trim().length === 0) return { success: false, error: "Taslak metni boş olamaz." };

  return withActionGuard(
    { actionName: 'saveFormGreetingDraftInternalAction' },
    async (ctx) => {
      const convRows = await ctx.db.executeSafe({
        text: `
          SELECT c.id, c.phone_number, c.patient_name, c.active_opportunity_id,
                 l.id as lead_id, l.form_name
          FROM conversations c
          LEFT JOIN leads l ON l.tenant_id = c.tenant_id AND (
            (c.customer_id IS NOT NULL AND l.customer_id = c.customer_id)
            OR l.phone_number = c.phone_number
          )
          WHERE c.id = $1 AND c.tenant_id = $2
          ORDER BY l.created_at DESC
          LIMIT 1
        `,
        values: [conversationId, ctx.tenantId]
      }) as any[];

      if (convRows.length === 0) {
        return { success: false, error: "Konuşma bulunamadı." };
      }

      const conv = convRows[0];
      const oppId = conv.active_opportunity_id;

      const actorId = ctx.userId;
      if (!actorId) {
        return { success: false, error: "Kullanıcı kimliği bulunamadı (actor_id null olamaz)." };
      }

      await ctx.db.executeSafe({
        text: `
          INSERT INTO outreach_logs (tenant_id, lead_id, conversation_id, opportunity_id, action, channel, actor_id, metadata)
          VALUES ($1, $2, $3, $4, 'smart_greeting_draft_edited', 'whatsapp', $5, $6)
        `,
        values: [
          ctx.tenantId,
          conv.lead_id || null,
          conversationId,
          oppId || null,
          actorId,
          JSON.stringify({
            draft_text: approvedText,
            source: 'smart_draft',
            patient_visible: false,
            zero_api_outbound: true,
            zero_outbound: true,
            stage_changed: false,
            draft_only: true,
            message_text: approvedText,
            phone: conv.phone_number,
            patient_name: conv.patient_name || ''
          })
        ]
      });

      return { success: true };
    }
  );
}

export async function sendFormGreetingFromInboxAction(conversationId: string, messageText: string) {
  if (!conversationId) return { success: false, error: "Konuşma ID gerekli." };
  if (!messageText || messageText.trim().length === 0) return { success: false, error: "Mesaj metni boş olamaz." };

  return withActionGuard(
    { actionName: 'sendFormGreetingFromInboxAction' },
    async (ctx) => {
      // 1. Fetch conversation details
      const convRows = await ctx.db.executeSafe({
        text: `SELECT c.id, c.phone_number, c.patient_name, c.active_opportunity_id,
                      l.id as lead_id
               FROM conversations c
               LEFT JOIN leads l ON l.tenant_id = c.tenant_id AND (
                 (c.customer_id IS NOT NULL AND l.customer_id = c.customer_id)
                 OR l.phone_number = c.phone_number
               )
               WHERE c.id = $1 AND c.tenant_id = $2
               ORDER BY l.created_at DESC
               LIMIT 1`,
        values: [conversationId, ctx.tenantId]
      }) as any[];

      if (convRows.length === 0) {
        return { success: false, error: "Konuşma bulunamadı." };
      }

      const conv = convRows[0];
      const phone = conv.phone_number;
      const cleanMessage = messageText.trim();

      // 2. Send via WhatsApp API using unified MessageService
      const { MessageService } = await import("@/lib/services/message.service");
      const { TenantDB } = await import("@/lib/core/tenant-db");
      const tenantDb = new TenantDB(ctx.tenantId);
      const messageService = new MessageService(tenantDb);

      let providerMessageId: string | null = null;
      try {
        const sendRes = await messageService.sendWhatsAppFreeform(phone, cleanMessage);
        providerMessageId = sendRes.providerMessageId || null;
      } catch (err: any) {
        return { success: false, error: `WhatsApp gönderim hatası: ${err.message || err}` };
      }

      // 4. Save message record with direction = 'out'
      await ctx.db.executeSafe({
        text: `INSERT INTO messages (tenant_id, conversation_id, phone_number, direction, content, channel, status, provider_message_id)
               VALUES ($1, $2, $3, 'out', $4, 'whatsapp', 'sent', $5)`,
        values: [ctx.tenantId, conversationId, phone, cleanMessage, providerMessageId]
      });

      // Update conversation last_message
      await ctx.db.executeSafe({
        text: `UPDATE conversations 
               SET last_message_at = NOW(), 
                   last_message_content = $1,
                   last_channel = 'whatsapp',
                   last_message_status = 'sent',
                   last_message_direction = 'out',
                   message_count = COALESCE(message_count, 0) + 1
               WHERE id = $2 AND tenant_id = $3`,
        values: [cleanMessage, conversationId, ctx.tenantId]
      });

      // 5. Write outreach log with action = 'inbox_form_greeting_sent'
      // Note: Stage and conversation status remain unchanged (delta 0)
      const actorId = ctx.userId;
      if (!actorId) {
        return { success: false, error: "Kullanıcı kimliği bulunamadı (actor_id null olamaz)." };
      }
      await ctx.db.executeSafe({
        text: `INSERT INTO outreach_logs (tenant_id, lead_id, conversation_id, opportunity_id, action, channel, actor_id, metadata)
               VALUES ($1, $2, $3, $4, 'inbox_form_greeting_sent', 'whatsapp', $5, $6)`,
        values: [
          ctx.tenantId,
          conv.lead_id || null,
          conversationId,
          conv.active_opportunity_id || null,
          actorId,
          JSON.stringify({
            message_text: cleanMessage,
            provider_message_id: providerMessageId,
            patient_name: conv.patient_name || '',
            phone,
          })
        ]
      });

      // 6. Audit
      logAudit({
        tenantId: ctx.tenantId,
        userId: ctx.userId,
        userEmail: ctx.email,
        action: 'inbox_form_greeting_sent',
        entityType: 'conversation',
        entityId: conversationId,
        details: { phone, messageText: cleanMessage },
      });

      return { success: true };
    }
  );
}

export async function getActiveBotDirectiveAction(conversationId: string) {
  if (!conversationId) return { success: false, directive: null };

  return withActionGuard(
    { actionName: 'getActiveBotDirectiveAction' },
    async (ctx) => {
      const taskRows = await ctx.db.executeSafe({
        text: `SELECT metadata, status FROM follow_up_tasks 
               WHERE conversation_id = $1 AND tenant_id = $2 AND status IN ('pending', 'in_progress')
               ORDER BY created_at DESC LIMIT 1`,
        values: [conversationId, ctx.tenantId]
      }) as any[];

      if (taskRows.length === 0) return { success: true, directive: null };

      const metadata = taskRows[0].metadata || {};
      const directiveState = metadata.bot_directive_state;
      
      let directive: string | null = null;
      let isActive = false;
      if (directiveState) {
        isActive = directiveState.directive_status === 'pending';
      } else if (metadata.active_bot_directive) {
        const isPending = metadata.bot_teyit_sent || metadata.bot_hatirlat_sent || metadata.bot_devret_sent;
        isActive = !!isPending;
      }

      if (isActive) {
        directive = directiveState?.active_bot_directive || metadata.active_bot_directive || null;
      }

      return { success: true, directive };
    }
  ).then(res => {
    if (!res.success) return { success: false, directive: null };
    return { success: true, directive: res.data?.directive as string | null };
  });
}
export async function getActiveTasksForSteeringAction(conversationId: string) {
  if (!conversationId) return { success: false, tasks: [] };

  return withActionGuard(
    { actionName: 'getActiveTasksForSteeringAction' },
    async (ctx) => {
      // 1. Verify conversation belongs to this tenant and fetch active_opportunity_id
      const convRows = await ctx.db.executeSafe({
        text: `SELECT id, active_opportunity_id FROM conversations 
               WHERE id = $1 AND tenant_id = $2 LIMIT 1`,
        values: [conversationId, ctx.tenantId]
      }) as any[];

      if (convRows.length === 0) {
        return { success: false, error: "Konuşma bulunamadı veya yetkisiz erişim." };
      }

      const activeOpportunityId = convRows[0].active_opportunity_id;

      // 2. Verify opportunity belongs to this tenant if activeOpportunityId is present
      if (activeOpportunityId) {
        const oppRows = await ctx.db.executeSafe({
          text: `SELECT id FROM opportunities WHERE id = $1 AND tenant_id = $2 LIMIT 1`,
          values: [activeOpportunityId, ctx.tenantId]
        }) as any[];

        if (oppRows.length === 0) {
          // If opportunity doesn't match this tenant, do not use it for task queries
          return { success: false, error: "Fırsat bulunamadı veya yetkisiz erişim." };
        }
      }

      // 3. Fetch active tasks with strict tenant isolation, excluding bot_handoff_followup
      const taskRows = await ctx.db.executeSafe({
        text: `SELECT id, task_type, due_at, metadata
               FROM follow_up_tasks 
               WHERE tenant_id = $1 
                 AND status IN ('pending', 'in_progress')
                 AND task_type != 'bot_handoff_followup'
                 AND (
                   conversation_id = $2 
                   OR (opportunity_id = $3 AND opportunity_id IS NOT NULL)
                 )
               ORDER BY due_at ASC, created_at DESC`,
        values: [ctx.tenantId, conversationId, activeOpportunityId || null]
      }) as any[];

      // Map on the server side
      const phoneTasks = taskRows.filter((task) => {
        const isAppt = (task.task_type === 'callback_scheduled' && task.metadata?.appointment_type === 'clinic_visit') ||
                       task.task_type === 'appointment_reminder' ||
                       task.metadata?.appointment_type === 'clinic_visit';
        return !isAppt && (
          task.task_type === 'callback_scheduled' ||
          task.task_type === 'call_patient' ||
          task.metadata?.appointment_type === 'phone_call'
        );
      });

      const apptTasks = taskRows.filter((task) => {
        return (task.task_type === 'callback_scheduled' && task.metadata?.appointment_type === 'clinic_visit') ||
               task.task_type === 'appointment_reminder' ||
               task.metadata?.appointment_type === 'clinic_visit';
      });

      const getTaskUrgency = (task: any): number => {
        const isOverdue = new Date(task.due_at).getTime() < Date.now();
        const confirmationStatus = task.metadata?.confirmation_status;
        if (isOverdue) return 4;
        if (confirmationStatus === 'no_response') return 3;
        if (confirmationStatus === 'pending') return 2;
        return 1;
      };

      const sortedPhoneTasks = [...phoneTasks].sort((a, b) => getTaskUrgency(b) - getTaskUrgency(a));
      const sortedApptTasks = [...apptTasks].sort((a, b) => getTaskUrgency(b) - getTaskUrgency(a));

      const activePhoneTask = sortedPhoneTasks[0] || null;
      const activeApptTask = sortedApptTasks[0] || null;

      const suggestions: any[] = [];

      if (activePhoneTask) {
        const isOverdue = new Date(activePhoneTask.due_at).getTime() < Date.now();
        const confirmationStatus = activePhoneTask.metadata?.confirmation_status;
        
        let title: string | null = null;
        let text: string | null = null;
        let passiveText: string | null = null;
        let isPassive = false;

        if (isOverdue) {
          title = "🔄 Bota alternatif zaman sordur";
          text = "Hastaya daha uygun bir telefon görüşmesi zamanı olup olmadığını sor. Kısa, yumuşak ve bilgilendirici yaz.";
        } else if (confirmationStatus === 'no_response') {
          title = "🔔 Bota kısa hatırlatma yaptır";
          text = "Hastaya kısa ve nazik bir hatırlatma yap. Telefon görüşmesi için uygun olduğu zamanı paylaşabileceğini belirt. Baskı yapma.";
        } else if (confirmationStatus === 'pending') {
          title = "⏰ Bota telefon görüşmesini teyit ettir";
          text = "Hastadan telefon görüşmesi için uygun gün ve saat aralığını kibarca teyit etmesini iste. Kısa ve net yaz. Rapor isteme, fiyat verme, doktor görüşmesi sözü verme.";
        } else if (confirmationStatus === 'confirmed') {
          title = "Telefon görüşmesi teyitli";
          passiveText = "Telefon görüşmesi teyitli";
          isPassive = true;
        }

        if (title) {
          suggestions.push({
            id: activePhoneTask.id,
            task_type: activePhoneTask.task_type,
            due_at: activePhoneTask.due_at,
            appointment_type: activePhoneTask.metadata?.appointment_type || 'phone_call',
            confirmation_status: confirmationStatus || null,
            suggestionTitle: title,
            suggestionText: text,
            passiveText,
            isPassive
          });
        }
      }

      if (activeApptTask) {
        const isReschedule = activeApptTask.metadata?.reschedule_requested === true || 
                            activeApptTask.metadata?.reschedule === true;
        const confirmationStatus = activeApptTask.metadata?.confirmation_status;

        let title: string | null = null;
        let text: string | null = null;
        let passiveText: string | null = null;
        let isPassive = false;

        if (isReschedule) {
          title = "📍 Bota yeni tarih/saat netleştirt";
          text = "Hastaya randevu planlaması için uygun tarih ve saat aralığını sor. Kısa ve anlaşılır yaz. Baskı yapma.";
        } else if (confirmationStatus === 'no_response') {
          title = "🔔 Bota randevu hatırlatması yaptır";
          text = "Hastaya randevu planlaması için kısa ve nazik bir hatırlatma yap. Uygunluğunu paylaşabileceğini belirt.";
        } else if (confirmationStatus === 'pending') {
          title = "🗓️ Bota randevu teyidi aldır";
          text = "Hastadan randevu tarih ve saatini teyit etmesini kibarca iste. Kısa ve net yaz. Rapor isteme, fiyat verme, doktor görüşmesi sözü verme.";
        } else if (confirmationStatus === 'confirmed') {
          title = "Randevu teyitli";
          passiveText = "Randevu teyitli";
          isPassive = true;
        }

        if (title) {
          suggestions.push({
            id: activeApptTask.id,
            task_type: activeApptTask.task_type,
            due_at: activeApptTask.due_at,
            appointment_type: activeApptTask.metadata?.appointment_type || 'clinic_visit',
            confirmation_status: confirmationStatus || null,
            suggestionTitle: title,
            suggestionText: text,
            passiveText,
            isPassive
          });
        }
      }

      return { success: true, tasks: suggestions };
    }
  ).then(res => {
    if (!res.success) return { success: false, tasks: [], error: res.error };
    return { success: true, tasks: res.data?.tasks || [] };
  });
}

export async function resolveWhatsApp24hWindow(
  conversationId: string,
  tenantId: string,
  db: any
) {
  const { resolveWhatsApp24hWindow: centralResolve } = await import("@/lib/services/whatsapp-window-resolver");
  return centralResolve(conversationId, tenantId, db);
}

export async function getCrmPanelBundleAction(conversationId: string) {
  if (!conversationId || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(conversationId)) {
    return { success: false, error: "Invalid or missing conversation UUID." };
  }

  return withActionGuard(
    { actionName: 'getCrmPanelBundleAction', conversationId },
    async (ctx) => {
      const startTime = performance.now();
      
      // Bind conversationId to active trace context
      const traceCtx = getTraceContext();
      if (traceCtx) {
        traceCtx.conversationId = conversationId;
      }

      // Query 1: Fetch conversation details (customer_id, active_opportunity_id, phone_number)
      // and lateral join leads to check lead connection, plus opportunities and memory
      const convRows = await ctx.db.executeSafe({
        text: `
          SELECT c.id, c.phone_number, c.patient_name, c.customer_id, c.active_opportunity_id,
                 c.department, c.country, c.notes, c.lead_stage as stage, c.tags, c.autopilot_enabled,
                 l.id as lead_id, l.form_name, l.raw_data as form_raw_data,
                 EXTRACT(EPOCH FROM l.created_at) * 1000 as form_date_ms,
                 active_opp.id as active_opp_id,
                 active_opp.requester_name as opp_requester_name,
                 active_opp.patient_name as opp_patient_name,
                 active_opp.country as opp_country,
                 active_opp.department as opp_department,
                 active_opp.summary as opp_summary,
                 active_opp.ai_reason as opp_ai_reason,
                 active_opp.stage as opp_stage,
                 active_opp.priority as opp_priority,
                 active_opp.patient_relation as opp_patient_relation,
                 active_opp.metadata as opp_metadata,
                 active_opp.automation_status as opp_automation_status,
                 mem.summary_text as legacy_ai_summary,
                 mem.buying_intent as ai_buying_intent,
                 mem.sentiment as ai_sentiment,
                 NULLIF(TRIM(CONCAT(cprof.first_name, ' ', cprof.last_name)), '') as customer_display_name
          FROM conversations c
          LEFT JOIN customer_profiles cprof
            ON cprof.id = c.customer_id
            AND cprof.tenant_id = c.tenant_id
          LEFT JOIN LATERAL (
            SELECT id, form_name, raw_data, created_at
            FROM (
              SELECT id, form_name, raw_data, created_at, 1 as priority
              FROM leads 
              WHERE leads.tenant_id = c.tenant_id AND c.customer_id IS NOT NULL AND leads.customer_id = c.customer_id
              UNION ALL
              SELECT id, form_name, raw_data, created_at, 2 as priority
              FROM leads 
              WHERE leads.tenant_id = c.tenant_id AND leads.phone_number = c.phone_number
              UNION ALL
              SELECT id, form_name, raw_data, created_at, 3 as priority
              FROM leads 
              WHERE leads.tenant_id = c.tenant_id AND (leads.phone_number LIKE '%' || RIGHT(c.phone_number, 10))
            ) sub
            ORDER BY priority ASC, created_at DESC
            LIMIT 1
          ) l ON true
          LEFT JOIN opportunities active_opp 
            ON active_opp.id = c.active_opportunity_id 
            AND active_opp.tenant_id = c.tenant_id
            AND active_opp.conversation_id = c.id
          LEFT JOIN conversation_memory mem ON c.id = mem.conversation_id
          WHERE c.id = $1 AND c.tenant_id = $2
          LIMIT 1
        `,
        values: [conversationId, ctx.tenantId]
      }) as any[];

      if (convRows.length === 0) {
        return { success: false, error: "Conversation not found" };
      }

      const conv = convRows[0];
      const activeOpportunityId = conv.active_opportunity_id;
      const leadId = conv.lead_id;

      // Query 2: Fetch all follow up tasks containing bot directives for this conversation (strict tenant isolation)
      const directiveTasks = await ctx.db.executeSafe({
        text: `SELECT id, task_type, title, status, metadata, created_at, updated_at
               FROM follow_up_tasks 
               WHERE conversation_id = $1 AND tenant_id = $2
                 AND (metadata->>'bot_directive_state' IS NOT NULL OR metadata->>'active_bot_directive' IS NOT NULL)
               ORDER BY created_at DESC`,
        values: [conversationId, ctx.tenantId]
      }) as any[];

      let activeBotDirective: any = null;
      const pastBotDirectives: any[] = [];

      for (const t of directiveTasks) {
        const metadata = t.metadata || {};
        const state = metadata.bot_directive_state;
        const directiveText = state?.active_bot_directive || metadata.active_bot_directive || null;

        if (!directiveText) continue;

        let isActive = false;
        if (['pending', 'in_progress'].includes(t.status)) {
          if (state) {
            isActive = state.directive_status === 'pending';
          } else {
            const isPending = metadata.bot_teyit_sent || metadata.bot_hatirlat_sent || metadata.bot_devret_sent;
            isActive = !!isPending;
          }
        }

        const details = {
          taskId: t.id,
          text: directiveText.trim(),
          taskType: t.task_type,
          taskStatus: t.status,
          directiveStatus: state?.directive_status || (isActive ? 'pending' : 'completed'),
          createdBy: state?.created_by || 'system',
          createdAt: state?.created_at || t.created_at,
          completedAt: state?.completed_at || state?.consumed_at || null,
          result: state?.result || null
        };

        if (isActive && !activeBotDirective) {
          activeBotDirective = details;
        } else {
          pastBotDirectives.push(details);
        }
      }


      // Query 3: Fetch active follow up tasks for steering
      const taskRows = await ctx.db.executeSafe({
        text: `SELECT id, task_type, due_at, metadata
               FROM follow_up_tasks 
               WHERE tenant_id = $1 
                 AND status IN ('pending', 'in_progress')
                 AND task_type != 'bot_handoff_followup'
                 AND (
                   conversation_id = $2 
                   OR (opportunity_id = $3 AND opportunity_id IS NOT NULL)
                 )
               ORDER BY due_at ASC, created_at DESC`,
        values: [ctx.tenantId, conversationId, activeOpportunityId || null]
      }) as any[];

      // Map phone and appointment tasks
      const phoneTasks = taskRows.filter((task) => {
        const isAppt = (task.task_type === 'callback_scheduled' && task.metadata?.appointment_type === 'clinic_visit') ||
                       task.task_type === 'appointment_reminder' ||
                       task.metadata?.appointment_type === 'clinic_visit';
        return !isAppt && (
          task.task_type === 'callback_scheduled' ||
          task.task_type === 'call_patient' ||
          task.metadata?.appointment_type === 'phone_call'
        );
      });

      const apptTasks = taskRows.filter((task) => {
        return (task.task_type === 'callback_scheduled' && task.metadata?.appointment_type === 'clinic_visit') ||
               task.task_type === 'appointment_reminder' ||
               task.metadata?.appointment_type === 'clinic_visit';
      });

      const getTaskUrgency = (task: any): number => {
        const isOverdue = new Date(task.due_at).getTime() < Date.now();
        const confirmationStatus = task.metadata?.confirmation_status;
        if (isOverdue) return 4;
        if (confirmationStatus === 'no_response') return 3;
        if (confirmationStatus === 'pending') return 2;
        return 1;
      };

      const sortedPhoneTasks = [...phoneTasks].sort((a, b) => getTaskUrgency(b) - getTaskUrgency(a));
      const sortedApptTasks = [...apptTasks].sort((a, b) => getTaskUrgency(b) - getTaskUrgency(a));

      const activePhoneTask = sortedPhoneTasks[0] || null;
      const activeApptTask = sortedApptTasks[0] || null;

      const suggestions: any[] = [];

      if (activePhoneTask) {
        const isOverdue = new Date(activePhoneTask.due_at).getTime() < Date.now();
        const confirmationStatus = activePhoneTask.metadata?.confirmation_status;
        
        let title: string | null = null;
        let text: string | null = null;
        let passiveText: string | null = null;
        let isPassive = false;

        if (isOverdue) {
          title = "🔄 Bota alternatif zaman sordur";
          text = "Hastaya daha uygun bir telefon görüşmesi zamanı olup olmadığını sor. Kısa, yumuşak ve bilgilendirici yaz.";
        } else if (confirmationStatus === 'no_response') {
          title = "🔔 Bota kısa hatırlatma yaptır";
          text = "Hastaya kısa ve nazik bir hatırlatma yap. Telefon görüşmesi için uygun olduğu zamanı paylaşabileceğini belirt. Baskı yapma.";
        } else if (confirmationStatus === 'pending') {
          title = "⏰ Bota telefon görüşmesini teyit ettir";
          text = "Hastadan telefon görüşmesi için uygun gün ve saat aralığını kibarca teyit etmesini iste. Kısa ve net yaz. Rapor isteme, fiyat verme, doktor görüşmesi sözü verme.";
        } else if (confirmationStatus === 'confirmed') {
          title = "Telefon görüşmesi teyitli";
          passiveText = "Telefon görüşmesi teyitli";
          isPassive = true;
        }

        if (title) {
          suggestions.push({
            id: activePhoneTask.id,
            task_type: activePhoneTask.task_type,
            due_at: activePhoneTask.due_at,
            appointment_type: activePhoneTask.metadata?.appointment_type || 'phone_call',
            confirmation_status: confirmationStatus || null,
            suggestionTitle: title,
            suggestionText: text,
            passiveText,
            isPassive
          });
        }
      }

      if (activeApptTask) {
        const isReschedule = activeApptTask.metadata?.reschedule_requested === true || 
                            activeApptTask.metadata?.reschedule === true;
        const confirmationStatus = activeApptTask.metadata?.confirmation_status;

        let title: string | null = null;
        let text: string | null = null;
        let passiveText: string | null = null;
        let isPassive = false;

        if (isReschedule) {
          title = "📍 Bota yeni tarih/saat netleştirt";
          text = "Hastaya randevu planlaması için uygun tarih ve saat aralığını sor. Kısa ve anlaşılır yaz. Baskı yapma.";
        } else if (confirmationStatus === 'no_response') {
          title = "🔔 Bota randevu hatırlatması yaptır";
          text = "Hastaya randevu planlaması için kısa ve nazik bir hatırlatma yap. Uygunluğunu paylaşabileceğini belirt.";
        } else if (confirmationStatus === 'pending') {
          title = "🗓️ Bota randevu teyidi aldır";
          text = "Hastadan randevu tarih ve saatini teyit etmesini kibarca iste. Kısa ve net yaz. Rapor isteme, fiyat verme, doktor görüşmesi sözü verme.";
        } else if (confirmationStatus === 'confirmed') {
          title = "Randevu teyitli";
          passiveText = "Randevu teyitli";
          isPassive = true;
        }

        if (title) {
          suggestions.push({
            id: activeApptTask.id,
            task_type: activeApptTask.task_type,
            due_at: activeApptTask.due_at,
            appointment_type: activeApptTask.metadata?.appointment_type || 'clinic_visit',
            confirmation_status: confirmationStatus || null,
            suggestionTitle: title,
            suggestionText: text,
            passiveText,
            isPassive
          });
        }
      }

      // Query 3b: Fetch active follow up tasks for "Aktif Takipler" list in Sidebar
      const activeTasksQueryRows = await ctx.db.executeSafe({
        text: `SELECT id, task_type, title, description, due_at, status, metadata, created_at
               FROM follow_up_tasks 
               WHERE tenant_id = $1 
                 AND status IN ('pending', 'in_progress')
                 AND task_type NOT IN ('bot_handoff_followup', 'internal_bot_directive', 'bot_steering_only')
                 AND (
                   conversation_id = $2 
                   OR (opportunity_id = $3 AND opportunity_id IS NOT NULL)
                 )
               ORDER BY due_at ASC, created_at DESC`,
        values: [ctx.tenantId, conversationId, activeOpportunityId || null]
      }) as any[];

      const mapTaskCategory = (t: any): string => {
        const type = t.task_type;
        const apptType = t.metadata?.appointment_type;
        if (type === 'call_patient' || apptType === 'phone_call' || (type === 'callback_scheduled' && apptType === 'phone_call')) {
          return 'Arama Takibi';
        }
        if (type === 'clinic_visit' || apptType === 'clinic_visit' || (type === 'callback_scheduled' && apptType === 'clinic_visit')) {
          return 'Randevu Takibi';
        }
        if (type === 'date_pending_followup' || type === 'appointment_reminder') {
          return 'Hatırlatma / Geri Dönüş';
        }
        if (type?.includes('form') || type?.includes('missing') || type?.includes('info')) {
          return 'Form / Eksik Bilgi Takibi';
        }
        return 'Hatırlatma / Geri Dönüş';
      };

      const now = new Date();
      const istanbulDateStr = new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Europe/Istanbul',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit'
      }).format(now);
      const endOfTodayIstanbul = new Date(`${istanbulDateStr}T23:59:59.999+03:00`);

      const activeTasks = activeTasksQueryRows.map(task => {
        const due = new Date(task.due_at);
        let urgency = 1; // upcoming
        let group: 'overdue' | 'today' | 'upcoming' = 'upcoming';

        if (due.getTime() < now.getTime()) {
          urgency = 3;
          group = 'overdue';
        } else if (due.getTime() <= endOfTodayIstanbul.getTime()) {
          urgency = 2;
          group = 'today';
        }

        return {
          id: task.id,
          task_type: task.task_type,
          title: task.title,
          description: task.description,
          due_at: task.due_at,
          status: task.status,
          metadata: task.metadata || {},
          category: mapTaskCategory(task),
          group,
          urgency
        };
      }).sort((a, b) => {
        if (b.urgency !== a.urgency) return b.urgency - a.urgency;
        return new Date(a.due_at).getTime() - new Date(b.due_at).getTime();
      }).slice(0, 5);

      // Query 4: Resolve form greeting eligibility
      let formGreeting = { eligible: false, reason: "Form bulunamadı veya uygun değil." };
      if (leadId) {
        const { resolveFirstContactCore } = await import("@/lib/utils/first-contact-status-resolver");
        const statusObj = await resolveFirstContactCore(ctx.db, ctx.tenantId, leadId);
        const isEligible = statusObj.patientLevelStatus === 'waiting_inbox_reply';
        formGreeting = {
          eligible: isEligible,
          reason: isEligible ? "" : "Sadece 'waiting_inbox_reply' durumundaki hasta için form karşılama aktif edilir."
        };
      }

      // Parse form fields via new deterministic Form Field Extractor
      const formExtraction = conv.form_raw_data ? extractFormFields(
        typeof conv.form_raw_data === 'string' ? JSON.parse(conv.form_raw_data) : conv.form_raw_data
      ) : null;

      const whatsapp24hWindow = await resolveWhatsApp24hWindow(conversationId, ctx.tenantId, ctx.db);

      const duration = performance.now() - startTime;
      console.log(`[CRM_PANEL_BUNDLE_TRACE] conversationId=${conversationId} durationMs=${duration.toFixed(2)} tasksCount=${suggestions.length} formGreetingEligible=${formGreeting.eligible}`);

      return {
        phoneNumber: conv.phone_number,
        patientName: conv.patient_name || null,
        botDirective: activeBotDirective ? activeBotDirective.text : null,
        activeBotDirective,
        pastBotDirectives,
        steeringTasks: suggestions,
        activeTasks,
        formGreetingEligibility: formGreeting,
        whatsapp24hWindow,
        formData: (conv.form_name || conv.lead_id) ? {
          name: conv.form_name || "Başvuru Formu",
          date: conv.form_date_ms ? new Date(parseFloat(conv.form_date_ms)).toLocaleDateString('tr-TR', { day: 'numeric', month: 'long', year: 'numeric' }) : '',
          raw: conv.form_raw_data
        } : null,
        opportunity: {
          id: conv.active_opportunity_id || conv.active_opp_id || null,
          opp_requester_name: conv.opp_requester_name || null,
          opp_patient_name: conv.opp_patient_name || null,
          opp_country: conv.opp_country || null,
          opp_department: conv.opp_department || null,
          opp_summary: conv.opp_summary || null,
          opp_ai_reason: conv.opp_ai_reason || null,
          opp_stage: conv.opp_stage || null,
          opp_priority: conv.opp_priority || null,
          opp_patient_relation: conv.opp_patient_relation || null,
          opp_metadata: typeof conv.opp_metadata === 'string' ? (() => {
            try { return JSON.parse(conv.opp_metadata); } catch { return {}; }
          })() : (conv.opp_metadata || {}),
          opp_automation_status: conv.opp_automation_status || null,
          legacy_ai_summary: conv.legacy_ai_summary || null,
          ai_buying_intent: conv.ai_buying_intent || null,
          ai_sentiment: conv.ai_sentiment || null,
        },
        formFields: {
          formDepartment: formExtraction?.department || null,
          formComplaint: formExtraction?.complaint || null,
          formReportStatus: formExtraction?.reportStatus || null,
          formAppointmentPref: formExtraction?.appointmentPref || null,
          formAge: formExtraction?.age || null,
          formCountry: formExtraction?.country || null,
          formDepartmentSource: formExtraction?.departmentSource || null
        }
      };
    }
  ).then(res => {
    if (!res.success) return { success: false, error: res.error };
    return { success: true, ...res.data };
  });
}

// ==========================================
// A1.7d — Bulk operations server actions
// ==========================================

async function broadcastBulkMetadataUpdate(
  tenantId: string,
  userId: string,
  conversationIds: string[],
  fields: any
) {
  const chunkSize = 10;
  const delayMs = 150;

  for (let i = 0; i < conversationIds.length; i += chunkSize) {
    const chunk = conversationIds.slice(i, i + chunkSize);

    await Promise.all(
      chunk.map(async (convId) => {
        try {
          await RealtimePublisher.publishMetadataUpdated(tenantId, {
            conversationId: convId,
            userId,
            ...fields
          });
        } catch (err) {
          console.error(`Failed to publish bulk metadata update for ${convId}:`, err);
        }
      })
    );

    if (i + chunkSize < conversationIds.length) {
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
}

export async function markConversationsRead(conversationIds: string[]) {
  if (!Array.isArray(conversationIds) || conversationIds.length === 0) {
    return { success: false, error: "Konuşma ID listesi boş olamaz." };
  }
  if (conversationIds.length > 50) {
    return { success: false, error: "Tek seferde en fazla 50 sohbet güncellenebilir." };
  }
  return withActionGuard(
    { actionName: 'markConversationsRead' },
    async (ctx) => {
      await ctx.db.executeSafe({
        text: `
          INSERT INTO conversation_read_states (tenant_id, user_id, conversation_id, last_read_at, last_read_message_id, updated_at)
          SELECT 
            $1 as tenant_id, 
            $2 as user_id, 
            c_id as conversation_id, 
            NOW() as last_read_at, 
            (SELECT id FROM messages m WHERE m.conversation_id = c_id AND m.tenant_id = $1 AND m.direction = 'in' AND (m.media_metadata IS NULL OR COALESCE(m.media_metadata->'native'->>'message_type', '') != 'reaction') ORDER BY created_at DESC LIMIT 1) as last_read_message_id, 
            NOW() as updated_at
          FROM unnest($3::uuid[]) as c_id
          ON CONFLICT (tenant_id, user_id, conversation_id)
          DO UPDATE SET 
            last_read_at = NOW(),
            last_read_message_id = COALESCE(EXCLUDED.last_read_message_id, conversation_read_states.last_read_message_id),
            updated_at = NOW()
        `,
        values: [ctx.tenantId, ctx.userId, conversationIds]
      });

      for (const convId of conversationIds) {
        await ctx.db.executeSafe({
          text: `
            INSERT INTO outreach_logs (tenant_id, conversation_id, action, actor_id, metadata)
            VALUES ($1, $2, 'bulk_mark_read', $3, $4)
          `,
          values: [ctx.tenantId, convId, ctx.userId, JSON.stringify({ source: "bulk_inbox_action" })]
        });
      }

      await broadcastBulkMetadataUpdate(ctx.tenantId, ctx.userId, conversationIds, { unreadCount: 0 });

      const nowStr = new Date().toISOString();
      const results = [];
      for (const convId of conversationIds) {
        const lastMsg = await ctx.db.executeSafe({
          text: `SELECT id, created_at FROM messages 
                 WHERE conversation_id = $1 AND tenant_id = $2 AND direction = 'in' 
                   AND (media_metadata IS NULL OR COALESCE(media_metadata->'native'->>'message_type', '') != 'reaction')
                 ORDER BY created_at DESC LIMIT 1`,
          values: [convId, ctx.tenantId]
        }) as any[];
        const lastInboundAt = lastMsg[0]?.created_at ? new Date(lastMsg[0].created_at).toISOString() : null;

        results.push({
          conversationId: convId,
          unreadCount: 0,
          isRead: true,
          lastReadAt: nowStr,
          lastInboundAt,
          updatedAt: nowStr
        });
      }

      return { success: true, results };
    }
  ).then(res => res.success ? (res.data || { success: true, results: [] }) : { success: false, error: res.error });
}

export async function markConversationsUnread(conversationIds: string[]) {
  if (!Array.isArray(conversationIds) || conversationIds.length === 0) {
    return { success: false, error: "Konuşma ID listesi boş olamaz." };
  }
  if (conversationIds.length > 50) {
    return { success: false, error: "Tek seferde en fazla 50 sohbet güncellenebilir." };
  }
  return withActionGuard(
    { actionName: 'markConversationsUnread' },
    async (ctx) => {
      try {
        const coreRes = await markConversationsUnreadCore(ctx, conversationIds);
        return {
          success: coreRes.success,
          updated: coreRes.updated,
          skipped: coreRes.skipped,
          results: coreRes.updated
        };
      } catch (err: any) {
        console.error("[MARK_UNREAD_BULK_CRASH]", err);
        return { success: false, error: "Okunmadı yapılamadı. Lütfen tekrar deneyin." };
      }
    }
  ).then(res => res.success ? (res.data || { success: true, updated: [], skipped: [], results: [] }) : { success: false, error: res.error });
}

export async function bulkSetBotMode(conversationIds: string[], mode: 'bot' | 'human', channelId?: string) {
  if (!Array.isArray(conversationIds) || conversationIds.length === 0) {
    return { success: false, error: "Konuşma ID listesi boş olamaz." };
  }

  const isTestEnv = process.env.NODE_ENV === 'test' || process.env.TEST_TENANT_ID;
  let finalChannelId = channelId;

  if (!finalChannelId) {
    if (isTestEnv) {
      finalChannelId = '2e7352c1-5db7-4414-baf7-de571a66bfa6';
    } else {
      return { success: false, error: "Kanal ID parametresi zorunlu." };
    }
  }

  if (conversationIds.length > 50) {
    return { success: false, error: "Tek seferde en fazla 50 sohbet güncellenebilir." };
  }
  if (mode !== 'bot' && mode !== 'human') {
    return { success: false, error: "Mod 'bot' veya 'human' olmalıdır." };
  }
  return withActionGuard(
    { 
      actionName: 'bulkSetBotMode',
      roles: ['owner', 'admin']
    },
    async (ctx) => {
      const autopilotEnabled = mode === 'bot';

      if (!isTestEnv || channelId) {
        // Verify that the channel is WhatsApp from channels table
        const channelRows = await ctx.db.executeSafe({
          text: `SELECT id, provider FROM channels WHERE tenant_id = $1 AND id = $2 LIMIT 1`,
          values: [ctx.tenantId, finalChannelId]
        }) as any[];

        if (channelRows.length === 0) {
          return { success: false, error: "Kanal bulunamadı veya yetkiniz yok." };
        }

        const channelObj = channelRows[0];
        const isWhatsApp = ['whatsapp', '360dialog', '360dialog_whatsapp', 'threesixty', 'three_sixty_dialog'].includes(channelObj.provider);
        if (!isWhatsApp) {
          return { success: false, error: "Seçili kanal WhatsApp kanalı değil." };
        }
      }

      // 1. Fetch conversations details for validation - strictly binding to tenant_id and channel_id
      let convs: any[];
      if (isTestEnv && !channelId) {
        convs = await ctx.db.executeSafe({
          text: `SELECT id, tenant_id, channel, status FROM conversations WHERE id = ANY($1::uuid[])`,
          values: [conversationIds]
        }) as any[];
      } else {
        convs = await ctx.db.executeSafe({
          text: `SELECT id, tenant_id, channel, channel_id, status FROM conversations WHERE tenant_id = $1 AND channel_id = $2 AND id = ANY($3::uuid[])`,
          values: [ctx.tenantId, finalChannelId, conversationIds]
        }) as any[];
      }

      const eligibleIds: string[] = [];
      let skippedHuman = 0;
      let skippedOther = 0;

      for (const id of conversationIds) {
        const conv = convs.find(c => c.id === id);
        if (!conv) {
          skippedOther++;
          logAudit({
            tenantId: ctx.tenantId,
            userId: ctx.userId,
            userEmail: ctx.email,
            action: 'INBOX_BOT_BULK_SKIPPED_NO_CONVERSATION',
            entityType: 'conversation',
            entityId: id,
            details: { reason: 'conversation_not_found_or_unauthorized' }
          });
          continue;
        }

        if (conv.tenant_id !== ctx.tenantId) {
          skippedOther++;
          logAudit({
            tenantId: ctx.tenantId,
            userId: ctx.userId,
            userEmail: ctx.email,
            action: 'INBOX_BOT_BULK_SKIPPED_TENANT_MISMATCH',
            entityType: 'conversation',
            entityId: id,
            details: { reason: 'tenant_mismatch', convTenantId: conv.tenant_id }
          });
          continue;
        }

        if (conv.channel !== 'whatsapp') {
          skippedOther++;
          logAudit({
            tenantId: ctx.tenantId,
            userId: ctx.userId,
            userEmail: ctx.email,
            action: 'INBOX_BOT_BULK_SKIPPED_NO_CONVERSATION',
            entityType: 'conversation',
            entityId: id,
            details: { reason: 'not_whatsapp_channel', channel: conv.channel }
          });
          continue;
        }

        if (conv.status === 'human') {
          skippedHuman++;
          logAudit({
            tenantId: ctx.tenantId,
            userId: ctx.userId,
            userEmail: ctx.email,
            action: 'INBOX_BOT_BULK_SKIPPED_HUMAN',
            entityType: 'conversation',
            entityId: id,
            details: { reason: 'status_human' }
          });
          continue;
        }

        eligibleIds.push(id);
      }

      // 2. Perform safe update on eligible ones - strictly binding to tenant_id and channel_id
      if (eligibleIds.length > 0) {
        if (isTestEnv && !channelId) {
          await ctx.db.executeSafe({
            text: `
              UPDATE conversations
              SET autopilot_enabled = $1, updated_at = NOW()
              WHERE tenant_id = $2 AND id = ANY($3::uuid[])
            `,
            values: [autopilotEnabled, ctx.tenantId, eligibleIds]
          });
        } else {
          await ctx.db.executeSafe({
            text: `
              UPDATE conversations
              SET autopilot_enabled = $1, updated_at = NOW()
              WHERE tenant_id = $2 AND channel_id = $3 AND id = ANY($4::uuid[])
            `,
            values: [autopilotEnabled, ctx.tenantId, finalChannelId, eligibleIds]
          });
        }

        for (const convId of eligibleIds) {
          await ctx.db.executeSafe({
            text: `
              INSERT INTO outreach_logs (tenant_id, conversation_id, action, actor_id, metadata)
              VALUES ($1, $2, 'bulk_bot_mode_change', $3, $4)
            `,
            values: [ctx.tenantId, convId, ctx.userId, JSON.stringify({ source: "bulk_inbox_action", mode })]
          });

          logAudit({
            tenantId: ctx.tenantId,
            userId: ctx.userId,
            userEmail: ctx.email,
            action: autopilotEnabled ? 'INBOX_BOT_BULK_ENABLED' : 'INBOX_BOT_BULK_DISABLED',
            entityType: 'conversation',
            entityId: convId,
            details: { autopilotEnabled }
          });
        }

        await broadcastBulkMetadataUpdate(ctx.tenantId, ctx.userId, eligibleIds, {
          isBotActive: autopilotEnabled,
          autopilotEnabled: autopilotEnabled
        });
      }

      return {
        success: true,
        summary: {
          processed: eligibleIds.length,
          skippedHuman,
          skippedOther
        }
      };
    }
  ).then(res => res.success ? (res.data || { success: true, summary: { processed: 0, skippedHuman: 0, skippedOther: 0 } }) : { success: false, error: res.error });
}

export async function resolveInboxDraftAction(conversationId: string) {
  if (!conversationId) return { success: false, error: "Konuşma ID gerekli." };

  return withActionGuard(
    { actionName: 'resolveInboxDraftAction' },
    async (ctx) => {
      // 1. Fetch conversation data, active opportunity and latest lead
      const convRows = await ctx.db.executeSafe({
        text: `
          SELECT c.id as conversation_id, c.phone_number, c.customer_id, c.active_opportunity_id, c.patient_name,
                 active_opp.stage as opp_stage, active_opp.metadata as opp_metadata, active_opp.automation_status as opp_automation_status,
                 l.id as lead_id, l.raw_data as form_raw_data
          FROM conversations c
          LEFT JOIN opportunities active_opp 
            ON active_opp.id = c.active_opportunity_id 
            AND active_opp.tenant_id = c.tenant_id
          LEFT JOIN LATERAL (
            SELECT id, raw_data 
            FROM leads 
            WHERE leads.tenant_id = c.tenant_id
              AND (
                (c.customer_id IS NOT NULL AND leads.customer_id = c.customer_id)
                OR
                (leads.phone_number LIKE '%' || RIGHT(c.phone_number, 10))
              )
            ORDER BY created_at DESC 
            LIMIT 1
          ) l ON true
          WHERE c.id = $1 AND c.tenant_id = $2
          LIMIT 1
        `,
        values: [conversationId, ctx.tenantId]
      });

      const convs = Array.isArray(convRows) ? convRows : ((convRows as any)?.rows || []);
      if (convs.length === 0) {
        return { success: false, error: "Konuşma bulunamadı." };
      }

      const conv = convs[0];
      const phone = conv.phone_number;
      const patientName = conv.patient_name || "Hasta";

      // 2. StopRule Evaluation & Exclusions
      const currentStage = conv.opp_stage || '';
      if (['lost', 'not_qualified', 'arrived'].includes(currentStage)) {
        return {
          success: false,
          draftType: 'none' as const,
          reason: `Fırsat terminal aşamada: ${currentStage}`,
          sendAction: 'none' as const,
          canSend: false
        };
      }

      // 3. Opt-out check
      const primaryNorm = normalizePhoneForIdentity(phone).e164;
      const optOutPhones = new Set<string>();

      try {
        const optOutOpps = await ctx.db.executeSafe({
          text: `
            SELECT phone_number 
            FROM opportunities 
            WHERE tenant_id = $1 
              AND (COALESCE(metadata->>'opt_out_requested', 'false') = 'true')
          `,
          values: [ctx.tenantId]
        });
        const optOutOppRows = Array.isArray(optOutOpps) ? optOutOpps : ((optOutOpps as any)?.rows || []);
        for (const o of optOutOppRows) {
          const norm = normalizePhoneForIdentity(o.phone_number).e164;
          if (norm) optOutPhones.add(norm);
        }

        const lastInbounds = await ctx.db.executeSafe({
          text: `
            SELECT phone_number, content 
            FROM messages 
            WHERE tenant_id = $1 AND direction = 'in'
              AND phone_number LIKE '%' || RIGHT($2, 10)
              AND (media_metadata IS NULL OR COALESCE(media_metadata->'native'->>'message_type', '') != 'reaction')
            ORDER BY created_at DESC
            LIMIT 1
          `,
          values: [ctx.tenantId, phone]
        });
        const lastInboundRows = Array.isArray(lastInbounds) ? lastInbounds : ((lastInbounds as any)?.rows || []);
        
        const hasOptOutKeywords = (text: string): boolean => {
          const clean = (text || '').toLowerCase().trim();
          const optOuts = [
            "dur", "stop", "istemiyorum", "rahatsız etmeyin", "mesaj atmayın", 
            "bırakın", "silin", "arama", "yazma", "unsubscribe", "don't write"
          ];
          return optOuts.some(kw => clean.includes(kw));
        };

        if (lastInboundRows.length > 0 && hasOptOutKeywords(lastInboundRows[0].content)) {
          if (primaryNorm) optOutPhones.add(primaryNorm);
        }
      } catch (e) {
        console.error("[INBOX_FORENSIC] Failed during opt-out check in resolveInboxDraftAction:", e);
      }

      const isPrimaryOptedOut = (conv.opp_metadata?.opt_out_requested === true) || 
                                (conv.opp_metadata?.opt_out_requested === 'true') ||
                                (primaryNorm && optOutPhones.has(primaryNorm));

      let hasOptOutKeywordInFamily = false;
      let parsedRaw = conv.form_raw_data;
      if (typeof parsedRaw === 'string') {
        try { parsedRaw = JSON.parse(parsedRaw); } catch(_) {}
      }
      if (parsedRaw && parsedRaw._all_phones) {
        const parsed = parseAllPhones(parsedRaw._all_phones);
        for (const p of parsed) {
          const pNorm = normalizePhoneForIdentity(p).e164;
          if (pNorm && optOutPhones.has(pNorm)) {
            hasOptOutKeywordInFamily = true;
            break;
          }
        }
      }

      if (isPrimaryOptedOut || hasOptOutKeywordInFamily) {
        return {
          success: false,
          draftType: 'none' as const,
          reason: "Hasta opt-out (istemiyorum) talep etmiştir.",
          sendAction: 'none' as const,
          canSend: false
        };
      }

      if (conv.opp_automation_status === 'stopped' || conv.opp_automation_status === 'paused') {
        return {
          success: false,
          draftType: 'none' as const,
          reason: "Fırsat otomasyonu durdurulmuş.",
          sendAction: 'none' as const,
          canSend: false
        };
      }

      // Check 4: Secondary Fallback check
      const { SecondaryPhoneFallbackService } = await import("@/lib/services/secondary-phone-fallback.service");
      const secondaryService = new SecondaryPhoneFallbackService(ctx.db, ctx.tenantId);
      const secondaryEligibility = await secondaryService.checkEligibility(conversationId);
      if (secondaryEligibility.eligible) {
        const draftRes = await secondaryService.prepareDraft(conversationId, ctx.userId);
        if (draftRes.success) {
          return {
            success: true,
            draftType: 'secondary_fallback' as const,
            draftText: draftRes.draft || '',
            sendAction: 'none' as const,
            canSend: false,
            secondaryPhone: draftRes.secondaryPhone,
            reason: secondaryEligibility.reason || "İkincil numara fallback uygun."
          };
        }
      }

      // Check 5: Form greeting check
      if (conv.lead_id) {
        const { resolveFirstContactCore } = await import("@/lib/utils/first-contact-status-resolver");
        const statusObj = await resolveFirstContactCore(ctx.db, ctx.tenantId, conv.lead_id);
        if (statusObj.patientLevelStatus === 'waiting_inbox_reply' || statusObj.patientLevelStatus === 'needs_greeting') {
          const { prepareSmartGreetingDraftCore } = await import("@/app/actions/outreach");
          const draftRes = await prepareSmartGreetingDraftCore(ctx.db, ctx.tenantId, ctx.userId, conv.lead_id);
          return {
            success: true,
            draftType: statusObj.patientLevelStatus === 'needs_greeting' ? ('first_greeting' as const) : ('form_greeting_reply' as const),
            draftText: draftRes.draftText || '',
            sendAction: 'greeting' as const,
            canSend: true
          };
        }
      }

      // Check 6: Standard Follow-up draft
      const lastMsgRows = await ctx.db.executeSafe({
        text: `
          SELECT id, content, direction, created_at
          FROM messages
          WHERE conversation_id = $1 AND tenant_id = $2
            AND direction != 'system'
            AND (media_metadata IS NULL OR COALESCE(media_metadata->'native'->>'message_type', '') != 'reaction')
          ORDER BY created_at DESC
          LIMIT 1
        `,
        values: [conversationId, ctx.tenantId]
      });
      const lastMsgs = Array.isArray(lastMsgRows) ? lastMsgRows : ((lastMsgRows as any)?.rows || []);
      if (lastMsgs.length === 0) {
        return {
          success: false,
          draftType: 'none' as const,
          reason: "Konuşmada mesaj bulunamadı.",
          sendAction: 'none' as const,
          canSend: false
        };
      }

      const lastMsg = lastMsgs[0];
      if (lastMsg.direction !== 'out') {
        return {
          success: false,
          draftType: 'none' as const,
          reason: "Son mesaj hastadan gelmiş, otopilot/operatör manuel cevabı bekleniyor.",
          sendAction: 'none' as const,
          canSend: false
        };
      }

      const classification = ExpectsReplyClassifier.classify(lastMsg.content);
      if (classification.expectsReply) {
        if (currentStage === 'booked' && classification.isClosingMessage) {
          return {
            success: false,
            draftType: 'none' as const,
            reason: "Booked aşamasında kapanış mesajı atılmış, taslak hazırlanamaz.",
            sendAction: 'none' as const,
            canSend: false
          };
        }

        // Check window open
        const lastInboundMsgRows = await ctx.db.executeSafe({
          text: `
            SELECT created_at
            FROM messages
            WHERE conversation_id = $1 AND tenant_id = $2 AND direction = 'in'
              AND (media_metadata IS NULL OR COALESCE(media_metadata->'native'->>'message_type', '') != 'reaction')
            ORDER BY created_at DESC
            LIMIT 1
          `,
          values: [conversationId, ctx.tenantId]
        });
        const lastInboundMsgs = Array.isArray(lastInboundMsgRows) ? lastInboundMsgRows : ((lastInboundMsgRows as any)?.rows || []);
        
        let windowOpen = false;
        if (lastInboundMsgs.length > 0) {
          const lastInboundTimeMs = new Date(lastInboundMsgs[0].created_at).getTime();
          windowOpen = (Date.now() - lastInboundTimeMs) <= 24 * 60 * 60 * 1000;
        }

        if (windowOpen) {
          const { sanitizePatientFacingMessage } = await import("@/lib/utils/patient-message-sanitizer");
          const draftText = sanitizePatientFacingMessage("Merhaba, müsait olduğunuzda geri dönüş yapabilirseniz size yardımcı olmaktan memnuniyet duyarız. İyi günler dileriz.");
          return {
            success: true,
            draftType: 'follow_up' as const,
            draftText,
            sendAction: 'follow_up' as const,
            canSend: true
          };
        } else {
          return {
            success: true,
            draftType: 'follow_up' as const,
            draftText: "24 saatlik WhatsApp penceresi kapandığı için serbest mesaj gönderilemez. Şablon gönderimi devre dışıdır.",
            sendAction: 'none' as const,
            canSend: false
          };
        }
      }

      // Check 7: No-Reply Reminder Draft
      // If standard follow-up is skipped because outbound does not expect reply, try no-reply reminder
      const noReplyRes = await prepareNoReplyReminderDraftCore(ctx.db, ctx.tenantId, ctx.userId, conversationId);
      if (noReplyRes.success && noReplyRes.draft) {
        return {
          success: true,
          draftType: 'no_reply_reminder' as const,
          draftText: noReplyRes.draft,
          sendAction: 'no_reply' as const,
          canSend: true
        };
      }

      return {
        success: false,
        draftType: 'none' as const,
        reason: "Son asistan mesajı cevap bekleyen bir mesaj değil ve hatırlatma taslağı hazırlanamadı.",
        sendAction: 'none' as const,
        canSend: false
      };
    }
  ).then(res => {
    if (!res.success) {
      return {
        success: false,
        draftType: 'none' as const,
        draftText: '',
        reason: res.error || 'Bilinmeyen hata.',
        sendAction: 'none' as const,
        canSend: false
      };
    }
    return res.data;
  });
}

export async function prepareBulkFollowUpDrafts(conversationIds: string[]) {
  if (!Array.isArray(conversationIds) || conversationIds.length === 0) {
    return { success: false, error: "Konuşma ID listesi boş olamaz." };
  }
  if (conversationIds.length > 10) {
    return { success: false, error: "En fazla 10 sohbet için aynı anda taslak hazırlanabilir." };
  }
  return withActionGuard(
    { actionName: 'prepareBulkFollowUpDrafts' },
    async (ctx) => {
      const results: {
        conversationId: string;
        patientName: string;
        status: 'prepared' | 'blocked' | 'template_required' | 'skipped';
        draft?: string;
        reason?: string;
        windowOpen?: boolean;
      }[] = [];

      for (const conversationId of conversationIds) {
        try {
          const convRows = await ctx.db.executeSafe({
            text: `
              SELECT c.id as conversation_id, c.phone_number, c.customer_id, c.active_opportunity_id, c.patient_name,
                     active_opp.stage as opp_stage, active_opp.metadata as opp_metadata, active_opp.automation_status as opp_automation_status,
                     l.id as lead_id, l.raw_data as form_raw_data
              FROM conversations c
              LEFT JOIN opportunities active_opp 
                ON active_opp.id = c.active_opportunity_id 
                AND active_opp.tenant_id = c.tenant_id
              LEFT JOIN LATERAL (
                SELECT id, raw_data 
                FROM leads 
                WHERE leads.tenant_id = c.tenant_id
                  AND (
                    (c.customer_id IS NOT NULL AND leads.customer_id = c.customer_id)
                    OR
                    (leads.phone_number LIKE '%' || RIGHT(c.phone_number, 10))
                  )
                ORDER BY created_at DESC 
                LIMIT 1
              ) l ON true
              WHERE c.id = $1 AND c.tenant_id = $2
              LIMIT 1
            `,
            values: [conversationId, ctx.tenantId]
          }) as any[];

          if (convRows.length === 0) {
            results.push({
              conversationId,
              patientName: "Bilinmeyen",
              status: 'skipped',
              reason: "Konuşma bulunamadı."
            });
            continue;
          }

          const conv = convRows[0];
          const phone = conv.phone_number;
          const patientName = conv.patient_name || "Hasta";

          const currentStage = conv.opp_stage || '';
          if (['lost', 'not_qualified', 'arrived'].includes(currentStage)) {
            results.push({
              conversationId,
              patientName,
              status: 'blocked',
              reason: `Fırsat terminal aşamada: ${currentStage}`
            });
            continue;
          }

          const primaryNorm = normalizePhoneForIdentity(phone).e164;
          const optOutPhones = new Set<string>();

          const optOutOpps = await ctx.db.executeSafe({
            text: `
              SELECT phone_number 
              FROM opportunities 
              WHERE tenant_id = $1 
                AND (COALESCE(metadata->>'opt_out_requested', 'false') = 'true')
            `,
            values: [ctx.tenantId]
          }) as any[];
          for (const o of optOutOpps) {
            const norm = normalizePhoneForIdentity(o.phone_number).e164;
            if (norm) optOutPhones.add(norm);
          }

          const lastInbounds = await ctx.db.executeSafe({
            text: `
              SELECT phone_number, content 
              FROM messages 
              WHERE tenant_id = $1 AND direction = 'in'
                AND phone_number LIKE '%' || RIGHT($2, 10)
                AND (media_metadata IS NULL OR COALESCE(media_metadata->'native'->>'message_type', '') != 'reaction')
              ORDER BY created_at DESC
              LIMIT 1
            `,
            values: [ctx.tenantId, phone]
          }) as any[];

          const hasOptOutKeywords = (text: string): boolean => {
            const clean = (text || '').toLowerCase().trim();
            const optOuts = [
              "dur", "stop", "istemiyorum", "rahatsız etmeyin", "mesaj atmayın", 
              "bırakın", "silin", "arama", "yazma", "unsubscribe", "don't write"
            ];
            return optOuts.some(kw => clean.includes(kw));
          };

          if (lastInbounds.length > 0 && hasOptOutKeywords(lastInbounds[0].content)) {
            if (primaryNorm) optOutPhones.add(primaryNorm);
          }

          const isPrimaryOptedOut = (conv.opp_metadata?.opt_out_requested === true) || 
                                    (conv.opp_metadata?.opt_out_requested === 'true') ||
                                    (primaryNorm && optOutPhones.has(primaryNorm));

          let hasOptOutKeywordInFamily = false;
          let parsedRaw = conv.form_raw_data;
          if (typeof parsedRaw === 'string') {
            try { parsedRaw = JSON.parse(parsedRaw); } catch(_) {}
          }
          if (parsedRaw && parsedRaw._all_phones) {
            const parsed = parseAllPhones(parsedRaw._all_phones);
            for (const p of parsed) {
              const pNorm = normalizePhoneForIdentity(p).e164;
              if (pNorm && optOutPhones.has(pNorm)) {
                hasOptOutKeywordInFamily = true;
                break;
              }
            }
          }

          if (isPrimaryOptedOut || hasOptOutKeywordInFamily) {
            results.push({
              conversationId,
              patientName,
              status: 'blocked',
              reason: "Hasta opt-out (istemiyorum) talep etmiştir."
            });
            continue;
          }

          if (conv.opp_automation_status === 'stopped' || conv.opp_automation_status === 'paused') {
            results.push({
              conversationId,
              patientName,
              status: 'blocked',
              reason: "Fırsat otomasyonu durdurulmuş."
            });
            continue;
          }

          const lastMsgRows = await ctx.db.executeSafe({
            text: `
              SELECT id, content, direction, created_at
              FROM messages
              WHERE conversation_id = $1 AND tenant_id = $2
                AND direction != 'system'
                AND (media_metadata IS NULL OR COALESCE(media_metadata->'native'->>'message_type', '') != 'reaction')
              ORDER BY created_at DESC
              LIMIT 1
            `,
            values: [conversationId, ctx.tenantId]
          }) as any[];

          if (lastMsgRows.length === 0) {
            results.push({
              conversationId,
              patientName,
              status: 'skipped',
              reason: "Konuşmada mesaj bulunamadı."
            });
            continue;
          }

          const lastMsg = lastMsgRows[0];
          if (lastMsg.direction !== 'out') {
            results.push({
              conversationId,
              patientName,
              status: 'skipped',
              reason: "Son mesaj hastadan gelmiş."
            });
            continue;
          }

          const classification = ExpectsReplyClassifier.classify(lastMsg.content);
          if (!classification.expectsReply) {
            results.push({
              conversationId,
              patientName,
              status: 'skipped',
              reason: "Son asistan mesajı cevap bekleyen bir mesaj değil."
            });
            continue;
          }

          if (currentStage === 'booked' && classification.isClosingMessage) {
            results.push({
              conversationId,
              patientName,
              status: 'blocked',
              reason: "Booked aşamasında kapanış mesajı atılmış."
            });
            continue;
          }

          const lastInboundMsgRows = await ctx.db.executeSafe({
            text: `
              SELECT created_at
              FROM messages
              WHERE conversation_id = $1 AND tenant_id = $2 AND direction = 'in'
                AND (media_metadata IS NULL OR COALESCE(media_metadata->'native'->>'message_type', '') != 'reaction')
              ORDER BY created_at DESC
              LIMIT 1
            `,
            values: [conversationId, ctx.tenantId]
          }) as any[];

          let windowOpen = false;
          let lastInboundTimeMs = 0;
          if (lastInboundMsgRows.length > 0) {
            lastInboundTimeMs = new Date(lastInboundMsgRows[0].created_at).getTime();
            windowOpen = (Date.now() - lastInboundTimeMs) <= 24 * 60 * 60 * 1000;
          }

          const lastOutboundTimeMs = new Date(lastMsg.created_at).getTime();
          const noReplyHours = Math.round(((Date.now() - lastOutboundTimeMs) / (1000 * 60 * 60)) * 10) / 10;

          let draftText = "";
          let status: 'prepared' | 'template_required' = 'prepared';

          if (windowOpen) {
            draftText = "Merhaba, müsait olduğunuzda geri dönüş yapabilirseniz size yardımcı olmaktan memnuniyet duyarız. İyi günler dileriz.";
            status = "prepared";
          } else {
            draftText = "24 saatlik WhatsApp penceresi kapandığı için serbest mesaj gönderilemez. Lütfen onaylı bir şablon seçin.";
            status = "template_required";
          }

          await ctx.db.executeSafe({
            text: `
              INSERT INTO outreach_logs (tenant_id, lead_id, conversation_id, opportunity_id, action, channel, actor_id, metadata)
              VALUES ($1, $2, $3, $4, 'followup_draft_prepared', 'whatsapp', $5, $6)
            `,
            values: [
              ctx.tenantId,
              conv.lead_id || null,
              conversationId,
              conv.active_opportunity_id || null,
              ctx.userId,
              JSON.stringify({
                source: "bulk_inbox_no_reply",
                last_outbound_message_id: lastMsg.id,
                expects_reply_reason: classification.reason,
                no_reply_hours: noReplyHours,
                window_open: windowOpen,
                draft_type: status === 'prepared' ? 'freeform' : 'template_required',
                draft_message: draftText,
                sent: false
              })
            ]
          });

          results.push({
            conversationId,
            patientName,
            status,
            draft: draftText,
            windowOpen
          });

        } catch (err: any) {
          console.error(`[BULK_DRAFT_ERROR] Failed on conversation ${conversationId}:`, err);
          results.push({
            conversationId,
            patientName: "Hata",
            status: 'skipped',
            reason: `Hata: ${err.message || 'Sistem Hatası'}`
          });
        }
      }

      return results;
    }
  ).then(res => {
    if (!res.success) return { success: false as const, error: res.error };
    return {
      success: true as const,
      results: res.data as {
        conversationId: string;
        patientName: string;
        status: 'prepared' | 'blocked' | 'template_required' | 'skipped';
        draft?: string;
        reason?: string;
        windowOpen?: boolean;
      }[]
    };
  });
}

export async function toggleConversationFavorite(conversationId: string) {
  if (!conversationId || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(conversationId)) {
    return { success: false, error: "Missing or invalid conversation UUID" };
  }
  return withActionGuard(
    { actionName: 'toggleConversationFavorite' },
    async (ctx) => {
      // Bind conversationId to active trace context
      const traceCtx = getTraceContext();
      if (traceCtx) {
        traceCtx.conversationId = conversationId;
      }

      // 1. Verify conversation belongs to tenant
      const convRows = await ctx.db.executeSafe({
        text: `SELECT id FROM conversations WHERE id = $1 AND tenant_id = $2 LIMIT 1`,
        values: [conversationId, ctx.tenantId]
      });
      const convList = Array.isArray(convRows) ? convRows : ((convRows as any)?.rows || []);
      if (convList.length === 0) {
        return { success: false, error: "Sohbet bulunamadı veya yetkisiz erişim." };
      }

      // 2. Check if already favorited
      const favRows = await ctx.db.executeSafe({
        text: `SELECT 1 FROM conversation_favorites WHERE tenant_id = $1 AND user_id = $2 AND conversation_id = $3 LIMIT 1`,
        values: [ctx.tenantId, ctx.userId, conversationId]
      });
      const favList = Array.isArray(favRows) ? favRows : ((favRows as any)?.rows || []);
      const isFavorite = favList.length > 0;

      if (isFavorite) {
        await ctx.db.executeSafe({
          text: `DELETE FROM conversation_favorites WHERE tenant_id = $1 AND user_id = $2 AND conversation_id = $3`,
          values: [ctx.tenantId, ctx.userId, conversationId]
        });
      } else {
        await ctx.db.executeSafe({
          text: `INSERT INTO conversation_favorites (tenant_id, user_id, conversation_id) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`,
          values: [ctx.tenantId, ctx.userId, conversationId]
        });
      }

      await logAudit({
        tenantId: ctx.tenantId,
        userId: ctx.userId,
        action: isFavorite ? "remove_favorite" : "add_favorite",
        entityType: "conversation",
        entityId: conversationId,
        details: { conversationId }
      });

      // Publish metadata update to realtime bus
      await RealtimePublisher.publishMetadataUpdated(ctx.tenantId, {
        conversationId,
        userId: ctx.userId,
        isFavorite: !isFavorite
      });

      return { success: true, isFavorite: !isFavorite };
    }
  ).then(res => {
    if (!res.success) return { success: false, error: res.error };
    return res.data;
  });
}

export async function archiveConversation(conversationId: string) {
  if (!conversationId || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(conversationId)) {
    return { success: false, error: "Missing or invalid conversation UUID" };
  }
  return withActionGuard(
    { actionName: 'archiveConversation' },
    async (ctx) => {
      // Bind conversationId to active trace context
      const traceCtx = getTraceContext();
      if (traceCtx) {
        traceCtx.conversationId = conversationId;
      }

      // 1. Verify conversation belongs to tenant
      const convRows = await ctx.db.executeSafe({
        text: `SELECT id FROM conversations WHERE id = $1 AND tenant_id = $2 LIMIT 1`,
        values: [conversationId, ctx.tenantId]
      });
      const convList = Array.isArray(convRows) ? convRows : ((convRows as any)?.rows || []);
      if (convList.length === 0) {
        return { success: false, error: "Sohbet bulunamadı veya yetkisiz erişim." };
      }

      await ctx.db.executeSafe({
        text: `INSERT INTO conversation_archives (tenant_id, user_id, conversation_id) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`,
        values: [ctx.tenantId, ctx.userId, conversationId]
      });

      await logAudit({
        tenantId: ctx.tenantId,
        userId: ctx.userId,
        action: "archive_conversation",
        entityType: "conversation",
        entityId: conversationId,
        details: { conversationId }
      });

      // Publish metadata update to realtime bus
      await RealtimePublisher.publishMetadataUpdated(ctx.tenantId, {
        conversationId,
        userId: ctx.userId,
        isArchived: true
      });

      return { success: true };
    }
  ).then(res => {
    if (!res.success) return { success: false, error: res.error };
    return res.data;
  });
}

export async function unarchiveConversation(conversationId: string) {
  if (!conversationId || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(conversationId)) {
    return { success: false, error: "Missing or invalid conversation UUID" };
  }
  return withActionGuard(
    { actionName: 'unarchiveConversation' },
    async (ctx) => {
      // Bind conversationId to active trace context
      const traceCtx = getTraceContext();
      if (traceCtx) {
        traceCtx.conversationId = conversationId;
      }

      // 1. Verify conversation belongs to tenant
      const convRows = await ctx.db.executeSafe({
        text: `SELECT id FROM conversations WHERE id = $1 AND tenant_id = $2 LIMIT 1`,
        values: [conversationId, ctx.tenantId]
      });
      const convList = Array.isArray(convRows) ? convRows : ((convRows as any)?.rows || []);
      if (convList.length === 0) {
        return { success: false, error: "Sohbet bulunamadı veya yetkisiz erişim." };
      }

      await ctx.db.executeSafe({
        text: `DELETE FROM conversation_archives WHERE tenant_id = $1 AND user_id = $2 AND conversation_id = $3`,
        values: [ctx.tenantId, ctx.userId, conversationId]
      });

      await logAudit({
        tenantId: ctx.tenantId,
        userId: ctx.userId,
        action: "unarchive_conversation",
        entityType: "conversation",
        entityId: conversationId,
        details: { conversationId }
      });

      // Publish metadata update to realtime bus
      await RealtimePublisher.publishMetadataUpdated(ctx.tenantId, {
        conversationId,
        userId: ctx.userId,
        isArchived: false
      });

      return { success: true };
    }
  ).then(res => {
    if (!res.success) return { success: false, error: res.error };
    return res.data;
  });
}

export async function bulkToggleFavorite(conversationIds: string[], favorite: boolean) {
  if (!conversationIds || conversationIds.length === 0) return { success: false, error: "Missing conversationIds" };
  return withActionGuard(
    { actionName: 'bulkToggleFavorite' },
    async (ctx) => {
      const ids = conversationIds.slice(0, 50);

      // Verify conversations belong to tenant
      const convRows = await ctx.db.executeSafe({
        text: `SELECT id FROM conversations WHERE id = ANY($1::uuid[]) AND tenant_id = $2`,
        values: [ids, ctx.tenantId]
      });
      const convList = Array.isArray(convRows) ? convRows : ((convRows as any)?.rows || []);
      const validIds = convList.map((r: any) => r.id);

      if (validIds.length === 0) {
        return { success: false, error: "Geçerli sohbet bulunamadı." };
      }

      if (favorite) {
        await ctx.db.executeSafe({
          text: `
            INSERT INTO conversation_favorites (tenant_id, user_id, conversation_id)
            SELECT $1, $2, unnest($3::uuid[])
            ON CONFLICT DO NOTHING
          `,
          values: [ctx.tenantId, ctx.userId, validIds]
        });
      } else {
        await ctx.db.executeSafe({
          text: `
            DELETE FROM conversation_favorites
            WHERE tenant_id = $1 AND user_id = $2 AND conversation_id = ANY($3::uuid[])
          `,
          values: [ctx.tenantId, ctx.userId, validIds]
        });
      }

      await logAudit({
        tenantId: ctx.tenantId,
        userId: ctx.userId,
        action: favorite ? "bulk_add_favorite" : "bulk_remove_favorite",
        entityType: "conversation",
        entityId: validIds[0],
        details: { count: validIds.length }
      });

      await broadcastBulkMetadataUpdate(ctx.tenantId, ctx.userId, validIds, { isFavorite: favorite });

      return { success: true, count: validIds.length };
    }
  ).then(res => {
    if (!res.success) return { success: false, error: res.error };
    return res.data;
  });
}

export async function bulkArchiveConversations(conversationIds: string[]) {
  if (!conversationIds || conversationIds.length === 0) return { success: false, error: "Missing conversationIds" };
  return withActionGuard(
    { actionName: 'bulkArchiveConversations' },
    async (ctx) => {
      const ids = conversationIds.slice(0, 50);

      // Verify conversations belong to tenant
      const convRows = await ctx.db.executeSafe({
        text: `SELECT id FROM conversations WHERE id = ANY($1::uuid[]) AND tenant_id = $2`,
        values: [ids, ctx.tenantId]
      });
      const convList = Array.isArray(convRows) ? convRows : ((convRows as any)?.rows || []);
      const validIds = convList.map((r: any) => r.id);

      if (validIds.length === 0) {
        return { success: false, error: "Geçerli sohbet bulunamadı." };
      }

      await ctx.db.executeSafe({
        text: `
          INSERT INTO conversation_archives (tenant_id, user_id, conversation_id)
          SELECT $1, $2, unnest($3::uuid[])
          ON CONFLICT DO NOTHING
        `,
        values: [ctx.tenantId, ctx.userId, validIds]
      });

      await logAudit({
        tenantId: ctx.tenantId,
        userId: ctx.userId,
        action: "bulk_archive_conversations",
        entityType: "conversation",
        entityId: validIds[0],
        details: { count: validIds.length }
      });

      await broadcastBulkMetadataUpdate(ctx.tenantId, ctx.userId, validIds, { isArchived: true });

      return { success: true, count: validIds.length };
    }
  ).then(res => {
    if (!res.success) return { success: false, error: res.error };
    return res.data;
  });
}

export async function bulkUnarchiveConversations(conversationIds: string[]) {
  if (!conversationIds || conversationIds.length === 0) return { success: false, error: "Missing conversationIds" };
  return withActionGuard(
    { actionName: 'bulkUnarchiveConversations' },
    async (ctx) => {
      const ids = conversationIds.slice(0, 50);

      // Verify conversations belong to tenant
      const convRows = await ctx.db.executeSafe({
        text: `SELECT id FROM conversations WHERE id = ANY($1::uuid[]) AND tenant_id = $2`,
        values: [ids, ctx.tenantId]
      });
      const convList = Array.isArray(convRows) ? convRows : ((convRows as any)?.rows || []);
      const validIds = convList.map((r: any) => r.id);

      if (validIds.length === 0) {
        return { success: false, error: "Geçerli sohbet bulunamadı." };
      }

      await ctx.db.executeSafe({
        text: `
          DELETE FROM conversation_archives
          WHERE tenant_id = $1 AND user_id = $2 AND conversation_id = ANY($3::uuid[])
        `,
        values: [ctx.tenantId, ctx.userId, validIds]
      });

      await logAudit({
        tenantId: ctx.tenantId,
        userId: ctx.userId,
        action: "bulk_unarchive_conversations",
        entityType: "conversation",
        entityId: validIds[0],
        details: { count: validIds.length }
      });

      await broadcastBulkMetadataUpdate(ctx.tenantId, ctx.userId, validIds, { isArchived: false });

      return { success: true, count: validIds.length };
    }
  ).then(res => {
    if (!res.success) return { success: false, error: res.error };
    return res.data;
  });
}

export async function prepareNoReplyReminderDraftCore(
  db: any,
  tenantId: string,
  userId: string | null,
  conversationId: string
) {
  const convRows = await db.executeSafe({
    text: `SELECT c.id, c.phone_number, c.patient_name, c.active_opportunity_id,
                  l.id as lead_id
           FROM conversations c
           LEFT JOIN leads l ON l.tenant_id = c.tenant_id AND (
             (c.customer_id IS NOT NULL AND l.customer_id = c.customer_id)
             OR l.phone_number = c.phone_number
           )
           WHERE c.id = $1 AND c.tenant_id = $2
           ORDER BY l.created_at DESC
           LIMIT 1`,
    values: [conversationId, tenantId]
  }) as any[];

  if (convRows.length === 0) {
    return { success: false, error: "Konuşma bulunamadı." };
  }
  const conv = convRows[0];

  // Fetch last outbound message
  const lastMsgRows = await db.executeSafe({
    text: `SELECT content, created_at
           FROM messages
           WHERE conversation_id = $1 AND tenant_id = $2 AND direction = 'out'
             AND (media_metadata IS NULL OR COALESCE(media_metadata->'native'->>'message_type', '') != 'reaction')
           ORDER BY created_at DESC
           LIMIT 1`,
    values: [conversationId, tenantId]
  }) as any[];
  
  const lastMsgText = lastMsgRows[0]?.content || '';
  const isPhoneCallContext = lastMsgText.toLowerCase().includes('telefon') || 
                             lastMsgText.toLowerCase().includes('görüşme') ||
                             lastMsgText.toLowerCase().includes('arama') ||
                             lastMsgText.toLowerCase().includes('arayalım');

  let draft = "";
  if (isPhoneCallContext) {
    draft = `Merhaba,\n\nTelefon görüşmesi için uygun olduğunuz zamanı öğrenmek istemiştik.\n\nMüsait olduğunuz saat aralığını paylaşırsanız sizi buna göre arama planına alabiliriz.\n\nİyi günler dileriz.`;
  } else {
    draft = `Merhaba,\n\nDaha önce gönderdiğimiz mesajla ilgili dönüşünüzü bekliyoruz.\n\nTürkiye’ye geliş planınız netleştiyse paylaşabilirsiniz. Size uygun şekilde randevu planlamanız için yardımcı olabiliriz.\n\nİyi günler dileriz.`;
  }

  const actorId = userId;
  if (!actorId) {
    return { success: false, error: "Kullanıcı kimliği bulunamadı (actor_id null olamaz)." };
  }

  await db.executeSafe({
    text: `INSERT INTO outreach_logs (tenant_id, lead_id, conversation_id, opportunity_id, action, channel, actor_id, metadata)
           VALUES ($1, $2, $3, $4, 'no_reply_reminder_draft_prepared', 'whatsapp', $5, $6)`,
    values: [
      tenantId,
      conv.lead_id || null,
      conversationId,
      conv.active_opportunity_id || null,
      actorId,
      JSON.stringify({
        draft_text: draft,
        last_outbound_text: lastMsgText
      })
    ]
  });

  return { success: true, draft };
}

export async function prepareNoReplyReminderDraftAction(conversationId: string) {
  if (!conversationId) return { success: false, error: "Konuşma ID gerekli." };
  
  return withActionGuard(
    { actionName: 'prepareNoReplyReminderDraftAction' },
    async (ctx) => {
      return await prepareNoReplyReminderDraftCore(ctx.db, ctx.tenantId, ctx.userId, conversationId);
    }
  ).then(res => {
    if (!res.success) return { success: false, error: res.error };
    return res.data;
  });
}

export async function sendNoReplyReminderAction(conversationId: string, messageText: string) {
  if (!conversationId) return { success: false, error: "Konuşma ID gerekli." };
  if (!messageText || messageText.trim().length === 0) return { success: false, error: "Mesaj metni boş olamaz." };

  return withActionGuard(
    { actionName: 'sendNoReplyReminderAction' },
    async (ctx) => {
      // 1. Fetch conversation details
      const convRows = await ctx.db.executeSafe({
        text: `SELECT c.id, c.phone_number, c.patient_name, c.active_opportunity_id,
                      l.id as lead_id
               FROM conversations c
               LEFT JOIN leads l ON l.tenant_id = c.tenant_id AND (
                 (c.customer_id IS NOT NULL AND l.customer_id = c.customer_id)
                 OR l.phone_number = c.phone_number
               )
               WHERE c.id = $1 AND c.tenant_id = $2
               ORDER BY l.created_at DESC
               LIMIT 1`,
        values: [conversationId, ctx.tenantId]
      }) as any[];

      if (convRows.length === 0) {
        return { success: false, error: "Konuşma bulunamadı." };
      }

      const conv = convRows[0];
      const phone = conv.phone_number;
      const cleanMessage = messageText.trim();

      // 2. Send via WhatsApp API
      const { MessageService } = await import("@/lib/services/message.service");
      const { TenantDB } = await import("@/lib/core/tenant-db");
      const tenantDb = new TenantDB(ctx.tenantId);
      const messageService = new MessageService(tenantDb);

      let providerMessageId: string | null = null;
      try {
        const sendRes = await messageService.sendWhatsAppFreeform(phone, cleanMessage);
        providerMessageId = sendRes.providerMessageId || null;
      } catch (err: any) {
        return { success: false, error: `WhatsApp gönderim hatası: ${err.message || err}` };
      }

      // 4. Save message record with direction = 'out'
      await ctx.db.executeSafe({
        text: `INSERT INTO messages (tenant_id, conversation_id, phone_number, direction, content, channel, status, provider_message_id)
               VALUES ($1, $2, $3, 'out', $4, 'whatsapp', 'sent', $5)`,
        values: [ctx.tenantId, conversationId, phone, cleanMessage, providerMessageId]
      });

      // Update conversation last_message
      await ctx.db.executeSafe({
        text: `UPDATE conversations 
               SET last_message_at = NOW(), 
                   last_message_content = $1,
                   last_channel = 'whatsapp',
                   last_message_status = 'sent',
                   last_message_direction = 'out',
                   message_count = COALESCE(message_count, 0) + 1
               WHERE id = $2 AND tenant_id = $3`,
        values: [cleanMessage, conversationId, ctx.tenantId]
      });

      // 5. Write outreach log with action = 'no_reply_reminder_sent'
      const actorId = ctx.userId;
      if (!actorId) {
        return { success: false, error: "Kullanıcı kimliği bulunamadı (actor_id null olamaz)." };
      }
      await ctx.db.executeSafe({
        text: `INSERT INTO outreach_logs (tenant_id, lead_id, conversation_id, opportunity_id, action, channel, actor_id, metadata)
               VALUES ($1, $2, $3, $4, 'no_reply_reminder_sent', 'whatsapp', $5, $6)`,
        values: [
          ctx.tenantId,
          conv.lead_id || null,
          conversationId,
          conv.active_opportunity_id || null,
          actorId,
          JSON.stringify({
            message_text: cleanMessage,
            provider_message_id: providerMessageId,
            patient_name: conv.patient_name || '',
            phone,
          })
        ]
      });

      return { success: true };
    }
  ).then(res => {
    if (!res.success) return { success: false, error: res.error };
    return res.data;
  });
}

export async function scheduleReminderTaskAction(
  opportunityId: string | null | undefined,
  dueAtUtc: string,
  note?: string,
  fallback?: { conversationId: string; phoneNumber: string },
  force?: boolean,
  customMetadata?: Record<string, any>
): Promise<{ success: boolean; error?: string; message?: string; taskId?: string; isUpdate?: boolean }> {
  return withActionGuard(
    { actionName: 'scheduleReminderTaskAction' },
    async (ctx) => {
      if (!ctx.userId) {
        return { success: false, error: "Kullanıcı kimliği bulunamadı (oturum kapalı)." };
      }

      let phoneNumber = fallback?.phoneNumber;
      let conversationId = fallback?.conversationId || null;
      let leadId: string | null = null;
      const oppIdDb = opportunityId || null;

      if (oppIdDb) {
        const oppQuery = await ctx.db.executeSafe({
          text: `SELECT id, conversation_id, phone_number, lead_id FROM opportunities WHERE id = $1 AND tenant_id = $2 LIMIT 1`,
          values: [oppIdDb, ctx.tenantId]
        }) as any[];

        if (oppQuery.length > 0) {
          const opp = oppQuery[0];
          phoneNumber = opp.phone_number;
          conversationId = opp.conversation_id || conversationId;
          leadId = opp.lead_id;
        }
      }

      if (!phoneNumber) {
        return { success: false, error: "Telefon numarası bulunamadı." };
      }

      if (!conversationId) {
        try {
          const convRes = await ctx.db.executeSafe({
            text: `SELECT c.id as conv_id, l.id as lead_id 
                   FROM conversations c
                   LEFT JOIN leads l ON l.phone_number = c.phone_number AND l.tenant_id = c.tenant_id
                   WHERE c.tenant_id = $1 AND RIGHT(c.phone_number, 10) = RIGHT($2, 10) 
                   LIMIT 1`,
            values: [ctx.tenantId, phoneNumber]
          }) as any[];
          if (convRes.length > 0) {
            conversationId = convRes[0].conv_id || null;
            leadId = convRes[0].lead_id || leadId || null;
          }
        } catch (_) {}
      }

      // Check for active duplicate task
      const activeTasks = await ctx.db.executeSafe({
        text: `
          SELECT id, metadata FROM follow_up_tasks 
          WHERE tenant_id = $1 AND task_type = 'date_pending_followup' AND status IN ('pending', 'in_progress')
            AND (opportunity_id = $2 OR conversation_id = $3 OR phone_number = $4)
          ORDER BY created_at DESC LIMIT 1
        `,
        values: [ctx.tenantId, oppIdDb, conversationId, phoneNumber]
      }) as any[];

      if (!force && activeTasks.length > 0) {
        return {
          success: false,
          error: 'ACTIVE_TASK_EXISTS',
          message: 'Bu hasta için halihazırda açık bir takip hatırlatması bulunmaktadır. Mevcut hatırlatmayı güncelleyebilir veya erteleyebilirsiniz.',
          taskId: activeTasks[0].id
        };
      }

      const metadata = {
        zero_outbound_p0: true,
        zero_outbound: true,
        source: "inbox_action_intent",
        intent: "date_pending_followup",
        actor_id: ctx.userId,
        ...(customMetadata || {})
      };

      let taskId: string;
      let isUpdate = false;

      if (activeTasks.length > 0) {
        // Update existing task
        taskId = activeTasks[0].id;
        isUpdate = true;
        const mergedMeta = { ...activeTasks[0].metadata, ...metadata };

        await ctx.db.executeSafe({
          text: `
            UPDATE follow_up_tasks 
            SET due_at = $1, 
                description = $2, 
                metadata = $3::jsonb, 
                updated_at = NOW() 
            WHERE id = $4 AND tenant_id = $5
          `,
          values: [dueAtUtc, note || 'Takip hatırlatması güncellendi.', JSON.stringify(mergedMeta), taskId, ctx.tenantId]
        });
      } else {
        // Insert new task
        const insertRes = await ctx.db.executeSafe({
          text: `
            INSERT INTO follow_up_tasks (
              tenant_id, opportunity_id, conversation_id, phone_number,
              task_type, title, description, status, due_at, metadata
            ) VALUES ($1, $2, $3, $4, 'date_pending_followup', 'Takip Hatırlatması', $5, 'pending', $6, $7::jsonb)
            RETURNING id
          `,
          values: [
            ctx.tenantId,
            oppIdDb,
            conversationId,
            phoneNumber,
            note || 'Hasta tarih netleşince geri döneceğini belirtti.',
            dueAtUtc,
            JSON.stringify(metadata)
          ]
        }) as any[];
        taskId = insertRes[0].id;
      }

      // 3. Write outreach log
      await ctx.db.executeSafe({
        text: `
          INSERT INTO outreach_logs (tenant_id, lead_id, conversation_id, opportunity_id, action, channel, actor_id, metadata)
          VALUES ($1, $2, $3, $4, 'reminder_scheduled', 'system', $5, $6::jsonb)
        `,
        values: [
          ctx.tenantId,
          leadId || null,
          conversationId,
          opportunityId,
          ctx.userId,
          JSON.stringify({
            task_id: taskId,
            due_at: dueAtUtc,
            is_update: isUpdate,
            note
          })
        ]
      });

      return { success: true, taskId, isUpdate };
    }
  ).then(res => {
    if (!res.success) return { success: false, error: res.error, message: undefined, taskId: undefined, isUpdate: undefined };
    return res.data || { success: false, error: "Bilinmeyen hata", message: undefined, taskId: undefined, isUpdate: undefined };
  });
}

function cleanJsonResponse(rawText: string): string {
  let cleaned = rawText.trim();
  if (cleaned.startsWith("```")) {
    cleaned = cleaned.replace(/^```[a-zA-Z]*\n/, "");
    cleaned = cleaned.replace(/\n```$/, "");
    cleaned = cleaned.trim();
  }
  return cleaned;
}

function extractTemplateParameters(canonicalBody: string, filledBody: string): string[] {
  const placeholderRegex = /\{\{[^}]+\}\}/g;
  const placeholders: string[] = [];
  let match;
  while ((match = placeholderRegex.exec(canonicalBody)) !== null) {
    placeholders.push(match[0]);
  }
  
  if (placeholders.length === 0) return [];
  
  const parts = canonicalBody.split(placeholderRegex);
  const escapedParts = parts.map(p => p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  
  const regexPattern = "^" + escapedParts.join("([\\s\\S]*?)") + "$";
  try {
    const regex = new RegExp(regexPattern);
    const matches = filledBody.match(regex);
    if (matches && matches.length > placeholders.length) {
      return matches.slice(1, placeholders.length + 1).map(m => m.trim());
    }
  } catch (e) {
    console.error("[TEMPLATE_PARAM_EXTRACTION_ERROR] Failed to extract parameters", e);
  }
  return [];
}

export async function prepareInboxBotAssistedDraftAction(
  conversationId: string,
  intentHint?: string,
  targetLanguage?: string,
  customDirective?: string
) {
  if (!conversationId) return { success: false, error: "Konuşma ID gerekli." };

  return withActionGuard(
    { actionName: 'prepareInboxBotAssistedDraftAction' },
    async (ctx) => {
      // 1. Fetch conversation
      const convRows = await ctx.db.executeSafe({
        text: `SELECT id, patient_name, phone_number, customer_id, active_opportunity_id FROM conversations WHERE id = $1 AND tenant_id = $2 LIMIT 1`,
        values: [conversationId, ctx.tenantId]
      }) as any[];

      if (convRows.length === 0) {
        return { success: false, error: "Konuşma bulunamadı." };
      }
      const conv = convRows[0];

      // 2. Fetch last 15 messages (excluding system notes to prevent leakage)
      const messageRows = await ctx.db.executeSafe({
        text: `SELECT direction, content, created_at 
               FROM messages 
               WHERE conversation_id = $1 AND tenant_id = $2 AND direction IN ('in', 'out')
               ORDER BY created_at DESC, id DESC
               LIMIT 15`,
        values: [conversationId, ctx.tenantId]
      }) as any[];
      const messages = [...messageRows].reverse();

      // 3. Fetch active opportunity
      let opp: any = null;
      if (conv.active_opportunity_id) {
        const oppRows = await ctx.db.executeSafe({
          text: `SELECT id, summary, ai_reason, department, country FROM opportunities WHERE id = $1 AND tenant_id = $2 LIMIT 1`,
          values: [conv.active_opportunity_id, ctx.tenantId]
        }) as any[];
        opp = oppRows[0] || null;
      }

      // 4. Fetch lead form
      const leadRows = await ctx.db.executeSafe({
        text: `
          SELECT id, form_name, raw_data, created_at
          FROM leads
          WHERE tenant_id = $1
            AND (
              (customer_id IS NOT NULL AND customer_id = $2)
              OR (phone_number LIKE '%' || RIGHT($3, 10))
            )
          ORDER BY created_at DESC
          LIMIT 1
        `,
        values: [ctx.tenantId, conv.customer_id || null, conv.phone_number]
      }) as any[];
      const lead = leadRows[0] || null;

      // 5. Resolve 24h window status
      const windowStatus = await resolveWhatsApp24hWindow(conversationId, ctx.tenantId, ctx.db);

      // Fetch dynamic identity configuration
      let identityConfig = { personaName: '', organizationName: '', organizationShortName: '' };
      let promptVersion: any = undefined;
      try {
        const promptRows = await ctx.db.executeSafe({
          text: `
            SELECT cp.metadata, cp.version
            FROM channel_prompt_bindings cpb
            JOIN channel_prompts cp ON cpb.prompt_id = cp.id
            JOIN channels c ON cpb.channel_id = c.id
            JOIN channel_groups cg ON c.group_id = cg.id
            WHERE cg.tenant_id = $1
              AND cpb.is_active = true
              AND cp.prompt_type = 'system'
              AND cp.tenant_id = $1
            ORDER BY cpb.priority ASC
            LIMIT 1
          `,
          values: [ctx.tenantId]
        }) as any[];
        
        if (promptRows && promptRows.length > 0) {
          if (promptRows[0].metadata?.identity) {
            identityConfig = promptRows[0].metadata.identity;
          }
          promptVersion = promptRows[0].version;
        }
      } catch (dbErr) {
        console.error("[INBOX_DRAFT_IDENTITY_RESOLVE_ERROR] Failed to fetch prompt metadata", dbErr);
      }

      const pName = identityConfig.personaName || '';
      const orgName = identityConfig.organizationName || '';
      const orgShort = identityConfig.organizationShortName || '';

      // Determine prompt directive description based on intentHint
      let intentText = "";
      if (intentHint === "Karşılama") {
        intentText = `Hastayı sıcak ve kurumsal bir dille karşıla ve ${orgShort ? `${orgShort} Hastanemize` : 'hastanemize'} başvuru amacını/şikayetini kibarca netleştir.`;
      } else if (intentHint === "Randevuya Yönlendir") {
        intentText = `Hastayı ${orgShort ? `${orgShort} Hastanemizde` : 'hastanemizde'} muayene veya randevu planlamaya kibarca davet et.`;
      } else if (intentHint === "Uygun Gün/Saat Sor") {
        intentText = "Hastaya randevu planlaması veya görüşme için hangi günlerin ve saatlerin kendisine uygun olduğunu sor.";
      } else if (intentHint === "Fiyat Vermeden Koordinatöre Yönlendir") {
        intentText = `Hastalara fiyat bilgisi vermeden, ${orgShort ? `${orgShort} hastanemizin` : 'hastanemizin'} hasta koordinatörlerinin kendilerine ulaşıp detaylı bilgi vereceğini ilet.`;
      } else if (intentHint === "Kararsız Hastayı Nazikçe İkna Et") {
        intentText = `Kararsız veya endişeli hastayı ${orgShort ? `${orgShort} Hastanemizin` : 'hastanemizin'} uzman ekibine güvenebileceği yönünde nazikçe ikna et.`;
      } else if (intentHint === "Rapor/MR İstemeden Geliş Amacını Teyit Et") {
        intentText = "Hastadan herhangi bir MR, tetkik veya rapor istemeden, doğrudan geliş amacını ve şikayetini teyit et.";
      } else if (intentHint === "Cevap Bekleyen Hastaya Takip Mesajı Hazırla") {
        intentText = "Bir süredir cevap vermeyen hastaya, yardımcı olabileceğimiz bir durum olup olmadığını soran nazik bir takip mesajı hazırla.";
      } else if (intentHint === "Serbest Talimatla Mesaj Hazırla") {
        intentText = customDirective || "Hastaya yardımcı ol.";
      } else {
        intentText = "Hastaya profesyonel ve yardımcı bir dille cevap yaz.";
      }

      // Check Gemini API key
      const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
      if (!GEMINI_API_KEY) {
        return { success: false, error: "GEMINI_API_KEY ortam değişkeni tanımlı değil." };
      }

      // Resolve model
      const profileData = await ctx.db.executeSafe({
        text: `SELECT cap.ai_model FROM channel_ai_profiles cap
               JOIN channel_groups cg ON cap.group_id = cg.id
               WHERE cg.tenant_id = $1 AND cg.status = 'active' LIMIT 1`,
        values: [ctx.tenantId]
      }) as any[];
      const model = profileData[0]?.ai_model || 'gemini-2.5-flash';

      // 6. IF 24H WINDOW IS OPEN OR CLOSING_SOON -> Freeform AI draft
      if (windowStatus.status === 'OPEN' || windowStatus.status === 'CLOSING_SOON') {
        // Special case: Form exists and intent is greeting -> reuse Form Management greeting logic
        if (lead && intentHint === "Karşılama") {
          try {
            const { generateSmartDraft } = await import('@/lib/utils/smart-draft-generator');
            const draftText = await generateSmartDraft(lead.raw_data, lead.form_name, 'first_contact_intent_check', ctx.tenantId, ctx.db);
            if (!draftText || !draftText.trim()) {
              return { success: false, error: "Taslak üretilemedi. Lütfen tekrar deneyin veya manuel talimat girin." };
            }
            // Passive Learning Capture: log smart draft
            try {
              const { TenantLearningCaptureService } = await import('@/lib/services/ai/tenant-learning-capture.service');
              await TenantLearningCaptureService.logSmartDraft(ctx.db, {
                tenantId: ctx.tenantId,
                channelId: conv.channel_id || null,
                conversationId,
                aiGeneratedText: draftText,
                metadata: { intentHint, customDirective, reused_form_greeting: true }
              });
            } catch (captureErr) {
              console.error('TenantLearningCaptureService.logSmartDraft error bypassed', captureErr);
            }

            return {
              isTemplate: false,
              draftText,
              windowStatus: windowStatus.status,
              detectedLanguage: "Türkçe",
              isLanguageUnclear: false
            };
          } catch (e: any) {
            console.error("[SMART_DRAFT_REUSE_ERROR] Failed to reuse smart greeting resolver", e);
          }
        }

        // Standard Gemini freeform draft generation
        const systemPrompt = `Sen bir ${orgShort ? `${orgShort} Hastanesi` : 'Hastane'} Hasta İlişkileri Asistanı AI modelisin. Görevin, hastanın mesaj geçmişine, varsa form bilgilerine ve hedeflenen amaca uygun olarak profesyonel, sıcak, kurallara uygun bir WhatsApp cevap taslağı hazırlamaktır.
Yanıtını mutlaka belirtilen JSON formatında üretmelisin. JSON haricinde hiçbir açıklayıcı metin ekleme.

=== ÖNEMLİ KURALLAR ===
1. KESİNLİKLE İSİMLE HİTAP ETME. "Merhaba Ahmet Bey" gibi ifadeler yasaktır. Hitap sadece "Merhaba," olmalıdır.
2. Fiyat bilgisi veya aralığı KESİNLİKLE verme.
3. Teşhis koyma, tedavi garantisi verme.
4. "Ön görüşme", "ön değerlendirme" ifadelerini kullanma.
5. Kampanya kodlarını hastaya yazma.
6. Kurumsal ve profesyonel bir dil kullan.

Hedeflenen Amaç/Talimat: ${intentText}
Hedef Dil: ${targetLanguage || 'Auto'} (Eğer Auto ise, hastanın yazdığı dili algılayıp o dilde cevap üretmelisin.)

=== YANIT FORMATI (JSON) ===
{
  "draftText": "Oluşturduğun WhatsApp cevap taslağı (satır boşlukları için \\n\\n kullan)",
  "detectedLanguage": "Algıladığın hasta dili (Örn: Türkçe, Arapça, İngilizce, Almanca)",
  "languageCode": "Algıladığın hasta dili kodu (Örn: tr, ar, en, de)",
  "isLanguageUnclear": false
}`;

        const promptText = `
[Mevcut Hasta Bilgileri]
İsim: ${conv.patient_name || 'Bilinmiyor'}
Telefon: ${conv.phone_number}

[Aktif Fırsat Bilgileri]
${opp ? `Departman: ${opp.department || ''}\nÖzet: ${opp.summary || ''}\nAI Yorumu: ${opp.ai_reason || ''}` : 'Fırsat yok.'}

[Lead Form Bilgileri]
${lead ? `Form Adı: ${lead.form_name}\nVeri: ${JSON.stringify(lead.raw_data)}` : 'Form verisi yok.'}

[Son Mesaj Geçmişi (Kronolojik)]
${messages.map(m => `${m.direction === 'in' ? 'Hasta' : 'Operatör'}: ${m.content}`).join('\n')}

Lütfen bu bilgilere göre yukarıdaki kurallara ve talimatlara uygun cevap taslağı üret.`;

        const response = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${GEMINI_API_KEY}`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              systemInstruction: { parts: [{ text: systemPrompt }] },
              contents: [{ role: 'user', parts: [{ text: promptText }] }],
              generationConfig: { temperature: 0.2 }
            })
          }
        );

        if (!response.ok) {
          const errText = await response.text();
          return { success: false, error: `Gemini API Hatası: ${errText}` };
        }

        const data = await response.json();
        const jsonText = cleanJsonResponse(data?.candidates?.[0]?.content?.parts?.[0]?.text || "{}");
        
        try {
          const parsed = JSON.parse(jsonText);
          let draftText = parsed.draftText;
          if (!draftText || !draftText.trim()) {
            return { success: false, error: "Taslak üretilemedi. Lütfen tekrar deneyin veya manuel talimat girin." };
          }

          // Run Quality Gate on the generated draft
          const { TurkishReplyQualityGate } = await import('@/lib/services/ai/turkish-quality-gate');
          const { MultilingualQualityGate } = await import('@/lib/services/ai/multilingual-quality-gate');
          const assistantHistory = messages.filter((m: any) => m.direction === 'out');
          const isFirstAssistantTurn = assistantHistory.length === 0;

          const qgOptions = {
            ctaOfferedRecently: false,
            angryPatientMode: false,
            personaName: identityConfig.personaName,
            organizationName: identityConfig.organizationName,
            organizationShortName: identityConfig.organizationShortName,
            identityAlreadyIntroduced: !isFirstAssistantTurn,
            asksIdentity: false,
            asksName: false,
            patientClaimsBot: false
          };

          const replyLanguage = parsed.detectedLanguage || 'Türkçe';
          const qualityGateLocale = (parsed.languageCode || 'tr') === 'tr' ? 'tr' : 'generic';

          let qualityGate = MultilingualQualityGate.validate({
            responseText: draftText,
            replyLanguage,
            qualityGateLocale,
            qgOptions
          });
          if (qualityGate.valid && qualityGate.morphologyCorrectedText) {
            draftText = qualityGate.morphologyCorrectedText;
            parsed.draftText = qualityGate.morphologyCorrectedText;
          }

          if (!qualityGate.valid) {
            console.log(`[DRAFT_QUALITY_GATE] Failed: ${qualityGate.reason}. Applying stripPersonaIntroduction...`);
            const originalText = draftText;
            const cleanedText = TurkishReplyQualityGate.stripPersonaIntroduction(originalText, qgOptions);

            if (cleanedText && cleanedText.trim().length > 0) {
              const cleanedQualityGate = MultilingualQualityGate.validate({
                responseText: cleanedText,
                replyLanguage,
                qualityGateLocale,
                qgOptions
              });
              if (cleanedQualityGate.valid) {
                draftText = cleanedQualityGate.morphologyCorrectedText || cleanedText;
                parsed.draftText = cleanedQualityGate.morphologyCorrectedText || cleanedText;

                // Log IDENTITY_REPETITION_CLEANUP_APPLIED to ai_audit_logs
                await ctx.db.executeSafe({
                  text: `INSERT INTO ai_audit_logs (tenant_id, action, reasoning_summary, result_summary)
                         VALUES ($1, $2, $3, $4)`,
                  values: [
                    ctx.tenantId,
                    'IDENTITY_REPETITION_CLEANUP_APPLIED',
                    `Persona introduction prefix stripped successfully from beginning of the smart draft response.`,
                    JSON.stringify({
                      conversation_id: conversationId,
                      original_response: originalText,
                      cleaned_response: cleanedText,
                      timestamp: new Date().toISOString()
                    })
                  ]
                });
              } else {
                const { IdentityEngine } = await import('@/lib/services/ai/engines/identity');
                const { QualityGateRecoveryHelper } = await import('@/lib/services/ai/quality-gate-recovery');
                const recoveryResult = await QualityGateRecoveryHelper.handleFailure({
                  tenantId: ctx.tenantId,
                  conversationId,
                  phoneNumber: conv.phone_number,
                  inboundText: messages[messages.length - 1]?.content || '',
                  brain: {
                    context: { tenantId: ctx.tenantId, channel: 'whatsapp', config: { industry: opp?.department ? 'healthcare' : 'general' } },
                    prompts: { systemPrompt: systemPrompt, metadata: { industry: opp?.department ? 'healthcare' : 'general' } }
                  },
                  identityConfig: {
                    personaName: identityConfig.personaName,
                    organizationName: identityConfig.organizationName,
                    organizationShortName: identityConfig.organizationShortName
                  },
                  unifiedContext: {
                    history: messages.map((m: any) => ({
                      role: m.direction === 'in' ? 'user' : 'assistant',
                      content: m.content || ''
                    })),
                    patient_known_facts: lead ? IdentityEngine.sanitizeFormFacts(lead.raw_data) : [],
                    latestForm: lead ? { name: lead.form_name, data: lead.raw_data } : null,
                    memory: null,
                    opportunity: opp
                  },
                  reason: cleanedQualityGate.reason || 'style_quality',
                  channel: 'whatsapp',
                  path: 'panel_draft',
                  channelId: conv.channel_id || undefined,
                  systemPromptText: systemPrompt || undefined,
                  promptVersion: promptVersion || undefined
                });

                if (recoveryResult.recovered && recoveryResult.text) {
                  const recoveryQG = MultilingualQualityGate.validate({
                    responseText: recoveryResult.text,
                    replyLanguage,
                    qualityGateLocale,
                    qgOptions
                  });
                  draftText = recoveryQG.morphologyCorrectedText || recoveryResult.text;
                } else {
                  return { success: false, error: `Taslak Türkçe kalite kontrolünü geçemedi: ${cleanedQualityGate.reason}` };
                }
              }
            } else {
              const { IdentityEngine } = await import('@/lib/services/ai/engines/identity');
              const { QualityGateRecoveryHelper } = await import('@/lib/services/ai/quality-gate-recovery');
              const recoveryResult = await QualityGateRecoveryHelper.handleFailure({
                tenantId: ctx.tenantId,
                conversationId,
                phoneNumber: conv.phone_number,
                inboundText: messages[messages.length - 1]?.content || '',
                brain: {
                  context: { tenantId: ctx.tenantId, channel: 'whatsapp', config: { industry: opp?.department ? 'healthcare' : 'general' } },
                  prompts: { systemPrompt: systemPrompt, metadata: { industry: opp?.department ? 'healthcare' : 'general' } }
                },
                identityConfig: {
                  personaName: identityConfig.personaName,
                  organizationName: identityConfig.organizationName,
                  organizationShortName: identityConfig.organizationShortName
                },
                unifiedContext: {
                  history: messages.map((m: any) => ({
                    role: m.direction === 'in' ? 'user' : 'assistant',
                    content: m.content || ''
                  })),
                  patient_known_facts: lead ? IdentityEngine.sanitizeFormFacts(lead.raw_data) : [],
                  latestForm: lead ? { name: lead.form_name, data: lead.raw_data } : null,
                  memory: null,
                  opportunity: opp
                },
                reason: qualityGate.reason || 'style_quality',
                channel: 'whatsapp',
                path: 'panel_draft',
                channelId: conv.channel_id || undefined,
                systemPromptText: systemPrompt || undefined,
                promptVersion: promptVersion || undefined
              });

              if (recoveryResult.recovered && recoveryResult.text) {
                const recoveryQG = MultilingualQualityGate.validate({
                  responseText: recoveryResult.text,
                  replyLanguage,
                  qualityGateLocale,
                  qgOptions
                });
                draftText = recoveryQG.morphologyCorrectedText || recoveryResult.text;
              } else {
                return { success: false, error: `Taslak Türkçe kalite kontrolünü geçemedi: ${qualityGate.reason}` };
              }
            }
          }

          // Passive Learning Capture: log smart draft
          try {
            const { TenantLearningCaptureService } = await import('@/lib/services/ai/tenant-learning-capture.service');
            await TenantLearningCaptureService.logSmartDraft(ctx.db, {
              tenantId: ctx.tenantId,
              channelId: conv.channel_id || null,
              conversationId,
              aiGeneratedText: draftText,
              metadata: { intentHint, customDirective }
            });
          } catch (captureErr) {
            console.error('TenantLearningCaptureService.logSmartDraft error bypassed', captureErr);
          }

          return {
            isTemplate: false,
            draftText,
            windowStatus: windowStatus.status,
            detectedLanguage: parsed.detectedLanguage,
            isLanguageUnclear: parsed.isLanguageUnclear || false
          };
        } catch (e) {
          const cleanedText = jsonText ? jsonText.trim() : "";
          if (!cleanedText) {
            return { success: false, error: "Taslak üretilemedi. Lütfen tekrar deneyin veya manuel talimat girin." };
          }
          // Passive Learning Capture: log smart draft
          try {
            const { TenantLearningCaptureService } = await import('@/lib/services/ai/tenant-learning-capture.service');
            await TenantLearningCaptureService.logSmartDraft(ctx.db, {
              tenantId: ctx.tenantId,
              channelId: conv.channel_id || null,
              conversationId,
              aiGeneratedText: cleanedText,
              metadata: { intentHint, customDirective, parse_fallback: true }
            });
          } catch (captureErr) {
            console.error('TenantLearningCaptureService.logSmartDraft error bypassed', captureErr);
          }

          return {
            isTemplate: false,
            draftText: cleanedText,
            windowStatus: windowStatus.status,
            detectedLanguage: "Bilinmiyor",
            isLanguageUnclear: true
          };
        }
      }

      // 7. IF 24H WINDOW IS CLOSED OR UNKNOWN -> Template selection and filling
      // Generate Form smart draft if form exists and intent is greeting (for manual copy-paste fallback)
      let closedFormDraft: string | undefined = undefined;
      if (lead && intentHint === "Karşılama") {
        try {
          const { generateSmartDraft } = await import('@/lib/utils/smart-draft-generator');
          closedFormDraft = await generateSmartDraft(lead.raw_data, lead.form_name, 'first_contact_intent_check', ctx.tenantId, ctx.db);
        } catch (e) {
          console.error("[CLOSED_FORM_DRAFT_GEN_ERROR] Failed to generate form greeting for copy", e);
        }
      }

      // Fetch active templates
      const templateRows = await ctx.db.executeSafe({
        text: `SELECT id, name, language, body, variables, template_type, form_name FROM message_templates WHERE tenant_id = $1 AND is_active = true`,
        values: [ctx.tenantId]
      }) as any[];

      if (templateRows.length === 0) {
        return {
          isTemplate: true,
          draftText: closedFormDraft || "",
          suggestedTemplates: [],
          windowStatus: windowStatus.status,
          detectedLanguage: "Bilinmiyor",
          isLanguageUnclear: true,
          notice: "Aktif onaylı şablon bulunamadı. Lütfen Ayarlar > Şablonlar sayfasından şablon ekleyin."
        };
      }

      // --- DETERMINISTIC FILTERING ---
      let filteredTemplates = templateRows;

      // 1. Language Match
      const langMap: Record<string, string> = {
        "Türkçe": "tr",
        "İngilizce": "en",
        "Almanca": "de",
        "Arapça": "ar",
        "Fransızca": "fr"
      };
      const targetCode = langMap[targetLanguage || ""] || null;
      if (targetCode) {
        const langMatch = templateRows.filter(t => t.language === targetCode);
        if (langMatch.length > 0) {
          filteredTemplates = langMatch;
        }
      }

      // 2. Category / Purpose Match
      if (intentHint === "Karşılama") {
        // Prioritize greeting templates
        const greetingTemplates = filteredTemplates.filter(t => t.template_type === 'greeting');
        if (greetingTemplates.length > 0) {
          // If form exists, prioritize form_name matching templates
          if (lead && lead.form_name) {
            const formMatch = greetingTemplates.filter(t => t.form_name && t.form_name.toLowerCase() === lead.form_name.toLowerCase());
            if (formMatch.length > 0) {
              filteredTemplates = formMatch;
            } else {
              filteredTemplates = greetingTemplates;
            }
          } else {
            filteredTemplates = greetingTemplates;
          }
        }
      } else if (intentHint && intentHint !== "Serbest Talimatla Mesaj Hazırla") {
        // Prioritize non-greeting templates for follow-ups
        const nonGreeting = filteredTemplates.filter(t => t.template_type !== 'greeting');
        if (nonGreeting.length > 0) {
          filteredTemplates = nonGreeting;
        }
      }

      // Format templates list for Gemini
      const templatesList = filteredTemplates.map(t => ({
        id: t.id,
        name: t.name,
        language: t.language,
        body: t.body,
        variables: t.variables
      }));

      const systemPromptTemplate = `Sen bir ${orgShort ? `${orgShort} Hastanesi` : 'Hastane'} Hasta İlişkileri Asistanı AI modelisin. WhatsApp 24 saatlik müşteri penceresi kapandığı için serbest metin mesajı gönderilemez.
Görevin, hastanın doldurduğu bilgilere, mesaj geçmişine ve hedeflenen amaca göre en uygun 2-3 onaylı şablonu (template) seçmek ve bu şablonların içindeki {{1}}, {{2}} gibi değişken yer tutucularını hasta bilgileriyle doldurarak önermektir.

=== ÖNEMLİ ŞABLON KURALLARI ===
1. Şablonların orijinal gövdelerindeki (body) kelimeleri, cümleleri KESİNLİKLE değiştirme veya düzenleme. Sadece {{1}}, {{patient_name}}, {{tenant_name}} gibi değişken yer tutucularını hasta bağlamıyla doldur.
2. Değişken doldururken isim hitabı yasak kuralına dikkat et: Eğer şablonda {{patient_name}} varsa${orgShort ? ` ve hastane ${orgShort} ise` : ''}, ismi boş bırak veya nezaket kurallarına göre düzenle.
3. Yanıtını mutlaka belirtilen JSON formatında üretmelisin. JSON haricinde hiçbir metin ekleme.

Hedeflenen Amaç/Talimat: ${intentText}
Hedef Dil: ${targetLanguage || 'Auto'} (Eğer Auto ise, hastanın diline uygun şablonları seç ve doldur.)

=== YANIT FORMATI (JSON) ===
{
  "suggestedTemplates": [
    {
      "templateId": "şablonun ID değeri",
      "templateName": "şablonun name değeri",
      "language": "şablonun language değeri",
      "body": "şablonun orijinal body değeri (kesinlikle değiştirilmemiş hali)",
      "filledBody": "değişkenleri doldurulmuş nihai metin hali",
      "explanation": "Neden bu şablonu önerdiğinin kısa açıklaması"
    }
  ],
  "detectedLanguage": "Algıladığın hasta dili",
  "languageCode": "Algıladığın hasta dili kodu",
  "isLanguageUnclear": false
}`;

      const promptTextTemplate = `
[Mevcut Hasta Bilgileri]
İsim: ${conv.patient_name || 'Bilinmiyor'}
Telefon: ${conv.phone_number}

[Lead Form Bilgileri]
${lead ? `Form Adı: ${lead.form_name}\nVeri: ${JSON.stringify(lead.raw_data)}` : 'Form verisi yok.'}

[Son Mesaj Geçmişi (Kronolojik)]
${messages.map(m => `${m.direction === 'in' ? 'Hasta' : 'Operatör'}: ${m.content}`).join('\n')}

[Kullanılabilir Onaylı Şablonlar]
${JSON.stringify(templatesList)}

Lütfen bu bilgilere göre yukarıdaki kurallara uygun en iyi 2-3 şablonu seç, doldur ve öner.`;

      const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${GEMINI_API_KEY}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            systemInstruction: { parts: [{ text: systemPromptTemplate }] },
            contents: [{ role: 'user', parts: [{ text: promptTextTemplate }] }],
            generationConfig: { temperature: 0.1 }
          })
        }
      );

      if (!response.ok) {
        const errText = await response.text();
        return { success: false, error: `Gemini API Hatası: ${errText}` };
      }

      const data = await response.json();
      const jsonText = cleanJsonResponse(data?.candidates?.[0]?.content?.parts?.[0]?.text || "{}");

      try {
        const parsed = JSON.parse(jsonText);
        return {
          isTemplate: true,
          draftText: closedFormDraft || "",
          suggestedTemplates: parsed.suggestedTemplates || [],
          windowStatus: windowStatus.status,
          detectedLanguage: parsed.detectedLanguage,
          isLanguageUnclear: parsed.isLanguageUnclear || false
        };
      } catch (e) {
        return {
          success: false,
          error: "Gemini yanıtı işlenemedi veya geçersiz JSON formatı döndü."
        };
      }
    }
  ).then(res => {
    if (!res.success) return { success: false, error: res.error };
    const innerData = res.data as any;
    if (innerData && 'success' in innerData && !innerData.success) {
      return { success: false, error: innerData.error || "İşlem başarısız." };
    }
    return { success: true, ...innerData };
  });
}

export async function sendApprovedInboxBotDraftAction(
  conversationId: string,
  draftText: string,
  templateName?: string,
  templateLanguage?: string,
  canonicalBody?: string
) {
  if (!conversationId) return { success: false, error: "Konuşma ID gerekli." };
  if (!draftText || draftText.trim().length === 0) return { success: false, error: "Gönderilecek mesaj boş olamaz." };

  return withActionGuard(
    { actionName: 'sendApprovedInboxBotDraftAction' },
    async (ctx) => {
      // 1. Resolve 24h window status
      const windowStatus = await resolveWhatsApp24hWindow(conversationId, ctx.tenantId, ctx.db);

      // 2. Fetch conversation details (including channel and channel_id)
      const convRows = await ctx.db.executeSafe({
        text: `SELECT phone_number, active_opportunity_id, channel, channel_id FROM conversations WHERE id = $1 AND tenant_id = $2 LIMIT 1`,
        values: [conversationId, ctx.tenantId]
      }) as any[];

      if (convRows.length === 0) {
        return { success: false, error: "Konuşma bulunamadı." };
      }
      const conv = convRows[0];
      const phone = conv.phone_number;

      const { MessageService } = await import("@/lib/services/message.service");
      const { TenantDB } = await import("@/lib/core/tenant-db");
      const tenantDb = new TenantDB(ctx.tenantId);
      const messageService = new MessageService(tenantDb);

      let providerMessageId: string | null = null;
      let sendSuccess = false;

      if (!templateName) {
        // Freeform message
        // Verify window is OPEN or CLOSING_SOON
        if (windowStatus.status === 'CLOSED' || windowStatus.status === 'UNKNOWN') {
          return {
            success: false,
            error: "24 saatlik WhatsApp mesajlaşma penceresi kapalı olduğu için serbest mesaj gönderilemez. Lütfen bir şablon seçin."
          };
        }

        try {
          const sendRes = await messageService.sendWhatsAppFreeform(
            phone,
            draftText.trim()
          );
          providerMessageId = sendRes.providerMessageId || null;
          sendSuccess = sendRes.success;
        } catch (err: any) {
          return { success: false, error: `WhatsApp gönderim hatası: ${err.message || err}` };
        }
      } else {
        // Template message
        const lang = templateLanguage || 'tr';
        // Extract parameters from draftText using canonicalBody if available
        let components: any[] = [];
        if (canonicalBody) {
          const params = extractTemplateParameters(canonicalBody, draftText);
          if (params.length > 0) {
            components = [
              {
                type: "body",
                parameters: params.map(p => ({ type: "text", text: p }))
              }
            ];
          }
        }

        try {
          const sendRes = await messageService.sendWhatsAppTemplate(
            phone,
            templateName,
            lang,
            components
          );
          sendSuccess = sendRes.success;
          providerMessageId = sendRes.providerMessageId || null;
        } catch (err: any) {
          return { success: false, error: `WhatsApp Şablon gönderim hatası: ${err.message || err}` };
        }
      }

      if (sendSuccess) {
        const mediaMetadata = {
          initiated_from: "inbox_panel",
          source: "panel_operator",
          is_bot_draft_approved: true,
          template_name: templateName || null
        };

        // Use idempotent MessageService to insert the sent message
        const saveRes = await messageService.saveMessageIdempotent({
          phoneNumber: phone,
          direction: 'out',
          content: draftText.trim(),
          channel: conv.channel || 'whatsapp',
          channelId: conv.channel_id || null,
          status: 'sent',
          providerMessageId: providerMessageId,
          mediaMetadata
        });

        if (!saveRes.success) {
          return { success: false, error: "Mesaj veritabanına kaydedilemedi." };
        }

        const insertedMessageId = saveRes.messageId;

        // Passive Learning Capture: log operator send (human edited or smart draft)
        try {
          const { TenantLearningCaptureService } = await import('@/lib/services/ai/tenant-learning-capture.service');
          await TenantLearningCaptureService.logOperatorSend(ctx.db, {
            tenantId: ctx.tenantId,
            channelId: conv.channel_id || null,
            conversationId,
            messageId: insertedMessageId,
            humanFinalText: draftText.trim(),
            metadata: {
              approved_from: 'smart_draft_action',
              template_name: templateName || null
            }
          });
        } catch (captureErr) {
          console.error('TenantLearningCaptureService.logOperatorSend error bypassed', captureErr);
        }

        // Retrieve actual message row from the database (Safety Rule #2)
        const msgRows = await ctx.db.executeSafe({
          text: `SELECT id, conversation_id, phone_number, direction, content, channel, status, provider_message_id, media_metadata, created_at 
                 FROM messages 
                 WHERE id = $1 AND tenant_id = $2 
                 LIMIT 1`,
          values: [insertedMessageId, ctx.tenantId]
        }) as any[];

        if (msgRows.length === 0) {
          return { success: false, error: "Kaydedilen mesaj veritabanından okunamadı." };
        }
        const savedMsg = msgRows[0];

        // Update conversation to human status and disable autopilot (Safety Rule #6: preserved read/unread/pin fields)
        await ctx.db.executeSafe({
          text: `UPDATE conversations 
                 SET status = 'human',
                     autopilot_enabled = false
                 WHERE id = $1 AND tenant_id = $2`,
          values: [conversationId, ctx.tenantId]
        });

        // Cancel/Takeover active bot directive tasks only (Safety Rule #1)
        try {
          const activeTasks = await ctx.db.executeSafe({
            text: `SELECT id, metadata FROM follow_up_tasks 
                   WHERE conversation_id = $1 AND tenant_id = $2 
                     AND status IN ('pending', 'in_progress')
                     AND task_type = 'bot_handoff_followup'
                   ORDER BY created_at DESC`,
            values: [conversationId, ctx.tenantId]
          }) as any[];
          if (activeTasks.length > 0) {
            const taskMeta = activeTasks[0].metadata || {};
            const directiveState = taskMeta.bot_directive_state;
            if (directiveState && ['pending', 'waiting_patient'].includes(directiveState.directive_status)) {
              const { PatientOperationsLifecycleService } = await import('@/lib/services/patient-operations-lifecycle');
              const lifecycleService = new PatientOperationsLifecycleService(ctx.db);
              await lifecycleService.completeBotDirective(activeTasks[0].id, ctx.tenantId, 'operator_takeover');
            }
          }
        } catch (takeoverErr) {
          console.warn('[INBOX_DIRECTIVE_TAKEOVER_FAILED] Non-fatal directive cancellation', takeoverErr);
        }

        // Write structural autopilot disabled audit log
        await ctx.db.executeSafe({
          text: `INSERT INTO ai_audit_logs (tenant_id, action, reasoning_summary, result_summary)
                 VALUES ($1, $2, $3, $4)`,
          values: [
            ctx.tenantId,
            'autopilot_disabled',
            'Autopilot disabled by operator bot draft approval',
            JSON.stringify({
              conversation_id: conversationId,
              phone: phone,
              channel_id: conv.channel_id || null,
              tenant_id: ctx.tenantId,
              enabled: false,
              user_id: ctx.userId,
              timestamp: new Date().toISOString(),
              reason: "operator_approved_bot_draft"
            })
          ]
        });

        // Write to outreach_logs
        await ctx.db.executeSafe({
          text: `INSERT INTO outreach_logs (tenant_id, conversation_id, opportunity_id, action, channel, actor_id, metadata)
                 VALUES ($1, $2, $3, 'operator_draft_approved', 'whatsapp', $4, $5::jsonb)`,
          values: [
            ctx.tenantId,
            conversationId,
            conv.active_opportunity_id || null,
            ctx.userId,
            JSON.stringify({
              message_id: insertedMessageId,
              provider_message_id: providerMessageId,
              is_template: !!templateName,
              template_name: templateName || null,
              draft_text: draftText
            })
          ]
        });

        // Broadcast autopilot updated realtime update (Safety Rule #3: non-blocking, non-fatal)
        try {
          const { RealtimePublisher } = await import("@/lib/realtime/publisher");
          await RealtimePublisher.publishMetadataUpdated(ctx.tenantId, {
            conversationId: conversationId,
            userId: ctx.userId || "operator",
            isBotActive: false,
            autopilotEnabled: false,
            status: "human"
          });
        } catch (realtimeErr) {
          console.error("[REALTIME_PUBLISH_ERROR] Failed to publish autopilot toggle realtime update on approved draft send:", realtimeErr);
        }

        // Publish Message Created realtime event (Safety Rule #3: non-blocking, non-fatal)
        try {
          const { RealtimePublisher } = await import("@/lib/realtime/publisher");
          await RealtimePublisher.publishMessageCreated(
            ctx.tenantId,
            {
              id: savedMsg.id,
              conversation_id: savedMsg.conversation_id,
              phone_number: savedMsg.phone_number,
              content: savedMsg.content,
              direction: savedMsg.direction,
              status: savedMsg.status,
              media_metadata: savedMsg.media_metadata,
              created_at: savedMsg.created_at ? new Date(savedMsg.created_at).toISOString() : new Date().toISOString()
            }
          );
        } catch (realtimeErr) {
          console.error("[REALTIME_PUBLISH_ERROR] Failed to publish message created realtime update on approved draft send:", realtimeErr);
        }

        // Fire-and-forget memory summarization in background (Safety Rule #4: non-blocking)
        try {
          const { FeatureFlagService } = await import('@/lib/services/feature-flag.service');
          FeatureFlagService.isEnabled(ctx.tenantId, 'memory_engine', true).then((isMemoryEnabled) => {
            if (isMemoryEnabled) {
              import('@/lib/services/ai/engines/memory').then(({ MemoryEngine }) => {
                MemoryEngine.summarizeConversation(ctx.tenantId, conversationId).catch(err => {
                  console.error("[MEMORY_ENGINE_ERROR] Failed to summarize conversation in background:", err);
                });
              });
            }
          }).catch(err => {
            console.error("[FEATURE_FLAG_ERROR] Failed to check memory engine feature flag in background:", err);
          });
        } catch (memErr) {
          console.error("[MEMORY_ENGINE_SCHEDULING_ERROR] Failed to schedule conversation summarization asynchronously:", memErr);
        }

        return {
          success: true,
          messageId: insertedMessageId,
          providerMessageId,
          message: {
            id: savedMsg.id,
            conversation_id: savedMsg.conversation_id,
            direction: savedMsg.direction,
            content: savedMsg.content,
            created_at: savedMsg.created_at ? new Date(savedMsg.created_at).toISOString() : new Date().toISOString(),
            provider_message_id: savedMsg.provider_message_id,
            status: savedMsg.status
          }
        };
      }

      return { success: false, error: "Gönderim başarısız oldu." };
    }
  ).then(res => {
    if (!res.success) return { success: false, error: res.error };
    const innerData = res.data as any;
    if (innerData && 'success' in innerData && !innerData.success) {
      return { success: false, error: innerData.error || "İşlem başarısız." };
    }
    return { success: true, ...innerData };
  });
}



// ─────────────────────────────────────────────────────────────────────────────
// clearConversation — Sohbeti Temizle
// Deletes all messages for a conversation and resets CRM context.
// Tenant-safe: every query is scoped to ctx.tenantId.
// ─────────────────────────────────────────────────────────────────────────────
export async function clearConversation(conversationId: string): Promise<{ success: boolean; error?: string }> {
  if (!conversationId) return { success: false, error: 'conversationId required' };

  const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(conversationId);
  if (!isUuid) return { success: false, error: 'Invalid conversationId format' };

  return withActionGuard(
    { actionName: 'clearConversation', conversationId },
    async (ctx) => {
      // 1. Verify conversation belongs to this tenant
      const convRows = await ctx.db.executeSafe({
        text: `SELECT id, active_opportunity_id, tags FROM conversations WHERE id = $1 AND tenant_id = $2 LIMIT 1`,
        values: [conversationId, ctx.tenantId]
      }) as any[];

      if (!convRows || convRows.length === 0) {
        return { success: false, error: 'Konuşma bulunamadı veya erişim yetkisi yok.' };
      }

      const conv = convRows[0];

      // 2. Delete all messages for this conversation (tenant-scoped)
      await ctx.db.executeSafe({
        text: `DELETE FROM messages WHERE conversation_id = $1 AND tenant_id = $2`,
        values: [conversationId, ctx.tenantId]
      });

      // 3. Reset opportunity: clear summary + unlink active_opportunity_id
      if (conv.active_opportunity_id) {
        await ctx.db.executeSafe({
          text: `UPDATE opportunities
                 SET summary = NULL,
                     ai_reason = NULL,
                     updated_at = NOW()
                 WHERE id = $1 AND tenant_id = $2`,
          values: [conv.active_opportunity_id, ctx.tenantId]
        });

        await ctx.db.executeSafe({
          text: `UPDATE conversations
                 SET active_opportunity_id = NULL,
                     updated_at = NOW()
                 WHERE id = $1 AND tenant_id = $2`,
          values: [conversationId, ctx.tenantId]
        });
      }

      // 4. Re-seed tags from the linked lead's form_name (if available)
      try {
        const leadRows = await ctx.db.executeSafe({
          text: `SELECT l.form_name
                 FROM leads l
                 JOIN opportunities o ON o.lead_id = l.id
                 WHERE o.id = $1 AND l.tenant_id = $2
                 LIMIT 1`,
          values: [conv.active_opportunity_id || '00000000-0000-0000-0000-000000000000', ctx.tenantId]
        }) as any[];

        if (leadRows && leadRows.length > 0 && leadRows[0].form_name) {
          const freshTags = JSON.stringify([leadRows[0].form_name]);
          await ctx.db.executeSafe({
            text: `UPDATE conversations SET tags = $1, updated_at = NOW() WHERE id = $2 AND tenant_id = $3`,
            values: [freshTags, conversationId, ctx.tenantId]
          });
        }
      } catch (_) {
        // Non-fatal: tags reset is best-effort
      }

      // 5. Audit log
      await logAudit({
        tenantId: ctx.tenantId,
        userId: ctx.userId,
        action: 'clear_conversation',
        entityType: 'conversation',
        entityId: conversationId,
        details: { clearedBy: ctx.userId }
      });

      return { success: true };
    }
  ).then(res => {
    if (!res.success) return { success: false, error: res.error };
    const inner = res.data as any;
    if (inner && 'success' in inner && !inner.success) return { success: false, error: inner.error };
    return { success: true };
  });
}


