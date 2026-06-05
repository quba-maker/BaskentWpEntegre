/**
 * PHASE A1.7c: Form Greeting Handoff Service
 * 
 * Manages greeting handoff for form-submitted leads who never messaged via WhatsApp.
 * 
 * KEY RULES:
 * - NO automatic outbound to patient
 * - Template config must exist — no hello_world to live patients
 * - 24h window check: freeform only if inbound within 24h, otherwise template required
 * - hasPatientMessagedBefore: cross-phone check to avoid duplicate greetings
 * - Coordinator must explicitly approve every draft
 * - All actions logged to outreach_logs
 * - No new opportunity creation — link to existing
 * - No duplicate tasks
 * 
 * ARCHITECTURE:
 * - checkEligibility(): Determines if form greeting is available
 * - prepareDraft(): Creates coordinator-reviewable draft with template resolver
 */

import type { TenantDB } from '@/lib/core/tenant-db';
import { normalizePhoneForIdentity, parseAllPhones } from '@/lib/utils/phone-identity';

// ═══════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════

export interface FormGreetingEligibility {
  eligible: boolean;
  reason: string;
  conversationId: string;
  phone: string;
  patientName: string;
  formName: string | null;
  leadId: string | null;
  opportunityId: string | null;
  hasPatientMessagedBefore: boolean;
  messageCount: number;
  windowOpen: boolean;
  requiresTemplate: boolean;
  leadCreatedAt: string | null;
  templateConfigExists: boolean;
}

export interface FormGreetingDraftResult {
  success: boolean;
  error?: string;
  draft?: string;
  draftType?: 'freeform' | 'template_required';
  windowOpen?: boolean;
  patientName?: string;
  phone?: string;
  templateConfigExists?: boolean;
}

// Terminal stages
const TERMINAL_STAGES = new Set(['lost', 'not_qualified', 'arrived']);

// Opt-out keywords
const OPT_OUT_KEYWORDS = [
  "dur", "stop", "istemiyorum", "rahatsız etmeyin", "mesaj atmayın",
  "bırakın", "silin", "arama", "yazma", "unsubscribe", "don't write"
];

// ═══════════════════════════════════════════════════════════
// SERVICE
// ═══════════════════════════════════════════════════════════

export class FormGreetingHandoffService {
  private db: TenantDB;
  private tenantId: string;

  constructor(db: TenantDB, tenantId: string) {
    this.db = db;
    this.tenantId = tenantId;
  }

