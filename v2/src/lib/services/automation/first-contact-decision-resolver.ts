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

  public static async resolveBulkFormLeadDecisions(
    tenantId: string,
    leads: any[],
    db: TenantDB
  ): Promise<Record<string, GreetingAutomationDecision>> {
    const decisions: Record<string, GreetingAutomationDecision> = {};
    if (!leads || leads.length === 0) return decisions;

    try {
      // 1. Fetch Tenant Slug
      const tenantRows = await db.executeSafe({
        text: `SELECT slug FROM tenants WHERE id = $1 LIMIT 1`,
        values: [tenantId]
      }) as any[];
      const tenantSlug = tenantRows[0]?.slug || '';

      const allowedTenantsList = (process.env.FORM_AUTOPILOT_ALLOWED_TENANTS || '')
        .split(',')
        .map(t => t.trim().toLowerCase())
        .filter(Boolean);
      const isTenantAllowed = allowedTenantsList.includes(tenantSlug.toLowerCase());

      // 2. Fetch Autopilot settings
      const { getAutopilotSettings } = await import("../forms/form-autopilot-eligibility-resolver");
      const settings = await getAutopilotSettings(tenantId, db);

      // 3. Collect conversation IDs for bulk query
      const conversationIds = leads
        .map(l => l.linked_conv_id || l.linked_conversation_id)
        .filter(Boolean);

      // 4. Fetch duplicate logs in bulk
      const dupLogsMap = new Set<string>();
      if (conversationIds.length > 0) {
        const logs = await db.executeSafe({
          text: `
            SELECT conversation_id, result_summary->>'leadId' as lead_id
            FROM ai_audit_logs
            WHERE tenant_id = $1
              AND conversation_id = ANY($2::uuid[])
              AND action IN ('FORM_AUTOPILOT_ELIGIBLE', 'FORM_AUTOPILOT_DRY_RUN', 'FORM_AUTOPILOT_SENT')
          `,
          values: [tenantId, conversationIds]
        }) as any[];
        for (const log of logs) {
          if (log.conversation_id && log.lead_id) {
            dupLogsMap.add(`${log.conversation_id}_${log.lead_id}`);
          }
        }
      }

      const now = new Date();

      // 5. Calculate decision for each lead in memory
      for (const lead of leads) {
        const leadId = String(lead.id);
        const phone = lead.phone_number;
        const rawData = lead.raw_data;
        const formName = lead.form_name;
        const langDec = resolveLeadLanguage(rawData, formName, phone, 'tr');

        const convId = lead.linked_conv_id || lead.linked_conversation_id;
        const convStatus = lead.conversation_status || (lead.isBotActive ? 'bot' : 'human');
        const convAutopilotEnabled = lead.conv_autopilot_enabled !== undefined ? lead.conv_autopilot_enabled : lead.isBotActive;
        const channelId = lead.conv_channel || 'whatsapp';

        const decisionBase = {
          source: 'form' as const,
          tenantId,
          conversationId: convId || undefined,
          leadId,
          language: langDec.language,
          languageConfidence: langDec.confidence,
          channelId: channelId
        };

        if (!convId) {
          decisions[leadId] = {
            ...decisionBase,
            category: 'manual_draft_required',
            metaWindow: 'no_conversation',
            technicalEligible: false,
            finalActionAllowed: false,
            recommendedAction: 'prepare_manual_draft',
            reason: 'no_conversation',
            userFriendlyReason: mapUserFriendlyReason('no_conversation')
          };
          continue;
        }

        // Determine Meta Window status in memory from message_stats
        const stats = lead.message_stats || lead.inbound_stats || {};
        const hasInbound = stats.has_inbound;
        const lastInboundAt = stats.last_inbound_at;

        let metaWindow: 'open' | 'closed' | 'no_inbound' | 'unknown' = 'unknown';
        if (!hasInbound) {
          metaWindow = 'no_inbound';
        } else if (lastInboundAt) {
          const lastInteraction = new Date(lastInboundAt);
          const elapsedMs = now.getTime() - lastInteraction.getTime();
          if (elapsedMs < 24 * 60 * 60 * 1000) {
            metaWindow = 'open';
          } else {
            metaWindow = 'closed';
          }
        }

        if (metaWindow === 'closed') {
          decisions[leadId] = {
            ...decisionBase,
            category: 'manual_template_required',
            metaWindow: 'closed',
            technicalEligible: false,
            finalActionAllowed: false,
            recommendedAction: 'select_template',
            reason: 'meta_window_closed',
            userFriendlyReason: mapUserFriendlyReason('meta_window_closed')
          };
          continue;
        }

        if (metaWindow === 'no_inbound') {
          decisions[leadId] = {
            ...decisionBase,
            category: 'manual_draft_required',
            metaWindow: 'no_inbound',
            technicalEligible: false,
            finalActionAllowed: false,
            recommendedAction: 'prepare_manual_draft',
            reason: 'form_only_no_inbound',
            userFriendlyReason: mapUserFriendlyReason('form_only_no_inbound')
          };
          continue;
        }

        // Window is open, check details
        let baseEligible = true;
        let baseReason = 'eligible';

        if (convStatus === 'human') {
          decisions[leadId] = {
            ...decisionBase,
            category: 'already_open_inbox',
            metaWindow: 'open',
            technicalEligible: false,
            finalActionAllowed: false,
            recommendedAction: 'go_to_inbox',
            reason: 'status_human',
            userFriendlyReason: mapUserFriendlyReason('status_human')
          };
          continue;
        }

        if (convAutopilotEnabled === false) {
          baseEligible = false;
          baseReason = 'autopilot_disabled';
        } else if (channelId !== 'whatsapp') {
          baseEligible = false;
          baseReason = 'not_whatsapp_channel';
        } else if (dupLogsMap.has(`${convId}_${leadId}`)) {
          baseEligible = false;
          baseReason = 'already_processed';
        }

        if (baseReason === 'already_processed') {
          decisions[leadId] = {
            ...decisionBase,
            category: 'already_processed',
            metaWindow: 'open',
            technicalEligible: false,
            finalActionAllowed: false,
            recommendedAction: 'go_to_inbox',
            reason: 'already_processed',
            userFriendlyReason: mapUserFriendlyReason('already_processed')
          };
          continue;
        }

        // Evaluate Gates
        let gateOpen = true;
        let gateReason = 'gate_open';

        if (!isTenantAllowed) {
          gateOpen = false;
          gateReason = 'tenant_not_allowlisted';
        } else if (settings.globalDisabled) {
          gateOpen = false;
          gateReason = 'global_disabled';
        } else if (!settings.featureFlagEnabled) {
          gateOpen = false;
          gateReason = 'feature_flag_disabled';
        }

        const eligible = baseEligible && gateOpen;
        const finalReason = eligible 
          ? 'eligible'
          : (!baseEligible ? baseReason : gateReason);

        const isPhaseLocked = process.env.FORM_AUTOPILOT_PHASE_LOCK_OUTBOUND_BLOCKED !== 'false';
        let reasonStr = finalReason;
        if (eligible === false && baseEligible && gateOpen === false) {
          if (isPhaseLocked) reasonStr = 'phase_lock_enabled';
          else if (settings.globalDisabled) reasonStr = 'global_disabled';
          else if (!settings.featureFlagEnabled) reasonStr = 'feature_flag_disabled';
        }

        decisions[leadId] = {
          ...decisionBase,
          category: eligible ? 'bot_auto_eligible' : (baseEligible ? 'bot_auto_eligible' : 'not_eligible'),
          metaWindow: 'open',
          technicalEligible: baseEligible,
          finalActionAllowed: eligible,
          recommendedAction: 'bot_can_reply',
          reason: reasonStr,
          userFriendlyReason: mapUserFriendlyReason(reasonStr)
        };
      }
    } catch (err) {
      console.error("[BULK_DECISION_RESOLVER_ERROR]", err);
    }

    return decisions;
  }
}

