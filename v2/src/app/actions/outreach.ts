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
    if (!res.success || res.data?.success === false) return { success: false as const, error: res.error || res.data?.error, alreadySent: res.data?.alreadySent };
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

/**
 * Purely read-only, side-effect-free check for lead greeting readiness.
 * Does not write messages, outreach_logs, notifications, follow_up_tasks,
 * and does not call WhatsApp API or AI.
 */
export async function checkGreetingReadinessCore(
  db: any,
  tenantId: string,
  userId: string,
  leadId: string
) {
  const safeLeadId = leadId && leadId.trim() ? leadId.trim() : null;
  if (!safeLeadId || !UUID_RE.test(safeLeadId)) {
    throw new Error("Geçersiz Lead ID formatı.");
  }

  // 1. Fetch lead
  let dbDiagnostics = {};
  try {
    const dbUrlLog = process.env.DATABASE_URL ? (process.env.DATABASE_URL.includes('@') ? process.env.DATABASE_URL.split('@')[1] : process.env.DATABASE_URL) : 'NOT_SET';
    
    const countRes = await db.executeSafe({
      text: `SELECT count(*) FROM message_templates WHERE tenant_id = $1::uuid`,
      values: [tenantId]
    }) as any[];

    const activeTemplates = await db.executeSafe({
      text: `SELECT id, name, is_active, is_default FROM message_templates WHERE tenant_id = $1::uuid`,
      values: [tenantId]
    }) as any[];
    
    dbDiagnostics = {
      urlHost: dbUrlLog,
      count: countRes[0]?.count,
      templates: activeTemplates
    };
  } catch (err: any) {
    dbDiagnostics = { error: err.message };
  }

  const leads = await db.executeSafe({
    text: `/* checkGreetingReadiness:fetchLead */
           SELECT l.id, l.phone_number, l.patient_name, l.form_name,
                  l.linked_opportunity_id, l.customer_id, l.country, l.raw_data, l.created_at
           FROM leads l
           WHERE l.id = $1::uuid AND l.tenant_id = $2::uuid`,
    values: [safeLeadId, tenantId]
  }) as any[];

  if (leads.length === 0) {
    throw new Error("Lead bulunamadı.");
  }

  const lead = leads[0];
  const phone = lead.phone_number;

  if (!phone) {
    throw new Error("Telefon numarası eksik.");
  }

  // 2. Check if patient has EVER sent inbound on this phone
  const inbounds = await db.executeSafe({
    text: `/* checkGreetingReadiness:inboundBlock */
           SELECT 1 FROM messages 
           WHERE tenant_id = $1::uuid AND RIGHT(phone_number, 10) = RIGHT($2, 10) AND direction = 'in'
           LIMIT 1`,
    values: [tenantId, phone]
  }) as any[];
  const hardBlockedBecausePatientAlreadyInbound = inbounds.length > 0;

  // 3. Resolve active opportunity and conversation context
  const oppId = lead.linked_opportunity_id || null;
  let conversationId = null;
  if (oppId) {
    const opp = await db.executeSafe({
      text: `/* checkGreetingReadiness:fetchOpportunity */
             SELECT conversation_id FROM opportunities WHERE id = $1::uuid AND tenant_id = $2::uuid LIMIT 1`,
      values: [oppId, tenantId]
    }) as any[];
    conversationId = opp[0]?.conversation_id || null;
  }

  if (!conversationId) {
    const convRes = await db.executeSafe({
      text: `/* checkGreetingReadiness:fetchConversation */
             SELECT id FROM conversations WHERE tenant_id = $1::uuid AND RIGHT(phone_number, 10) = RIGHT($2, 10) LIMIT 1`,
      values: [tenantId, phone]
    }) as any[];
    conversationId = convRes[0]?.id || null;
  }

  // 4. Check Hard Duplicate logs
  const dupLogs = await db.executeSafe({
    text: `/* checkGreetingReadiness:duplicateLogs */
      SELECT ol.action, ol.created_at
      FROM outreach_logs ol
      LEFT JOIN leads l ON l.id = ol.lead_id AND l.tenant_id::text = ol.tenant_id
      WHERE ol.tenant_id = $1::text
        AND ol.action IN ('greeting_sent', 'template_sent', 'form_greeting_template_sent', 'manual_whatsapp_greeting_echo_confirmed')
        AND (
          ol.lead_id = $2::uuid
          OR (ol.opportunity_id = $3::text AND $3 IS NOT NULL)
          OR (ol.conversation_id = $4::text AND $4 IS NOT NULL)
          OR (
            RIGHT(ol.metadata->>'phone', 10) = RIGHT($5, 10)
            AND (l.form_name = $6 OR ol.metadata->>'form_name' = $6)
          )
        )
      LIMIT 1
    `,
    values: [tenantId, safeLeadId, oppId, conversationId, phone, lead.form_name]
  }) as any[];
  const hasHardDuplicate = dupLogs.length > 0;
  const greetingSent = hasHardDuplicate; // legacy UI compatibility mapping

  // 5. Check Soft Duplicate (Outbound message exists)
  const outMessages = await db.executeSafe({
    text: `SELECT 1 FROM messages 
           WHERE tenant_id = $1::uuid AND RIGHT(phone_number, 10) = RIGHT($2, 10) AND direction = 'out'
           LIMIT 1`,
    values: [tenantId, phone]
  }) as any[];
  const hasSoftDuplicate = outMessages.length > 0;

  // 6. Resolve greeting template
  const { FormGreetingHandoffService } = await import("@/lib/services/form-greeting-handoff.service");
  const service = new FormGreetingHandoffService(db, tenantId);
  const elig = await service.checkEligibilityForLead(lead);

  // Resolve greeting language config from channel_ai_profiles
  let greetingLang = 'auto';
  try {
    const profileRes = await db.executeSafe({
      text: `SELECT cap.greeting_language FROM channel_ai_profiles cap
             JOIN channel_groups cg ON cap.group_id = cg.id
             WHERE cg.tenant_id = $1 AND cg.status = 'active'
             ORDER BY cg.sort_order ASC LIMIT 1`,
      values: [tenantId]
    }) as any[];
    if (profileRes.length > 0) {
      greetingLang = profileRes[0].greeting_language || 'auto';
    }
  } catch (_) {}

  // Extract lead-level language hint from raw_data
  let leadLanguage: string | undefined;
  let leadDepartment: string | undefined;
  try {
    const rawData = typeof lead.raw_data === 'string' ? JSON.parse(lead.raw_data) : (lead.raw_data || {});
    leadLanguage = rawData.language || rawData.Language || rawData.dil || rawData.Dil || undefined;
    leadDepartment = rawData.department || rawData.Department || rawData.departman || rawData.Departman || rawData.bolum || rawData.Bölüm || undefined;
  } catch (_) {}

  if (!leadDepartment && lead.linked_opportunity_id) {
    try {
      const oppRes = await db.executeSafe({
        text: `SELECT department FROM opportunities WHERE id = $1 AND tenant_id = $2 LIMIT 1`,
        values: [lead.linked_opportunity_id, tenantId]
      }) as any[];
      if (oppRes.length > 0) leadDepartment = oppRes[0].department || undefined;
    } catch (_) {}
  }

  // Resolve tenant name
  let tenantName = 'Başkent Üniversitesi Hastanesi';
  try {
    const { withTenantDB } = await import('@/lib/core/tenant-db');
    const sysDb = withTenantDB('admin-system', true);
    const tenantRes = await sysDb.executeSafe({
      text: `SELECT name FROM tenants WHERE id = $1 LIMIT 1`,
      values: [tenantId]
    }) as any[];
    if (tenantRes.length > 0) tenantName = tenantRes[0].name;
  } catch (_) {}

  const { TemplateResolverService } = await import('@/lib/services/template-resolver.service');
  const resolved = await TemplateResolverService.resolve(db, {
    tenantId: tenantId,
    tenantName,
    patientName: lead.patient_name || '',
    formName: lead.form_name || undefined,
    department: leadDepartment || undefined,
    country: lead.country || undefined,
    phoneNumber: phone,
  }, greetingLang);

  const hasRealTemplate = resolved.templateId !== null && resolved.source !== 'system_hardcoded';
  const isNonCompliant = resolved.template_non_compliant || false;

  // 7. Validate template variables (unsupported variables guard)
  const safeVars = new Set(['patient_name', 'tenant_name', 'form_name', 'department', 'country', 'coordinator_name']);
  const matches = resolved.body ? (resolved.body.match(/\{\{([^}]+)\}\}/g) || []) : [];
  let hasUnsupportedVariables = false;
  for (const match of matches) {
    const varName = match.replace(/[\{\}]/g, '').trim();
    if (!safeVars.has(varName)) {
      hasUnsupportedVariables = true;
      break;
    }
  }

  // Calculate sendability rules
  const templateSendable = !hardBlockedBecausePatientAlreadyInbound &&
                           !hasHardDuplicate &&
                           hasRealTemplate &&
                           !isNonCompliant &&
                           !hasUnsupportedVariables;

  return {
    draftTemplateAvailable: true,
    approvedWhatsappTemplateAvailable: hasRealTemplate && !isNonCompliant && !hasUnsupportedVariables,
    templateConfigExists: hasRealTemplate,
    templateSendable,
    templateNonCompliant: isNonCompliant,
    complianceWarning: resolved.compliance_warning || null,
    source: resolved.source === 'system_hardcoded' ? 'system_hardcoded' : (hasRealTemplate ? 'message_templates' : 'none'),
    isWithin24hWindow: elig.windowOpen,
    hardBlockedBecausePatientAlreadyInbound,
    hasHardDuplicate,
    hasSoftDuplicate,
    hasUnsupportedVariables,
    draftText: resolved.rendered,
    templateName: resolved.templateName,
    templateLanguage: resolved.language,
    greetingSent,
    _diagnostics: dbDiagnostics
  };
}

