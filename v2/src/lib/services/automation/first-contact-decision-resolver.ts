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
  baseCategory:
    | 'bot_auto_eligible'
    | 'manual_draft_required'
    | 'manual_template_required'
    | 'already_open_inbox'
    | 'not_eligible'
    | 'error';
  gateState:
    | 'open'
    | 'live_locked'
    | 'dry_run'
    | 'feature_disabled'
    | 'allowlist_missing'
    | 'global_disabled';
  gateReasons: Array<
    | 'phase_lock_enabled'
    | 'dry_run_enabled'
    | 'feature_flag_disabled'
    | 'allowlist_missing'
    | 'global_disabled'
  >;
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
  userFriendlyTitle: string;
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

export function calculateGateStateAndReasons(params: {
  isTenantAllowed: boolean;
  globalDisabled: boolean;
  featureFlagEnabled: boolean;
  phaseLockBlocked: boolean;
  dryRun: boolean;
}) {
  const gateReasons: Array<
    | 'phase_lock_enabled'
    | 'dry_run_enabled'
    | 'feature_flag_disabled'
    | 'allowlist_missing'
    | 'global_disabled'
  > = [];

  if (params.globalDisabled) gateReasons.push('global_disabled');
  if (!params.isTenantAllowed) gateReasons.push('allowlist_missing');
  if (!params.featureFlagEnabled) gateReasons.push('feature_flag_disabled');
  if (params.phaseLockBlocked) gateReasons.push('phase_lock_enabled');
  if (params.dryRun) gateReasons.push('dry_run_enabled');

  let gateState: 'open' | 'live_locked' | 'dry_run' | 'feature_disabled' | 'allowlist_missing' | 'global_disabled' = 'open';
  if (params.globalDisabled) gateState = 'global_disabled';
  else if (!params.isTenantAllowed) gateState = 'allowlist_missing';
  else if (!params.featureFlagEnabled) gateState = 'feature_disabled';
  else if (params.phaseLockBlocked) gateState = 'live_locked';
  else if (params.dryRun) gateState = 'dry_run';

  return { gateState, gateReasons };
}

