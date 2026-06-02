"use server";

// sql import removed — all queries use parameterized {text, values} format for proper RLS enforcement
import { withActionGuard } from "@/lib/core/action-guard";
import { logAudit } from "@/lib/audit";
import { enqueueRetry } from "@/lib/retry";
import { CredentialsService } from "@/lib/services/credentials.service";
import { PatientNameSyncService } from "@/lib/services/patient-name-sync";

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
          c.phone_number as id,
          c.patient_name as name,
          c.department,
          c.country,
          c.status,
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
          active_opp.stage as opp_stage,
          active_opp.priority as opp_priority,
          active_opp.patient_relation as opp_patient_relation,
          -- P1B FIX: No global fallback — prevents Mehmet/Irak leaking into Almanya/Kardiyoloji
          active_opp.summary as ai_summary,
          mem.buying_intent as ai_buying_intent,
          mem.sentiment as ai_sentiment,
          0 as unread
        FROM conversations c
        LEFT JOIN LATERAL (
          SELECT content, status, direction
          FROM messages 
          WHERE phone_number = c.phone_number AND messages.tenant_id = $1
          ORDER BY created_at DESC 
          LIMIT 1
        ) m ON c.last_message_content IS NULL
        LEFT JOIN LATERAL (
          SELECT form_name, patient_name, raw_data, created_at 
          FROM leads 
          WHERE leads.tenant_id = $1
            AND leads.phone_number LIKE '%' || RIGHT(COALESCE(c.real_phone, c.phone_number), 10) || '%'
          ORDER BY created_at DESC 
          LIMIT 1
        ) l ON true
        LEFT JOIN conversation_memory mem ON c.id = mem.conversation_id
        -- P1B: Active opportunity JOIN (tenant safety enforced)
        LEFT JOIN opportunities active_opp 
          ON active_opp.id = c.active_opportunity_id 
          AND active_opp.tenant_id = c.tenant_id
          AND active_opp.conversation_id = c.id
        WHERE c.tenant_id = $1
          AND ($2::text IS NULL OR c.patient_name ILIKE $2 OR c.phone_number ILIKE $2)
          AND ($3::text IS NULL OR c.lead_stage = $3)
        ORDER BY c.last_message_at DESC NULLS LAST
        LIMIT $4 OFFSET $5
        `,
        values: [ctx.tenantId, searchFilter, stageFilter, limit, offset]
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

        // P1B Priority name resolution: opp.requester_name > opp.patient_name > form full_name > form patient_name > conversation name
        let resolvedName = r.name;
        
        // Highest priority: Active opportunity identity
        if (r.opp_requester_name && r.opp_requester_name.trim()) {
          resolvedName = r.opp_requester_name.trim();
        } else if (r.opp_patient_name && r.opp_patient_name.trim()) {
          resolvedName = r.opp_patient_name.trim();
        } else if (r.form_raw_data) {
          try {
            const rawData = typeof r.form_raw_data === 'string' ? JSON.parse(r.form_raw_data) : r.form_raw_data;
            const formFullName = rawData.full_name || rawData['full name'] || rawData['Full Name'] || rawData['full_name'];
            if (formFullName && formFullName.trim()) {
              resolvedName = formFullName.trim();
            } else if (r.form_patient_name && r.form_patient_name.trim()) {
              resolvedName = r.form_patient_name.trim();
            }
          } catch {
            if (r.form_patient_name && r.form_patient_name.trim()) {
              resolvedName = r.form_patient_name.trim();
            }
          }
        } else if (r.form_patient_name && r.form_patient_name.trim()) {
          resolvedName = r.form_patient_name.trim();
        }

        // P1B: Country/Department from active opp (source of truth)
        const resolvedCountry = r.opp_country || r.country || 
          (r.form_raw_data && typeof r.form_raw_data === 'string' && r.form_raw_data.includes('country') ? JSON.parse(r.form_raw_data).country : null) || 
          (r.id.startsWith('90') || r.id.startsWith('+90') ? 'Türkiye' : r.id.startsWith('49') || r.id.startsWith('+49') ? 'Almanya' : null);
        const resolvedDepartment = r.opp_department || r.department;

        return {
          ...r,
          name: resolvedName,
          country: resolvedCountry,
          department: resolvedDepartment,
          score: r.stage === 'appointed' ? 100 : r.stage === 'contacted' ? 60 : 30,
          isBotActive: r.status !== 'human',
          formattedTime,
          channel: r.channel || 'whatsapp',
          lastMessageStatus: r.last_message_status || 'sent',
          lastMessageDirection: r.last_message_direction || 'in',
          // P1B Summary Unification — separate fields for manual vs AI
          // ai_crm_summary: long CRM summary from MemoryEngine (opportunity.summary)
          // notes: textarea content — manual if user edited, else ai_crm_summary
          ai_crm_summary: r.opp_summary || '',
          notes: (() => {
            const oppSummary = r.opp_summary || '';
            const convNotes = r.notes || '';
            // If conv.notes has content AND it's different from opp.summary → user edited manually
            if (convNotes && oppSummary && convNotes !== oppSummary) return convNotes;
            // Otherwise use opp_summary as primary (AI-managed)
            if (oppSummary) return oppSummary;
            return convNotes;
          })(),
          patientRelation: r.opp_patient_relation || null,
          formData: r.form_name ? {
            name: r.form_name,
            date: r.form_date_ms ? new Date(parseFloat(r.form_date_ms)).toLocaleDateString('tr-TR', { day: 'numeric', month: 'long', year: 'numeric' }) : '',
            raw: r.form_raw_data
          } : null,
          aiSummary: r.ai_summary ? {
            text: r.ai_summary,
            buying_intent: r.ai_buying_intent,
            sentiment: r.ai_sentiment
          } : null
        };
      });
    }
  ).then(res => res.data || []);
}


import { unstable_noStore as noStore } from "next/cache";

export async function getMessages(phone: string) {
  noStore();
  if (!phone) return [];
  
  return withActionGuard(
    { actionName: 'getMessages' },
    async (ctx) => {
      try {
        const cleanPhone = phone.replace(/\D/g, '').slice(-10);
        // Create the string pattern with % wildcards
        const phoneLike = `%${cleanPhone}%`;

        const rows = await ctx.db.executeSafe({
          text: `
            SELECT * FROM (
              SELECT id, content as text, direction, status, model_used,
                     media_type, media_url, media_metadata,
                     EXTRACT(EPOCH FROM created_at) * 1000 as created_at_ms
              FROM messages
              WHERE phone_number LIKE $1 
                AND (tenant_id = $2)
              ORDER BY created_at DESC
              LIMIT 100
            ) sub
            ORDER BY created_at_ms ASC
          `,
          values: [phoneLike, ctx.tenantId]
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

export async function sendMessage(phone: string, text: string) {
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
        text: `SELECT id, channel FROM conversations WHERE phone_number = $1 AND tenant_id = $2 LIMIT 1`,
        values: [phone, ctx.tenantId]
      });
      const channel = convRows[0]?.channel || 'whatsapp';
      const conversationId = convRows[0]?.id;

      if (!conversationId) {
        throw new Error(`Aktif bir konuşma kaydı bulunamadı (Telefon: ${phone})`);
      }

      // Credentials Service ile kimlik bilgilerini çöz
      const provider = (channel === 'messenger' || channel === 'instagram' ? channel : 'whatsapp') as 'whatsapp' | 'messenger' | 'instagram';
      const credentials = await CredentialsService.resolveCredentials(ctx.tenantId, provider);
      const META_ACCESS_TOKEN = credentials.accessToken;
      const PHONE_NUMBER_ID = credentials.whatsappPhoneNumberId;

      let response: Response | null = null;
      let providerMessageId: string | null = null;
      let messageStatus = 'pending';

      if (!META_ACCESS_TOKEN) {
        const { logger: inboxLogger } = await import("@/lib/core/logger");
        inboxLogger.withContext({ module: 'Inbox' }).warn("Meta credentials missing, only saving to DB");
      } else {
        if (channel === 'whatsapp' && PHONE_NUMBER_ID) {
          response = await fetch(`https://graph.facebook.com/v25.0/${PHONE_NUMBER_ID}/messages`, {
            method: "POST",
            headers: {
              "Authorization": `Bearer ${META_ACCESS_TOKEN}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              messaging_product: "whatsapp",
              to: phone,
              type: "text",
              text: { body: text },
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

      const msgInsert = await ctx.db.executeSafe({
        text: `INSERT INTO messages (tenant_id, conversation_id, phone_number, direction, content, channel, status, provider_message_id)
               VALUES ($1, $2, $3, 'out', $4, $5, $6, $7)
               RETURNING id`,
        values: [ctx.tenantId, conversationId, phone, text, channel, messageStatus, providerMessageId]
      });

      const messageId = Array.isArray(msgInsert) ? msgInsert[0]?.id : (msgInsert as any)?.rows?.[0]?.id;

      await ctx.db.executeSafe({
        text: `UPDATE conversations 
               SET last_message_at = NOW(), 
                   last_message_content = $1,
                   last_channel = $2,
                   last_message_status = $3,
                   last_message_direction = 'out',
                   message_count = message_count + 1
               WHERE phone_number = $4 AND tenant_id = $5`,
        values: [text, channel, messageStatus, phone, ctx.tenantId]
      });

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

  return withActionGuard(
    { actionName: 'sendMediaMessage' },
    async (ctx) => {
      // Resolve channel and conversation_id
      const convRows = await ctx.db.executeSafe({
        text: `SELECT id, channel FROM conversations WHERE phone_number = $1 AND tenant_id = $2 LIMIT 1`,
        values: [phone, ctx.tenantId]
      });
      const channel = convRows[0]?.channel || 'whatsapp';
      const conversationId = convRows[0]?.id;

      if (!conversationId) {
        throw new Error(`Aktif bir konuşma kaydı bulunamadı (Telefon: ${phone})`);
      }

      const provider = (channel === 'messenger' || channel === 'instagram' ? channel : 'whatsapp') as 'whatsapp' | 'messenger' | 'instagram';
      const credentials = await CredentialsService.resolveCredentials(ctx.tenantId, provider);
      const META_ACCESS_TOKEN = credentials.accessToken;
      const PHONE_NUMBER_ID = credentials.whatsappPhoneNumberId;

      let providerMessageId: string | null = null;
      let messageStatus = 'pending';

      if (META_ACCESS_TOKEN && PHONE_NUMBER_ID && channel === 'whatsapp') {
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

      // Save to DB with media fields and conversation_id
      const msgInsert = await ctx.db.executeSafe({
        text: `INSERT INTO messages (tenant_id, conversation_id, phone_number, direction, content, channel, status, provider_message_id, media_type, media_url, media_metadata)
               VALUES ($1, $2, $3, 'out', $4, $5, $6, $7, $8, $9, $10)
               RETURNING id`,
        values: [
          ctx.tenantId, conversationId, phone, contentText, channel, messageStatus, providerMessageId,
          mediaType, mediaUrl,
          JSON.stringify({ filename, mime_type: mimeType, size: fileSize, caption: caption || null })
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
                   message_count = message_count + 1
               WHERE phone_number = $4 AND tenant_id = $5`,
        values: [contentText, channel, messageStatus, phone, ctx.tenantId]
      });

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
          if (notes !== undefined && notes !== null) {
            oppUpdateFields.push(`summary = $${oppIdx++}`);
            oppValues.push(notes);
          }
          if (patientName !== undefined && patientName !== null) {
            oppUpdateFields.push(`patient_name = $${oppIdx++}`);
            oppValues.push(patientName);
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
            values: [department, country, notes !== undefined ? notes : null, patientName || '', phone, ctx.tenantId]
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

export async function toggleBotStatus(phone: string, isBotActive: boolean) {
  if (!phone) return { success: false };
  
  return withActionGuard(
    { actionName: 'toggleBotStatus' },
    async (ctx) => {
      const newStatus = isBotActive ? 'bot' : 'human';
      
      if (isBotActive) {
        // Bot enabled: set bot_activated_at to reset the max messages counter
        await ctx.db.executeSafe({
          text: `UPDATE conversations SET status = $1, bot_activated_at = NOW() WHERE phone_number = $2 AND tenant_id = $3`,
          values: [newStatus, phone, ctx.tenantId]
        });
      } else {
        await ctx.db.executeSafe({
          text: `UPDATE conversations SET status = $1 WHERE phone_number = $2 AND tenant_id = $3`,
          values: [newStatus, phone, ctx.tenantId]
        });
      }

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
  ).then(res => res.success ? { success: true } : { success: false });
}