export async function checkGreetingReadiness(leadId: string) {
  console.info('[GREETING_READINESS_INPUT]', {
    receivedId: String(leadId).slice(0, 8) + '***',
    idType: typeof leadId,
  });

  const safeLeadId = leadId && leadId.trim() ? leadId.trim() : null;
  if (!safeLeadId || !UUID_RE.test(safeLeadId)) {
    return { success: false as const, error: "Geçersiz Lead ID formatı." };
  }

  return withActionGuard(
    { actionName: 'checkGreetingReadiness' },
    async (ctx) => {
      const res = await checkGreetingReadinessCore(ctx.db, ctx.tenantId, ctx.userId, leadId);
      return res;
    }
  ).then(res => {
    if (!res.success || !res.data) return { success: false as const, error: res.error || "Kontrol başarısız." };
    const data = (res.data || {}) as any;
    const finalData = {
      draftTemplateAvailable: !!data.draftTemplateAvailable,
      approvedWhatsappTemplateAvailable: !!data.approvedWhatsappTemplateAvailable,
      templateConfigExists: !!data.templateConfigExists,
      templateSendable: !!data.templateSendable,
      templateNonCompliant: !!data.templateNonCompliant,
      complianceWarning: (data.complianceWarning || null) as string | null,
      source: (data.source || 'none') as 'message_templates' | 'system_hardcoded' | 'none',
      isWithin24hWindow: !!data.isWithin24hWindow,
      hardBlockedBecausePatientAlreadyInbound: !!data.hardBlockedBecausePatientAlreadyInbound,
      hasHardDuplicate: !!data.hasHardDuplicate,
      hasSoftDuplicate: !!data.hasSoftDuplicate,
      hasUnsupportedVariables: !!data.hasUnsupportedVariables,
      draftText: (data.draftText || "") as string,
      templateName: (data.templateName || "") as string,
      templateLanguage: (data.templateLanguage || "") as string,
      greetingSent: !!data.greetingSent,
      _diagnostics: data._diagnostics
    };

    console.info('[GREETING_READINESS_RESULT]', {
      leadId: leadId.substring(0, 8) + '***',
      templateConfigExists: finalData.templateConfigExists,
      templateName: finalData.templateName,
      templateLanguage: finalData.templateLanguage,
      templateNonCompliant: finalData.templateNonCompliant,
      templateSendable: finalData.templateSendable,
      isWithin24hWindow: finalData.isWithin24hWindow,
      source: finalData.source
    });

    return {
      success: true as const,
      data: finalData
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
    if (!res.success || res.data?.success === false) return { success: false, error: res.error || res.data?.error, alreadySent: res.data?.alreadySent };
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
    if (!res.success || res.data?.success === false) return { success: false, error: res.error || res.data?.error };
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
  const safeLeadId = leadId && leadId.trim() ? leadId.trim() : null;
  if (!safeLeadId || !UUID_RE.test(safeLeadId)) return [];

  const result = await withActionGuard(
    { actionName: 'getOutreachHistory' },
    async (ctx) => {
      const rows = await ctx.db.executeSafe({
        text: `/* getOutreachHistory:fetchHistory */
               SELECT ol.id, ol.action, ol.channel, ol.actor_id, ol.metadata, ol.created_at,
                      u.name as actor_name
               FROM outreach_logs ol
               LEFT JOIN users u ON u.id::text = ol.actor_id AND u.tenant_id = $2::uuid
               WHERE ol.lead_id = $1::uuid AND ol.tenant_id = $2::text
               ORDER BY ol.created_at DESC`,
        values: [safeLeadId, ctx.tenantId]
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
    if (!res.success || res.data?.success === false) return { success: false, error: res.error || res.data?.error };
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
    if (!res.success || res.data?.success === false) return { success: false, error: res.error || res.data?.error };
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
    if (!res.success || res.data?.success === false) return { success: false, error: res.error || res.data?.error };
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
    if (!res.success || res.data?.success === false) return { success: false, error: res.error || res.data?.error };
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
// 9b. SEND FORM GREETING TEMPLATE ACTION — Şablonlu karşılama gönder (360dialog/Meta)
// ═══════════════════════════════════════════════════════════

export async function sendFormGreetingTemplateAction(
  leadId: string,
  templateId: string,
  templateName: string,
  languageCode: string,
  templateText: string
) {
  const safeLeadId = leadId && leadId.trim() ? leadId.trim() : null;
  const safeTemplateId = templateId && templateId.trim() ? templateId.trim() : null;

  if (!safeLeadId || !UUID_RE.test(safeLeadId)) return { success: false, error: "Geçersiz Lead ID." };
  if (!templateName) return { success: false, error: "Şablon ismi gerekli." };
  if (!templateText) return { success: false, error: "Şablon metni gerekli." };

  return withActionGuard(
    { actionName: 'sendFormGreetingTemplateAction' },
    async (ctx) => {
      // 1. Fetch Lead
      const leads = await ctx.db.executeSafe({
        text: `/* sendFormGreetingTemplateAction:fetchLead */
               SELECT l.id, l.phone_number, l.patient_name, l.form_name,
                      l.linked_opportunity_id, l.customer_id, l.raw_data
               FROM leads l
               WHERE l.id = $1::uuid AND l.tenant_id = $2::uuid`,
        values: [safeLeadId, ctx.tenantId]
      }) as any[];

      if (leads.length === 0) {
        return { success: false, error: "Lead bulunamadı." };
      }

      const lead = leads[0];
      const phone = lead.phone_number;

      if (!phone) {
        return { success: false, error: "Telefon numarası eksik." };
      }

      // Parse raw_data
      let rawData: any = {};
      try {
        if (lead.raw_data) {
          rawData = typeof lead.raw_data === 'string' ? JSON.parse(lead.raw_data) : lead.raw_data;
        }
      } catch (_) {}

      // 2. Duplicate Check (Hard Guard)
      // Check if patient wrote to us (inbound)
      const inbounds = await ctx.db.executeSafe({
        text: `/* sendFormGreetingTemplateAction:inboundBlock */
               SELECT 1 FROM messages 
               WHERE tenant_id = $1::uuid AND RIGHT(phone_number, 10) = RIGHT($2, 10) AND direction = 'in' 
               LIMIT 1`,
        values: [ctx.tenantId, phone]
      }) as any[];
      if (inbounds.length > 0) {
        return { success: false, error: "Hasta zaten bize yazdı. Karşılama engellendi." };
      }

      // Check if hard duplicate in outreach_logs
      const oppId = lead.linked_opportunity_id || null;
      let conversationId = null;
      if (oppId) {
        const opp = await ctx.db.executeSafe({
          text: `/* sendFormGreetingTemplateAction:fetchOpportunity */
                 SELECT conversation_id FROM opportunities WHERE id = $1::uuid AND tenant_id = $2::uuid LIMIT 1`,
          values: [oppId, ctx.tenantId]
        }) as any[];
        conversationId = opp[0]?.conversation_id || null;
      }

      if (!conversationId) {
        const convRes = await ctx.db.executeSafe({
          text: `/* sendFormGreetingTemplateAction:fetchConversation */
                 SELECT id FROM conversations WHERE tenant_id = $1::uuid AND RIGHT(phone_number, 10) = RIGHT($2, 10) LIMIT 1`,
          values: [ctx.tenantId, phone]
        }) as any[];
        conversationId = convRes[0]?.id || null;
      }

      const dupLogs = await ctx.db.executeSafe({
        text: `/* sendFormGreetingTemplateAction:duplicateLogs */
          SELECT ol.action 
          FROM outreach_logs ol
          LEFT JOIN leads l ON l.id = ol.lead_id AND l.tenant_id::text = ol.tenant_id
          WHERE ol.tenant_id = $1
            AND ol.action IN ('greeting_sent', 'template_sent', 'form_greeting_template_sent')
            AND (
              ol.lead_id = $2::uuid
              OR (ol.opportunity_id = $3 AND $3 IS NOT NULL)
              OR (ol.conversation_id = $4 AND $4 IS NOT NULL)
              OR (
                RIGHT(ol.metadata->>'phone', 10) = RIGHT($5, 10)
                AND (l.form_name = $6 OR ol.metadata->>'form_name' = $6)
              )
            )
          LIMIT 1
        `,
        values: [ctx.tenantId, safeLeadId, oppId, conversationId, phone, lead.form_name]
      }) as any[];
      if (dupLogs.length > 0) {
        return { success: false, error: "Bu hastaya daha önce karşılama şablonu gönderilmiştir." };
      }

      // 3. Resolve active WhatsApp provider details
      const creds = await CredentialsService.resolveCredentials(ctx.tenantId, 'whatsapp');
      if (!creds.accessToken) {
        return { success: false, error: "WhatsApp sağlayıcı erişim anahtarı bulunamadı." };
      }

      let providerMessageId: string | null = null;
      let sendSuccess = false;

      // 4. Call Meta / 360dialog template send API
      try {
        if (creds.provider === '360dialog' || creds.provider === '360dialog_whatsapp') {
          const { ThreeSixtyDialogService } = await import('@/lib/services/providers/three-sixty-dialog.service');
          const res = await ThreeSixtyDialogService.sendTemplate(
            creds.accessToken,
            phone,
            templateName,
            languageCode
          );
          sendSuccess = res.success;
          providerMessageId = res.providerMessageId || null;
        } else {
          // Default: Meta Cloud API via Graph API
          const phoneId = creds.whatsappPhoneNumberId;
          if (!phoneId) {
            return { success: false, error: "WhatsApp Phone Number ID eksik." };
          }
          const response = await fetch(`https://graph.facebook.com/v25.0/${phoneId}/messages`, {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${creds.accessToken}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              messaging_product: 'whatsapp',
              to: phone,
              recipient_type: 'individual',
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
            const rawErrorMsg = errData?.error?.message || response.statusText;
            throw new Error(`Meta API error: ${rawErrorMsg}`);
          }

          const resData = await response.json().catch(() => ({}));
          providerMessageId = resData.messages?.[0]?.id || null;
          sendSuccess = true;
        }
      } catch (err: any) {
        // Safe scrubbing of credentials in the returned error message
        const safeErrorMsg = (err instanceof Error ? err.message : String(err))
          .replace(new RegExp(creds.accessToken || 'NON_EXISTENT_KEY', 'g'), '[SCRUBBED_API_KEY]');
          
        if (safeErrorMsg.includes('lack of payment on client side')) {
          return { success: false, error: '360dialog API gönderimi ödeme/billing nedeniyle reddetti. Dilerseniz ücretsiz manuel seçenekle WhatsApp uygulamasında açabilirsiniz.' };
        }
        
        return { success: false, error: `WhatsApp gönderimi başarısız oldu: ${safeErrorMsg}` };
      }

      if (!sendSuccess) {
        return { success: false, error: "WhatsApp sağlayıcı şablon gönderimi başarısız oldu." };
      }

      // 5. Ensure conversation/opportunity exist in compliance with FormLeadActivationService
      let finalOppId = lead.linked_opportunity_id;
      let finalConvId = conversationId;

      if (!finalOppId) {
        try {
          const { FormLeadActivationService } = await import('@/lib/services/form-lead-activation.service');
          const actRes = await FormLeadActivationService.activate({
            tenantId: ctx.tenantId,
            leadId: lead.id,
            phoneNumber: phone,
            patientName: lead.patient_name || undefined,
            formName: lead.form_name || 'Bilinmeyen Form',
            email: rawData?.email || undefined,
            source: rawData?.source || 'manual'
          });
          finalOppId = actRes.opportunityId || null;
          finalConvId = actRes.conversationId || null;
        } catch (actErr) {
          // Non-fatal fallback for activation
          console.error("Form lead activation error:", actErr);
        }
      }

      if (finalOppId && !finalConvId) {
        const opp = await ctx.db.executeSafe({
          text: `/* sendFormGreetingTemplateAction:activateLeadOpportunity */
                 SELECT conversation_id FROM opportunities WHERE id = $1::uuid AND tenant_id = $2::uuid LIMIT 1`,
          values: [finalOppId, ctx.tenantId]
        }) as any[];
        finalConvId = opp[0]?.conversation_id || null;
      }

      if (!finalConvId) {
        const suffixes = [phone.slice(-10)];
        const conv = await ctx.db.executeSafe({
          text: `/* sendFormGreetingTemplateAction:activateLeadConversation */
                 SELECT id FROM conversations WHERE tenant_id = $1::uuid AND RIGHT(phone_number, 10) = ANY($2) LIMIT 1`,
          values: [ctx.tenantId, suffixes]
        }) as any[];
        finalConvId = conv[0]?.id || null;
      }

      // 6. Write messages record
      if (finalConvId) {
        await ctx.db.executeSafe({
          text: `/* sendFormGreetingTemplateAction:insertMessage */
                 INSERT INTO messages (tenant_id, conversation_id, phone_number, direction, content, channel, status, provider_message_id)
                 VALUES ($1::uuid, $2::uuid, $3, 'out', $4, 'whatsapp', 'sent', $5)`,
          values: [ctx.tenantId, finalConvId, phone, templateText, providerMessageId]
        });

        // Update conversation last_message
        await ctx.db.executeSafe({
          text: `/* sendFormGreetingTemplateAction:updateConversation */
                 UPDATE conversations 
                 SET last_message_at = NOW(), 
                     last_message_content = $1,
                     last_channel = 'whatsapp',
                     last_message_status = 'sent',
                     last_message_direction = 'out',
                     message_count = COALESCE(message_count, 0) + 1
                 WHERE id = $2::uuid AND tenant_id = $3::uuid`,
          values: [templateText, finalConvId, ctx.tenantId]
        });
      }

      // 7. Update Opportunity/Conversation stage to 'first_contact'
      if (finalOppId) {
        try {
          const { UnifiedStageService } = await import('@/lib/services/unified-stage.service');
          await UnifiedStageService.update({
            tenantId: ctx.tenantId,
            source: 'system',
            opportunityId: finalOppId,
            phoneNumber: phone,
            targetStage: 'first_contact',
            actorId: ctx.userId,
            reason: 'form_greeting_template_sent',
          });
        } catch (_) {}
      }

      // 8. Write outreach log
      await ctx.db.executeSafe({
        text: `/* sendFormGreetingTemplateAction:insertOutreachLog */
               INSERT INTO outreach_logs (tenant_id, lead_id, conversation_id, opportunity_id, action, channel, actor_id, metadata)
               VALUES ($1, $2::uuid, $3, $4, 'form_greeting_template_sent', 'whatsapp', $5, $6)`,
        values: [
          ctx.tenantId,
          safeLeadId,
          finalConvId,
          finalOppId,
          ctx.userId,
          JSON.stringify({
            template_id: templateId,
            template_name: templateName,
            message_text: templateText,
            provider_message_id: providerMessageId,
            phone,
            form_name: lead.form_name
          })
        ]
      });

      // 9. Audit Log
      logAudit({
        tenantId: ctx.tenantId,
        userId: ctx.userId,
        userEmail: ctx.email,
        action: 'outreach_form_greeting_template_sent',
        entityType: 'lead',
        entityId: leadId,
        details: { phone, templateName, providerMessageId },
      });

      return { success: true, providerMessageId };
    }
  ).then(res => {
    if (!res.success || res.data?.success === false) return { success: false, error: res.error || res.data?.error };
    return { success: true, providerMessageId: res.data?.providerMessageId };
  });
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
    if (!res.success || res.data?.success === false) return { success: false, error: res.error || res.data?.error };
    return { success: true };
  });
}

export async function saveGreetingDraftInternal(leadId: string, approvedText: string, coordinatorNote?: string, targetPhone?: string) {
  const safeLeadId = leadId && leadId.trim() ? leadId.trim() : null;
  if (!safeLeadId || !UUID_RE.test(safeLeadId)) return { success: false as const, error: "Geçersiz Lead ID formatı." };
  if (!approvedText || approvedText.trim().length === 0) return { success: false as const, error: "Taslak metni boş olamaz." };

  return withActionGuard(
    { actionName: 'saveGreetingDraftInternal' },
    async (ctx) => {
      // 1. Fetch lead
      const leads = await ctx.db.executeSafe({
        text: `/* saveGreetingDraftInternal:fetchLead */
               SELECT l.id, l.phone_number, l.patient_name, l.linked_opportunity_id, l.customer_id
               FROM leads l
               WHERE l.id = $1::uuid AND l.tenant_id = $2::uuid`,
        values: [safeLeadId, ctx.tenantId]
      }) as any[];

      if (leads.length === 0) {
        return { success: false, error: "Lead bulunamadı." };
      }

      const lead = leads[0];
      const phone = targetPhone || lead.phone_number;

      if (!phone) {
        return { success: false, error: "Telefon numarası eksik." };
      }

      // 2. Find conversation
      const convRes = await ctx.db.executeSafe({
        text: `/* saveGreetingDraftInternal:fetchConversation */
               SELECT id FROM conversations 
               WHERE tenant_id = $1::uuid AND RIGHT(phone_number, 10) = RIGHT($2, 10)
               LIMIT 1`,
        values: [ctx.tenantId, phone]
      }) as any[];
      const conversationId = convRes[0]?.id || null;

      // 3. Write outreach log (Zero-Outbound, stage unchanged)
      const actorId = ctx.userId;
      if (!actorId) {
        return { success: false, error: "Kullanıcı kimliği bulunamadı (actor_id null olamaz)." };
      }
      await ctx.db.executeSafe({
        text: `/* saveGreetingDraftInternal:insertOutreachLog */
               INSERT INTO outreach_logs (tenant_id, lead_id, conversation_id, opportunity_id, action, channel, actor_id, metadata)
               VALUES ($1, $2::uuid, $3, $4, 'smart_greeting_draft_edited', 'whatsapp', $5, $6)`,
        values: [
          ctx.tenantId,
          safeLeadId,
          conversationId,
          lead.linked_opportunity_id || null,
          actorId,
          JSON.stringify({
            draft_text: approvedText,
            source: 'smart_draft',
            patient_visible: false,
            zero_api_outbound: true,
            zero_outbound: true,
            draft_only: true,
            stage_changed: false,
            message_text: approvedText,
            coordinator_note: coordinatorNote || null,
            phone,
            target_phone: phone,
            patient_name: lead.patient_name || ''
          })
        ]
      });

      // 4. Save Bot Directive if conversation exists and note is provided
      let directiveSaved = false;
      if (conversationId && coordinatorNote && coordinatorNote.trim().length > 0) {
        try {
          const { saveBotSteeringDirectiveAction } = await import("./inbox");
          const steeringRes = await saveBotSteeringDirectiveAction(conversationId, coordinatorNote);
          directiveSaved = steeringRes.success;
        } catch (err) {
          console.error("Failed to save bot steering from forms page:", err);
        }
      }

      return { 
        success: true, 
        hasConversation: !!conversationId, 
        directiveSaved 
      };
    }
  ).then(res => {
    if (!res.success || res.data?.success === false) return { success: false as const, error: res.error || "İşlem başarısız." };
    return { 
      success: true as const, 
      hasConversation: !!res.data?.hasConversation,
      directiveSaved: !!res.data?.directiveSaved
    };
  });
}


// ═══════════════════════════════════════════════════════════
// 12. WHATSAPP APP OPEN LOG — Ücretsiz Manuel Seçenek Logu
// ═══════════════════════════════════════════════════════════
export async function logWhatsappAppOpenedForGreetingAction(
  leadId: string, 
  messageText: string,
  options?: { source?: string, queue_index?: number, queue_total?: number, targetPhone?: string }
) {
  const safeLeadId = leadId?.replace(/['";\\]/g, "");
  if (!safeLeadId || !UUID_RE.test(safeLeadId)) return { success: false, error: "Geçersiz Lead ID." };

  return withActionGuard(
    { actionName: 'logWhatsappAppOpenedForGreetingAction' },
    async (ctx) => {
      // 1. Fetch Lead for phone and form_name
      const leads = await ctx.db.executeSafe({
        text: `SELECT phone_number, form_name, patient_name, linked_opportunity_id
               FROM leads
               WHERE id = $1::uuid AND tenant_id = $2::uuid LIMIT 1`,
        values: [safeLeadId, ctx.tenantId]
      }) as any[];

      if (leads.length === 0) return { success: false, error: "Lead bulunamadı." };
      const lead = leads[0];
      const phone = options?.targetPhone || lead.phone_number;

      // Mask phone for metadata
      const maskPhone = (p: string) => {
        if (!p) return "";
        if (p.length < 6) return p;
        return p.slice(0, 3) + "****" + p.slice(-3);
      };

      const actorId = ctx.userId;
      if (!actorId) {
        return { success: false, error: "Kullanıcı kimliği bulunamadı (actor_id null olamaz)." };
      }
      await ctx.db.executeSafe({
        text: `INSERT INTO outreach_logs (tenant_id, lead_id, opportunity_id, action, channel, actor_id, metadata)
               VALUES ($1, $2::uuid, $3, 'whatsapp_app_opened_for_greeting', 'whatsapp', $4, $5)`,
        values: [
          ctx.tenantId,
          safeLeadId,
          lead.linked_opportunity_id || null,
          actorId,
          JSON.stringify({
            zero_api_outbound: true,
            patient_visible: false,
            opened_via: 'wa_me_link',
            message_text: messageText,
            phone_masked: maskPhone(phone),
            target_phone: phone,
            source: options?.source || 'forms_page',
            queue_index: options?.queue_index,
            queue_total: options?.queue_total
          })
        ]
      });

      return { success: true };
    }
  ).then(res => {
    if (!res.success || res.data?.success === false) return { success: false, error: res.error || res.data?.error };
    return { success: true };
  });
}

// ═══════════════════════════════════════════════════════════
// 13. PREPARE MANUAL GREETING QUEUE — Bulk WhatsApp Açılışı İçin
// ═══════════════════════════════════════════════════════════
import { generateSmartDraft } from '@/lib/utils/smart-draft-generator';

export async function prepareSmartGreetingDraftCore(
  db: any,
  tenantId: string,
  userId: string,
  leadId: string
) {
  const resolutionCore = await resolveFirstContactCore(db, tenantId, leadId);
  let readinessData: any = {};
  try {
    readinessData = await checkGreetingReadinessCore(db, tenantId, userId, leadId);
  } catch (e) {
    console.error("prepareSmartGreetingDraftCore: failed to fetch greeting readiness:", e);
  }
  const resolution = {
    ...resolutionCore,
    ...readinessData
  };

  // Get the existing logs to check for existing draft
  const logsRes = await db.executeSafe({
    text: `SELECT action, created_at, metadata->>'draft' as draft, metadata->>'draftText' as draft_text, metadata->>'message_text' as message_text
           FROM outreach_logs
           WHERE lead_id = $1::uuid AND tenant_id = $2::text
           ORDER BY created_at DESC`,
    values: [leadId, tenantId]
  }) as any[];

  // Hard duplicates definition
  const hardDuplicateActions = [
    'greeting_sent',
    'template_sent',
    'form_greeting_template_sent',
    'manual_whatsapp_greeting_echo_confirmed',
    'inbox_form_greeting_sent'
  ];
  
  // Soft duplicates definition
  const softDuplicateActions = [
    'smart_greeting_draft_prepared',
    'smart_greeting_draft_edited',
    'form_greeting_draft_saved_internal',
    'whatsapp_app_opened_for_greeting'
  ];

  let existingDraft = '';
  
  for (const log of logsRes) {
    if (hardDuplicateActions.includes(log.action)) {
       break;
    }
    if (softDuplicateActions.includes(log.action)) {
       const meta = typeof log.metadata === 'string' ? JSON.parse(log.metadata) : (log.metadata || {});
       const draftVal = meta.draft_text || meta.draftText || meta.message_text || meta.messageText || meta.draft;
       if (draftVal) {
         existingDraft = draftVal;
         break;
       }
    }
  }

  let draftText = existingDraft;
  if (!draftText) {
    const leads = await db.executeSafe({
      text: `SELECT form_name, raw_data FROM leads WHERE id = $1::uuid AND tenant_id = $2::uuid LIMIT 1`,
      values: [leadId, tenantId]
    }) as any[];
    
    if (leads.length > 0) {
      const { generateSmartDraft } = await import('@/lib/utils/smart-draft-generator');
      draftText = await generateSmartDraft(leads[0].raw_data, leads[0].form_name);
    } else {
      draftText = "Merhaba, Başkent Üniversitesi Konya Hastanesi’nden, doldurduğunuz form doğrultusunda sizinle iletişime geçiyoruz.";
    }
    
    // Log the newly prepared draft
    if (!userId) {
      throw new Error("Kullanıcı kimliği bulunamadı (actor_id null olamaz).");
    }
    await db.executeSafe({
      text: `INSERT INTO outreach_logs (tenant_id, lead_id, action, actor_id, metadata) VALUES ($1, $2, 'smart_greeting_draft_prepared', $3, $4)`,
      values: [
        tenantId,
        leadId,
        userId,
        JSON.stringify({
          draft_text: draftText,
          source: 'smart_draft',
          patient_visible: false,
          zero_api_outbound: true
        })
      ]
    });
  }

  return {
    draftText,
    restoredFromLog: !!existingDraft,
    source: existingDraft ? 'restored' as const : 'generated' as const,
    recommendedPhone: resolution.recommendedPhone?.phone,
    phones: resolution.phones
  };
}

export async function prepareSmartGreetingDraftAction(leadId: string) {
  try {
    return await withActionGuard({ actionName: 'prepareSmartGreetingDraftAction' }, async (ctx) => {
      return await prepareSmartGreetingDraftCore(ctx.db, ctx.tenantId, ctx.userId, leadId);
    }).then(res => {
      if (!res.success) return { success: false, error: res.error || "Taslak hazırlanamadı." };
      return {
        success: true as const,
        data: res.data
      };
    });
  } catch (err: any) {
    return { success: false, error: err.message };
  }
}

// ═══════════════════════════════════════════════════════════
// 13. PREPARE SMART GREETING QUEUE — Bulk WhatsApp Açılışı İçin
// ═══════════════════════════════════════════════════════════
export async function prepareBulkSmartGreetingDraftsAction(leadIds: string[]) {
  try {
    return await withActionGuard({ actionName: 'prepareBulkSmartGreetingDraftsAction' }, async (ctx) => {
      const safeIds = leadIds.slice(0, 10);

      const draftPromises = safeIds.map(async (id) => {
        try {
          const draftRes = await prepareSmartGreetingDraftCore(ctx.db, ctx.tenantId, ctx.userId, id);
          
          // Check eligibility
          const resolutionCore = await resolveFirstContactCore(ctx.db, ctx.tenantId, id);
          
          let isEligible = true;
          let status = 'Hazır';
          let reason = '';

          // Strict Bulk Eligibility: Only 'needs_greeting' allowed
          if (resolutionCore.patientLevelStatus !== 'needs_greeting') {
            isEligible = false;
            status = 'Atlandı';
            if (resolutionCore.patientLevelStatus === 'waiting_inbox_reply' || resolutionCore.patientLevelStatus === 'patient_replied') {
              reason = 'Hasta Inbox mesajı göndermiş';
            } else if (resolutionCore.patientLevelStatus === 'whatsapp_opened') {
              reason = 'Uygulama zaten açılmış (Tekli ekranı kullanın)';
            } else if (resolutionCore.patientLevelStatus === 'manual_greeting_confirmed' || resolutionCore.patientLevelStatus === 'inbox_greeting_sent') {
              reason = 'Karşılama zaten yapılmış';
            } else {
              reason = 'Lead durumu needs_greeting değil (' + resolutionCore.patientLevelStatus + ')';
            }
          }

          return {
            id,
            draftText: isEligible ? draftRes.draftText : "",
            isEligible,
            status,
            reason,
            source: 'smart_form_draft',
            recommendedPhone: draftRes.recommendedPhone,
          };
        } catch (e: any) {
          return { id, draftText: "", isEligible: false, status: 'Hata', reason: e.message || "Bilinmeyen hata" };
        }
      });

      const results = await Promise.all(draftPromises);
      return { success: true, data: { queueItems: results } };
    }).then(res => {
      if (!res.success) return { success: false, error: res.error || "Kuyruk hazırlanamadı." };
      return { success: true, queueItems: (res.data as any)?.queueItems || [] };
    });
  } catch (err: any) {
    return { success: false, error: err.message };
  }
}

import { resolveFirstContactCore, type ContactPhoneStatus } from "@/lib/utils/first-contact-status-resolver";
import { deduplicatePhones } from "@/lib/utils/country";

export async function resolveFirstContactAction(leadId: string): Promise<{ success: boolean; resolution?: any; error?: string }> {
  return withActionGuard(
    { actionName: 'resolveFirstContactAction' },
    async (ctx) => {
      const resolution = await resolveFirstContactCore(ctx.db, ctx.tenantId, leadId);
      
      let readinessData: any = {};
      try {
        readinessData = await checkGreetingReadinessCore(ctx.db, ctx.tenantId, ctx.userId, leadId);
      } catch (e) {
        console.error("resolveFirstContactAction: failed to fetch greeting readiness:", e);
      }

      const combined = {
        ...resolution,
        ...readinessData
      };

      return { success: true, resolution: combined };
    }
  ).then(res => {
    if (res.success && res.data) {
      return { success: true, resolution: res.data.resolution };
    }
    return { success: false, error: res.error };
  });
}
