import { logger } from "@/lib/core/logger";

/**
 * Enterprise Queue Worker Engine
 * Abstracted worker logic to keep API routes clean and testable.
 */
export class QueueWorkerEngine {
  private log = logger.withContext({ module: 'QueueWorkerEngine' });

  /**
   * Processes incoming events from QStash or generic message queues.
   */
  public async processEvent(
    topic: string, 
    tenantId: string, 
    payload: any, 
    metadata: { messageId: string, isRetry: boolean, retriedCount: number }
  ) {
    this.log.info(`[WORKER] Initiating execution for topic: ${topic}`, metadata);

    switch (topic) {
      case "whatsapp.message.received":
        await this.handleWhatsAppMessage(tenantId, payload);
        break;
      
      case "meta.webhook.fallback":
        this.log.info("Handling meta.webhook.fallback", { tenantId, payload });
        break;

      default:
        this.log.warn(`[WORKER] Unknown topic received, skipping execution. Topic: ${topic}`);
    }
  }

  /**
   * Domain-specific handler for WhatsApp Messages
   */
  private async handleWhatsAppMessage(tenantId: string, payload: any) {
    this.log.info(`[WORKER] Processing WhatsApp message for tenant ${tenantId}`, { payload });
    // TODO: Connect this to the actual LLM / Conversation service
  }

  /**
   * Manual DLQ Logging mechanism for when Upstash auto-retries are exhausted.
   * Ensures no message is ever silently dropped.
   */
  public async moveToDLQ(topic: string, tenantId: string, payload: any, error: any) {
    const errObj = error instanceof Error ? error : new Error(String(error));
    this.log.error(`[DLQ] Moving failed event to Dead Letter Queue`, errObj, {
      topic,
      tenantId,
      payload
    });
    // TODO: In Phase 2, persist this to a `dead_letter_jobs` table in Postgres for Observability Dashboard
  }
}

export const queueWorkerEngine = new QueueWorkerEngine();
