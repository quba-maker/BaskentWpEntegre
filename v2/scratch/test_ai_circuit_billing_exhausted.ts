// ==========================================
// QUBA AI — Spend Cap & Circuit Breaker Stabilization Test
// Run: npx tsx scratch/test_ai_circuit_billing_exhausted.ts
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

// Set mock environment variables
process.env.UPSTASH_REDIS_REST_URL = "https://mock-redis.upstash.io";
process.env.UPSTASH_REDIS_REST_TOKEN = "mock-token";
process.env.GEMINI_API_KEY = "mock-gemini-key";
process.env.ENABLE_SELECTED_AUTOPILOT = "true";

const tenantAId = "11111111-1111-1111-1111-111111111111";
const tenantBId = "22222222-2222-2222-2222-222222222222";

// Store for mocked Redis
const redisStore: Record<string, string> = {};

// Store for mock fetch handler behavior
let geminiResponseStatus = 200;
let geminiResponseBody = {};

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
  
  if (urlStr.includes("generativelanguage.googleapis.com")) {
    return new Response(
      JSON.stringify(geminiResponseBody),
      { status: geminiResponseStatus, headers: { "Content-Type": "application/json" } }
    );
  }
  
  return originalFetch(url, init);
};

// Mock Database
const dbQueries: { text: string; values?: any[] }[] = [];
const mockDb = {
  executeSafe: async (query: any, values?: any[]) => {
    const qText = typeof query === "string" ? query : (query?.text || "");
    const qValues = typeof query === "string" ? values : (query?.values || []);
    dbQueries.push({ text: qText, values: qValues });
    
    const normalized = qText.toLowerCase().replace(/\s+/g, ' ');

    if (normalized.includes("insert into customer_profiles")) {
      return [{ id: "customer-123" }];
    }
    if (normalized.includes("select id, first_name, primary_phone from customer_profiles")) {
      return []; // Return empty to force creation
    }
    if (normalized.includes("with lock_acquire")) {
      return [{ dup_id: null, msg_id: "msg-123", conv_id: "conv-123" }];
    }
    if (normalized.includes("select cg.status as group_status")) {
      return [{ group_status: "active" }];
    }
    if (normalized.includes("from channels c") || normalized.includes("join channel_groups")) {
      return [{
        channel_id: "channel-123",
        provider: "whatsapp",
        identifier: "905554443322",
        group_id: "group-123",
        tenant_id: tenantAId,
        tenant_slug: "tenant-a",
        tenant_name: "Tenant A",
        meta_app_id: "app-123",
        meta_app_secret: "secret-123",
        instagram_app_secret: "ig-secret-123",
        plan: "pro",
        status: "active",
        industry: "healthcare",
        whatsapp_phone_id: "phone-123",
        whatsapp_business_id: "waba-123",
        meta_page_id: "page-123",
        instagram_id: "ig-123",
        credentials_encrypted: JSON.stringify({ accessToken: "mock-access-token" })
      }];
    }
    if (normalized.includes("from channel_prompts")) {
      return [{
        prompt_id: "prompt-123",
        prompt_name: "System Prompt",
        prompt_text: "You are a healthcare assistant.",
        prompt_type: "system",
        version: 1,
        knowledge_prices: "",
        knowledge_rules: "",
        is_active: true
      }];
    }
    if (normalized.includes("from channel_ai_profiles")) {
      return [{
        id: "profile-123",
        ai_model: "gemini-2.5-flash",
        temperature: 0.7,
        aggression_level: "medium",
        business_hours_json: {},
        max_messages: 10,
        max_response_tokens: 1000,
        auto_greeting: true,
        greeting_language: "tr",
        follow_up_enabled: true,
        response_delay_seconds: 5,
        response_style: "balanced"
      }];
    }
    if (normalized.includes("select c.phone_number, c.active_opportunity_id")) {
      return [{
        phone_number: "905551112233",
        active_opportunity_id: "opp-123",
        current_notes: "",
        current_opp_summary: "",
        requester_name: "Test Patient",
        patient_name: "Test Patient",
        country: "Turkey",
        department: "Genel",
        patient_relation: "self",
        opp_metadata: {}
      }];
    }
    if (normalized.includes("select * from messages")) {
      return [
        { content: "Merhaba randevu istiyorum", direction: "in", created_at: new Date() }
      ];
    }
    if (normalized.includes("select id, status, autopilot_enabled")) {
      return [{
        id: "conv-123",
        status: "open",
        autopilot_enabled: true,
        channel_id: "channel-123",
        lead_stage: "new"
      }];
    }
    if (normalized.includes("select credentials from tenant_integrations")) {
      return [];
    }
    if (normalized.includes("select name from tenants")) {
      return [{ name: "Tenant A" }];
    }
    if (normalized.includes("select id, name, slug from tenants")) {
      return [{ id: tenantAId, name: "Tenant A", slug: "tenant-a" }];
    }
    if (normalized.includes("select id from channel_groups")) {
      return [{ id: "group-123" }];
    }
    if (normalized.includes("select provider_message_id, content from messages")) {
      return [{ provider_message_id: "msg-123", content: "Yardım edin" }];
    }
    if (normalized.includes("select id from messages") && normalized.includes("direction = 'out'")) {
      return [];
    }
    if (normalized.includes("select created_at from messages")) {
      return [];
    }
    return [];
  }
};
(global as any).mockDb = mockDb;

