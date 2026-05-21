import { NextResponse } from "next/server";
import { Receiver } from "@upstash/qstash";
import { logger } from "@/lib/core/logger";
import { queueWorkerEngine } from "@/lib/queue/worker";
import fs from "fs";
import path from "path";

// Initialize global debug logs in dev
if (!global.debugLogs) {
  global.debugLogs = [];
}
function addLog(entry: any) {
  global.debugLogs = global.debugLogs || [];
  global.debugLogs.push({
    timestamp: new Date().toISOString(),
    ...entry
  });
  if (global.debugLogs.length > 200) global.debugLogs.shift();
}

const receiver = new Receiver({
  currentSigningKey: process.env.QSTASH_CURRENT_SIGNING_KEY || "",
  nextSigningKey: process.env.QSTASH_NEXT_SIGNING_KEY || "",
});

export const maxDuration = 60; // Allow 60s for AI completion to prevent Vercel 504 timeouts

export async function POST(req: Request) {
  const log = logger.withContext({ module: 'QueueWorker' });
  let body: any;
  
  addLog({ stage: "POST_RECEIVED", method: req.method, url: req.url });

  try {
    const signature = req.headers.get("Upstash-Signature");
    const isDev = process.env.NODE_ENV === "development" || !process.env.QSTASH_TOKEN;
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
    } else if (process.env.QSTASH_CURRENT_SIGNING_KEY && !signature && !isDev) {
      log.warn("Missing QStash signature");
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    } else {
      log.info("Skipping QStash signature verification (Local development / Simulation mode)");
    }

    // 2. Parse Body & Headers
    body = await req.json();
    const { id, traceId: bodyTraceId, tenantId, topic, payload } = body;
    
    const traceId = req.headers.get("x-trace-id") || bodyTraceId || crypto.randomUUID();

    const { runWithTrace } = await import("@/lib/core/trace-context");

    return await runWithTrace({ traceId, tenantId }, async () => {
      // Upstash injects these headers if it's a retry
      const retriedCount = parseInt(req.headers.get("Upstash-Retried") || "0", 10);
      const isRetry = retriedCount > 0;

      // 3. Hand over execution to the Engine
      await queueWorkerEngine.processEvent(
        topic,
        tenantId,
        payload,
        { messageId: id, isRetry, retriedCount, channelId: body.channelId, groupId: body.groupId }
      );

      // 4. Fast-Ack Success
      return NextResponse.json({ success: true, messageId: id });
    });

  } catch (error: any) {
    log.error("[QUEUE WORKER ERROR] Pipeline failed", error);
    
    addLog({ 
      stage: "CATCH_BLOCK", 
      errorMessage: error?.message, 
      errorStack: error?.stack, 
      bodyPayload: body 
    });
    
    try {
      fs.writeFileSync(
        "/tmp/worker-debug.json",
        JSON.stringify({
          timestamp: new Date().toISOString(),
          error: error?.message || "Unknown error",
          stack: error?.stack || "No stack trace available",
          body: body || null
        }, null, 2)
      );
    } catch (fsErr: any) {
      log.error("Failed to write debug log file to /tmp/worker-debug.json", fsErr);
    }
    
    const retriedCount = parseInt(req.headers.get("Upstash-Retried") || "0", 10);
    if (retriedCount >= 3 && body) {
      // 5. DLQ Handling when auto-retries are exhausted
      await queueWorkerEngine.moveToDLQ(body.topic, body.tenantId, body.payload, error);
    }
    
    // Return a guaranteed safe Response format to prevent JSON stringify issues on circular reference error objects
    const responsePayload = JSON.stringify({
      error: "Processing failed",
      message: String(error?.message || error),
      stack: String(error?.stack || "")
    });
    
    return new Response(responsePayload, {
      status: 500,
      headers: { "Content-Type": "application/json" }
    });
  }
}
