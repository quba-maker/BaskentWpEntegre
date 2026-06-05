"use server";

/**
 * PHASE 2L-P0: Outreach Server Actions (v2 — Two-Step Draft→Send)
 * 
 * Coordinator-initiated actions for form leads:
 * 1. prepareGreetingDraft — Taslak mesaj üret (NO WhatsApp API call)
 * 2. sendGreetingMessage  — Koordinatör onayladığı mesajı WhatsApp ile gönder
 * 3. activateBot          — Bota devret (conversation status → bot)
 * 4. getOutreachHistory   — Outreach log timeline
 * 
 * P0 PRINCIPLE: Hastaya kontrolsüz otomatik mesaj yok.
 * Karşılama mesajı mutlaka koordinatör tarafından onaylanmalı.
 * 
 * All actions write to outreach_logs for audit trail.
 * All actions use withActionGuard for auth + tenant isolation.
 */

import { withActionGuard } from "@/lib/core/action-guard";
import { CredentialsService } from "@/lib/services/credentials.service";
import { logAudit } from "@/lib/audit";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// ═══════════════════════════════════════════════════════════
// 1. PREPARE GREETING DRAFT — Taslak mesaj üret (NO API CALL)
// ═══════════════════════════════════════════════════════════

/**
 * Generates a greeting draft based on lead data + tenant template config.
 * 
 * DOES NOT:
 * - Call WhatsApp API
 * - Write to messages table
 * - Write to outreach_logs
 * - Change any stage
 * 
 * RETURNS: { success, draft, patientName, phone, language, templateId, templateName, channelReady, channelError }
 */
