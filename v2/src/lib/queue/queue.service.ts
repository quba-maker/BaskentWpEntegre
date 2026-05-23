import { logger } from "@/lib/core/logger";
import { Client } from "@upstash/qstash";

const qstash = new Client({ token: process.env.QSTASH_TOKEN || "" });

import { getTraceContext } from "@/lib/core/trace-context";

export interface QueueMessage<T = any> {
  id: string;
  traceId?: string;
  tenantId: string;
  channelId?: string; // NEW V2 Routing
  groupId?: string;   // NEW V2 Routing
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

  public async publish<T>(
    tenantId: string, 
    topic: string, 
    payload: T, 
    options?: { delayMs?: number; channelId?: string; groupId?: string }
  ): Promise<string> {
    const traceCtx = getTraceContext();
    const traceId = traceCtx?.traceId;

    const message: QueueMessage<T> = {
      id: crypto.randomUUID(), // Internal correlation ID
      traceId,
      tenantId,
      channelId: options?.channelId,
      groupId: options?.groupId,
      topic,
      payload,
      timestamp: Date.now()
    };

    if (!process.env.QSTASH_TOKEN) {
      this.log.warn("QSTASH_TOKEN is not set. Simulating queue publish locally via direct API call...", { topic, tenantId });
      
      const localUrl = `http://localhost:${process.env.PORT || 3000}/api/queue-worker`;
      fetch(localUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-tenant-id": tenantId,
          "x-topic": topic,
          ...(traceId ? { "x-trace-id": traceId } : {})
        },
        body: JSON.stringify(message)
      })
      .then(async (res) => {
        const text = await res.text();
        if (res.ok) {
          this.log.info(`[QueueService] Local simulation dispatch success: ${res.status}`, { topic, response: text });
        } else {
          this.log.error(`[QueueService] Local simulation dispatch rejected: ${res.status}`, new Error(text), { topic });
        }
      })
      .catch(err => {
        this.log.error("[QueueService] Local simulation dispatch network failed:", err);
      });

      return "simulated-" + message.id;
    }

    try {
      const { getPublicBaseUrl } = await import('@/lib/core/url');
      const baseUrl = getPublicBaseUrl();
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
        delay: options?.delayMs ? Math.max(1, Math.round(options.delayMs / 1000)) : undefined,
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
