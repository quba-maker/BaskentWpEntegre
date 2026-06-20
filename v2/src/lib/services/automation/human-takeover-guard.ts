import { TenantDB } from "@/lib/core/tenant-db";

export class HumanTakeoverGuard {
  
  /**
   * Checks if a human agent has taken over the conversation.
   * A takeover is active if:
   * 1. The conversation's status is 'human'.
   * 2. OR, the last outbound message (direction = 'out') was sent by a human agent (i.e. model_used is null/empty and metadata source is not bot/outbound auto).
   * 3. OR, any human agent outbound message was sent in the last 30 minutes.
   */
  public static async isHumanTakeoverActive(
    tenantId: string,
    conversationId: string,
    db: TenantDB
  ): Promise<{ active: boolean; reason?: string }> {
    try {
      // 1. Check conversation status
      const convRows = await db.executeSafe({
        text: `SELECT status FROM conversations WHERE id = $1 AND tenant_id = $2 LIMIT 1`,
        values: [conversationId, tenantId]
      }) as any[];

      if (convRows.length === 0) {
        return { active: false };
      }

      if (convRows[0].status === 'human') {
        return { active: true, reason: 'status_human' };
      }

      // 2. Query last outbound message (skip if status is explicitly 'bot' to avoid permanent lockout on manual reactivation)
      if (convRows[0].status !== 'bot') {
        const lastOutboundRows = await db.executeSafe({
          text: `
            SELECT created_at, model_used, media_metadata
            FROM messages
            WHERE tenant_id = $1 AND conversation_id = $2 AND direction = 'out'
            ORDER BY created_at DESC, id DESC
            LIMIT 1
          `,
          values: [tenantId, conversationId]
        }) as any[];

        if (lastOutboundRows.length > 0) {
          const lastOut = lastOutboundRows[0];
          const modelUsed = lastOut.model_used;
          const meta = lastOut.media_metadata || {};
          
          // A message is considered sent by a bot if model_used is set or metadata source matches bot/greeting otopilot keys.
          const isBot = !!(modelUsed || meta.source === 'form_autopilot' || meta.source === 'bot_autopilot');

          if (!isBot) {
            // The last outbound message was sent by a human agent!
            return { active: true, reason: 'last_message_by_human' };
          }
        }
      }

      // 3. Check if any human agent outbound message was sent in the last 30 minutes
      const thirtyMinutesAgo = new Date(Date.now() - 30 * 60 * 1000).toISOString();
      const recentOutboundRows = await db.executeSafe({
        text: `
          SELECT created_at, model_used, media_metadata
          FROM messages
          WHERE tenant_id = $1 
            AND conversation_id = $2 
            AND direction = 'out' 
            AND created_at >= $3
          ORDER BY created_at DESC
        `,
        values: [tenantId, conversationId, thirtyMinutesAgo]
      }) as any[];

      for (const msg of recentOutboundRows) {
        const isBot = !!(msg.model_used || msg.media_metadata?.source === 'form_autopilot' || msg.media_metadata?.source === 'bot_autopilot');
        if (!isBot) {
          const elapsedMin = Math.round((Date.now() - new Date(msg.created_at).getTime()) / (60 * 1000));
          return { 
            active: true, 
            reason: `human_agent_replied_recently_${elapsedMin}_mins_ago` 
          };
        }
      }

      return { active: false };
    } catch (err) {
      console.error("[HUMAN_TAKEOVER_GUARD_ERROR]", err);
      // Fail safe: if we cannot determine, do not respond (assume takeover active)
      return { active: true, reason: 'internal_check_error' };
    }
  }
}
