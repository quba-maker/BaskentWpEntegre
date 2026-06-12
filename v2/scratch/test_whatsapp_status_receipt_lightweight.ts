// ==========================================
// QUBA AI — WhatsApp Status Receipt Lightweight Verification Test
// Run: npx tsx scratch/test_whatsapp_status_receipt_lightweight.ts
// ==========================================

// Mock neondatabase serverless at require level before any imports
try {
  const neonPath = require.resolve("@neondatabase/serverless");
  require.cache[neonPath] = {
    id: neonPath,
    filename: neonPath,
    loaded: true,
    exports: {
      neon: () => {
        return (strings: any, ...values: any[]) => {
          let text = strings[0];
          for (let i = 1; i < strings.length; i++) {
            text += `$${i}` + strings[i];
          }
          return { text, values };
        };
      }
    }
  } as any;
} catch (e) {
  console.warn("Could not mock @neondatabase/serverless require cache:", e);
}

import { NextRequest } from "next/server";

// Set mock environment variables
process.env.UPSTASH_REDIS_REST_URL = "https://mock-redis.upstash.io";
process.env.UPSTASH_REDIS_REST_TOKEN = "mock-token";
process.env.QSTASH_TOKEN = "mock-token";
process.env.GEMINI_API_KEY = "mock-gemini-key";

// Use a custom UUID that doesn't trigger maskPII phone/TC formatting
const tenantIdVal = "a1b2c3d4-e5f6-7a8b-9c0d-1e2f3a4b5c6d";

// Store for mocked Redis deduplication state
const redisStore: Record<string, string> = {};

// Mock fetch
const originalFetch = global.fetch;
global.fetch = async (url: string | URL, init?: RequestInit): Promise<Response> => {
  const urlStr = String(url);
  
  if (urlStr.startsWith("https://mock-redis.upstash.io")) {
    const path = urlStr.replace("https://mock-redis.upstash.io/", "");
    const parts = path.split("?")[0].split("/");
    const cmd = parts[0];
    
    if (cmd === "get") {
      const key = parts[1];
      const val = redisStore[key] || null;
      return new Response(JSON.stringify({ result: val }));
    }
    if (cmd === "set") {
      const key = parts[1];
      const val = parts[2];
      redisStore[key] = val;
      return new Response(JSON.stringify({ result: "OK" }));
    }
    if (cmd === "incr") {
      const key = parts[1];
      const val = parseInt(redisStore[key] || "0", 10) + 1;
      redisStore[key] = String(val);
      return new Response(JSON.stringify({ result: val }));
    }
    if (cmd === "del") {
      const key = parts[1];
      delete redisStore[key];
      return new Response(JSON.stringify({ result: 1 }));
    }
    if (cmd === "expire") {
      return new Response(JSON.stringify({ result: 1 }));
    }
  }
  
  return originalFetch(url, init);
};

// Spies for heavy components
let orchestratorCalled = false;
let brainResolverCalled = false;
let memoryEngineCalled = false;

// Mock database deduplication events
const processedWebhookEvents = new Set<string>();

// Mock Database
const dbQueries: { text: string; values?: any[] }[] = [];
const mockDb = {
  tenantId: tenantIdVal,
  executeSafe: async (query: any, values?: any[]) => {
    const qText = typeof query === "string" ? query : (query?.text || "");
    const qValues = typeof query === "string" ? values : (query?.values || []);
    dbQueries.push({ text: qText, values: qValues });
    
    const normalized = qText.toLowerCase().replace(/\s+/g, ' ');

    if (normalized.includes("select c.id as channel_id") || normalized.includes("from channels c")) {
      return [{
        channel_id: "channel-123",
        provider: "whatsapp",
        identifier: "905554443322",
        group_id: "group-123",
        tenant_id: tenantIdVal,
        tenant_slug: "baskent",
        tenant_status: "active"
      }];
    }
    if (normalized.includes("insert into channel_events")) {
      return [{ id: 1 }];
    }
    if (normalized.includes("update messages")) {
      return [{ id: 123, phone_number: "905551112233" }];
    }
    if (normalized.includes("update conversations")) {
      return [{ id: "conv-123" }];
    }
    if (normalized.includes("webhook_events")) {
      const providerMsgId = qValues?.[3];
      if (providerMsgId) {
        if (processedWebhookEvents.has(providerMsgId)) {
          return [{ is_duplicate: true }];
        } else {
          processedWebhookEvents.add(providerMsgId);
          return [{ is_duplicate: false }];
        }
      }
      return [{ is_duplicate: false }];
    }
    return [];
  }
};
(global as any).mockDb = mockDb;

