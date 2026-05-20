import { sql } from "@/lib/db";
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
      // 1. Transaction başlat: Lock Al + Duplicate Kontrolü Yap + Insert
      // Eğer provider_message_id varsa, duplicate mesaj gelip gelmediğine bak.
      const queries = [];
      queries.push(sql`SELECT pg_advisory_xact_lock(${hash})`);

      // Idempotency: Duplicate Check
      if (payload.providerMessageId) {
        // Eğer varsa provider_message_id = ${payload.providerMessageId} olan bir şey var mı diye okumak daha iyi ama 
        // Transaction içi olduğu için insert conflict de yapabilirdik.
        // Biz burada basit select yapalım. PostgreSQL'de messages tablosuna `provider_message_id` eklendiğini varsayıyoruz.
        // NOT: Schema migration ile eklenecektir.
        queries.push(sql`
          SELECT id FROM messages 
          WHERE tenant_id = ${this.db.tenantId} 
            AND provider_message_id = ${payload.providerMessageId} 
          LIMIT 1
        `);
      }

      // Check if conversation exists
      queries.push(sql`
        SELECT id FROM conversations 
        WHERE phone_number = ${payload.phoneNumber} AND tenant_id = ${this.db.tenantId}
      `);

      const txResult = await this.db.executeTransaction(queries);
      
      const dupCheckIdx = payload.providerMessageId ? 1 : -1;
      const convCheckIdx = payload.providerMessageId ? 2 : 1;

      if (dupCheckIdx > -1 && txResult[dupCheckIdx].length > 0) {
        // Duplicate webhook!
        return { success: true, isDuplicate: true, messageId: txResult[dupCheckIdx][0].id };
      }

      const convExists = txResult[convCheckIdx].length > 0;

      // 2. Insert Message & Upsert Conversation
      const writeQueries = [];
      
      writeQueries.push(sql`
        INSERT INTO messages (
          tenant_id, phone_number, direction, content, channel, 
          channel_id, group_id, workflow_run_id, prompt_binding_id,
          provider_message_id, model_used, prompt_tokens, completion_tokens, status
        ) VALUES (
          ${this.db.tenantId}, ${payload.phoneNumber}, ${payload.direction}, ${payload.content}, 
          ${payload.channel}, ${payload.channelId || null}, ${payload.groupId || null}, 
          ${payload.workflowRunId || null}, ${payload.promptBindingId || null},
          ${payload.providerMessageId || null}, ${payload.modelUsed || null},
          ${payload.promptTokens || 0}, ${payload.completionTokens || 0}, ${payload.status || 'pending'}
        ) RETURNING id
      `);

      if (convExists) {
        writeQueries.push(sql`
          UPDATE conversations 
          SET last_message_at = NOW(), 
              message_count = message_count + 1, 
              channel = ${payload.channel},
              last_channel = ${payload.direction === 'in' ? payload.channel : sql`last_channel`},
              last_message_content = ${payload.content},
              last_message_direction = ${payload.direction},
              last_message_status = ${payload.status || 'pending'}
          WHERE phone_number = ${payload.phoneNumber} AND tenant_id = ${this.db.tenantId}
          RETURNING id
        `);
      } else {
        writeQueries.push(sql`
          INSERT INTO conversations (
            tenant_id, phone_number, message_count, channel, last_channel,
            last_message_content, last_message_direction, last_message_status, last_message_at
          ) VALUES (
            ${this.db.tenantId}, ${payload.phoneNumber}, 1, ${payload.channel}, 
            ${payload.direction === 'in' ? payload.channel : null},
            ${payload.content}, ${payload.direction}, ${payload.status || 'pending'}, NOW()
          )
          RETURNING id
        `);
      }

      const writeResult = await this.db.executeTransaction(writeQueries);
      const insertedMessageId = writeResult[0][0].id;
      const conversationId = writeResult[1][0].id;

      return { success: true, isDuplicate: false, messageId: insertedMessageId, conversationId };
    } catch (e: any) {
      this.log.error("SaveMessageIdempotent Error", e instanceof Error ? e : new Error(String(e)));
      // Eğer column yok hatası alırsak, provider_message_id migrationı henüz yapılmamış demektir
      throw e;
    }
  }

  /**
   * Send outgoing WhatsApp message via Meta Graph API
   */
  async sendWhatsAppMessage(phoneId: string, accessToken: string, to: string, content: string): Promise<{ success: boolean; providerMessageId?: string }> {
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
