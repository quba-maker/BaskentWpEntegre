import { NextResponse } from "next/server";
import { Receiver } from "@upstash/qstash";
import { logger } from "@/lib/core/logger";
import { queueWorkerEngine } from "@/lib/queue/worker";

const receiver = new Receiver({
  currentSigningKey: process.env.QSTASH_CURRENT_SIGNING_KEY || "",
  nextSigningKey: process.env.QSTASH_NEXT_SIGNING_KEY || "",
});

export async function POST(req: Request) {
  const log = logger.withContext({ module: 'QueueWorker' });
  let body: any;

  try {
    // 1. Verify QStash Signature (Zero-Trust Security)
    const signature = req.headers.get("Upstash-Signature");
    
    if (process.env.QSTASH_CURRENT_SIGNING_KEY && signature) {
      const bodyText = await req.clone().text();
      const isValid = await receiver.verify({
        signature,
        body: bodyText,
      });

      if (!isValid) {
        log.warn("Invalid QStash signature detected");
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
      }
    } else if (process.env.QSTASH_CURRENT_SIGNING_KEY && !signature) {
      log.warn("Missing QStash signature");
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    } else {
      log.warn("Skipping QStash signature verification (Missing env variables)");
    }

    // 2. Parse Body & Headers
    body = await req.json();
    const { id, traceId: bodyTraceId, tenantId, topic, payload } = body;
    
    const traceId = req.headers.get("x-trace-id") || bodyTraceId || crypto.randomUUID();

    const { runWithTrace } = await import("@/lib/core/trace-context");

    return runWithTrace({ traceId, tenantId }, async () => {
      // Upstash injects these headers if it's a retry
      const retriedCount = parseInt(req.headers.get("Upstash-Retried") || "0", 10);
      const isRetry = retriedCount > 0;

      // 3. Hand over execution to the Engine
      await queueWorkerEngine.processEvent(
        topic,
        tenantId,
        payload,
        { messageId: id, isRetry, retriedCount }
      );

      // 4. Fast-Ack Success
      return NextResponse.json({ success: true, messageId: id });
    });

  } catch (error: any) {
    log.error("[QUEUE WORKER ERROR] Pipeline failed", error);
    
    const retriedCount = parseInt(req.headers.get("Upstash-Retried") || "0", 10);
    if (retriedCount >= 3 && body) {
      // 5. DLQ Handling when auto-retries are exhausted
      await queueWorkerEngine.moveToDLQ(body.topic, body.tenantId, body.payload, error);
    }
    
    // Returning 500 triggers QStash exponential backoff retry mechanism
    return NextResponse.json({ error: "Processing failed" }, { status: 500 });
  }
}