export async function prepareGreetingDraft(leadId: string) {
  if (!leadId) return { success: false as const, error: "Lead ID gerekli." };
  if (!UUID_RE.test(leadId)) return { success: false as const, error: "Geçersiz Lead ID formatı." };

  return withActionGuard(
    { actionName: 'prepareGreetingDraft' },
    async (ctx) => {
      // ── 1. Resolve lead data (extended: form_name, country, raw_data) ──
      const leads = await ctx.db.executeSafe({
        text: `SELECT l.id, l.phone_number, l.patient_name, l.form_name,
                      l.linked_opportunity_id, l.customer_id, l.country, l.raw_data
               FROM leads l
               WHERE l.id = $1 AND l.tenant_id = $2`,
        values: [leadId, ctx.tenantId]
      }) as any[];

      if (leads.length === 0) {
        return { success: false, error: "Lead bulunamadı." };
      }

      const lead = leads[0];
      const phone = lead.phone_number;

      if (!phone) {
        return { success: false, error: "Telefon numarası eksik." };
      }

      // ── 2. Check if greeting already sent (informational for UI) ──
      const existingGreeting = await ctx.db.executeSafe({
        text: `SELECT id FROM outreach_logs 
               WHERE lead_id = $1 AND tenant_id = $2 AND action = 'greeting_sent'
               LIMIT 1`,
        values: [leadId, ctx.tenantId]
      }) as any[];

      if (existingGreeting.length > 0) {
        return { success: false, error: "Bu lead'e zaten selamlama gönderilmiş.", alreadySent: true };
      }

      // ── 3. Resolve tenant name ──
      let tenantName = 'Ekibimiz';
      try {
        const { withTenantDB } = await import('@/lib/core/tenant-db');
        const sysDb = withTenantDB('admin-system', true);
        const tenantRes = await sysDb.executeSafe({
          text: `SELECT name FROM tenants WHERE id = $1 LIMIT 1`,
          values: [ctx.tenantId]
        }) as any[];
        if (tenantRes.length > 0) tenantName = tenantRes[0].name;
      } catch (_) {}

      // ── 4. Resolve greeting language config from channel_ai_profiles ──
      let greetingLang = 'auto';
      try {
        const profileRes = await ctx.db.executeSafe({
          text: `SELECT cap.greeting_language FROM channel_ai_profiles cap
                 JOIN channel_groups cg ON cap.group_id = cg.id
                 WHERE cg.tenant_id = $1 AND cg.status = 'active'
                 ORDER BY cg.sort_order ASC LIMIT 1`,
          values: [ctx.tenantId]
        }) as any[];
        if (profileRes.length > 0) {
          greetingLang = profileRes[0].greeting_language || 'auto';
        }
      } catch (_) {}

      // ── 5. Extract lead-level language hint from raw_data ──
      let leadLanguage: string | undefined;
      let leadDepartment: string | undefined;
      try {
        const rawData = typeof lead.raw_data === 'string' ? JSON.parse(lead.raw_data) : (lead.raw_data || {});
        leadLanguage = rawData.language || rawData.Language || rawData.dil || rawData.Dil || undefined;
        leadDepartment = rawData.department || rawData.Department || rawData.departman || rawData.Departman || rawData.bolum || rawData.Bölüm || undefined;
      } catch (_) {}

      // ── 6. Resolve opportunity department if not in raw_data ──
      if (!leadDepartment && lead.linked_opportunity_id) {
        try {
          const oppRes = await ctx.db.executeSafe({
            text: `SELECT department FROM opportunities WHERE id = $1 AND tenant_id = $2 LIMIT 1`,
            values: [lead.linked_opportunity_id, ctx.tenantId]
          }) as any[];
          if (oppRes.length > 0) leadDepartment = oppRes[0].department || undefined;
        } catch (_) {}
      }

      // ── 7. Resolve coordinator name ──
      let coordinatorName = '';
      try {
        const userRes = await ctx.db.executeSafe({
          text: `SELECT name FROM users WHERE id = $1 AND tenant_id = $2 LIMIT 1`,
          values: [ctx.userId, ctx.tenantId]
        }) as any[];
        if (userRes.length > 0) coordinatorName = userRes[0].name || '';
      } catch (_) {}

      // ── 8. Resolve template via TemplateResolverService ──
      const { TemplateResolverService } = await import('@/lib/services/template-resolver.service');
      const resolved = await TemplateResolverService.resolve(ctx.db, {
        tenantId: ctx.tenantId,
        tenantName,
        patientName: lead.patient_name || '',
        formName: lead.form_name || undefined,
        department: leadDepartment || undefined,
        country: lead.country || undefined,
        coordinatorName,
        language: leadLanguage || undefined,
        phoneNumber: phone,
      }, greetingLang);

      // ── 9. Channel readiness pre-check (NO API call) ──
      let channelReady = false;
      let channelError: string | undefined;
      try {
        const creds = await CredentialsService.resolveCredentials(ctx.tenantId, 'whatsapp');
        if (!creds.accessToken) {
          channelError = 'WhatsApp Access Token bulunamadı.';
        } else if (!creds.whatsappPhoneNumberId) {
          channelError = 'WhatsApp Phone Number ID eksik.';
        } else {
          channelReady = true;
        }
      } catch (credErr: any) {
        channelError = `Kanal kimlik bilgileri çözülemedi: ${credErr?.message || 'Bilinmeyen hata'}`;
      }

      // Return draft + channel status — no API call, no DB write
      return { 
        success: true, 
        draft: resolved.rendered, 
        patientName: lead.patient_name || '',
        phone,
        tenantName,
        language: resolved.language,
        templateId: resolved.templateId || undefined,
        templateName: resolved.templateName,
        templateSource: resolved.source,
        channelReady,
        channelError,
      };
    }
  ).then(res => {
    if (!res.success) return { success: false as const, error: res.error || res.data?.error, alreadySent: res.data?.alreadySent };
    return { 
      success: true as const, 
      draft: res.data?.draft as string, 
      patientName: res.data?.patientName as string, 
      phone: res.data?.phone as string,
      language: res.data?.language as string,
      templateId: res.data?.templateId as string | undefined,
      templateName: res.data?.templateName as string,
      channelReady: res.data?.channelReady as boolean,
      channelError: res.data?.channelError as string | undefined,
    };
  });
}


// ═══════════════════════════════════════════════════════════
// 2. SEND GREETING MESSAGE — Koordinatör onayladığı mesajı gönder
// ═══════════════════════════════════════════════════════════

