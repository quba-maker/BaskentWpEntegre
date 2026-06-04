import { TenantDB } from "@/lib/core/tenant-db";
import { logger } from "@/lib/core/logger";

export interface MessagePayload {
  phoneNumber: string;
  direction: 'in' | 'out';
  content: string;
  channel: string;
  channelId?: string | null;
  groupId?: string | null;
  workflowRunId?: string | null;
  promptBindingId?: string | null;
  modelUsed?: string | null;
  providerMessageId?: string | null; // Idempotency için Meta'dan gelen message ID
  promptTokens?: number;
  completionTokens?: number;
  status?: string;
  // Media fields
  mediaType?: string | null;           // 'image' | 'document' | 'audio' | 'video' | 'location' | 'sticker'
  mediaUrl?: string | null;            // Vercel Blob permanent URL
  mediaMetadata?: Record<string, any> | null;  // { filename, mime_type, caption, latitude, longitude, ... }
  providerTimestamp?: number;
  isHistoryImport?: boolean;
}

export class MessageService {
  private db: TenantDB;
  private log = logger.withContext({ module: 'MessageService' });

  constructor(db: TenantDB) {
    this.db = db;
  }

  /**
   * Idempotent (Tekrar Engellemeli) Mesaj Kaydetme ve Conversation State Güncelleme.
   * Aynı anda hem lock alır, hem duplicate kontrolü yapar, hem message yazar hem de conversation'ı günceller.
   */
  async saveMessageIdempotent(payload: MessagePayload): Promise<{ success: boolean; isDuplicate: boolean; messageId?: string; conversationId?: string }> {
    // Lock ID için hash
    const lockKeyStr = `${this.db.tenantId}-${payload.phoneNumber}`;
    let hash = 0;
    for (let i = 0; i < lockKeyStr.length; i++) {
      hash = ((hash << 5) - hash) + lockKeyStr.charCodeAt(i);
      hash |= 0;
    }

    try {
      // Single transaction boundary CTE for locking, deduplication, message insert, and conversation upsert
      const result = await this.db.executeSafe({
        text: `
          WITH lock_acquire AS (
            SELECT pg_advisory_xact_lock($15)
          ), dup_check AS (
            SELECT id FROM messages 
            WHERE tenant_id = $1 AND provider_message_id = $10 AND $10 IS NOT NULL
            LIMIT 1
          ), conv_update AS (
            UPDATE conversations 
            SET 
              last_message_at = CASE 
                WHEN $3 = 'system' THEN last_message_at
                WHEN $19::double precision IS NOT NULL THEN 
                  CASE WHEN TO_TIMESTAMP($19::double precision) > last_message_at THEN TO_TIMESTAMP($19::double precision) ELSE last_message_at END
                ELSE NOW() 
              END,
              history_imported_at = CASE WHEN COALESCE($20::boolean, false) = true THEN NOW() ELSE history_imported_at END,
              message_count = CASE WHEN $3 = 'system' THEN message_count ELSE message_count + 1 END, 
              channel = CASE WHEN $3 = 'system' THEN channel ELSE $5 END,
              channel_id = CASE WHEN $3 = 'system' THEN channel_id ELSE COALESCE($6, channel_id) END,
              last_channel = CASE WHEN $3 = 'in' THEN $5 ELSE last_channel END,
              last_message_content = CASE WHEN $3 = 'system' THEN last_message_content ELSE $4 END,
              last_message_direction = CASE WHEN $3 = 'system' THEN last_message_direction ELSE $3 END,
              last_message_status = CASE WHEN $3 = 'system' THEN last_message_status ELSE $14 END
            WHERE phone_number = $2 AND tenant_id = $1 AND NOT EXISTS (SELECT 1 FROM dup_check)
            RETURNING id
          ), conv_insert AS (
            INSERT INTO conversations (
              tenant_id, phone_number, message_count, channel, channel_id, last_channel,
              last_message_content, last_message_direction, last_message_status, last_message_at, history_imported_at
            )
            SELECT $1, $2, 
                   CASE WHEN $3 = 'system' THEN 0 ELSE 1 END, 
                   $5, $6, 
                   CASE WHEN $3 = 'in' THEN $5 ELSE NULL END, 
                   CASE WHEN $3 = 'system' THEN NULL ELSE $4 END, 
                   CASE WHEN $3 = 'system' THEN NULL ELSE $3 END, 
                   CASE WHEN $3 = 'system' THEN NULL ELSE $14 END, 
                   COALESCE(TO_TIMESTAMP($19::double precision), NOW()), 
                   CASE WHEN COALESCE($20::boolean, false) = true THEN NOW() ELSE NULL END
            WHERE NOT EXISTS (SELECT 1 FROM dup_check) AND NOT EXISTS (SELECT 1 FROM conv_update)
            RETURNING id
          ), resolved_conv AS (
            SELECT COALESCE(
              (SELECT id FROM conv_update),
              (SELECT id FROM conv_insert),
              (SELECT id FROM conversations WHERE phone_number = $2 AND tenant_id = $1 LIMIT 1)
            ) AS conv_id
          ), msg_insert AS (
            INSERT INTO messages (
              tenant_id, conversation_id, phone_number, direction, content, channel, 
              channel_id, group_id, workflow_run_id, prompt_binding_id,
              provider_message_id, model_used, prompt_tokens, completion_tokens, status,
              media_type, media_url, media_metadata, provider_timestamp
            )
            SELECT $1, rc.conv_id, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14,
                   $16, $17, $18::jsonb, CASE WHEN $19::double precision IS NOT NULL THEN TO_TIMESTAMP($19::double precision) ELSE NULL END
            FROM resolved_conv rc
            WHERE rc.conv_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM dup_check)
            RETURNING id
          )
          SELECT 
            (SELECT id FROM dup_check) as dup_id,
            (SELECT id FROM msg_insert) as msg_id,
            (SELECT conv_id FROM resolved_conv) as conv_id;
        `,
        values: [
          this.db.tenantId,                  // $1
          payload.phoneNumber,               // $2
          payload.direction,                 // $3
          payload.content,                   // $4
          payload.channel,                   // $5
          payload.channelId || null,         // $6
          payload.groupId || null,           // $7
          payload.workflowRunId || null,     // $8
          payload.promptBindingId || null,   // $9
          payload.providerMessageId || null, // $10
          payload.modelUsed || null,         // $11
          payload.promptTokens || 0,         // $12
          payload.completionTokens || 0,     // $13
          payload.status || 'pending',       // $14
          hash,                              // $15
          payload.mediaType || null,         // $16
          payload.mediaUrl || null,          // $17
          payload.mediaMetadata ? JSON.stringify(payload.mediaMetadata) : null,  // $18
          payload.providerTimestamp != null ? Number(payload.providerTimestamp) : null, // $19 — explicit number or null
          payload.isHistoryImport === true   // $20 — explicit boolean
        ]
      }) as any[];

      const row = result && result.length > 0 ? result[0] : null;
      if (row && row.dup_id) {
        return { success: true, isDuplicate: true, messageId: row.dup_id };
      }

      const insertedMessageId = row ? row.msg_id : null;
      const conversationId = row ? row.conv_id : null;

      return { success: true, isDuplicate: false, messageId: insertedMessageId, conversationId };
    } catch (e: any) {
      this.log.error("SaveMessageIdempotent Error", e instanceof Error ? e : new Error(String(e)));
      throw e;
    }
  }


