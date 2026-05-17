import { logger } from "@/lib/core/logger";
import { Client } from "@upstash/qstash";

const qstash = new Client({ token: process.env.QSTASH_TOKEN || "" });

import { getTraceContext } from "@/lib/core/trace-context";

export interface QueueMessage<T = any> {
  id: string;
  traceId?: string;
  tenantId: string;
  topic: string;
  payload: T;
  timestamp: number;
}

/**
 * 🚀 Enterprise Queue Service (Event-Driven Runtime)
 * Powered by Upstash QStash.
 * Ensures Guaranteed Delivery, Exponential Backoff, and DLQ tracking.
 */
export class QueueService {
  private log = logger.withContext({ module: 'QueueService' });

  public async publish<T>(tenantId: string, topic: string, payload: T, delayMs?: number): Promise<string> {
    const traceCtx = getTraceContext();
    const traceId = traceCtx?.traceId;

    const message: QueueMessage<T> = {
      id: crypto.randomUUID(), // Internal correlation ID
      traceId,
      tenantId,
      topic,
      payload,
      timestamp: Date.now()
    };

    if (!process.env.QSTASH_TOKEN) {
      this.log.warn("QSTASH_TOKEN is not set. Ensure you configure it for production. Simulating queue publish...", { topic, tenantId });
      return "simulated-" + message.id;
    }

    try {
      // Base URL resolution: prioritize environment variable, fallback to known prod url
      const baseUrl = process.env.NEXT_PUBLIC_APP_URL || process.env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}` : "https://baskent-wp-entegre.vercel.app";
      const endpoint = `${baseUrl}/api/queue-worker`;

      const headers: Record<string, string> = {
        "x-tenant-id": tenantId,
        "x-topic": topic
      };

      if (traceId) {
        headers["x-trace-id"] = traceId;
      }

      const res = await qstash.publishJSON({
        url: endpoint,
        body: message,
        retries: 3, // Auto retry up to 3 times with exponential backoff
        delay: delayMs ? Math.max(1, Math.round(delayMs / 1000)) : undefined,
        headers
      });

      this.log.info(`[PUBLISH] Event pushed to QStash: ${topic}`, { 
        qstashId: res.messageId, 
        internalId: message.id,
        tenantId,
        traceId
      });

      return res.messageId;
    } catch (error: any) {
      this.log.error(`[PUBLISH FAILED] Could not push to QStash`, error);
      throw error;
    }
  }
}