/**
 * Sends the coordinator-approved greeting message via WhatsApp.
 * 
 * @param leadId - The lead UUID
 * @param message - The coordinator-approved message text (edited or default draft)
 * 
 * DOES:
 * - Duplicate guard (outreach_logs check)
 * - WhatsApp credentials check
 * - WhatsApp API call
 * - messages table insert (outbound)
 * - conversations last_message update
 * - UnifiedStageService → first_contact
 * - outreach_logs → greeting_sent
 * - Audit log
 */
export async function sendGreetingMessage(leadId: string, message: string) {
  if (!leadId) return { success: false, error: "Lead ID gerekli." };
  if (!UUID_RE.test(leadId)) return { success: false, error: "Geçersiz Lead ID formatı." };
  if (!message || message.trim().length === 0) return { success: false, error: "Mesaj metni boş olamaz." };
  if (message.trim().length > 4096) return { success: false, error: "Mesaj çok uzun (max 4096 karakter)." };

  const cleanMessage = message.trim();

  return withActionGuard(
    { actionName: 'sendGreetingMessage' },
    async (ctx) => {
      // ── 1. Resolve lead data ──
      const leads = await ctx.db.executeSafe({
        text: `SELECT l.id, l.phone_number, l.patient_name, l.form_name,
                      l.linked_opportunity_id, l.customer_id
               FROM leads l
               WHERE l.id = $1 AND l.tenant_id = $2`,
        values: [leadId, ctx.tenantId]
      }) as any[];

      if (leads.length === 0) {
        return { success: false, error: "Lead bulunamadı." };
      }

      const lead = leads[0];
      const phone = lead.phone_number;

      if (!phone) {
        return { success: false, error: "Telefon numarası eksik." };
      }

      // ── 2. Duplicate guard ──
      const existingGreeting = await ctx.db.executeSafe({
        text: `SELECT id FROM outreach_logs 
               WHERE lead_id = $1 AND tenant_id = $2 AND action = 'greeting_sent'
               LIMIT 1`,
        values: [leadId, ctx.tenantId]
      }) as any[];

      if (existingGreeting.length > 0) {
        return { success: false, error: "Bu lead'e zaten selamlama gönderilmiş.", alreadySent: true };
      }

      // ── 3. Resolve WhatsApp credentials ──
      const creds = await CredentialsService.resolveCredentials(ctx.tenantId, 'whatsapp');
      const META_ACCESS_TOKEN = creds.accessToken;
      const PHONE_NUMBER_ID = creds.whatsappPhoneNumberId;

      if (!META_ACCESS_TOKEN || !PHONE_NUMBER_ID) {
        return { success: false, error: "WhatsApp kimlik bilgileri eksik. Lütfen entegrasyon ayarlarını kontrol edin." };
      }

      // ── 4. Send via WhatsApp API ──
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

      // ── 5. Resolve conversation_id ──
      let conversationId: string | null = null;
      try {
        const convRes = await ctx.db.executeSafe({
          text: `SELECT id FROM conversations 
                 WHERE tenant_id = $1 AND RIGHT(phone_number, 10) = RIGHT($2, 10)
                 LIMIT 1`,
          values: [ctx.tenantId, phone]
        }) as any[];
        conversationId = convRes[0]?.id || null;
      } catch (_) {}

      // ── 6. Save message record ──
      if (conversationId) {
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
      }

      // ── 7. Update stage → first_contact (via UnifiedStageService for atomic mirror sync) ──
      try {
        const { UnifiedStageService } = await import('@/lib/services/unified-stage.service');
        await UnifiedStageService.update({
          tenantId: ctx.tenantId,
          source: 'system',
          opportunityId: lead.linked_opportunity_id || undefined,
          phoneNumber: phone,
          targetStage: 'first_contact',
          actorId: ctx.userId,
          reason: 'outreach_greeting_sent',
        });
      } catch (_) {}

      // ── 8. Write outreach log ──
      await ctx.db.executeSafe({
        text: `INSERT INTO outreach_logs (tenant_id, lead_id, conversation_id, opportunity_id, action, channel, actor_id, metadata)
               VALUES ($1, $2, $3, $4, 'greeting_sent', 'whatsapp', $5, $6)`,
        values: [
          ctx.tenantId,
          leadId,
          conversationId,
          lead.linked_opportunity_id || null,
          ctx.userId,
          JSON.stringify({
            message_text: cleanMessage,
            provider_message_id: providerMessageId,
            patient_name: lead.patient_name || '',
            phone,
          })
        ]
      });

      // ── 9. Audit ──
      logAudit({
        tenantId: ctx.tenantId,
        userId: ctx.userId,
        userEmail: ctx.email,
        action: 'outreach_greeting_sent',
        entityType: 'lead',
        entityId: leadId,
        details: { phone, formName: lead.form_name },
      });

      return { success: true, messageSent: true };
    }
  ).then(res => {
    if (!res.success) return { success: false, error: res.error || res.data?.error, alreadySent: res.data?.alreadySent };
    return { success: true, messageSent: res.data?.messageSent };
  });
}