  /**
   * Send outgoing WhatsApp message via Meta Graph API
   */
  async sendWhatsAppMessage(
    phoneId: string,
    accessToken: string,
    to: string,
    content: string,
    provider?: string | null
  ): Promise<{ success: boolean; providerMessageId?: string }> {
    if (provider === '360dialog' || provider === '360dialog_whatsapp') {
      const { ThreeSixtyDialogService } = await import("./providers/three-sixty-dialog.service");
      return ThreeSixtyDialogService.sendMessage(accessToken, to, content);
    }

    const url = `https://graph.facebook.com/v25.0/${phoneId}/messages`;
    try {
      const response = await fetch(url, {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${accessToken}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          messaging_product: "whatsapp",
          recipient_type: "individual",
          to: to,
          type: "text",
          text: { body: content }
        })
      });
      if (!response.ok) {
        const err = await response.text();
        throw new Error(`WhatsApp API Error: ${err}`);
      }
      const data = await response.json();
      const providerMessageId = data.messages?.[0]?.id || data.message_id || null;
      return { success: true, providerMessageId };
    } catch (e: any) {
      this.log.error("WhatsApp API request failed", e instanceof Error ? e : new Error(String(e)));
      throw e;
    }
  }

  /**
   * Send outgoing Messenger/Instagram message via Meta Graph API
   */
  async sendSocialMessage(accessToken: string, to: string, content: string, channel: 'messenger' | 'instagram'): Promise<{ success: boolean; providerMessageId?: string }> {
    const url = `https://graph.facebook.com/v25.0/me/messages`;
    try {
      const response = await fetch(url, {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${accessToken}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          recipient: { id: to },
          message: { text: content },
          messaging_type: "RESPONSE"
        })
      });
      if (!response.ok) {
        const err = await response.text();
        throw new Error(`Meta API Error (${channel}): ${err}`);
      }
      const data = await response.json();
      const providerMessageId = data.message_id || null;
      return { success: true, providerMessageId };
    } catch (e: any) {
      this.log.error(`${channel} API request failed`, e instanceof Error ? e : new Error(String(e)));
      throw e;
    }
  }
}
