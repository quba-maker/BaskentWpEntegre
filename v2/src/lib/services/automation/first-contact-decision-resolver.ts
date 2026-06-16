import { TenantDB } from "@/lib/core/tenant-db";
import { resolveFormAutopilotEligibility } from "../forms/form-autopilot-eligibility-resolver";
import { resolveWhatsApp24hWindow } from "../whatsapp-window-resolver";
import { resolveLeadLanguage } from "../forms/form-autopilot-language-resolver";

export type GreetingAutomationDecision = {
  source: 'form' | 'inbox';
  category:
    | 'bot_auto_eligible'
    | 'manual_draft_required'
    | 'manual_template_required'
    | 'inbox_bot_control'
    | 'already_open_inbox'
    | 'already_processed'
    | 'not_eligible'
    | 'error';
  metaWindow:
    | 'open'
    | 'closed'
    | 'no_inbound'
    | 'no_conversation'
    | 'unknown';
  technicalEligible: boolean;
  finalActionAllowed: boolean;
  recommendedAction:
    | 'bot_can_reply'
    | 'enable_bot'
    | 'disable_bot'
    | 'prepare_manual_draft'
    | 'select_template'
    | 'wait_for_inbound'
    | 'go_to_inbox'
    | 'no_action';
  reason: string;
  userFriendlyReason: string;
  language?: 'tr' | 'en' | 'ru' | 'ar' | 'de' | 'fr' | 'nl' | 'unknown';
  languageConfidence?: 'high' | 'medium' | 'low';
  tenantId?: string;
  channelId?: string;
  leadId?: string;
  conversationId?: string;
};

export const REASON_MAPPING: Record<string, string> = {
  feature_flag_disabled: 'Otomatik karşılama ayarı kapalı.',
  dry_run_only: 'Dry-run açık, canlı gönderim kapalı.',
  global_disabled: 'Sistem genel güvenlik kilidi açık.',
  phase_lock_enabled: 'Canlı gönderim güvenlik kilidi açık.',
  meta_window_closed: '24 saat penceresi kapalı.',
  form_only_no_inbound: 'Hasta henüz WhatsApp’tan yazmadı.',
  no_conversation: 'WhatsApp konuşması bulunamadı.',
  tenant_mismatch: 'Güvenli tenant eşleşmesi sağlanamadı.',
  channel_mismatch: 'Kanal eşleşmesi güvenli değil.',
  template_required: 'Manuel şablon/taslak gerekir.',
  already_processed: 'Bu kayıt daha önce işlenmiş.',
  status_human: 'İnsan temsilci devralmış.',
  bot_disabled: 'Bot kapalı.',
  autopilot_disabled: 'Otomatik cevap kapalı.',
  internal_error: 'Durum hesaplanamadı. Veri eksik veya bağlantı doğrulanamadı.',
  
  // Additional internal maps
  tenant_not_allowlisted: 'Bu kurum için autopilot yetkilendirmesi bulunmuyor.',
  conversation_not_found: 'WhatsApp konuşması bulunamadı.',
  lead_not_found: 'Hasta form kaydı bulunamadı.',
  tenant_not_found: 'Güvenli tenant eşleşmesi sağlanamadı.',
  not_whatsapp_channel: 'Kanal WhatsApp olmadığı için autopilot devre dışı.',
  form_only_outbound: 'Hasta henüz WhatsApp’tan yazmadı.'
};

export function mapUserFriendlyReason(reason: string): string {
  return REASON_MAPPING[reason] || reason || 'Durum hesaplanamadı.';
}