// ═══════════════════════════════════════════════════════════
// 3. ACTIVATE BOT — Bota devret
// ═══════════════════════════════════════════════════════════

export async function activateBot(leadId: string) {
  if (!leadId) return { success: false, error: "Lead ID gerekli." };
  if (!UUID_RE.test(leadId)) return { success: false, error: "Geçersiz Lead ID formatı." };

  return withActionGuard(
    { actionName: 'activateBot' },
    async (ctx) => {
      // Resolve lead → phone
      const leads = await ctx.db.executeSafe({
        text: `SELECT phone_number, linked_opportunity_id FROM leads WHERE id = $1 AND tenant_id = $2`,
        values: [leadId, ctx.tenantId]
      }) as any[];

      if (leads.length === 0) return { success: false, error: "Lead bulunamadı." };

      const phone = leads[0].phone_number;

      // Toggle bot status on conversation
      await ctx.db.executeSafe({
        text: `UPDATE conversations SET status = 'bot', bot_activated_at = NOW() 
               WHERE tenant_id = $1 AND RIGHT(phone_number, 10) = RIGHT($2, 10)`,
        values: [ctx.tenantId, phone]
      });

      // Resolve conversation_id for log
      let conversationId: string | null = null;
      try {
        const convRes = await ctx.db.executeSafe({
          text: `SELECT id FROM conversations WHERE tenant_id = $1 AND RIGHT(phone_number, 10) = RIGHT($2, 10) LIMIT 1`,
          values: [ctx.tenantId, phone]
        }) as any[];
        conversationId = convRes[0]?.id || null;
      } catch (_) {}

      // Write outreach log
      await ctx.db.executeSafe({
        text: `INSERT INTO outreach_logs (tenant_id, lead_id, conversation_id, opportunity_id, action, channel, actor_id, metadata)
               VALUES ($1, $2, $3, $4, 'bot_activated', 'whatsapp', $5, $6)`,
        values: [
          ctx.tenantId,
          leadId,
          conversationId,
          leads[0].linked_opportunity_id || null,
          ctx.userId,
          JSON.stringify({ phone })
        ]
      });

      logAudit({
        tenantId: ctx.tenantId,
        userId: ctx.userId,
        userEmail: ctx.email,
        action: 'outreach_bot_activated',
        entityType: 'lead',
        entityId: leadId,
        details: { phone },
      });

      return { success: true };
    }
  ).then(res => {
    if (!res.success) return { success: false, error: res.error || res.data?.error };
    return { success: true };
  });
}


// ═══════════════════════════════════════════════════════════
// 4. GET OUTREACH HISTORY — Timeline data
// ═══════════════════════════════════════════════════════════

export interface OutreachLogEntry {
  id: string;
  action: string;
  channel: string;
  actor_id: string;
  actor_name?: string;
  metadata: Record<string, any>;
  created_at: string;
}

