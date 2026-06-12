import { logger } from "../src/lib/core/logger";

async function runTest() {
  console.log("=== STARTING TELEMETRY CONTEXT TEST ===");

  const capturedPayloads: any[] = [];
  const originalConsoleLog = console.log;

  // Intercept console.log to capture structured logger JSON outputs
  console.log = (message: any, ...optionalParams: any[]) => {
    if (typeof message === "string") {
      try {
        const parsed = JSON.parse(message);
        capturedPayloads.push(parsed);
      } catch (_) {
        // Fallback for regular text logs
      }
    }
    originalConsoleLog(message, ...optionalParams);
  };

  // Temporarily force production mode to print JSON logs
  const originalEnv = process.env.NODE_ENV;
  process.env.NODE_ENV = "production";

  // Test 1: Global Context Logging
  const cronLog = logger.withContext({ module: "TestModule" });
  cronLog.info("Global test log message", {
    tenantId: "system_scheduler",
    conversationId: "cron_sync_no_conversation"
  });

  // Test 2: Inbound Webhook Processing context logging
  const webhookLog = logger.withContext({ module: "WebhookModule" });
  webhookLog.info("Ingesting message log", {
    tenantId: "some-tenant-uuid",
    conversationId: "conversation_pending_resolution"
  });

  // Test 3: Status receipt context logging
  const workerLog = logger.withContext({ module: "QueueWorker" });
  workerLog.info("Worker status update log", {
    tenantId: "some-tenant-uuid",
    conversationId: "status_receipt_no_conversation"
  });

  // Revert console.log and NODE_ENV
  console.log = originalConsoleLog;
  process.env.NODE_ENV = originalEnv;

  // Assertions
  console.log("\nAnalyzing captured JSON log payloads:");
  console.log(JSON.stringify(capturedPayloads, null, 2));

  if (capturedPayloads.length !== 3) {
    console.error(`❌ Expected 3 captured payloads, got ${capturedPayloads.length}`);
    process.exit(1);
  }

  const p1 = capturedPayloads[0];
  if (p1.tenantId !== "system_scheduler" || p1.conversationId !== "cron_sync_no_conversation") {
    console.error("❌ Test 1 Failed: Context variables did not populate correctly");
    process.exit(1);
  }
  console.log("✅ Test 1 Passed (Global Context Sentinel)");

  const p2 = capturedPayloads[1];
  if (p2.tenantId !== "some-tenant-uuid" || p2.conversationId !== "conversation_pending_resolution") {
    console.error("❌ Test 2 Failed: Context variables did not populate correctly");
    process.exit(1);
  }
  console.log("✅ Test 2 Passed (Webhook Context Sentinel)");

  const p3 = capturedPayloads[2];
  if (p3.tenantId !== "some-tenant-uuid" || p3.conversationId !== "status_receipt_no_conversation") {
    console.error("❌ Test 3 Failed: Context variables did not populate correctly");
    process.exit(1);
  }
  console.log("✅ Test 3 Passed (Worker Status Sentinel)");

  // Verify compilation of target routes/services
  console.log("\nVerifying module imports:");
  try {
    await import("../src/app/api/cron-form-sync/route");
    console.log("   ✅ cron-form-sync route compiles");

    await import("../src/lib/services/automation/no-reply-automation.service");
    console.log("   ✅ no-reply-automation service compiles");

    await import("../src/app/api/webhooks/360dialog/route");
    console.log("   ✅ 360dialog webhook route compiles");

    await import("../src/app/api/follow-up/route");
    console.log("   ✅ follow-up cron route compiles");
  } catch (err: any) {
    console.error(`❌ Module compilation failed: ${err.message}`);
    process.exit(1);
  }

  console.log("\n=== ALL TELEMETRY CONTEXT TESTS PASSED SUCCESSFULLY! ===");
}

runTest().catch((err) => {
  console.error("Test failed with error:", err);
  process.exit(1);
});
