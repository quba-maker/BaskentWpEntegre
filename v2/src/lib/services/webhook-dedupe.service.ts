import { sql } from "@/lib/db";
import { TenantDB } from "@/lib/core/tenant-db";
import { logger } from "@/lib/core/logger";

export interface DedupePayload {
  provider: 'whatsapp' | 'messenger' | 'instagram' | 'leadgen';
  providerMessageId: string;
  senderId: string;
  timestamp?: number; // Webhook'tan gelen unix timestamp
}

export class WebhookDedupeService {
  private db: TenantDB;
  private log = logger.withContext({ module: 'WebhookDedupe' });

  constructor(db: TenantDB) {
    this.db = db;
  }

  /**
   * Meta'dan gelen webhook'un tamamen duplicate olup olmadığını
   * Composite Key ile doğrular ve Event Lock alır.
   */
  async checkAndLock(payload: DedupePayload): Promise<{ isDuplicate: boolean; lockHash: number }> {
    // 1. Lock Hash üret (tenant_id + provider + sender_id)
    // Sadece o hastanın o kanaldaki webhook'larını sıraya sokar
    const lockKeyStr = `${this.db.tenantId}-${payload.provider}-${payload.senderId}`;
    let hash = 0;
    for (let i = 0; i < lockKeyStr.length; i++) {
      hash = ((hash << 5) - hash) + lockKeyStr.charCodeAt(i);
      hash |= 0;
    }

    try {
      const queries = [];
      // 2. Transaction bazlı Advisory Lock al
      queries.push(sql`SELECT pg_advisory_xact_lock(${hash})`);

      // 3. Tablo kontrolü (Eğer webhook_events tablosu yoksa)
      queries.push(sql`
        CREATE TABLE IF NOT EXISTS webhook_events (
          tenant_id UUID,
          provider VARCHAR(50),
          provider_message_id VARCHAR(255),
          sender_id VARCHAR(100),
          event_timestamp BIGINT,
          created_at TIMESTAMP DEFAULT NOW(),
          PRIMARY KEY(tenant_id, provider, provider_message_id)
        )
      `);

      // 4. Duplicate Check Query
      queries.push(sql`
        SELECT 1 FROM webhook_events 
        WHERE tenant_id = ${this.db.tenantId} 
          AND provider = ${payload.provider} 
          AND provider_message_id = ${payload.providerMessageId}
      `);

      const result = await this.db.executeTransaction(queries);
      const isDuplicate = result[2].length > 0;

      if (isDuplicate) {
        this.log.warn(`🛑 Duplicate Webhook Suppressed!`, { payload });
        return { isDuplicate: true, lockHash: hash };
      }

      // 5. Ordering Protection (Eski timestamp kontrolü)
      if (payload.timestamp) {
        const lastEvent = await this.db.executeSafe(sql`
          SELECT event_timestamp FROM webhook_events 
          WHERE tenant_id = ${this.db.tenantId} 
            AND provider = ${payload.provider} 
            AND sender_id = ${payload.senderId}
          ORDER BY event_timestamp DESC LIMIT 1
        `);

        if (lastEvent.length > 0 && lastEvent[0].event_timestamp > payload.timestamp) {
          this.log.warn(`⚠️ Out-of-order webhook detected!`, { 
            last: lastEvent[0].event_timestamp, incoming: payload.timestamp 
          });
          // Not: Out-of-order eventleri isDuplicate=false döner ama işlerken dikkat edilmeli.
          // İleride message ordering buffer'a atılabilir.
        }
      }

      // 6. Webhook'u kaydet (Event Sourcing Hazırlığı)
      await this.db.executeSafe(sql`
        INSERT INTO webhook_events (tenant_id, provider, provider_message_id, sender_id, event_timestamp)
        VALUES (${this.db.tenantId}, ${payload.provider}, ${payload.providerMessageId}, ${payload.senderId}, ${payload.timestamp || 0})
      `);

      return { isDuplicate: false, lockHash: hash };
    } catch (e: any) {
      this.log.error('Dedupe Check Error', e);
      // Hata durumunda fail-open davran (eski sisteme pasla)
      return { isDuplicate: false, lockHash: hash };
    }
  }
}
