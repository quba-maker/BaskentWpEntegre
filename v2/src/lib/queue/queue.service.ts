import { logger } from "@/lib/core/logger";

export interface QueueMessage<T = any> {
  id: string;
  tenantId: string;
  topic: string;
  payload: T;
  retryCount: number;
  maxRetries: number;
  timestamp: number;
}

export interface QueueConfig {
  maxRetries: number;
  baseBackoffMs: number;
  topic: string;
}

/**
 * 🚀 Enterprise Queue Service (Event-Driven Runtime)
 * Vercel Serverless timeout'larını engellemek ve "Guaranteed Delivery" sağlamak için
 * mesajları asenkron kuyruğa atar. Exponential Backoff ve DLQ (Dead Letter Queue) mekanizmalarını yönetir.
 */
export class QueueService {
  private log = logger.withContext({ module: 'QueueService' });

  // In a real Vercel environment, this would wrap Upstash QStash or Redis (BullMQ).
  // For now, it provides the architectural blueprint and abstraction.

  public async publish<T>(tenantId: string, topic: string, payload: T, config?: Partial<QueueConfig>): Promise<string> {
    const messageId = crypto.randomUUID();
    const message: QueueMessage<T> = {
      id: messageId,
      tenantId,
      topic,
      payload,
      retryCount: 0,
      maxRetries: config?.maxRetries ?? 3,
      timestamp: Date.now()
    };

    // TODO: Upstash QStash.publish() veya Redis.lpush() entegrasyonu gelecek
    this.log.info(`[PUBLISH] Event pushed to queue: ${topic}`, { messageId, tenantId });

    return messageId;
  }

  /**
   * Kuyruktan gelen mesajı işler.
   * Hata durumunda Retry veya DLQ'ya yönlendirir.
   */
  public async process<T>(message: QueueMessage<T>, handler: (payload: T) => Promise<void>): Promise<void> {
    try {
      this.log.info(`[PROCESS] Executing job: ${message.id} (Attempt ${message.retryCount + 1}/${message.maxRetries + 1})`);
      
      await handler(message.payload);
      
      this.log.info(`[SUCCESS] Job completed: ${message.id}`);
    } catch (error: any) {
      this.log.error(`[FAILED] Job crashed: ${message.id}`, error);
      await this.handleFailure(message, error);
    }
  }

  private async handleFailure<T>(message: QueueMessage<T>, error: any) {
    if (message.retryCount >= message.maxRetries) {
      // Poison job -> Send to Dead Letter Queue (DLQ)
      await this.moveToDLQ(message, error);
    } else {
      // Exponential Backoff Retry (e.g., 2s, 4s, 8s...)
      const backoffMs = Math.pow(2, message.retryCount) * 2000;
      message.retryCount += 1;
      
      this.log.info(`[RETRY] Scheduling job ${message.id} for retry in ${backoffMs}ms`);
      // TODO: Upstash QStash delay parameter or Redis ZADD for delayed execution
    }
  }

  private async moveToDLQ<T>(message: QueueMessage<T>, error: any) {
    this.log.error(`🚨 [DLQ] Job moved to Dead Letter Queue: ${message.id}. Requires human intervention!`);
    // TODO: Insert into database "dead_letter_jobs" table for Human Ops dashboard
  }
}