  /**
   * Check if form greeting handoff is eligible for a conversation.
   * 
   * Eligibility criteria:
   * 1. Conversation has an associated lead (form submission exists)
   * 2. Lead was created within last 72 hours
   * 3. Zero WhatsApp inbound messages from patient (on ANY known phone)
   * 4. Phone number is valid
   * 5. Not in terminal stage
   * 6. No opt-out on any family phone
   * 7. No previous greeting sent (via outreach_logs)
   */
  async checkEligibility(conversationId: string): Promise<FormGreetingEligibility> {
    const defaultResult: FormGreetingEligibility = {
      eligible: false,
      reason: '',
      conversationId,
      phone: '',
      patientName: '',
      formName: null,
      leadId: null,
      opportunityId: null,
      hasPatientMessagedBefore: false,
      messageCount: 0,
      windowOpen: false,
      requiresTemplate: true,
      leadCreatedAt: null,
      templateConfigExists: false,
    };

    // 1. Fetch conversation with lead and opportunity data
    const convRows = await this.db.executeSafe({
      text: `
        SELECT c.id, c.phone_number, c.patient_name, c.customer_id,
               c.active_opportunity_id, c.lead_stage,
               active_opp.stage as opp_stage, 
               active_opp.metadata as opp_metadata,
               active_opp.automation_status as opp_automation_status,
               l.id as lead_id, l.form_name, l.raw_data as form_raw_data,
               l.patient_name as lead_patient_name, l.created_at as lead_created_at
        FROM conversations c
        LEFT JOIN opportunities active_opp 
          ON active_opp.id = c.active_opportunity_id 
          AND active_opp.tenant_id = c.tenant_id
        LEFT JOIN LATERAL (
          SELECT id, form_name, raw_data, patient_name, created_at
          FROM leads 
          WHERE leads.tenant_id = c.tenant_id
            AND (
              (c.customer_id IS NOT NULL AND leads.customer_id = c.customer_id)
              OR leads.phone_number = c.phone_number
            )
          ORDER BY created_at DESC 
          LIMIT 1
        ) l ON true
        WHERE c.id = $1 AND c.tenant_id = $2
        LIMIT 1
      `,
      values: [conversationId, this.tenantId]
    });

    const convs = Array.isArray(convRows) ? convRows : ((convRows as any)?.rows || []);
    if (convs.length === 0) {
      return { ...defaultResult, reason: 'Konuşma bulunamadı.' };
    }

    const conv = convs[0];
    const phone = conv.phone_number;
    defaultResult.phone = phone;
    defaultResult.patientName = conv.patient_name || conv.lead_patient_name || 'İsimsiz';
    defaultResult.opportunityId = conv.active_opportunity_id || null;
    defaultResult.leadId = conv.lead_id || null;
    defaultResult.formName = conv.form_name || null;
    defaultResult.leadCreatedAt = conv.lead_created_at ? new Date(conv.lead_created_at).toISOString() : null;

    // 2. Check lead exists
    if (!conv.lead_id) {
      return { ...defaultResult, reason: 'Bu konuşmaya bağlı bir form kaydı bulunamadı.' };
    }

    // 3. Check lead age (must be within 72 hours)
    if (conv.lead_created_at) {
      const leadAge = Date.now() - new Date(conv.lead_created_at).getTime();
      const leadAgeHours = leadAge / (1000 * 60 * 60);
      if (leadAgeHours > 72) {
        return { ...defaultResult, reason: `Form kaydı ${Math.round(leadAgeHours)} saat önce oluşturulmuş. 72 saat sınırını aşıyor.` };
      }
    }

    // 4. Check terminal stage
    const currentStage = conv.opp_stage || conv.lead_stage || '';
    if (TERMINAL_STAGES.has(currentStage)) {
      return { ...defaultResult, reason: `Terminal aşamada (${currentStage}). Karşılama yapılamaz.` };
    }

    // 5. Check automation status
    if (conv.opp_automation_status === 'stopped' || conv.opp_automation_status === 'paused') {
      return { ...defaultResult, reason: 'Otomasyon durdurulmuş. Karşılama yapılamaz.' };
    }

    // 6. Collect all phones from lead
    let parsedRaw = conv.form_raw_data;
    if (typeof parsedRaw === 'string') {
      try { parsedRaw = JSON.parse(parsedRaw); } catch (_) {}
    }
    const allPhones = parsedRaw?._all_phones ? parseAllPhones(parsedRaw._all_phones) : [phone];

    // 7. Cross-phone opt-out check
    const isOptedOut = await this.checkCrossPhoneOptOut(allPhones, conv.opp_metadata);
    if (isOptedOut) {
      return { ...defaultResult, reason: 'Hasta veya aile numarası opt-out talep etmiş. Karşılama yapılamaz.' };
    }

    // 8. Check if patient has EVER sent an inbound message on ANY known phone
    const hasPatientMessaged = await this.hasPatientMessagedBefore(allPhones);
    defaultResult.hasPatientMessagedBefore = hasPatientMessaged;

    if (hasPatientMessaged) {
      return { ...defaultResult, reason: 'Hasta daha önce WhatsApp üzerinden mesaj göndermiş. Form karşılama gerekmez.' };
    }

    // 9. Check total message count on this conversation
    const msgCountRows = await this.db.executeSafe({
      text: `
        SELECT COUNT(*)::int as cnt FROM messages 
        WHERE conversation_id = $1 AND tenant_id = $2
          AND direction != 'system'
          AND (media_metadata IS NULL OR COALESCE(media_metadata->'native'->>'message_type', '') != 'reaction')
      `,
      values: [conversationId, this.tenantId]
    });
    const msgCountArr = Array.isArray(msgCountRows) ? msgCountRows : ((msgCountRows as any)?.rows || []);
    const messageCount = msgCountArr[0]?.cnt || 0;
    defaultResult.messageCount = messageCount;

    // If there are already outbound messages, this isn't a pure "never contacted" case
    // but we still allow form greeting if patient never replied
    // (coordinator may have sent but patient never responded)

    // 10. Check 24h window (based on last inbound from patient)
    const lastInboundRows = await this.db.executeSafe({
      text: `
        SELECT created_at FROM messages 
        WHERE conversation_id = $1 AND tenant_id = $2 AND direction = 'in'
          AND (media_metadata IS NULL OR COALESCE(media_metadata->'native'->>'message_type', '') != 'reaction')
        ORDER BY created_at DESC LIMIT 1
      `,
      values: [conversationId, this.tenantId]
    });
    const lastInbounds = Array.isArray(lastInboundRows) ? lastInboundRows : ((lastInboundRows as any)?.rows || []);
    
    let windowOpen = false;
    if (lastInbounds.length > 0) {
      const lastInboundTime = new Date(lastInbounds[0].created_at).getTime();
      windowOpen = (Date.now() - lastInboundTime) <= 24 * 60 * 60 * 1000;
    }
    // No inbound at all -> window closed, template required
    defaultResult.windowOpen = windowOpen;
    defaultResult.requiresTemplate = !windowOpen;

    // 11. Check if greeting was already sent
    const existingGreetingLog = await this.db.executeSafe({
      text: `
        SELECT 1 FROM outreach_logs 
        WHERE tenant_id = $1 
          AND conversation_id = $2
          AND (action = 'form_greeting_sent' OR action = 'form_greeting_draft_prepared')
          AND created_at > NOW() - INTERVAL '72 hour'
        LIMIT 1
      `,
      values: [this.tenantId, conversationId]
    });
    const existingLogs = Array.isArray(existingGreetingLog) ? existingGreetingLog : ((existingGreetingLog as any)?.rows || []);
    if (existingLogs.length > 0) {
      return { ...defaultResult, reason: 'Son 72 saat içinde zaten form karşılama taslağı hazırlanmış.' };
    }

    // 12. Check template config existence
    const templateConfigRows = await this.db.executeSafe({
      text: `
        SELECT 1 FROM greeting_templates 
        WHERE tenant_id = $1 
          AND is_active = true
        LIMIT 1
      `,
      values: [this.tenantId]
    });
    const templateConfigs = Array.isArray(templateConfigRows) ? templateConfigRows : ((templateConfigRows as any)?.rows || []);
    defaultResult.templateConfigExists = templateConfigs.length > 0;

    return {
      ...defaultResult,
      eligible: true,
      reason: 'Form karşılama uygun.',
    };
  }

