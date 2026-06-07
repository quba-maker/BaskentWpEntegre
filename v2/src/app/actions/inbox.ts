"use server";

import { withActionGuard } from "@/lib/core/action-guard";
import { logAudit } from "@/lib/audit";
import { enqueueRetry } from "@/lib/retry";
import { CredentialsService } from "@/lib/services/credentials.service";
import { PatientNameSyncService } from "@/lib/services/patient-name-sync";
import { resolvePatientDisplayName, checkNameValidity, resolvePatientNameDetailed } from "@/lib/utils/patient-name-resolver";
import { getCountryFromPhone } from "@/lib/utils/country";
import { extractFormFields } from "@/lib/utils/form-field-extractor";
import { normalizeCountry, getCountryDisplayLabel, resolvePatientCountryDetailed } from "@/lib/utils/country-normalizer";
import { ExpectsReplyClassifier } from "@/lib/services/classification/expects-reply-classifier";
import { normalizePhoneForIdentity, parseAllPhones } from "@/lib/utils/phone-identity";

// ==========================================
// QUBA AI — Inbox Actions (Zero-Trust Migrated)
// ==========================================

export async function getConversations(page: number = 1, search: string = "", stage: string = "all") {
  noStore();
  return withActionGuard(
    { actionName: 'getConversations' },
    async (ctx) => {
      const limit = 50;
      const offset = (page - 1) * limit;
      const searchFilter = search.trim() ? `%${search.trim()}%` : null;
      
      const isNoReplyFilter = stage && stage.startsWith('noReply');
      const isUnreadFilter = stage === 'unread';
      const isFavoritesFilter = stage === 'favorites';
      const isArchivedFilter = stage === 'archived';
      const isBotActiveFilter = stage === 'botActive';

      let noReplyHours: number | null = null;
      if (isNoReplyFilter) {
        const match = stage.match(/noReply_(\d+)h/);
        if (match) {
          noReplyHours = parseInt(match[1], 10);
        }
      }

      const stageFilter = (isNoReplyFilter || isUnreadFilter || isFavoritesFilter || isArchivedFilter || isBotActiveFilter) 
        ? null 
        : (stage !== "all" ? stage : null);

      const optOutPhones = new Set<string>();
      if (isNoReplyFilter) {
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
      }

      // ── FORENSIC TRACE: Log the tenant context being used ──
      console.log(`[INBOX_FORENSIC] getConversations called | tenantId=${ctx.tenantId} | page=${page} | search="${search}" | stage="${stage}" | noReplyHours=${noReplyHours}`);

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
          -- P1B: Tags from active opportunity (scoped), fallback to conversation tags
          COALESCE(active_opp.tags::text, c.tags) as tags,
          c.tags as conv_tags_raw,
          c.channel,
          c.notes as notes,
          c.last_message_at,
          EXTRACT(EPOCH FROM c.last_message_at) * 1000 as last_message_time_ms,
          m.content as last_message,
          m.status as last_message_status,
          m.direction as last_message_direction,
          m.model_used as last_message_model,
          m.media_type as last_message_media_type,
          m.media_url as last_message_media_url,
          l.id as lead_id,
          l.form_name,
          l.patient_name as form_patient_name,
          l.raw_data as form_raw_data,
          EXTRACT(EPOCH FROM l.created_at) * 1000 as form_date_ms,
          -- P1B: Active opportunity fields (source of truth)
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
          -- P1B FIX: No global fallback — prevents Mehmet/Irak leaking into Almanya/Kardiyoloji
          active_opp.summary as ai_summary,
          mem.summary_text as legacy_ai_summary,
          mem.buying_intent as ai_buying_intent,
          mem.sentiment as ai_sentiment,
          (
            SELECT COUNT(*)::int 
            FROM messages m_unread
            WHERE m_unread.conversation_id = c.id
              AND m_unread.tenant_id = c.tenant_id
              AND m_unread.direction = 'in'
              AND (m_unread.media_metadata IS NULL OR COALESCE(m_unread.media_metadata->'native'->>'message_type', '') != 'reaction')
              AND m_unread.created_at > COALESCE(
                (SELECT last_read_at FROM conversation_read_states rs WHERE rs.tenant_id = c.tenant_id AND rs.user_id = $6 AND rs.conversation_id = c.id),
                '1970-01-01'::timestamptz
              )
          ) as unread,
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
          SELECT id, form_name, patient_name, raw_data, created_at 
          FROM leads 
          WHERE leads.tenant_id = $1
            AND (
              (c.customer_id IS NOT NULL AND leads.customer_id = c.customer_id)
              OR
              (
                leads.phone_number LIKE '%' || RIGHT(COALESCE(c.real_phone, c.phone_number), 10) || '%'
                OR (
                  leads.raw_data IS NOT NULL 
                  AND leads.raw_data != ''
                  AND leads.raw_data LIKE '%_all_phones%'
                  AND (
                    CASE
                      WHEN jsonb_typeof(leads.raw_data::jsonb->'_all_phones') = 'array' 
                        THEN (leads.raw_data::jsonb->'_all_phones') @> jsonb_build_array(COALESCE(c.real_phone, c.phone_number))
                      WHEN jsonb_typeof(leads.raw_data::jsonb->'_all_phones') = 'string' 
                        THEN (leads.raw_data::jsonb->>'_all_phones')::jsonb @> jsonb_build_array(COALESCE(c.real_phone, c.phone_number))
                      ELSE false
                    END
                  )
                )
              )
            )
          ORDER BY created_at DESC 
          LIMIT 1
        ) l ON true
        LEFT JOIN conversation_memory mem ON c.id = mem.conversation_id
        -- P1B: Active opportunity JOIN (tenant safety enforced)
        LEFT JOIN opportunities active_opp 
          ON active_opp.id = c.active_opportunity_id 
          AND active_opp.tenant_id = c.tenant_id
          AND active_opp.conversation_id = c.id
        LEFT JOIN LATERAL (
          SELECT id as active_task_id, task_type as active_task_type, status as active_task_status
          FROM follow_up_tasks
          WHERE opportunity_id = active_opp.id
            AND tenant_id = c.tenant_id
            AND status = 'pending'
          ORDER BY due_at ASC, created_at DESC
          LIMIT 1
        ) active_task ON true
        -- Pinned Join
        LEFT JOIN conversation_pins cp
          ON c.id = cp.conversation_id
          AND cp.user_id = $6
          AND cp.tenant_id = c.tenant_id
        -- Favorites Join
        LEFT JOIN conversation_favorites cf
          ON c.id = cf.conversation_id
          AND cf.user_id = $6
          AND cf.tenant_id = c.tenant_id
        -- Archives Join
        LEFT JOIN conversation_archives ca
          ON c.id = ca.conversation_id
          AND ca.user_id = $6
          AND ca.tenant_id = c.tenant_id
        WHERE c.tenant_id = $1
          AND ($2::text IS NULL OR c.patient_name ILIKE $2 OR c.phone_number ILIKE $2)
          AND ($3::text IS NULL OR c.lead_stage = $3)
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
                  AND m_unread.created_at > COALESCE(
                    (SELECT last_read_at FROM conversation_read_states rs WHERE rs.tenant_id = c.tenant_id AND rs.user_id = $6 AND rs.conversation_id = c.id),
                    '1970-01-01'::timestamptz
                  )
              )
            )
          `)}
      `;

      const values: any[] = [ctx.tenantId, searchFilter, stageFilter, limit, offset, ctx.userId];

      if (isNoReplyFilter) {
        values.push(noReplyHours);
        queryText += `
          AND c.id IN (
            SELECT sub.conversation_id
            FROM (
              SELECT DISTINCT ON (m.conversation_id) m.conversation_id, m.direction, m.created_at
              FROM messages m
              WHERE m.tenant_id = $1
                AND m.direction != 'system'
                AND (m.media_metadata IS NULL OR COALESCE(m.media_metadata->'native'->>'message_type', '') != 'reaction')
              ORDER BY m.conversation_id, m.created_at DESC
            ) sub
            WHERE sub.direction = 'out'
              AND ($7::integer IS NULL OR sub.created_at <= NOW() - ($7::integer || ' hour')::interval)
          )
        `;
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
              AND m_unread.created_at > COALESCE(
                (SELECT last_read_at FROM conversation_read_states rs WHERE rs.tenant_id = c.tenant_id AND rs.user_id = $6 AND rs.conversation_id = c.id),
                '1970-01-01'::timestamptz
              )
          )
        `;
      }

      queryText += ` ORDER BY (cp.id IS NOT NULL) DESC, c.last_message_at DESC NULLS LAST `;

      if (!isNoReplyFilter) {
        queryText += ` LIMIT $4 OFFSET $5 `;
      }

      const rows = await ctx.db.executeSafe({
        text: queryText,
        values
      });

      const validRows = Array.isArray(rows) ? rows : ((rows as any)?.rows || []);

      // ── FORENSIC TRACE: Log row count ──
      console.log(`[INBOX_FORENSIC] Query returned ${validRows.length} rows for tenant ${ctx.tenantId}`);

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
          formRawDataName: typeof r.form_raw_data === 'string' ? (() => {
            try { 
              const parsed = JSON.parse(r.form_raw_data);
              return parsed.full_name || parsed['full name'] || parsed['Full Name'];
            } catch { return null; }
          })() : (r.form_raw_data?.full_name || r.form_raw_data?.['full name'] || r.form_raw_data?.['Full Name']),
          formPatientName: r.form_patient_name,
          convPatientName: r.name,
          customerDisplayName: r.customer_display_name,
          whatsappProfileName: r.wa_profile_name,
          phoneFallback: r.id,
          metadata: typeof r.opp_metadata === 'string' ? (() => {
            try { return JSON.parse(r.opp_metadata); } catch { return {}; }
          })() : (r.opp_metadata || {})
        });

        // Parse fields via new deterministic Form Field Extractor
        const formExtraction = r.form_raw_data ? extractFormFields(
          typeof r.form_raw_data === 'string' ? JSON.parse(r.form_raw_data) : r.form_raw_data
        ) : null;

        // Resolve country and source via unified country resolver
        const detailedCountry = resolvePatientCountryDetailed({
          manualCountry: r.opp_country || r.country,
          formCountry: formExtraction?.country,
          phoneFallback: r.id || r.phone_number,
          metadata: typeof r.opp_metadata === 'string' ? (() => {
            try { return JSON.parse(r.opp_metadata); } catch { return {}; }
          })() : (r.opp_metadata || {})
        });

        const resolvedDepartment = r.opp_department || r.department || null;

        return {
          ...r,
          name: detailedName.displayName,
          name_source: detailedName.nameSource,
          name_confidence: detailedName.nameConfidence,
          name_confirmation_needed: detailedName.nameConfirmationNeeded,
          country: detailedCountry.displayCountry,
          country_source: detailedCountry.countrySource,
          country_confirmation_needed: detailedCountry.countryConfirmationNeeded,
          country_conflict: detailedCountry.conflict || null,
          department: resolvedDepartment,
          formDepartment: formExtraction?.department || null,
          formComplaint: formExtraction?.complaint || null,
          formReportStatus: formExtraction?.reportStatus || null,
          formAppointmentPref: formExtraction?.appointmentPref || null,
          formAge: formExtraction?.age || null,
          formDepartmentSource: formExtraction?.departmentSource || null,
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
          opp_summary: r.opp_summary || null,
          opp_ai_reason: r.opp_ai_reason || null,
          legacy_ai_summary: r.legacy_ai_summary || null,
          ai_crm_summary: r.opp_summary || r.legacy_ai_summary || '',
          notes: r.notes || '',
          patientRelation: r.opp_patient_relation || null,
          formData: r.form_name ? {
            name: r.form_name,
            date: r.form_date_ms ? new Date(parseFloat(r.form_date_ms)).toLocaleDateString('tr-TR', { day: 'numeric', month: 'long', year: 'numeric' }) : '',
            raw: r.form_raw_data
          } : null,
          aiSummary: (r.opp_summary || r.legacy_ai_summary) ? {
            text: r.opp_summary || r.legacy_ai_summary || '',
            buying_intent: r.ai_buying_intent,
            sentiment: r.ai_sentiment
          } : null
        };
      });

      if (isNoReplyFilter) {
        // 1. Filter candidates based on expectsReply, opt-out, stages
        const eligibleCandidates = processedRows.filter((r: any) => {
          const lastMsg = r.last_message || '';
          const lastMsgDir = r.lastMessageDirection || 'in';
          
          if (lastMsgDir !== 'out') return false;

          const classification = ExpectsReplyClassifier.classify(lastMsg);
          
          if (!classification.expectsReply) return false;

          const normPhone = normalizePhoneForIdentity(r.id || r.phone_number);
          const isPrimaryOptedOut = (r.opp_metadata?.opt_out_requested === true) || 
                                    (r.opp_metadata?.opt_out_requested === 'true') ||
                                    (normPhone.e164 && optOutPhones.has(normPhone.e164));
          
          let hasOptOutKeywordInFamily = false;
          let parsedRaw = r.form_raw_data;
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

          if (isPrimaryOptedOut || hasOptOutKeywordInFamily) return false;

          const currentStage = r.opp_stage || r.stage;
          if (['lost', 'not_qualified', 'arrived'].includes(currentStage)) return false;

          if (currentStage === 'booked' && classification.isClosingMessage) return false;

          if (r.opp_automation_status === 'stopped' || r.opp_automation_status === 'paused') return false;

          const lastOutboundTime = r.last_message_time_ms ? parseFloat(r.last_message_time_ms) : 0;
          const hoursElapsed = lastOutboundTime > 0 ? (Date.now() - lastOutboundTime) / (1000 * 60 * 60) : 0;

          r.no_reply_classification = {
            ...classification,
            no_reply_hours: Math.round(hoursElapsed * 10) / 10
          };
          r.is_no_reply_eligible = true;
          r.no_reply_hours = Math.round(hoursElapsed * 10) / 10;

          return true;
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

        const offsetVal = (page - 1) * limit;
        return finalEligibleList.slice(offsetVal, offsetVal + limit);
      }

      return processedRows;
    }
  ).then(res => res.data || []);
}


import { unstable_noStore as noStore } from "next/cache";

export async function getMessages(phone: string, page: number = 1, limit: number = 50) {
  noStore();
  if (!phone) return [];
  
  return withActionGuard(
    { actionName: 'getMessages' },
    async (ctx) => {
      try {
        const cleanPhone = phone.replace(/\D/g, '').slice(-10);
        // Create the string pattern with % wildcards
        const phoneLike = `%${cleanPhone}%`;

        const offset = (page - 1) * limit;

        const rows = await ctx.db.executeSafe({
          text: `
            SELECT * FROM (
              SELECT id, content as text, direction, status, model_used,
                     media_type, media_url, media_metadata, provider_message_id,
                     EXTRACT(EPOCH FROM COALESCE(provider_timestamp, created_at)) * 1000 as created_at_ms
              FROM messages
              WHERE phone_number LIKE $1 
                AND (tenant_id = $2)
              ORDER BY COALESCE(provider_timestamp, created_at) DESC
              LIMIT $3 OFFSET $4
            ) sub
            ORDER BY created_at_ms ASC
          `,
          values: [phoneLike, ctx.tenantId, limit, offset]
        });

      const validRows = Array.isArray(rows) ? rows : ((rows as any)?.rows || []);

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
          dateLabel,
          status: r.status || 'sent',
          // Media fields
          mediaType: r.media_type || null,
          mediaUrl: r.media_url || null,
          mediaMetadata: r.media_metadata || null,
          providerMessageId: r.provider_message_id || null,
        };
      });
      } catch(err: any) {
        console.error("getMessages Error:", err, "Phone:", phone, "Tenant:", ctx.tenantId);
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

      const isThreeSixty = channel === 'whatsapp' && (credentials.provider === '360dialog' || credentials.provider === '360dialog_whatsapp');

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

      // Broadcast autopilot updated realtime update
      try {
        const { RealtimeBus } = await import("@/lib/realtime/bus");
        await RealtimeBus.publish(ctx.tenantId, {
          eventId: require("uuid").v4(),
          traceId: "manual-message-trace-" + Date.now(),
          spanId: require("uuid").v4(),
          timestamp: Date.now() * 1000,
          entityVersion: 1,
          eventVersion: "1.0",
          schemaVersion: "1.0",
          tenantId: ctx.tenantId,
          type: "conversation.autopilot_updated" as any,
          payload: {
            conversationId: conversationId,
            phone: phone,
            channelId: channelId,
            enabled: false,
            status: "human"
          }
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

      const isThreeSixty = channel === 'whatsapp' && (credentials.provider === '360dialog' || credentials.provider === '360dialog_whatsapp');

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

      // Broadcast autopilot updated realtime update
      try {
        const { RealtimeBus } = await import("@/lib/realtime/bus");
        await RealtimeBus.publish(ctx.tenantId, {
          eventId: require("uuid").v4(),
          traceId: "manual-media-trace-" + Date.now(),
          spanId: require("uuid").v4(),
          timestamp: Date.now() * 1000,
          entityVersion: 1,
          eventVersion: "1.0",
          schemaVersion: "1.0",
          tenantId: ctx.tenantId,
          type: "conversation.autopilot_updated" as any,
          payload: {
            conversationId: conversationId,
            phone: phone,
            channelId: channelId,
            enabled: false,
            status: "human"
          }
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

      // Ably Realtime Sync (publish event)
      try {
        const { RealtimeBus } = await import("@/lib/realtime/bus");
        await RealtimeBus.publish(ctx.tenantId, {
          eventId: require("uuid").v4(),
          traceId: "toggle-status-trace-" + Date.now(),
          spanId: require("uuid").v4(),
          timestamp: Date.now() * 1000,
          entityVersion: 1,
          eventVersion: "1.0",
          schemaVersion: "1.0",
          tenantId: ctx.tenantId,
          type: "conversation.autopilot_updated" as any,
          payload: {
            conversationId: conversationId,
            phone: phone,
            channelId: channelId,
            enabled: isBotActive,
            status: newStatus
          }
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
      const isThreeSixty = channel === 'whatsapp' && (credentials.provider === '360dialog' || credentials.provider === '360dialog_whatsapp');
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

export async function markConversationRead(phone: string) {
  if (!phone) return { success: false, error: "Phone number is required." };
  return withActionGuard(
    { actionName: 'markConversationRead' },
    async (ctx) => {
      const cleanPhone = phone.replace(/\D/g, '').slice(-10);
      const phoneLike = `%${cleanPhone}%`;

      // 1. Get conversation ID
      const conv = await ctx.db.executeSafe({
        text: `SELECT id FROM conversations WHERE phone_number LIKE $1 AND tenant_id = $2 LIMIT 1`,
        values: [phoneLike, ctx.tenantId]
      }) as any[];

      if (conv.length === 0) {
        return { success: false, error: "Conversation not found" };
      }
      const convId = conv[0].id;

      // 2. Get last inbound message ID to track last read message
      const lastMsg = await ctx.db.executeSafe({
        text: `SELECT id FROM messages 
               WHERE conversation_id = $1 AND tenant_id = $2 AND direction = 'in' 
               ORDER BY created_at DESC LIMIT 1`,
        values: [convId, ctx.tenantId]
      }) as any[];
      const lastMsgId = lastMsg[0]?.id || null;

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

      return { success: true };
    }
  ).then(res => res.success ? (res.data || { success: true }) : { success: false, error: res.error });
}

export async function togglePin(phone: string) {
  if (!phone) return { success: false, error: "Phone number is required." };
  return withActionGuard(
    { actionName: 'togglePin' },
    async (ctx) => {
      const cleanPhone = phone.replace(/\D/g, '').slice(-10);
      const phoneLike = `%${cleanPhone}%`;

      // 1. Get conversation ID
      const conv = await ctx.db.executeSafe({
        text: `SELECT id FROM conversations WHERE phone_number LIKE $1 AND tenant_id = $2 LIMIT 1`,
        values: [phoneLike, ctx.tenantId]
      }) as any[];

      if (conv.length === 0) {
        return { success: false, error: "Conversation not found" };
      }
      const convId = conv[0].id;

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
        return { success: true, isPinned: true };
      }
    }
  ).then(res => res.success ? (res.data || { success: true }) : { success: false, error: res.error });
}

export async function getGlobalUnreadCount() {
  return withActionGuard(
    { actionName: 'getGlobalUnreadCount' },
    async (ctx) => {
      const rows = await ctx.db.executeSafe({
        text: `
          SELECT COALESCE(SUM(unread_sub.unread), 0)::int as total_unread
          FROM (
            SELECT 
              (
                SELECT COUNT(*)::int 
                FROM messages m_unread
                WHERE m_unread.conversation_id = c.id
                  AND m_unread.tenant_id = c.tenant_id
                  AND m_unread.direction = 'in'
                  AND (m_unread.media_metadata IS NULL OR COALESCE(m_unread.media_metadata->'native'->>'message_type', '') != 'reaction')
                  AND m_unread.created_at > COALESCE(
                    (SELECT last_read_at FROM conversation_read_states rs WHERE rs.tenant_id = c.tenant_id AND rs.user_id = $2 AND rs.conversation_id = c.id),
                    '1970-01-01'::timestamptz
                  )
              ) as unread
            FROM conversations c
            WHERE c.tenant_id = $1
          ) unread_sub
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

      // 3. Resolve WhatsApp credentials
      const creds = await CredentialsService.resolveCredentials(ctx.tenantId, 'whatsapp');
      const META_ACCESS_TOKEN = creds.accessToken;
      const PHONE_NUMBER_ID = creds.whatsappPhoneNumberId;

      if (!META_ACCESS_TOKEN || !PHONE_NUMBER_ID) {
        return { success: false, error: "WhatsApp kimlik bilgileri eksik. Entegrasyon ayarlarını kontrol edin." };
      }

      // 4. Send via WhatsApp API
      const response = await fetch(`https://graph.facebook.com/v25.0/${PHONE_NUMBER_ID}/messages`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${META_ACCESS_TOKEN}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          messaging_product: 'whatsapp',
          to: phone,
          type: 'text',
          text: { body: cleanMessage },
        }),
      });

      if (!response.ok) {
        const errData = await response.json().catch(() => ({}));
        return { success: false, error: `WhatsApp gönderim hatası: ${errData?.error?.message || response.statusText}` };
      }

      let providerMessageId: string | null = null;
      try {
        const resData = await response.json();
        providerMessageId = resData.messages?.[0]?.id || null;
      } catch (_) {}

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

        oppId = convRows[0].active_opportunity_id;
        phone = convRows[0].phone_number;

        if (!oppId) {
          return { success: false, error: "Aktif fırsat/lead kaydı bulunamadı. Lütfen önce fırsat oluşturun." };
        }

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

      await ctx.db.executeSafe({
        text: `
          INSERT INTO outreach_logs (tenant_id, lead_id, conversation_id, opportunity_id, action, channel, actor_id, metadata)
          VALUES ($1, $2, $3, $4, 'smart_greeting_draft_edited', 'system', $5, $6)
        `,
        values: [
          ctx.tenantId,
          conv.lead_id || null,
          conversationId,
          oppId || null,
          ctx.userId,
          JSON.stringify({
            zero_outbound: true,
            patient_visible: false,
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

      // 2. Resolve WhatsApp credentials
      const creds = await CredentialsService.resolveCredentials(ctx.tenantId, 'whatsapp');
      const META_ACCESS_TOKEN = creds.accessToken;
      const PHONE_NUMBER_ID = creds.whatsappPhoneNumberId;

      if (!META_ACCESS_TOKEN || !PHONE_NUMBER_ID) {
        return { success: false, error: "WhatsApp kimlik bilgileri eksik. Entegrasyon ayarlarını kontrol edin." };
      }

      // 3. Send via WhatsApp API using unified MessageService
      const { MessageService } = await import("@/lib/services/message.service");
      const { TenantDB } = await import("@/lib/core/tenant-db");
      const tenantDb = new TenantDB(ctx.tenantId);
      const messageService = new MessageService(tenantDb);

      let providerMessageId: string | null = null;
      try {
        const sendRes = await messageService.sendWhatsAppMessage(
          PHONE_NUMBER_ID,
          META_ACCESS_TOKEN,
          phone,
          cleanMessage,
          creds.provider
        );
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
      await ctx.db.executeSafe({
        text: `INSERT INTO outreach_logs (tenant_id, lead_id, conversation_id, opportunity_id, action, channel, actor_id, metadata)
               VALUES ($1, $2, $3, $4, 'inbox_form_greeting_sent', 'whatsapp', $5, $6)`,
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
        text: `SELECT metadata FROM follow_up_tasks 
               WHERE conversation_id = $1 AND tenant_id = $2 AND status IN ('pending', 'in_progress')
               ORDER BY created_at DESC LIMIT 1`,
        values: [conversationId, ctx.tenantId]
      }) as any[];

      if (taskRows.length === 0) return { success: true, directive: null };

      const metadata = taskRows[0].metadata || {};
      const directiveState = metadata.bot_directive_state;
      const directive = directiveState?.active_bot_directive || metadata.active_bot_directive || null;

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

// ==========================================
// A1.7d — Bulk operations server actions
// ==========================================

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
            (SELECT id FROM messages m WHERE m.conversation_id = c_id AND m.tenant_id = $1 AND m.direction = 'in' ORDER BY created_at DESC LIMIT 1) as last_read_message_id, 
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

      return { success: true };
    }
  ).then(res => res.success ? (res.data || { success: true }) : { success: false, error: res.error });
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
      const updatedRows = await ctx.db.executeSafe({
        text: `
          INSERT INTO conversation_read_states (tenant_id, user_id, conversation_id, last_read_at, last_read_message_id, updated_at)
          SELECT 
            $1 as tenant_id, 
            $2 as user_id, 
            c_id as conversation_id, 
            (SELECT created_at - INTERVAL '1 millisecond' FROM messages m WHERE m.conversation_id = c_id AND m.tenant_id = $1 AND m.direction = 'in' ORDER BY created_at DESC LIMIT 1) as last_read_at, 
            (SELECT id FROM messages m WHERE m.conversation_id = c_id AND m.tenant_id = $1 AND m.direction = 'in' ORDER BY created_at DESC LIMIT 2 OFFSET 1) as last_read_message_id,
            NOW() as updated_at
          FROM unnest($3::uuid[]) as c_id
          WHERE EXISTS (
            SELECT 1 FROM messages m WHERE m.conversation_id = c_id AND m.tenant_id = $1 AND m.direction = 'in'
          )
          ON CONFLICT (tenant_id, user_id, conversation_id)
          DO UPDATE SET 
            last_read_at = EXCLUDED.last_read_at,
            last_read_message_id = EXCLUDED.last_read_message_id,
            updated_at = NOW()
          RETURNING conversation_id
        `,
        values: [ctx.tenantId, ctx.userId, conversationIds]
      }) as any[];

      const updatedIds = updatedRows.map(r => r.conversation_id);

      for (const convId of updatedIds) {
        await ctx.db.executeSafe({
          text: `
            INSERT INTO outreach_logs (tenant_id, conversation_id, action, actor_id, metadata)
            VALUES ($1, $2, 'bulk_mark_unread', $3, $4)
          `,
          values: [ctx.tenantId, convId, ctx.userId, JSON.stringify({ source: "bulk_inbox_action" })]
        });
      }

      return { success: true };
    }
  ).then(res => res.success ? (res.data || { success: true }) : { success: false, error: res.error });
}

export async function bulkSetBotMode(conversationIds: string[], mode: 'bot' | 'human') {
  if (!Array.isArray(conversationIds) || conversationIds.length === 0) {
    return { success: false, error: "Konuşma ID listesi boş olamaz." };
  }
  if (conversationIds.length > 50) {
    return { success: false, error: "Tek seferde en fazla 50 sohbet güncellenebilir." };
  }
  if (mode !== 'bot' && mode !== 'human') {
    return { success: false, error: "Mod 'bot' veya 'human' olmalıdır." };
  }
  return withActionGuard(
    { actionName: 'bulkSetBotMode' },
    async (ctx) => {
      const autopilotEnabled = mode === 'bot';

      await ctx.db.executeSafe({
        text: `
          UPDATE conversations
          SET autopilot_enabled = $1, updated_at = NOW()
          WHERE tenant_id = $2 AND id = ANY($3::uuid[])
        `,
        values: [autopilotEnabled, ctx.tenantId, conversationIds]
      });

      for (const convId of conversationIds) {
        await ctx.db.executeSafe({
          text: `
            INSERT INTO outreach_logs (tenant_id, conversation_id, action, actor_id, metadata)
            VALUES ($1, $2, 'bulk_bot_mode_change', $3, $4)
          `,
          values: [ctx.tenantId, convId, ctx.userId, JSON.stringify({ source: "bulk_inbox_action", mode })]
        });
      }

      return { success: true };
    }
  ).then(res => res.success ? (res.data || { success: true }) : { success: false, error: res.error });
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
  if (!conversationId) return { success: false, error: "Missing conversationId" };
  return withActionGuard(
    { actionName: 'toggleConversationFavorite' },
    async (ctx) => {
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

      return { success: true, isFavorite: !isFavorite };
    }
  ).then(res => {
    if (!res.success) return { success: false, error: res.error };
    return res.data;
  });
}

export async function archiveConversation(conversationId: string) {
  if (!conversationId) return { success: false, error: "Missing conversationId" };
  return withActionGuard(
    { actionName: 'archiveConversation' },
    async (ctx) => {
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

      return { success: true };
    }
  ).then(res => {
    if (!res.success) return { success: false, error: res.error };
    return res.data;
  });
}

export async function unarchiveConversation(conversationId: string) {
  if (!conversationId) return { success: false, error: "Missing conversationId" };
  return withActionGuard(
    { actionName: 'unarchiveConversation' },
    async (ctx) => {
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

      return { success: true, count: validIds.length };
    }
  ).then(res => {
    if (!res.success) return { success: false, error: res.error };
    return res.data;
  });
}

