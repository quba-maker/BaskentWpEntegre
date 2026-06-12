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
      // Single transaction boundary CTE for locking, deduplication, and insertion
      const result = await this.db.executeSafe({
        text: `
          WITH lock_acquire AS (
            SELECT pg_advisory_xact_lock($1)
          ), dup_check AS (
            SELECT 1 FROM webhook_events 
            WHERE tenant_id = $2 
              AND provider = $3 
              AND provider_message_id = $4
          ), ins AS (
            INSERT INTO webhook_events (tenant_id, provider, provider_message_id, sender_id, event_timestamp)
            SELECT $2, $3, $4, $5, $6
            WHERE NOT EXISTS (SELECT 1 FROM dup_check)
            RETURNING 1
          )
          SELECT (SELECT 1 FROM dup_check) IS NOT NULL as is_duplicate;
        `,
        values: [
          hash,
          this.db.tenantId,
          payload.provider,
          payload.providerMessageId,
          payload.senderId,
          payload.timestamp || 0
        ]
      }) as any[];

      const isDuplicate = result && result.length > 0 ? result[0].is_duplicate : false;
      const isStatusReceipt = payload.providerMessageId.includes('_delivered') || 
                              payload.providerMessageId.includes('_read') || 
                              payload.providerMessageId.includes('_sent') || 
                              payload.providerMessageId.includes('_failed');
      const conversationId = isStatusReceipt ? 'status_receipt_no_conversation' : undefined;

      if (isDuplicate) {
        this.log.warn(`🛑 Duplicate Webhook Suppressed!`, { 
          tenantId: this.db.tenantId,
          conversationId,
          payload 
        });
        return { isDuplicate: true, lockHash: hash };
      }

      // 5. Ordering Protection (Eski timestamp kontrolü)
      if (payload.timestamp) {
        const lastEvent = await this.db.executeSafe({
          text: `
            SELECT event_timestamp FROM webhook_events 
            WHERE tenant_id = $1 
              AND provider = $2 
              AND sender_id = $3
            ORDER BY event_timestamp DESC LIMIT 1
          `,
          values: [this.db.tenantId, payload.provider, payload.senderId]
        }) as any[];

        if (lastEvent && lastEvent.length > 0 && lastEvent[0].event_timestamp > payload.timestamp) {
          this.log.warn(`⚠️ Out-of-order webhook detected!`, { 
            tenantId: this.db.tenantId,
            conversationId,
            last: lastEvent[0].event_timestamp, 
            incoming: payload.timestamp 
          });
        }
      }

      return { isDuplicate: false, lockHash: hash };
    } catch (e: any) {
      const isStatusReceipt = payload.providerMessageId.includes('_delivered') || 
                              payload.providerMessageId.includes('_read') || 
                              payload.providerMessageId.includes('_sent') || 
                              payload.providerMessageId.includes('_failed');
      const conversationId = isStatusReceipt ? 'status_receipt_no_conversation' : undefined;
      this.log.error('Dedupe Check Error', e, { 
        tenantId: this.db.tenantId,
        conversationId
      });
      // Hata durumunda fail-open davran (eski sisteme pasla)
      return { isDuplicate: false, lockHash: hash };
    }
  }
}