export async function getOutreachHistory(leadId: string): Promise<OutreachLogEntry[]> {
  if (!leadId || !UUID_RE.test(leadId)) return [];

  const result = await withActionGuard(
    { actionName: 'getOutreachHistory' },
    async (ctx) => {
      const rows = await ctx.db.executeSafe({
        text: `SELECT ol.id, ol.action, ol.channel, ol.actor_id, ol.metadata, ol.created_at,
                      u.name as actor_name
               FROM outreach_logs ol
               LEFT JOIN users u ON u.id::text = ol.actor_id AND u.tenant_id = $2
               WHERE ol.lead_id = $1 AND ol.tenant_id = $2
               ORDER BY ol.created_at DESC`,
        values: [leadId, ctx.tenantId]
      }) as any[];

      return rows.map((r: any) => ({
        id: r.id,
        action: r.action,
        channel: r.channel,
        actor_id: r.actor_id,
        actor_name: r.actor_name || 'Sistem',
        metadata: typeof r.metadata === 'string' ? JSON.parse(r.metadata) : (r.metadata || {}),
        created_at: r.created_at,
      }));
    }
  );

  return result.data || [];
}


// ═══════════════════════════════════════════════════════════
// 5. LOG CALL REACHED — Arandı / Ulaşıldı
// ═══════════════════════════════════════════════════════════

export async function logCallReached(leadId: string, note?: string) {
  if (!leadId || !UUID_RE.test(leadId)) return { success: false, error: "Geçersiz Lead ID." };

  return withActionGuard(
    { actionName: 'logCallReached' },
    async (ctx) => {
      const leads = await ctx.db.executeSafe({
        text: `SELECT phone_number, linked_opportunity_id FROM leads WHERE id = $1 AND tenant_id = $2`,
        values: [leadId, ctx.tenantId]
      }) as any[];
      if (leads.length === 0) return { success: false, error: "Lead bulunamadı." };

      const phone = leads[0].phone_number;

      // Resolve conversation_id
      let conversationId: string | null = null;
      try {
        const convRes = await ctx.db.executeSafe({
          text: `SELECT id FROM conversations WHERE tenant_id = $1 AND RIGHT(phone_number, 10) = RIGHT($2, 10) LIMIT 1`,
          values: [ctx.tenantId, phone]
        }) as any[];
        conversationId = convRes[0]?.id || null;
      } catch (_) {}

      // Write outreach log
      await ctx.db.executeSafe({
        text: `INSERT INTO outreach_logs (tenant_id, lead_id, conversation_id, opportunity_id, action, channel, actor_id, metadata)
               VALUES ($1, $2, $3, $4, 'called_reached', 'phone', $5, $6)`,
        values: [
          ctx.tenantId, leadId, conversationId,
          leads[0].linked_opportunity_id || null,
          ctx.userId,
          JSON.stringify({ phone, note: note || '' })
        ]
      });

      // Stage update → first_contact or responded (via UnifiedStageService)
      try {
        const { UnifiedStageService } = await import('@/lib/services/unified-stage.service');
        await UnifiedStageService.update({
          tenantId: ctx.tenantId,
          source: 'system',
          opportunityId: leads[0].linked_opportunity_id || undefined,
          phoneNumber: phone,
          targetStage: 'responded',
          actorId: ctx.userId,
          reason: 'outreach_call_reached',
        });
      } catch (_) {}

      logAudit({
        tenantId: ctx.tenantId,
        userId: ctx.userId,
        userEmail: ctx.email,
        action: 'outreach_call_reached',
        entityType: 'lead',
        entityId: leadId,
        details: { phone, note },
      });

      return { success: true };
    }
  ).then(res => {
    if (!res.success) return { success: false, error: res.error || res.data?.error };
    return { success: true };
  });
}


// ═══════════════════════════════════════════════════════════
// 6. LOG CALL MISSED — Arandı / Ulaşılamadı
// ═══════════════════════════════════════════════════════════

