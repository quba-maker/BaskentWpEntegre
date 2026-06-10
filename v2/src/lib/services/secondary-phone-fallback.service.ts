/**
 * PHASE A1.7b: Secondary Phone Fallback Service
 * 
 * Manages secondary phone fallback when primary phone has no response.
 * 
 * KEY RULES:
 * - NO automatic outbound to secondary number
 * - NO simultaneous messages to both numbers
 * - Cross-phone opt-out: primary opt-out blocks secondary
 * - Reuse existing conversation for secondary number (no new conversation creation)
 * - Coordinator must explicitly approve every draft
 * - All actions logged to outreach_logs
 * 
 * ARCHITECTURE:
 * - checkEligibility(): Determines if secondary fallback is available
 * - prepareDraft(): Creates coordinator-reviewable draft
 * - sendApproved(): Sends after explicit coordinator approval
 */

import type { TenantDB } from '@/lib/core/tenant-db';
import { normalizePhoneForIdentity, parseAllPhones } from '@/lib/utils/phone-identity';
import { ExpectsReplyClassifier } from '@/lib/services/classification/expects-reply-classifier';
import { resolveTenantDisplayName } from '@/lib/services/meta/tenant-display-name-resolver';

// ═══════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════

export interface SecondaryFallbackEligibility {
  eligible: boolean;
  reason: string;
  primaryPhone: string;
  secondaryPhone: string | null;
  primaryConversationId: string;
  secondaryConversationId: string | null; // existing conv for secondary number
  noReplyHoursPrimary: number;
  windowOpenSecondary: boolean; // 24h window on secondary
  requiresTemplate: boolean;
  patientName: string;
  opportunityId: string | null;
  leadId: string | null;
}

export interface SecondaryDraftResult {
  success: boolean;
  error?: string;
  draft?: string;
  draftType?: 'freeform' | 'template_required';
  windowOpen?: boolean;
  secondaryPhone?: string;
  secondaryConversationId?: string | null;
  patientName?: string;
}

// Terminal stages that block follow-up
const TERMINAL_STAGES = new Set(['lost', 'not_qualified', 'arrived']);

// Opt-out keywords
const OPT_OUT_KEYWORDS = [
  "dur", "stop", "istemiyorum", "rahatsız etmeyin", "mesaj atmayın",
  "bırakın", "silin", "arama", "yazma", "unsubscribe", "don't write"
];

// ═══════════════════════════════════════════════════════════
// SERVICE
// ═══════════════════════════════════════════════════════════

export class SecondaryPhoneFallbackService {
  private db: TenantDB;
  private tenantId: string;

  constructor(db: TenantDB, tenantId: string) {
    this.db = db;
    this.tenantId = tenantId;
  }

