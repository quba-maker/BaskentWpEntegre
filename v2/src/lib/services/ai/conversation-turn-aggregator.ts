import { withTenantDB } from '@/lib/core/tenant-db';
import { ChatMessage } from './orchestrator';

export class ConversationTurnAggregator {
  /**
   * Aggregates consecutive user messages sent within a 10-second window.
   * Does NOT modify the database records. Only returns a collapsed ChatMessage array for prompt history.
   */
  public static async aggregate(
    tenantId: string,
    phoneNumber: string,
    inMemoryHistory?: ChatMessage[],
    limit = 10
  ): Promise<ChatMessage[]> {
    if (inMemoryHistory && inMemoryHistory.length > 0) {
      // In sandbox/test mode where history is passed directly, aggregate adjacent user turns
      const aggregated: ChatMessage[] = [];
      for (const msg of inMemoryHistory) {
        if (aggregated.length > 0 && msg.role === 'user' && aggregated[aggregated.length - 1].role === 'user') {
          aggregated[aggregated.length - 1].content += '\n' + msg.content;
        } else {
          aggregated.push({ ...msg });
        }
      }
      return aggregated;
    }

    try {
      const db = withTenantDB(tenantId);
      
      // Retrieve last N messages with created_at to compute time differences
      const rawMessages = await db.executeSafe({
        text: `
          SELECT direction, content, media_type, media_metadata, created_at
          FROM messages
          WHERE phone_number = $1 AND tenant_id = $2 AND direction IN ('in', 'out')
          ORDER BY created_at DESC
          LIMIT $3
        `,
        values: [phoneNumber, tenantId, limit]
      }) as any[];

      if (!rawMessages || rawMessages.length === 0) {
        return [];
      }

      // Reverse to chronological order
      const messages = [...rawMessages].reverse();
      const aggregated: ChatMessage[] = [];
      
      for (let i = 0; i < messages.length; i++) {
        const msg = messages[i];
        const role = msg.direction === 'in' ? 'user' : 'assistant';
        
        let content = '';
        if (msg.media_type) {
          const { buildMediaContext } = require('./media-context');
          content = buildMediaContext({
            direction: msg.direction,
            mediaType: msg.media_type,
            content: msg.content || '',
            metadata: msg.media_metadata || undefined,
          });
        } else {
          content = String(msg.content || '');
        }

        const timestamp = new Date(msg.created_at).getTime();

        if (aggregated.length > 0) {
          const lastAgg = aggregated[aggregated.length - 1];
          const lastMsg = messages[i - 1];
          const lastTimestamp = new Date(lastMsg.created_at).getTime();
          const diffSeconds = Math.abs(timestamp - lastTimestamp) / 1000;

          // Collapse consecutive user messages within 10 seconds
          if (role === 'user' && lastAgg.role === 'user' && diffSeconds <= 10) {
            lastAgg.content += '\n' + content;
            continue;
          }
        }

        aggregated.push({
          role,
          content
        });
      }

      return aggregated;
    } catch (err) {
      console.error('[ConversationTurnAggregator] Non-fatal aggregation error, falling back to empty history', err);
      return [];
    }
  }
}