const results: { name: string; passed: boolean; error?: string }[] = [];

async function runTest(name: string, fn: () => Promise<void>) {
  try {
    await fn();
    results.push({ name, passed: true });
    console.log(`✅ [PASSED] ${name}`);
  } catch (e: any) {
    results.push({ name, passed: false, error: e.message });
    console.log(`❌ [FAILED] ${name} - Error: ${e.stack || e.message}`);
  }
}

function assert(condition: boolean, msg: string) {
  if (!condition) throw new Error(msg);
}

// Clear state
function clearState() {
  for (const key in redisStore) {
    delete redisStore[key];
  }
  processedWebhookEvents.clear();
  dbQueries.length = 0;
  orchestratorCalled = false;
  brainResolverCalled = false;
  memoryEngineCalled = false;
}

// Custom spies/mocks for the test run
async function setupSpies() {
  const orchestratorModule = require("../src/lib/services/ai/orchestrator");
  const originalGenerate = orchestratorModule.AIOrchestrator.prototype.generateResponse;
  orchestratorModule.AIOrchestrator.prototype.generateResponse = async function(...args: any[]) {
    orchestratorCalled = true;
    return originalGenerate.apply(this, args);
  };

  const brainModule = require("../src/lib/brain/brain-resolver");
  const originalResolve = brainModule.BrainResolver.resolveTenantBrain;
  brainModule.BrainResolver.resolveTenantBrain = async function(...args: any[]) {
    brainResolverCalled = true;
    return originalResolve.apply(this, args);
  };

  const memoryModule = require("../src/lib/services/ai/engines/memory");
  const originalSummarize = memoryModule.MemoryEngine.summarizeConversation;
  memoryModule.MemoryEngine.summarizeConversation = async function(...args: any[]) {
    memoryEngineCalled = true;
    return originalSummarize.apply(this, args);
  };
}