export class FirstContactDecisionResolver {
  public static async resolveForFormLead(
    tenantId: string,
    leadId: string,
    db: TenantDB
  ): Promise<GreetingAutomationDecision> {
    try {
      // 1. Find conversation associated with lead phone number
      const leadRow = await db.executeSafe({
        text: `SELECT phone_number, raw_data, form_name FROM leads WHERE id = $1 AND tenant_id = $2 LIMIT 1`,
        values: [leadId, tenantId]
      }) as any[];

      if (leadRow.length === 0) {
        return {
          source: 'form',
          category: 'error',
          metaWindow: 'unknown',
          technicalEligible: false,
          finalActionAllowed: false,
          recommendedAction: 'no_action',
          reason: 'lead_not_found',
          userFriendlyReason: mapUserFriendlyReason('lead_not_found'),
          tenantId,
          leadId
        };
      }

      const lead = leadRow[0];
      const phone = lead.phone_number;

      const suffix = phone.slice(-10);
      const convRow = await db.executeSafe({
        text: `SELECT id, status, autopilot_enabled, channel FROM conversations WHERE tenant_id = $1 AND RIGHT(phone_number, 10) = $2 LIMIT 1`,
        values: [tenantId, suffix]
      }) as any[];

      if (convRow.length === 0) {
        // Form-only, no conversation at all
        const langDec = resolveLeadLanguage(lead.raw_data, lead.form_name, phone, 'tr');
        return {
          source: 'form',
          category: 'manual_draft_required',
          metaWindow: 'no_conversation',
          technicalEligible: false,
          finalActionAllowed: false,
          recommendedAction: 'prepare_manual_draft',
          reason: 'no_conversation',
          userFriendlyReason: mapUserFriendlyReason('no_conversation'),
          language: langDec.language,
          languageConfidence: langDec.confidence,
          tenantId,
          leadId
        };
      }

      const conv = convRow[0];
      const conversationId = conv.id;

      // 2. Call resolveFormAutopilotEligibility
      const eligibility = await resolveFormAutopilotEligibility(tenantId, leadId, conversationId, db);
      const langDec = resolveLeadLanguage(lead.raw_data, lead.form_name, phone, 'tr');

      const decisionBase = {
        source: 'form' as const,
        tenantId,
        conversationId,
        leadId,
        language: langDec.language,
        languageConfidence: langDec.confidence,
        channelId: eligibility.channelId || 'whatsapp'
      };

      // 3. Map to category based on eligibility reasons
      if (eligibility.reason === 'already_processed') {
        return {
          ...decisionBase,
          category: 'already_processed',
          metaWindow: 'open',
          technicalEligible: false,
          finalActionAllowed: false,
          recommendedAction: 'go_to_inbox',
          reason: 'already_processed',
          userFriendlyReason: mapUserFriendlyReason('already_processed')
        };
      }

      if (conv.status === 'human') {
        return {
          ...decisionBase,
          category: 'already_open_inbox',
          metaWindow: 'open',
          technicalEligible: false,
          finalActionAllowed: false,
          recommendedAction: 'go_to_inbox',
          reason: 'status_human',
          userFriendlyReason: mapUserFriendlyReason('status_human')
        };
      }

      // Check Meta 24h window
      const windowCheck = await resolveWhatsApp24hWindow(conversationId, tenantId, db);
      const metaWindow = windowCheck.status === 'OPEN' || windowCheck.status === 'CLOSING_SOON' ? 'open' as const : 
                         (windowCheck.status === 'UNKNOWN' ? 'no_inbound' as const : 'closed' as const);

      if (metaWindow === 'closed') {
        return {
          ...decisionBase,
          category: 'manual_template_required',
          metaWindow: 'closed',
          technicalEligible: false,
          finalActionAllowed: false,
          recommendedAction: 'select_template',
          reason: 'meta_window_closed',
          userFriendlyReason: mapUserFriendlyReason('meta_window_closed')
        };
      }

      if (metaWindow === 'no_inbound') {
        return {
          ...decisionBase,
          category: 'manual_draft_required',
          metaWindow: 'no_inbound',
          technicalEligible: false,
          finalActionAllowed: false,
          recommendedAction: 'prepare_manual_draft',
          reason: 'form_only_no_inbound',
          userFriendlyReason: mapUserFriendlyReason('form_only_no_inbound')
        };
      }

      // 4. If window is open, is it fully eligible or blocked by gates?
      if (eligibility.eligible) {
        return {
          ...decisionBase,
          category: 'bot_auto_eligible',
          metaWindow: 'open',
          technicalEligible: true,
          finalActionAllowed: true,
          recommendedAction: 'bot_can_reply',
          reason: 'eligible',
          userFriendlyReason: 'Bot otomatik karşılamaya uygun. Meta 24 saat penceresi açık. Hasta WhatsApp üzerinden yazmış.'
        };
      } else {
        // Technically baseEligible is true (window open, status not human, etc.) but gate is closed
        const isFFDisabled = !eligibility.featureFlagEnabled;
        const isGlobalDisabled = eligibility.globalDisabled;
        const isPhaseLocked = process.env.FORM_AUTOPILOT_PHASE_LOCK_OUTBOUND_BLOCKED !== 'false';
        
        let reasonStr = eligibility.reason;
        if (isPhaseLocked) reasonStr = 'phase_lock_enabled';
        else if (isGlobalDisabled) reasonStr = 'global_disabled';
        else if (isFFDisabled) reasonStr = 'feature_flag_disabled';

        return {
          ...decisionBase,
          category: 'bot_auto_eligible', // BaseEligible is true
          metaWindow: 'open',
          technicalEligible: eligibility.baseEligible,
          finalActionAllowed: false, // blocked by gates
          recommendedAction: 'bot_can_reply',
          reason: reasonStr,
          userFriendlyReason: mapUserFriendlyReason(reasonStr)
        };
      }
    } catch (err) {
      return {
        source: 'form',
        category: 'error',
        metaWindow: 'unknown',
        technicalEligible: false,
        finalActionAllowed: false,
        recommendedAction: 'no_action',
        reason: 'internal_error',
        userFriendlyReason: mapUserFriendlyReason('internal_error'),
        tenantId,
        leadId
      };
    }
  }
}