  /**
   * Prepare a coordinator-reviewable greeting draft.
   */
  async prepareDraft(conversationId: string): Promise<FormGreetingDraftResult> {
    const eligibility = await this.checkEligibility(conversationId);

    if (!eligibility.eligible) {
      return { success: false, error: eligibility.reason };
    }

    const draftType: 'freeform' | 'template_required' = eligibility.requiresTemplate ? 'template_required' : 'freeform';
    
    let draftText: string;
    if (!eligibility.requiresTemplate) {
      // 24h window open — freeform allowed
      const patientName = eligibility.patientName || 'Hasta';
      draftText = `Merhaba ${patientName}, Başkent Hastanesi'nden iletişime geçiyoruz. Formunuzu aldık ve size yardımcı olmak istiyoruz. Randevu ve tedavi sürecinizle ilgili bilgi almak isterseniz bize yazabilirsiniz.`;
    } else {
      // Template required
      if (!eligibility.templateConfigExists) {
        draftText = '⚠️ 24 saatlik WhatsApp penceresi kapalı ve onaylı şablon (template) konfigürasyonu bulunamadı. Lütfen 360dialog template ayarlarını yapın.';
      } else {
        draftText = '24 saatlik WhatsApp penceresi kapalı. Onaylı şablon ile gönderim yapılabilir. Şablon önizlemesi için template seçin.';
      }
    }

    // Log draft preparation
    await this.db.executeSafe({
      text: `
        INSERT INTO outreach_logs (tenant_id, lead_id, conversation_id, opportunity_id, action, channel, metadata)
        VALUES ($1, $2, $3, $4, 'form_greeting_draft_prepared', 'whatsapp', $5)
      `,
      values: [
        this.tenantId,
        eligibility.leadId || null,
        conversationId,
        eligibility.opportunityId || null,
        JSON.stringify({
          phone: eligibility.phone,
          patient_name: eligibility.patientName,
          form_name: eligibility.formName,
          lead_created_at: eligibility.leadCreatedAt,
          message_count: eligibility.messageCount,
          window_open: eligibility.windowOpen,
          requires_template: eligibility.requiresTemplate,
          template_config_exists: eligibility.templateConfigExists,
          draft_type: draftType,
          draft_message: draftText,
          sent: false,
        })
      ]
    });

    return {
      success: true,
      draft: draftText,
      draftType,
      windowOpen: eligibility.windowOpen,
      patientName: eligibility.patientName,
      phone: eligibility.phone,
      templateConfigExists: eligibility.templateConfigExists,
    };
  }