export async function logCallMissed(leadId: string, note?: string) {
  if (!leadId || !UUID_RE.test(leadId)) return { success: false, error: "Geçersiz Lead ID." };

  return withActionGuard(
    { actionName: 'logCallMissed' },
    async (ctx) => {
      const leads = await ctx.db.executeSafe({
        text: `SELECT phone_number, linked_opportunity_id FROM leads WHERE id = $1 AND tenant_id = $2`,
        values: [leadId, ctx.tenantId]
      }) as any[];
      if (leads.length === 0) return { success: false, error: "Lead bulunamadı." };

      const phone = leads[0].phone_number;

      let conversationId: string | null = null;
      try {
        const convRes = await ctx.db.executeSafe({
          text: `SELECT id FROM conversations WHERE tenant_id = $1 AND RIGHT(phone_number, 10) = RIGHT($2, 10) LIMIT 1`,
          values: [ctx.tenantId, phone]
        }) as any[];
        conversationId = convRes[0]?.id || null;
      } catch (_) {}

      // Write outreach log — NO stage change for missed calls
      await ctx.db.executeSafe({
        text: `INSERT INTO outreach_logs (tenant_id, lead_id, conversation_id, opportunity_id, action, channel, actor_id, metadata)
               VALUES ($1, $2, $3, $4, 'called_missed', 'phone', $5, $6)`,
        values: [
          ctx.tenantId, leadId, conversationId,
          leads[0].linked_opportunity_id || null,
          ctx.userId,
          JSON.stringify({ phone, note: note || '' })
        ]
      });

      logAudit({
        tenantId: ctx.tenantId,
        userId: ctx.userId,
        userEmail: ctx.email,
        action: 'outreach_call_missed',
        entityType: 'lead',
        entityId: leadId,
        details: { phone, note },
      });

      return { success: true };
    }
  ).then(res => {
    if (!res.success) return { success: false, error: res.error || res.data?.error };
    return { success: true };
  });
}


// ═══════════════════════════════════════════════════════════
// 7. LOG CALLBACK SCHEDULED — Geri Aranacak
// ═══════════════════════════════════════════════════════════

export async function logCallbackScheduled(leadId: string, note?: string) {
  if (!leadId || !UUID_RE.test(leadId)) return { success: false, error: "Geçersiz Lead ID." };

  return withActionGuard(
    { actionName: 'logCallbackScheduled' },
    async (ctx) => {
      const leads = await ctx.db.executeSafe({
        text: `SELECT phone_number, linked_opportunity_id FROM leads WHERE id = $1 AND tenant_id = $2`,
        values: [leadId, ctx.tenantId]
      }) as any[];
      if (leads.length === 0) return { success: false, error: "Lead bulunamadı." };

      const phone = leads[0].phone_number;

      let conversationId: string | null = null;
      try {
        const convRes = await ctx.db.executeSafe({
          text: `SELECT id FROM conversations WHERE tenant_id = $1 AND RIGHT(phone_number, 10) = RIGHT($2, 10) LIMIT 1`,
          values: [ctx.tenantId, phone]
        }) as any[];
        conversationId = convRes[0]?.id || null;
      } catch (_) {}

      // Write outreach log — NO stage change for callback scheduling
      await ctx.db.executeSafe({
        text: `INSERT INTO outreach_logs (tenant_id, lead_id, conversation_id, opportunity_id, action, channel, actor_id, metadata)
               VALUES ($1, $2, $3, $4, 'callback_scheduled', 'phone', $5, $6)`,
        values: [
          ctx.tenantId, leadId, conversationId,
          leads[0].linked_opportunity_id || null,
          ctx.userId,
          JSON.stringify({ phone, note: note || '' })
        ]
      });

      logAudit({
        tenantId: ctx.tenantId,
        userId: ctx.userId,
        userEmail: ctx.email,
        action: 'outreach_callback_scheduled',
        entityType: 'lead',
        entityId: leadId,
        details: { phone, note },
      });

      return { success: true };
    }
  ).then(res => {
    if (!res.success) return { success: false, error: res.error || res.data?.error };
    return { success: true };
  });
}


// ═══════════════════════════════════════════════════════════
// 8. LOG NOT INTERESTED — İlgilenmiyor
// ═══════════════════════════════════════════════════════════