export class FirstContactDecisionResolver {
  public static async resolveForFormLead(
    tenantId: string,
    leadId: string,
    db: TenantDB
  ): Promise<GreetingAutomationDecision> {
    try {
      // 1. Fetch Tenant Slug and autopilot settings first to determine gates
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

      const { getAutopilotSettings } = await import("../forms/form-autopilot-eligibility-resolver");
      const settings = await getAutopilotSettings(tenantId, db);
      const isPhaseLocked = process.env.FORM_AUTOPILOT_PHASE_LOCK_OUTBOUND_BLOCKED !== 'false';

      const gates = calculateGateStateAndReasons({
        isTenantAllowed,
        globalDisabled: settings.globalDisabled,
        featureFlagEnabled: settings.featureFlagEnabled,
        phaseLockBlocked: isPhaseLocked,
        dryRun: settings.dryRun
      });

      // 2. Find conversation associated with lead phone number
      const leadRow = await db.executeSafe({
        text: `SELECT phone_number, raw_data, form_name FROM leads WHERE id = $1 AND tenant_id = $2 LIMIT 1`,
        values: [leadId, tenantId]
      }) as any[];

      if (leadRow.length === 0) {
        return {
          source: 'form',
          category: 'error',
          baseCategory: 'error',
          gateState: gates.gateState,
          gateReasons: gates.gateReasons,
          metaWindow: 'unknown',
          technicalEligible: false,
          finalActionAllowed: false,
          recommendedAction: 'no_action',
          reason: 'lead_not_found',
          userFriendlyReason: mapUserFriendlyReason('lead_not_found'),
          userFriendlyTitle: 'Hata',
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
        const langDec = resolveLeadLanguage(lead.raw_data, lead.form_name, phone, 'tr');
        return {
          source: 'form',
          category: 'manual_draft_required',
          baseCategory: 'manual_draft_required',
          gateState: gates.gateState,
          gateReasons: gates.gateReasons,
          metaWindow: 'no_conversation',
          technicalEligible: false,
          finalActionAllowed: false,
          recommendedAction: 'prepare_manual_draft',
          reason: 'no_conversation',
          userFriendlyReason: mapUserFriendlyReason('no_conversation'),
          userFriendlyTitle: 'Taslak Gerekli',
          language: langDec.language,
          languageConfidence: langDec.confidence,
          tenantId,
          leadId
        };
      }

      const conv = convRow[0];
      const conversationId = conv.id;

      // 3. Call resolveFormAutopilotEligibility
      const eligibility = await resolveFormAutopilotEligibility(tenantId, leadId, conversationId, db);
      const langDec = resolveLeadLanguage(lead.raw_data, lead.form_name, phone, 'tr');

      const decisionBase = {
        source: 'form' as const,
        tenantId,
        conversationId,
        leadId,
        language: langDec.language,
        languageConfidence: langDec.confidence,
        channelId: eligibility.channelId || 'whatsapp',
        gateState: gates.gateState,
        gateReasons: gates.gateReasons
      };

      // Check Meta 24h window
      const windowCheck = await resolveWhatsApp24hWindow(conversationId, tenantId, db);
      const metaWindow = windowCheck.status === 'OPEN' || windowCheck.status === 'CLOSING_SOON' ? 'open' as const : 
                         (windowCheck.status === 'UNKNOWN' ? 'no_inbound' as const : 'closed' as const);

      // Map to category based on eligibility reasons
      if (eligibility.reason === 'already_processed') {
        return {
          ...decisionBase,
          category: 'already_processed',
          baseCategory: 'already_open_inbox',
          metaWindow: 'open',
          technicalEligible: false,
          finalActionAllowed: false,
          recommendedAction: 'go_to_inbox',
          reason: 'already_processed',
          userFriendlyReason: mapUserFriendlyReason('already_processed'),
          userFriendlyTitle: "Inbox'tan Devam"
        };
      }

      if (conv.status === 'human') {
        return {
          ...decisionBase,
          category: 'already_open_inbox',
          baseCategory: 'already_open_inbox',
          metaWindow: 'open',
          technicalEligible: false,
          finalActionAllowed: false,
          recommendedAction: 'go_to_inbox',
          reason: 'status_human',
          userFriendlyReason: mapUserFriendlyReason('status_human'),
          userFriendlyTitle: "Inbox'tan Devam"
        };
      }

      if (metaWindow === 'closed') {
        return {
          ...decisionBase,
          category: 'manual_template_required',
          baseCategory: 'manual_template_required',
          metaWindow: 'closed',
          technicalEligible: false,
          finalActionAllowed: false,
          recommendedAction: 'select_template',
          reason: 'meta_window_closed',
          userFriendlyReason: mapUserFriendlyReason('meta_window_closed'),
          userFriendlyTitle: 'Şablon Gerekli'
        };
      }

      if (metaWindow === 'no_inbound') {
        return {
          ...decisionBase,
          category: 'manual_draft_required',
          baseCategory: 'manual_draft_required',
          metaWindow: 'no_inbound',
          technicalEligible: false,
          finalActionAllowed: false,
          recommendedAction: 'prepare_manual_draft',
          reason: 'form_only_no_inbound',
          userFriendlyReason: mapUserFriendlyReason('form_only_no_inbound'),
          userFriendlyTitle: 'Taslak Gerekli'
        };
      }

      // Check other non-eligible reasons
      const isNotEligibleReason = [
        'tenant_mismatch',
        'channel_mismatch',
        'missing_phone',
        'invalid_conversation',
        'internal_error',
        'security_blocked',
        'not_whatsapp_channel',
        'autopilot_disabled'
      ].includes(eligibility.baseReason || '');

      if (isNotEligibleReason) {
        return {
          ...decisionBase,
          category: 'not_eligible',
          baseCategory: 'not_eligible',
          metaWindow: 'open',
          technicalEligible: false,
          finalActionAllowed: false,
          recommendedAction: 'no_action',
          reason: eligibility.baseReason || 'not_eligible',
          userFriendlyReason: mapUserFriendlyReason(eligibility.baseReason || 'not_eligible'),
          userFriendlyTitle: 'Uygun Değil'
        };
      }

      // Base category is eligible
      const baseCategory = 'bot_auto_eligible';
      const eligible = eligibility.baseEligible && eligibility.gateOpen;

      let finalReason = eligibility.reason;
      if (!eligible) {
        if (isPhaseLocked) finalReason = 'phase_lock_enabled';
        else if (settings.globalDisabled) finalReason = 'global_disabled';
        else if (!settings.featureFlagEnabled) finalReason = 'feature_flag_disabled';
      }

      return {
        ...decisionBase,
        category: 'bot_auto_eligible',
        baseCategory,
        metaWindow: 'open',
        technicalEligible: eligibility.baseEligible,
        finalActionAllowed: eligible,
        recommendedAction: 'bot_can_reply',
        reason: finalReason,
        userFriendlyReason: mapUserFriendlyReason(finalReason),
        userFriendlyTitle: 'Bot Uygun'
      };
    } catch (err) {
      return {
        source: 'form',
        category: 'error',
        baseCategory: 'error',
        gateState: 'global_disabled',
        gateReasons: ['global_disabled'],
        metaWindow: 'unknown',
        technicalEligible: false,
        finalActionAllowed: false,
        recommendedAction: 'no_action',
        reason: 'internal_error',
        userFriendlyReason: mapUserFriendlyReason('internal_error'),
        userFriendlyTitle: 'Hata',
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
      const isPhaseLocked = process.env.FORM_AUTOPILOT_PHASE_LOCK_OUTBOUND_BLOCKED !== 'false';

      const gates = calculateGateStateAndReasons({
        isTenantAllowed,
        globalDisabled: settings.globalDisabled,
        featureFlagEnabled: settings.featureFlagEnabled,
        phaseLockBlocked: isPhaseLocked,
        dryRun: settings.dryRun
      });

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
          channelId: channelId,
          gateState: gates.gateState,
          gateReasons: gates.gateReasons
        };

        if (!convId) {
          decisions[leadId] = {
            ...decisionBase,
            category: 'manual_draft_required',
            baseCategory: 'manual_draft_required',
            metaWindow: 'no_conversation',
            technicalEligible: false,
            finalActionAllowed: false,
            recommendedAction: 'prepare_manual_draft',
            reason: 'no_conversation',
            userFriendlyReason: mapUserFriendlyReason('no_conversation'),
            userFriendlyTitle: 'Taslak Gerekli'
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
            baseCategory: 'manual_template_required',
            metaWindow: 'closed',
            technicalEligible: false,
            finalActionAllowed: false,
            recommendedAction: 'select_template',
            reason: 'meta_window_closed',
            userFriendlyReason: mapUserFriendlyReason('meta_window_closed'),
            userFriendlyTitle: 'Şablon Gerekli'
          };
          continue;
        }

        if (metaWindow === 'no_inbound') {
          decisions[leadId] = {
            ...decisionBase,
            category: 'manual_draft_required',
            baseCategory: 'manual_draft_required',
            metaWindow: 'no_inbound',
            technicalEligible: false,
            finalActionAllowed: false,
            recommendedAction: 'prepare_manual_draft',
            reason: 'form_only_no_inbound',
            userFriendlyReason: mapUserFriendlyReason('form_only_no_inbound'),
            userFriendlyTitle: 'Taslak Gerekli'
          };
          continue;
        }

        if (convStatus === 'human') {
          decisions[leadId] = {
            ...decisionBase,
            category: 'already_open_inbox',
            baseCategory: 'already_open_inbox',
            metaWindow: 'open',
            technicalEligible: false,
            finalActionAllowed: false,
            recommendedAction: 'go_to_inbox',
            reason: 'status_human',
            userFriendlyReason: mapUserFriendlyReason('status_human'),
            userFriendlyTitle: "Inbox'tan Devam"
          };
          continue;
        }

        // Check non-eligible criteria
        let isNotEligible = false;
        let notEligibleReason = '';

        if (convAutopilotEnabled === false) {
          isNotEligible = true;
          notEligibleReason = 'autopilot_disabled';
        } else if (channelId !== 'whatsapp') {
          isNotEligible = true;
          notEligibleReason = 'not_whatsapp_channel';
        } else if (dupLogsMap.has(`${convId}_${leadId}`)) {
          isNotEligible = true;
          notEligibleReason = 'already_processed';
        }

        if (isNotEligible) {
          if (notEligibleReason === 'already_processed') {
            decisions[leadId] = {
              ...decisionBase,
              category: 'already_processed',
              baseCategory: 'already_open_inbox',
              metaWindow: 'open',
              technicalEligible: false,
              finalActionAllowed: false,
              recommendedAction: 'go_to_inbox',
              reason: 'already_processed',
              userFriendlyReason: mapUserFriendlyReason('already_processed'),
              userFriendlyTitle: "Inbox'tan Devam"
            };
          } else {
            decisions[leadId] = {
              ...decisionBase,
              category: 'not_eligible',
              baseCategory: 'not_eligible',
              metaWindow: 'open',
              technicalEligible: false,
              finalActionAllowed: false,
              recommendedAction: 'no_action',
              reason: notEligibleReason,
              userFriendlyReason: mapUserFriendlyReason(notEligibleReason),
              userFriendlyTitle: 'Uygun Değil'
            };
          }
          continue;
        }

        // Base category is eligible
        const baseCategory = 'bot_auto_eligible';
        const eligible = gates.gateState === 'open';

        let reasonStr = 'eligible';
        if (!eligible) {
          if (isPhaseLocked) reasonStr = 'phase_lock_enabled';
          else if (settings.globalDisabled) reasonStr = 'global_disabled';
          else if (!settings.featureFlagEnabled) reasonStr = 'feature_flag_disabled';
        }

        decisions[leadId] = {
          ...decisionBase,
          category: 'bot_auto_eligible',
          baseCategory,
          metaWindow: 'open',
          technicalEligible: true,
          finalActionAllowed: eligible,
          recommendedAction: 'bot_can_reply',
          reason: reasonStr,
          userFriendlyReason: mapUserFriendlyReason(reasonStr),
          userFriendlyTitle: 'Bot Uygun'
        };
      }
    } catch (err) {
      console.error("[BULK_DECISION_RESOLVER_ERROR]", err);
    }

    return decisions;
  }
}