  // ═══════════════════════════════════════════════════════════
  // PRIVATE HELPERS
  // ═══════════════════════════════════════════════════════════

  /**
   * Check if patient has ever sent an inbound message on any known phone.
   */
  private async hasPatientMessagedBefore(allPhones: string[]): Promise<boolean> {
    for (const phone of allPhones) {
      const result = await this.db.executeSafe({
        text: `
          SELECT 1 FROM messages 
          WHERE tenant_id = $1 AND phone_number = $2 AND direction = 'in'
            AND (media_metadata IS NULL OR COALESCE(media_metadata->'native'->>'message_type', '') != 'reaction')
          LIMIT 1
        `,
        values: [this.tenantId, phone]
      });
      const rows = Array.isArray(result) ? result : ((result as any)?.rows || []);
      if (rows.length > 0) return true;
    }
    return false;
  }

  /**
   * Cross-phone opt-out check.
   */
  private async checkCrossPhoneOptOut(
    allPhones: string[],
    oppMetadata: any
  ): Promise<boolean> {
    // 1. Check opp metadata
    if (oppMetadata?.opt_out_requested === true || oppMetadata?.opt_out_requested === 'true') {
      return true;
    }

    // 2. Check all opportunities with opt-out for any family phone
    const optOutOpps = await this.db.executeSafe({
      text: `
        SELECT phone_number 
        FROM opportunities 
        WHERE tenant_id = $1 
          AND (COALESCE(metadata->>'opt_out_requested', 'false') = 'true')
      `,
      values: [this.tenantId]
    });

    const optOutOppRows = Array.isArray(optOutOpps) ? optOutOpps : ((optOutOpps as any)?.rows || []);
    const optOutE164Set = new Set<string>();
    for (const o of optOutOppRows) {
      const norm = normalizePhoneForIdentity(o.phone_number).e164;
      if (norm) optOutE164Set.add(norm);
    }

    for (const phone of allPhones) {
      const norm = normalizePhoneForIdentity(phone).e164;
      if (norm && optOutE164Set.has(norm)) return true;
    }

    // 3. Check last inbound for opt-out keywords
    for (const phone of allPhones) {
      const lastInbound = await this.db.executeSafe({
        text: `
          SELECT content FROM messages 
          WHERE tenant_id = $1 AND phone_number = $2 AND direction = 'in'
            AND (media_metadata IS NULL OR COALESCE(media_metadata->'native'->>'message_type', '') != 'reaction')
          ORDER BY created_at DESC LIMIT 1
        `,
        values: [this.tenantId, phone]
      });
      const rows = Array.isArray(lastInbound) ? lastInbound : ((lastInbound as any)?.rows || []);
      if (rows.length > 0) {
        const content = (rows[0].content || '').toLowerCase().trim();
        if (OPT_OUT_KEYWORDS.some(kw => content.includes(kw))) {
          return true;
        }
      }
    }

    return false;
  }
}