export async function logNotInterested(leadId: string, reason?: string) {
  if (!leadId || !UUID_RE.test(leadId)) return { success: false, error: "Geçersiz Lead ID." };

  return withActionGuard(
    { actionName: 'logNotInterested' },
    async (ctx) => {
      const leads = await ctx.db.executeSafe({
        text: `SELECT phone_number, linked_opportunity_id FROM leads WHERE id = $1 AND tenant_id = $2`,
        values: [leadId, ctx.tenantId]
      }) as any[];
      if (leads.length === 0) return { success: false, error: "Lead bulunamadı." };

      const phone = leads[0].phone_number;

      let conversationId: string | null = null;
      try {
        const convRes = await ctx.db.executeSafe({
          text: `SELECT id FROM conversations WHERE tenant_id = $1 AND RIGHT(phone_number, 10) = RIGHT($2, 10) LIMIT 1`,
          values: [ctx.tenantId, phone]
        }) as any[];
        conversationId = convRes[0]?.id || null;
      } catch (_) {}

      // Write outreach log
      await ctx.db.executeSafe({
        text: `INSERT INTO outreach_logs (tenant_id, lead_id, conversation_id, opportunity_id, action, channel, actor_id, metadata)
               VALUES ($1, $2, $3, $4, 'not_interested', 'phone', $5, $6)`,
        values: [
          ctx.tenantId, leadId, conversationId,
          leads[0].linked_opportunity_id || null,
          ctx.userId,
          JSON.stringify({ phone, reason: reason || '' })
        ]
      });

      // Stage update → not_qualified (via UnifiedStageService)
      try {
        const { UnifiedStageService } = await import('@/lib/services/unified-stage.service');
        await UnifiedStageService.update({
          tenantId: ctx.tenantId,
          source: 'system',
          opportunityId: leads[0].linked_opportunity_id || undefined,
          phoneNumber: phone,
          targetStage: 'not_qualified',
          actorId: ctx.userId,
          reason: 'outreach_not_interested',
        });
      } catch (_) {}

      // Cancel pending tasks for this lead's phone
      try {
        await ctx.db.executeSafe({
          text: `UPDATE follow_up_tasks SET status = 'cancelled', skipped_reason = 'Lead ilgilenmiyor', updated_at = NOW()
                 WHERE tenant_id = $1 AND phone_number = $2 AND status IN ('pending', 'in_progress')`,
          values: [ctx.tenantId, phone]
        });
      } catch (_) {}

      logAudit({
        tenantId: ctx.tenantId,
        userId: ctx.userId,
        userEmail: ctx.email,
        action: 'outreach_not_interested',
        entityType: 'lead',
        entityId: leadId,
        details: { phone, reason },
      });

      return { success: true };
    }
  ).then(res => {
    if (!res.success) return { success: false, error: res.error || res.data?.error };
    return { success: true };
  });
}


// ═══════════════════════════════════════════════════════════
// 9. GET GREETING TEMPLATES — Template selector data
// ═══════════════════════════════════════════════════════════

export async function getGreetingTemplates() {
  return withActionGuard(
    { actionName: 'getGreetingTemplates' },
    async (ctx) => {
      const { TemplateResolverService } = await import('@/lib/services/template-resolver.service');
      return TemplateResolverService.listGreetingTemplates(ctx.db, ctx.tenantId);
    }
  ).then(res => res.data || []);
}

// ═══════════════════════════════════════════════════════════
// 10. SEND META TEMPLATE MESSAGE — Oturum kapalıyken şablon gönder
// ═══════════════════════════════════════════════════════════