  /**
   * Check if secondary fallback is eligible for a conversation.
   * 
   * Eligibility criteria:
   * 1. Conversation has a lead with _all_phones containing ≥2 phones
   * 2. Primary phone has no reply (last outbound expects reply, no subsequent inbound)
   * 3. No opt-out on primary or any family phone
   * 4. Not in terminal stage
   * 5. Primary no-reply duration ≥ 24h (safety margin)
   */
  async checkEligibility(conversationId: string): Promise<SecondaryFallbackEligibility> {
    const defaultResult: SecondaryFallbackEligibility = {
      eligible: false,
      reason: '',
      primaryPhone: '',
      secondaryPhone: null,
      primaryConversationId: conversationId,
      secondaryConversationId: null,
      noReplyHoursPrimary: 0,
      windowOpenSecondary: false,
      requiresTemplate: true,
      patientName: '',
      opportunityId: null,
      leadId: null,
    };

    // 1. Fetch conversation with lead data and opportunity
    const convRows = await this.db.executeSafe({
      text: `
        SELECT c.id, c.phone_number, c.patient_name, c.customer_id,
               c.active_opportunity_id, c.lead_stage,
               active_opp.stage as opp_stage, 
               active_opp.metadata as opp_metadata,
               active_opp.automation_status as opp_automation_status,
               l.id as lead_id, l.raw_data as form_raw_data, l.phone_number as lead_phone
        FROM conversations c
        LEFT JOIN opportunities active_opp 
          ON active_opp.id = c.active_opportunity_id 
          AND active_opp.tenant_id = c.tenant_id
        LEFT JOIN LATERAL (
          SELECT id, raw_data, phone_number
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
    const primaryPhone = conv.phone_number;
    defaultResult.primaryPhone = primaryPhone;
    defaultResult.patientName = conv.patient_name || 'İsimsiz';
    defaultResult.opportunityId = conv.active_opportunity_id || null;
    defaultResult.leadId = conv.lead_id || null;

    // 2. Check terminal stage
    const currentStage = conv.opp_stage || conv.lead_stage || '';
    if (TERMINAL_STAGES.has(currentStage)) {
      return { ...defaultResult, reason: `Terminal aşamada (${currentStage}). Fallback yapılamaz.` };
    }

    // 3. Check automation status
    if (conv.opp_automation_status === 'stopped' || conv.opp_automation_status === 'paused') {
      return { ...defaultResult, reason: 'Otomasyon durdurulmuş. Fallback yapılamaz.' };
    }

    // 4. Extract all phones from lead raw_data
    let parsedRaw = conv.form_raw_data;
    if (typeof parsedRaw === 'string') {
      try { parsedRaw = JSON.parse(parsedRaw); } catch (_) {}
    }

    const allPhones = parsedRaw?._all_phones ? parseAllPhones(parsedRaw._all_phones) : [];
    if (allPhones.length < 2) {
      return { ...defaultResult, reason: 'İkincil telefon numarası bulunamadı.' };
    }

    // Determine secondary phone (first phone that is NOT the primary)
    const primaryNorm = normalizePhoneForIdentity(primaryPhone);
    let secondaryPhone: string | null = null;

    for (const phone of allPhones) {
      const norm = normalizePhoneForIdentity(phone);
      // Skip if same as primary (compare by e164 or last 10 digits)
      if (norm.e164 && primaryNorm.e164 && norm.e164 === primaryNorm.e164) continue;
      if (norm.digits.slice(-10) === primaryNorm.digits.slice(-10)) continue;
      secondaryPhone = phone;
      break;
    }

    if (!secondaryPhone) {
      return { ...defaultResult, reason: 'İkincil telefon birincil ile aynı. Fallback yapılamaz.' };
    }

    defaultResult.secondaryPhone = secondaryPhone;

    // 5. Cross-phone opt-out check
    const isOptedOut = await this.checkCrossPhoneOptOut(primaryPhone, allPhones, conv.opp_metadata);
    if (isOptedOut) {
      return { ...defaultResult, reason: 'Hasta veya aile numarası opt-out talep etmiş. Fallback yapılamaz.' };
    }

    // 6. Check primary no-reply status
    const lastOutboundRow = await this.db.executeSafe({
      text: `
        SELECT id, content, created_at, direction
        FROM messages
        WHERE conversation_id = $1 AND tenant_id = $2
          AND direction != 'system'
          AND (media_metadata IS NULL OR COALESCE(media_metadata->'native'->>'message_type', '') != 'reaction')
        ORDER BY created_at DESC
        LIMIT 1
      `,
      values: [conversationId, this.tenantId]
    });

    const lastMsgs = Array.isArray(lastOutboundRow) ? lastOutboundRow : ((lastOutboundRow as any)?.rows || []);
    if (lastMsgs.length === 0) {
      return { ...defaultResult, reason: 'Konuşmada mesaj bulunamadı.' };
    }

    const lastMsg = lastMsgs[0];
    if (lastMsg.direction !== 'out') {
      return { ...defaultResult, reason: 'Son mesaj hastadan gelmiş. Fallback gerekmez.' };
    }

    // Check if last outbound expects reply
    const classification = ExpectsReplyClassifier.classify(lastMsg.content);
    if (!classification.expectsReply) {
      return { ...defaultResult, reason: 'Son outbound mesaj cevap beklemiyor. Fallback gerekmez.' };
    }

    // Calculate no-reply hours
    const lastOutboundTime = new Date(lastMsg.created_at).getTime();
    const noReplyHours = (Date.now() - lastOutboundTime) / (1000 * 60 * 60);
    defaultResult.noReplyHoursPrimary = Math.round(noReplyHours * 10) / 10;

    // Minimum 24h before secondary fallback is eligible
    if (noReplyHours < 24) {
      return { ...defaultResult, reason: `Birincil numaradan henüz ${Math.round(noReplyHours)} saat oldu. 24 saat beklenmeli.` };
    }

    // 7. Check if secondary phone already has a conversation
    const secondaryNorm = normalizePhoneForIdentity(secondaryPhone);
    const secConvRows = await this.db.executeSafe({
      text: `
        SELECT id FROM conversations 
        WHERE tenant_id = $1 AND phone_number = $2
        LIMIT 1
      `,
      values: [this.tenantId, secondaryPhone]
    });

    const secConvs = Array.isArray(secConvRows) ? secConvRows : ((secConvRows as any)?.rows || []);
    if (secConvs.length > 0) {
      defaultResult.secondaryConversationId = secConvs[0].id;
    }

    // 8. Check 24h window on secondary (if conversation exists)
    let windowOpen = false;
    if (defaultResult.secondaryConversationId) {
      const secInboundRows = await this.db.executeSafe({
        text: `
          SELECT created_at
          FROM messages
          WHERE conversation_id = $1 AND tenant_id = $2 AND direction = 'in'
            AND (media_metadata IS NULL OR COALESCE(media_metadata->'native'->>'message_type', '') != 'reaction')
          ORDER BY created_at DESC
          LIMIT 1
        `,
        values: [defaultResult.secondaryConversationId, this.tenantId]
      });
      const secInbounds = Array.isArray(secInboundRows) ? secInboundRows : ((secInboundRows as any)?.rows || []);
      if (secInbounds.length > 0) {
        const lastInboundTime = new Date(secInbounds[0].created_at).getTime();
        windowOpen = (Date.now() - lastInboundTime) <= 24 * 60 * 60 * 1000;
      }
    }

    defaultResult.windowOpenSecondary = windowOpen;
    defaultResult.requiresTemplate = !windowOpen;

    // 9. Check if secondary fallback was already sent in last 48h
    const recentSecondaryLog = await this.db.executeSafe({
      text: `
        SELECT 1 FROM outreach_logs 
        WHERE tenant_id = $1 
          AND (action = 'secondary_fallback_sent' OR action = 'secondary_fallback_draft_prepared')
          AND conversation_id = $2
          AND created_at > NOW() - INTERVAL '48 hour'
        LIMIT 1
      `,
      values: [this.tenantId, conversationId]
    });
    const recentLogs = Array.isArray(recentSecondaryLog) ? recentSecondaryLog : ((recentSecondaryLog as any)?.rows || []);
    if (recentLogs.length > 0) {
      return { ...defaultResult, reason: 'Son 48 saat içinde zaten ikincil numara taslağı hazırlanmış.' };
    }

    return {
      ...defaultResult,
      eligible: true,
      reason: 'İkincil numara fallback uygun.',
    };
  }

  /**
   * Prepare a coordinator-reviewable draft for secondary phone contact.
   */
  async prepareDraft(conversationId: string, actorId?: string): Promise<SecondaryDraftResult> {
    const eligibility = await this.checkEligibility(conversationId);

    if (!eligibility.eligible) {
      return { success: false, error: eligibility.reason };
    }

    const draftType: 'freeform' | 'template_required' = eligibility.windowOpenSecondary ? 'freeform' : 'template_required';
    
    let draftText: string;
    if (eligibility.windowOpenSecondary) {
      const { sanitizePatientFacingMessage } = await import('@/lib/utils/patient-message-sanitizer');
      const tenantDisplayName = await resolveTenantDisplayName(this.db, this.tenantId);
      let greetingText = '';
      if (tenantDisplayName) {
        greetingText = `${tenantDisplayName} tarafından sizinle iletişime geçiyoruz.`;
      } else {
        greetingText = `Başvurunuzla ilgili sizinle iletişime geçiyoruz.`;
      }
      draftText = sanitizePatientFacingMessage(`Merhaba, ${greetingText} Diğer numaranızdan yanıt alamadık. Müsait olduğunuzda bize dönüş yapabilirseniz çok seviniriz. İyi günler dileriz.`);
    } else {
      draftText = '24 saatlik WhatsApp penceresi kapalı. Onaylı şablon (template) gereklidir. Şablon konfigürasyonu yapılmadan gönderim devre dışıdır.';
    }

    // Log draft preparation
    await this.db.executeSafe({
      text: `
        INSERT INTO outreach_logs (tenant_id, lead_id, conversation_id, opportunity_id, action, channel, actor_id, metadata)
        VALUES ($1, $2, $3, $4, 'secondary_fallback_draft_prepared', 'whatsapp', $5, $6)
      `,
      values: [
        this.tenantId,
        eligibility.leadId || null,
        conversationId,
        eligibility.opportunityId || null,
        actorId || 'system',
        JSON.stringify({
          primary_phone: eligibility.primaryPhone,
          secondary_phone: eligibility.secondaryPhone,
          secondary_conversation_id: eligibility.secondaryConversationId,
          no_reply_hours_primary: eligibility.noReplyHoursPrimary,
          window_open_secondary: eligibility.windowOpenSecondary,
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
      windowOpen: eligibility.windowOpenSecondary,
      secondaryPhone: eligibility.secondaryPhone!,
      secondaryConversationId: eligibility.secondaryConversationId,
      patientName: eligibility.patientName,
    };
  }

  // ═══════════════════════════════════════════════════════════
  // PRIVATE HELPERS
  // ═══════════════════════════════════════════════════════════

  /**
   * Cross-phone opt-out check.
   * If ANY phone in the family has opt-out, block ALL phones.
   */
  private async checkCrossPhoneOptOut(
    primaryPhone: string,
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

    // Check if any family phone is in opt-out set
    for (const phone of allPhones) {
      const norm = normalizePhoneForIdentity(phone).e164;
      if (norm && optOutE164Set.has(norm)) return true;
    }

    // 3. Check last inbound from any family phone for opt-out keywords
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