// Target service placeholders for dynamic import
let AIOrchestrator: any;
let AIBillingExhaustedError: any;
let AIQuotaExhaustedError: any;
let AICircuitOpenError: any;
let MemoryEngine: any;
let queueWorkerEngine: any;

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

// Clear Redis Mock State
function clearRedis() {
  for (const key in redisStore) {
    delete redisStore[key];
  }
}

async function runTests() {
  console.log("🧪 Starting Spend Cap & Circuit Breaker Stabilization Tests...");

  // Load modules dynamically to make sure process.env mock is set
  const orchestratorModule = await import("../src/lib/services/ai/orchestrator");
  AIOrchestrator = orchestratorModule.AIOrchestrator;
  AIBillingExhaustedError = orchestratorModule.AIBillingExhaustedError;
  AIQuotaExhaustedError = orchestratorModule.AIQuotaExhaustedError;
  AICircuitOpenError = orchestratorModule.AICircuitOpenError;

  const memoryModule = await import("../src/lib/services/ai/engines/memory");
  MemoryEngine = memoryModule.MemoryEngine;

  const workerModule = await import("../src/lib/queue/worker");
  queueWorkerEngine = workerModule.queueWorkerEngine;

  // 1. Error Classification Tests
  await runTest("1. Gemini Spend Cap Exceeded -> AIBillingExhaustedError fırlatılmalı", async () => {
    clearRedis();
    geminiResponseStatus = 429;
    geminiResponseBody = {
      error: {
        code: 429,
        message: "RESOURCE_EXHAUSTED: Your project has exceeded its monthly spending cap",
        status: "RESOURCE_EXHAUSTED"
      }
    };
    
    const orchestrator = new AIOrchestrator();
    try {
      await orchestrator.generateResponse([{ role: "user", content: "test" }], {
        provider: "gemini",
        modelId: "gemini-2.5-flash",
        apiKey: "test-key",
        temperature: 0.7,
        maxTokens: 100
      }, tenantAId, "conv-123");
      assert(false, "Spend cap hatası fırlatılamadı");
    } catch (e) {
      assert(e instanceof AIBillingExhaustedError, `Hata türü AIBillingExhaustedError olmalı. Alınan: ${e}`);
    }
  });

  await runTest("2. Gemini Quota Exhausted -> AIQuotaExhaustedError fırlatılmalı", async () => {
    clearRedis();
    geminiResponseStatus = 429;
    geminiResponseBody = {
      error: {
        code: 429,
        message: "RESOURCE_EXHAUSTED: Quota exceeded for Generate Content Requests per minute",
        status: "RESOURCE_EXHAUSTED"
      }
    };
    
    const orchestrator = new AIOrchestrator();
    try {
      await orchestrator.generateResponse([{ role: "user", content: "test" }], {
        provider: "gemini",
        modelId: "gemini-2.5-flash",
        apiKey: "test-key",
        temperature: 0.7,
        maxTokens: 100
      }, tenantAId, "conv-123");
      assert(false, "Quota hatası fırlatılamadı");
    } catch (e) {
      assert(e instanceof AIQuotaExhaustedError, `Hata türü AIQuotaExhaustedError olmalı. Alınan: ${e}`);
    }
  });

  // 2. Circuit Breaker Tenant Isolation Tests
  await runTest("3. Tenant A circuit breaker tripped (OPEN) iken Tenant B etkilenmemeli", async () => {
    clearRedis();
    // Simulate Tenant A circuit OPEN
    redisStore[`circuit_breaker:gemini:${tenantAId}:state`] = "OPEN";
    
    const orchestrator = new AIOrchestrator();
    
    // Tenant A call must fail immediately with AICircuitOpenError
    try {
      await orchestrator.generateResponse([{ role: "user", content: "test" }], {
        provider: "gemini",
        modelId: "gemini-2.5-flash",
        apiKey: "test-key",
        temperature: 0.7,
        maxTokens: 100
      }, tenantAId, "conv-123");
      assert(false, "Tenant A için circuit breaker tetiklenmedi");
    } catch (e) {
      assert(e instanceof AICircuitOpenError, `Tenant A hatası AICircuitOpenError olmalı. Alınan: ${e}`);
    }

    // Tenant B call must succeed (Gemini returns status 200)
    geminiResponseStatus = 200;
    geminiResponseBody = {
      candidates: [{
        content: {
          parts: [{ text: "Normal response" }]
        },
        finishReason: "STOP"
      }]
    };

    const resB = await orchestrator.generateResponse([{ role: "user", content: "test" }], {
      provider: "gemini",
      modelId: "gemini-2.5-flash",
      apiKey: "test-key",
      temperature: 0.7,
      maxTokens: 100
    }, tenantBId, "conv-456");
    
    assert(resB.text === "Normal response", "Tenant B başarıyla çağrı yapabilmeli");
  });

  // 3. MemoryEngine structured JSON fallback skip tests
  await runTest("4. MemoryEngine circuit open iken summary skip etmeli ve controlled result dönmeli", async () => {
    clearRedis();
    redisStore[`circuit_breaker:gemini:${tenantAId}:state`] = "OPEN";

    const memRes = await MemoryEngine.summarizeConversation(tenantAId, "conv-123");
    
    assert(memRes && memRes.skipped === true, "MemoryEngine summary skip edilmeli");
    assert(memRes && memRes.reason === "AI_UNAVAILABLE", "Skip nedeni AI_UNAVAILABLE olmalı");
  });

  // 4. Queue worker recovery and human handoff validation
  await runTest("5. Queue worker AI unavailable yakaladığında conversation'ı human handoff'a almalı", async () => {
    clearRedis();
    dbQueries.length = 0; // reset query ledger
    
    // Force circuit breaker OPEN for worker call
    redisStore[`circuit_breaker:gemini:${tenantAId}:state`] = "OPEN";

    const payload = {
      entry: [{
        changes: [{
          value: {
            messages: [{
              from: "905551112233", // Customer number, not the business number!
              id: "msg-123",
              type: "text",
              text: { body: "Yardım edin" },
              timestamp: "1720000000"
            }],
            contacts: [{ profile: { name: "Test Patient" } }]
          }
        }]
      }],
      targetMessageId: "msg-123" // Set targetMessageId for delayed/debounced processing
    };

    const metadata = { messageId: "msg-123", attempts: 1, channelId: "channel-123", isRetry: false, retriedCount: 0 };
    
    // We run queueWorkerEngine's delayed handler directly to test the LLM execution path
    await (queueWorkerEngine as any).handleIncomingMessageDelayed(tenantAId, payload, metadata, "whatsapp");

    // Verify database updates inside conversation:
    // It must set status = 'human' and autopilot_enabled = false
    const updateQuery = dbQueries.find(q => q.text.includes("UPDATE conversations") && q.text.includes("status = 'human'") && q.text.includes("autopilot_enabled = false"));
    assert(!!updateQuery, "Conversation status 'human' and autopilot_enabled = false olarak güncellenmeli");
    
    // It must insert a system message alerting the coordinator
    const sysMsgQuery = dbQueries.find(q => q.text.includes("INSERT INTO messages") && q.text.includes("'system'"));
    assert(!!sysMsgQuery, "Sistem mesajı eklenmeli");
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