export async function sendMetaTemplateMessage(opportunityId: string, templateName: string, languageCode: string = 'tr', templateText: string) {
  if (!opportunityId) return { success: false, error: "Fırsat ID gerekli." };
  if (!templateName) return { success: false, error: "Şablon ismi gerekli." };
  if (!templateText) return { success: false, error: "Şablon metni gerekli." };

  return withActionGuard(
    { actionName: 'sendMetaTemplateMessage' },
    async (ctx) => {
      // 0. Compliance Check
      const { isNonCompliant } = await import('@/lib/utils/patient-message-sanitizer');
      if (isNonCompliant(templateText)) {
        return {
          success: false,
          error: "Bu şablon isimli veya cinsiyetli hitap barındırdığı için (non-compliant) gönderimi engellenmiştir. Lütfen yeni nötr bir şablon onaylatın."
        };
      }

      // 1. Fetch Opportunity and Phone
      const opps = await ctx.db.executeSafe({
        text: `SELECT patient_name, phone_number FROM opportunities WHERE id = $1 AND tenant_id = $2 LIMIT 1`,
        values: [opportunityId, ctx.tenantId]
      }) as any[];

      if (opps.length === 0) {
        return { success: false, error: "Fırsat bulunamadı." };
      }

      const phone = opps[0].phone_number;
      if (!phone) {
        return { success: false, error: "Telefon numarası bulunamadı." };
      }

      // 2. Resolve WhatsApp credentials
      const creds = await CredentialsService.resolveCredentials(ctx.tenantId, 'whatsapp');
      const META_ACCESS_TOKEN = creds.accessToken;
      const PHONE_NUMBER_ID = creds.whatsappPhoneNumberId;

      if (!META_ACCESS_TOKEN || !PHONE_NUMBER_ID) {
        return { success: false, error: "WhatsApp entegrasyon kimlik bilgileri eksik." };
      }

      // 3. Send Meta Template Message via Graph API
      const response = await fetch(`https://graph.facebook.com/v25.0/${PHONE_NUMBER_ID}/messages`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${META_ACCESS_TOKEN}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          messaging_product: 'whatsapp',
          to: phone,
          type: 'template',
          template: {
            name: templateName,
            language: {
              code: languageCode
            }
          }
        }),
      });

      if (!response.ok) {
        const errData = await response.json().catch(() => ({}));
        return { success: false, error: `Meta API Şablon hatası: ${errData?.error?.message || response.statusText}` };
      }

      let providerMessageId: string | null = null;
      try {
        const resData = await response.json();
        providerMessageId = resData.messages?.[0]?.id || null;
      } catch (_) {}

      // 4. Resolve conversation_id
      let conversationId: string | null = null;
      try {
        const convRes = await ctx.db.executeSafe({
          text: `SELECT id FROM conversations WHERE tenant_id = $1 AND phone_number = $2 LIMIT 1`,
          values: [ctx.tenantId, phone]
        }) as any[];
        conversationId = convRes[0]?.id || null;
      } catch (_) {}

      // 5. Save message record & update conversation
      if (conversationId) {
        await ctx.db.executeSafe({
          text: `INSERT INTO messages (tenant_id, conversation_id, phone_number, direction, content, channel, status, provider_message_id)
                 VALUES ($1, $2, $3, 'out', $4, 'whatsapp', 'sent', $5)`,
          values: [ctx.tenantId, conversationId, phone, templateText, 'whatsapp', providerMessageId]
        });

        await ctx.db.executeSafe({
          text: `UPDATE conversations 
                 SET last_message_at = NOW(), 
                     last_message_content = $1,
                     last_channel = 'whatsapp',
                     last_message_status = 'sent',
                     last_message_direction = 'out',
                     message_count = COALESCE(message_count, 0) + 1
                 WHERE id = $2 AND tenant_id = $3`,
          values: [templateText, conversationId, ctx.tenantId]
        });
      }

      // 6. Write outreach log
      await ctx.db.executeSafe({
        text: `INSERT INTO outreach_logs (tenant_id, conversation_id, opportunity_id, action, channel, actor_id, metadata)
               VALUES ($1, $2, $3, 'template_sent', 'whatsapp', $4, $5)`,
        values: [
          ctx.tenantId,
          conversationId,
          opportunityId,
          ctx.userId,
          JSON.stringify({
            template_name: templateName,
            message_text: templateText,
            provider_message_id: providerMessageId,
            phone,
          })
        ]
      });

      // 7. Audit
      logAudit({
        tenantId: ctx.tenantId,
        userId: ctx.userId,
        userEmail: ctx.email,
        action: 'outreach_template_sent',
        entityType: 'opportunity',
        entityId: opportunityId,
        details: { phone, templateName },
      });

      return { success: true };
    }
  ).then(res => {
    if (!res.success) return { success: false, error: res.error || res.data?.error };
    return { success: true };
  });
}
