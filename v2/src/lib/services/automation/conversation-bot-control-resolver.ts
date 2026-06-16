import { TenantDB } from "@/lib/core/tenant-db";
import { resolveWhatsApp24hWindow } from "../whatsapp-window-resolver";
import { mapUserFriendlyReason } from "./first-contact-decision-resolver";

export interface ConversationBotControlDecision {
  conversationId: string;
  tenantId: string;
  channel: string;
  status: string;
  autopilotEnabled: boolean;
  metaWindowStatus: 'open' | 'closed' | 'no_inbound' | 'unknown';
  category:
    | 'bot_enabled'
    | 'bot_disabled'
    | 'human_taken_over'
    | 'meta_window_open'
    | 'meta_window_closed'
    | 'eligible_for_bot_control'
    | 'not_eligible';
  reason: string;
  userFriendlyReason: string;
}

export class ConversationBotControlResolver {
  /**
   * Resolves the bot control status for a single conversation.
   */
  public static async resolve(
    tenantId: string,
    conversationId: string,
    db: TenantDB
  ): Promise<ConversationBotControlDecision> {
    try {
      const rows = await db.executeSafe({
        text: `SELECT id, tenant_id, channel, status, autopilot_enabled FROM conversations WHERE id = $1 AND tenant_id = $2 LIMIT 1`,
        values: [conversationId, tenantId]
      }) as any[];

      if (rows.length === 0) {
        return {
          conversationId,
          tenantId,
          channel: 'unknown',
          status: 'unknown',
          autopilotEnabled: false,
          metaWindowStatus: 'unknown',
          category: 'not_eligible',
          reason: 'no_conversation',
          userFriendlyReason: mapUserFriendlyReason('no_conversation')
        };
      }

      const conv = rows[0];
      const channel = conv.channel || 'whatsapp';
      const status = conv.status || 'open';
      const autopilotEnabled = !!conv.autopilot_enabled;

      if (channel !== 'whatsapp') {
        return {
          conversationId,
          tenantId,
          channel,
          status,
          autopilotEnabled,
          metaWindowStatus: 'unknown',
          category: 'not_eligible',
          reason: 'not_whatsapp_channel',
          userFriendlyReason: mapUserFriendlyReason('not_whatsapp_channel')
        };
      }

      if (status === 'human') {
        return {
          conversationId,
          tenantId,
          channel,
          status,
          autopilotEnabled,
          metaWindowStatus: 'unknown',
          category: 'human_taken_over',
          reason: 'status_human',
          userFriendlyReason: mapUserFriendlyReason('status_human')
        };
      }

      // Check Meta 24h Window
      const windowCheck = await resolveWhatsApp24hWindow(conversationId, tenantId, db);
      let metaWindowStatus: 'open' | 'closed' | 'no_inbound' | 'unknown' = 'unknown';

      if (windowCheck.status === 'OPEN' || windowCheck.status === 'CLOSING_SOON') {
        metaWindowStatus = 'open';
      } else if (windowCheck.status === 'CLOSED') {
        metaWindowStatus = 'closed';
      } else if (windowCheck.status === 'UNKNOWN') {
        metaWindowStatus = 'no_inbound';
      }

      // Determine category based on autopilot status and window
      let category: ConversationBotControlDecision['category'] = 'eligible_for_bot_control';
      let reason = 'eligible_for_bot_control';
      let userFriendlyReason = 'Konuşma bot kontrolüne uygun.';

      if (autopilotEnabled) {
        category = 'bot_enabled';
        reason = 'bot_active';
        userFriendlyReason = 'Bot aktif.';
      } else {
        category = 'bot_disabled';
        reason = 'bot_disabled';
        userFriendlyReason = 'Bot kapalı.';
      }

      // Overlay meta window specific info
      if (metaWindowStatus === 'closed') {
        reason = 'meta_window_closed';
        userFriendlyReason = `${userFriendlyReason} ${mapUserFriendlyReason('meta_window_closed')}`;
      } else if (metaWindowStatus === 'no_inbound') {
        reason = 'form_only_no_inbound';
        userFriendlyReason = `${userFriendlyReason} ${mapUserFriendlyReason('form_only_no_inbound')}`;
      }

      return {
        conversationId,
        tenantId,
        channel,
        status,
        autopilotEnabled,
        metaWindowStatus,
        category,
        reason,
        userFriendlyReason
      };
    } catch (err) {
      return {
        conversationId,
        tenantId,
        channel: 'unknown',
        status: 'unknown',
        autopilotEnabled: false,
        metaWindowStatus: 'unknown',
        category: 'not_eligible',
        reason: 'internal_error',
        userFriendlyReason: mapUserFriendlyReason('internal_error')
      };
    }
  }

  /**
   * Resolves bot control status for multiple conversations.
   */
  public static async resolveBulk(
    tenantId: string,
    conversationIds: string[],
    db: TenantDB
  ): Promise<ConversationBotControlDecision[]> {
    if (conversationIds.length === 0) return [];
    
    // Process them in parallel safely
    const promises = conversationIds.map(id => this.resolve(tenantId, id, db));
    return Promise.all(promises);
  }
}
