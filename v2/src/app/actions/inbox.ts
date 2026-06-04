"use server";

import { withActionGuard } from "@/lib/core/action-guard";
import { logAudit } from "@/lib/audit";
import { enqueueRetry } from "@/lib/retry";
import { CredentialsService } from "@/lib/services/credentials.service";
import { PatientNameSyncService } from "@/lib/services/patient-name-sync";
import { resolvePatientDisplayName } from "@/lib/utils/patient-name-resolver";
import { getCountryFromPhone } from "@/lib/utils/country";
import { extractFormFields } from "@/lib/utils/form-field-extractor";
import { normalizeCountry, getCountryDisplayLabel } from "@/lib/utils/country-normalizer";

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
      const stageFilter = stage !== "all" ? stage : null;

      // ── FORENSIC TRACE: Log the tenant context being used ──
      console.log(`[INBOX_FORENSIC] getConversations called | tenantId=${ctx.tenantId} | page=${page} | search="${search}" | stage="${stage}"`);

      const rows = await ctx.db.executeSafe({
        text: `
        SELECT 
          c.id as conversation_id,
          c.id as conversationId,
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
          COALESCE(c.last_message_content, m.content) as last_message,
          COALESCE(c.last_message_status, m.status) as last_message_status,
          COALESCE(c.last_message_direction, m.direction) as last_message_direction,
          COALESCE(c.last_message_model, m.model_used) as last_message_model,
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
          NULLIF(TRIM(CONCAT(cprof.first_name, ' ', cprof.last_name)), '') as customer_display_name,
          wa.wa_profile_name
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
          SELECT content, status, direction, model_used
          FROM messages 
          WHERE phone_number = c.phone_number 
            AND messages.tenant_id = $1
            AND direction != 'system'
            AND (media_metadata IS NULL OR COALESCE(media_metadata->'native'->>'message_type', '') != 'reaction')
          ORDER BY created_at DESC 
          LIMIT 1
        ) m ON c.last_message_content IS NULL
        LEFT JOIN LATERAL (
          SELECT form_name, patient_name, raw_data, created_at 
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
        -- Pinned Join
        LEFT JOIN conversation_pins cp
          ON c.id = cp.conversation_id
          AND cp.user_id = $6
          AND cp.tenant_id = c.tenant_id
        WHERE c.tenant_id = $1
          AND ($2::text IS NULL OR c.patient_name ILIKE $2 OR c.phone_number ILIKE $2)
          AND ($3::text IS NULL OR c.lead_stage = $3)
        ORDER BY (cp.id IS NOT NULL) DESC, c.last_message_at DESC NULLS LAST
        LIMIT $4 OFFSET $5
        `,
        values: [ctx.tenantId, searchFilter, stageFilter, limit, offset, ctx.userId]
      });

      const validRows = Array.isArray(rows) ? rows : ((rows as any)?.rows || []);

      // ── FORENSIC TRACE: Log row count ──
      console.log(`[INBOX_FORENSIC] Query returned ${validRows.length} rows for tenant ${ctx.tenantId}`);

      return validRows.map((r: any) => {
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

        let resolvedName = resolvePatientDisplayName({
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
        });

        // Parse fields via new deterministic Form Field Extractor
        const formExtraction = r.form_raw_data ? extractFormFields(
          typeof r.form_raw_data === 'string' ? JSON.parse(r.form_raw_data) : r.form_raw_data
        ) : null;

        // Resolve country and source
        let resolvedCountry = null;
        let countrySource: 'confirmed' | 'form' | 'phone_prefix' = 'confirmed';
        let countryConfirmationNeeded = false;

        const dbCountry = r.opp_country || r.country;
        if (dbCountry) {
          const norm = normalizeCountry(dbCountry, r.id || r.phone_number);
          resolvedCountry = norm.country;
          countryConfirmationNeeded = norm.countryConfirmationNeeded;
          countrySource = 'confirmed';
        } else if (formExtraction?.country) {
          const norm = normalizeCountry(formExtraction.country, r.id || r.phone_number, 'form');
          resolvedCountry = norm.country;
          countryConfirmationNeeded = norm.countryConfirmationNeeded;
          countrySource = 'form';
        } else {
          const phoneCountryInfo = getCountryFromPhone(r.id || r.phone_number);
          if (phoneCountryInfo) {
            resolvedCountry = phoneCountryInfo.name;
            countryConfirmationNeeded = true;
            countrySource = 'phone_prefix';
          }
        }

        // Run UI label generator to format "tc d" or similar messy existing data cleanly
        const countryDisplay = getCountryDisplayLabel(resolvedCountry, r.id || r.phone_number);
        resolvedCountry = countryDisplay.display;
        if (countryDisplay.needsConfirmation) {
          countryConfirmationNeeded = true;
        }

        const resolvedDepartment = r.opp_department || r.department || null;

        return {
          ...r,
          name: resolvedName,
          country: resolvedCountry,
          country_source: countrySource,
          country_confirmation_needed: countryConfirmationNeeded,
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
          isPinned: !!r.is_pinned,
          unread: r.unread || 0,
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
      // Systemic Patient Name Sync (Propagates validated name updates to all opportunities, conversations, and leads)
      if (patientName && patientName.trim()) {
        try {
          await PatientNameSyncService.syncName(ctx.db, phone, patientName);
        } catch (syncErr) {
          console.error("Failed to sync patient name in updateCrmData:", syncErr);
        }
      }

      // P1B: Update active opportunity FIRST (source of truth), then mirror to conversation
      let conversationId: string | undefined;
      try {
        const convRows = await ctx.db.executeSafe({
          text: `SELECT id, active_opportunity_id FROM conversations WHERE phone_number = $1 AND tenant_id = $2 LIMIT 1`,
          values: [phone, ctx.tenantId]
        });
        conversationId = convRows[0]?.id;
        const activeOppId = convRows[0]?.active_opportunity_id;

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
            oppValues.push(country);
          }
          if (patientName !== undefined && patientName !== null) {
            oppUpdateFields.push(`patient_name = $${oppIdx++}`);
            oppValues.push(patientName);
          }

          // Add manual lock metadata to prevent extractor overrides
          if (department || (country !== undefined && country)) {
            const lockObj: Record<string, boolean> = {};
            if (department) lockObj.department_locked = true;
            if (country !== undefined && country) lockObj.country_locked = true;
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
      const normCountry = country ? (normalizeCountry(country, phone).country || country) : null;
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

      return { success: true };
    }
  ).then(res => res.success ? { success: true } : { success: false });
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
