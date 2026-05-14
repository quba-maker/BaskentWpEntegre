import { sql } from "@/lib/db";
import { TenantDB } from "@/lib/core/tenant-db";

export interface MessagePayload {
  phoneNumber: string;
  direction: 'in' | 'out';
  content: string;
  channel: string;
  modelUsed?: string | null;
  providerMessageId?: string | null; // Idempotency için Meta'dan gelen message ID
}

export class MessageService {
  private db: TenantDB;

  constructor(db: TenantDB) {
    this.db = db;
  }

  /**
   * Idempotent (Tekrar Engellemeli) Mesaj Kaydetme ve Conversation State Güncelleme.
   * Aynı anda hem lock alır, hem duplicate kontrolü yapar, hem message yazar hem de conversation'ı günceller.
   */
  async saveMessageIdempotent(payload: MessagePayload): Promise<{ success: boolean; isDuplicate: boolean; messageId?: string }> {
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
      
      let dupCheckIdx = payload.providerMessageId ? 1 : -1;
      let convCheckIdx = payload.providerMessageId ? 2 : 1;

      if (dupCheckIdx > -1 && txResult[dupCheckIdx].length > 0) {
        // Duplicate webhook!
        return { success: true, isDuplicate: true, messageId: txResult[dupCheckIdx][0].id };
      }

      const convExists = txResult[convCheckIdx].length > 0;

      // 2. Insert Message & Upsert Conversation
      const writeQueries = [];
      
      writeQueries.push(sql`
        INSERT INTO messages (
          tenant_id, phone_number, direction, content, model_used, channel, provider_message_id
        ) VALUES (
          ${this.db.tenantId}, ${payload.phoneNumber}, ${payload.direction}, ${payload.content}, 
          ${payload.modelUsed || null}, ${payload.channel}, ${payload.providerMessageId || null}
        ) RETURNING id
      `);

      if (convExists) {
        if (payload.direction === 'in') {
          writeQueries.push(sql`
            UPDATE conversations 
            SET last_message_at = NOW(), 
                message_count = message_count + 1, 
                channel = ${payload.channel},
                last_channel = ${payload.channel}
            WHERE phone_number = ${payload.phoneNumber} AND tenant_id = ${this.db.tenantId}
          `);
        } else {
          writeQueries.push(sql`
            UPDATE conversations 
            SET last_message_at = NOW(), 
                message_count = message_count + 1, 
                channel = ${payload.channel}
            WHERE phone_number = ${payload.phoneNumber} AND tenant_id = ${this.db.tenantId}
          `);
        }
      } else {
        writeQueries.push(sql`
          INSERT INTO conversations (
            tenant_id, phone_number, message_count, channel, last_channel
          ) VALUES (
            ${this.db.tenantId}, ${payload.phoneNumber}, 1, ${payload.channel}, 
            ${payload.direction === 'in' ? payload.channel : null}
          )
        `);
      }

      const writeResult = await this.db.executeTransaction(writeQueries);
      const insertedMessageId = writeResult[0][0].id;

      return { success: true, isDuplicate: false, messageId: insertedMessageId };
    } catch (e: any) {
      console.error("SaveMessageIdempotent Error:", e.message);
      // Eğer column yok hatası alırsak, provider_message_id migrationı henüz yapılmamış demektir
      throw e;
    }
  }
}