async function runTests() {
  console.log("🧪 Starting Status Receipt Telemetry and Lightweight Pipeline Tests...");
  await setupSpies();

  const workerModule = await import("../src/lib/queue/worker");
  const queueWorkerEngine = workerModule.queueWorkerEngine;

  // Webhook payload mimicking 360dialog status receipt
  const mockStatusPayload = {
    object: "whatsapp_business_account",
    entry: [{
      id: "waba-123",
      changes: [{
        field: "messages",
        value: {
          messaging_product: "whatsapp",
          metadata: {
            display_phone_number: "905554443322",
            phone_number_id: "905554443322"
          },
          statuses: [{
            id: "msg-status-456",
            status: "delivered",
            recipient_id: "905551112233",
            timestamp: "1720000000"
          }]
        }
      }]
    }]
  };

  await runTest("1. delivered status geldiğinde sadece message status ve last_message_status güncellenir, AI/Brain tetiklenmez", async () => {
    clearState();

    const metadata = { messageId: "status-job-123", isRetry: false, retriedCount: 0 };
    await queueWorkerEngine.processEvent("whatsapp.status.received", tenantIdVal, mockStatusPayload, metadata);

    // Verify DB updates
    const messageUpdate = dbQueries.find(q => q.text.includes("UPDATE messages") && q.text.includes("SET status = $1"));
    const convUpdate = dbQueries.find(q => q.text.includes("UPDATE conversations") && q.text.includes("SET last_message_status = $1"));

    assert(!!messageUpdate, "Messages tablosu status için güncellenmeli");
    assert(messageUpdate.values?.[0] === "delivered", "Mesaj statüsü 'delivered' olmalı");
    assert(!!convUpdate, "Conversations tablosu last_message_status için güncellenmeli");
    assert(convUpdate.values?.[0] === "delivered", "Son mesaj statüsü 'delivered' olmalı");

    // Verify heavy processes NOT called
    assert(!orchestratorCalled, "AIOrchestrator status receipt sırasında çağrılmamalı (Lightweight Pipeline)");
    assert(!brainResolverCalled, "BrainResolver status receipt sırasında çağrılmamalı (Lightweight Pipeline)");
    assert(!memoryEngineCalled, "MemoryEngine status receipt sırasında çağrılmamalı (Lightweight Pipeline)");
  });

  await runTest("2. Webhook seviyesinde duplicate status receipt idempotent kalır ve ikinci kez kuyruğa eklenmez", async () => {
    clearState();
    
    // Import 360dialog webhook POST handler
    const webhookModule = await import("../src/app/api/webhooks/360dialog/route");
    
    // Payload directly sent by 360dialog
    const statusWebhookPayload = {
      statuses: [{
        id: "msg-status-456",
        status: "delivered",
        recipient_id: "905551112233",
        timestamp: "1720000000"
      }]
    };

    // First request
    const req1 = new NextRequest("https://localhost/api/webhooks/360dialog?channel_id=channel-123", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(statusWebhookPayload)
    });
    
    const res1 = await webhookModule.POST(req1);
    assert(res1.status === 200, "İlk webhook isteği 200 dönmeli");
    
    // Check if key is set in processedWebhookEvents
    assert(processedWebhookEvents.has("msg-status-456_delivered"), "Deduplication kilidi DB'de set edilmeli");

    // Second request (duplicate)
    const req2 = new NextRequest("https://localhost/api/webhooks/360dialog?channel_id=channel-123", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(statusWebhookPayload)
    });

    const res2 = await webhookModule.POST(req2);
    assert(res2.status === 200, "Duplicate istek de 200 dönmeli");
    
    // Verify it returns EVENT_RECEIVED_DUPLICATE text or handled cleanly
    const text = await res2.text();
    assert(text === "EVENT_RECEIVED_DUPLICATE", `Duplicate isteğe EVENT_RECEIVED_DUPLICATE dönmeli. Alınan: ${text}`);
  });

  await runTest("3. Telemetry context: Status receipt işlenirken loglarda tenantId gerçek ve conversationId sentinel olmalı", async () => {
    clearState();

    const metadata = { messageId: "status-job-123", isRetry: false, retriedCount: 0 };
    
    // Intercept console.log/console.info to catch structured json format log
    const logsCollected: any[] = [];
    const originalConsoleLog = console.log;
    
    console.log = (msg: string, ...args: any[]) => {
      try {
        const parsed = JSON.parse(msg);
        logsCollected.push(parsed);
      } catch (_) {
        // Not JSON structured log
      }
      originalConsoleLog(msg, ...args);
    };

    // Force production-like json logging
    const oldNodeEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = "production";

    try {
      await queueWorkerEngine.processEvent("whatsapp.status.received", tenantIdVal, mockStatusPayload, metadata);
    } finally {
      process.env.NODE_ENV = oldNodeEnv;
      console.log = originalConsoleLog;
    }

    const statusLog = logsCollected.find(l => l.message && l.message.includes("Processing WhatsApp status receipt"));
    assert(!!statusLog, "WA status logu yakalanmalı");
    assert(statusLog.tenantId === tenantIdVal, `tenantId gerçek tenantIdVal olmalı. Alınan: ${statusLog.tenantId}`);
    assert(statusLog.conversationId === "status_receipt_no_conversation", `conversationId status_receipt_no_conversation olmalı. Alınan: ${statusLog.conversationId}`);
  });

  // Print results
  console.log("\n📊 Test Raporu:");
  let allPassed = true;
  for (const r of results) {
    if (r.passed) {
      console.log(`State: PASSED - Test: ${r.name}`);
    } else {
      console.log(`State: FAILED - Test: ${r.name} - Error: ${r.error}`);
      allPassed = false;
    }
  }

  if (allPassed) {
    console.log("\n🎉 Tüm testler başarıyla tamamlandı!");
    process.exit(0);
  } else {
    console.log("\n⚠️ Bazı testler başarısız oldu!");
    process.exit(1);
  }
}

runTests();
