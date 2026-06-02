import dotenv from "dotenv";
import path from "path";
dotenv.config({ path: path.join(__dirname, "../.env.local") });

// Setup test secret for validation
process.env.THREE_SIXTY_DIALOG_WEBHOOK_SECRET = "super_secure_360dialog_secret_123456";
process.env.THREE_SIXTY_DIALOG_API_KEY_FALLBACK = "test_fallback_api_key_789";
process.env.BLOB_READ_WRITE_TOKEN = "mock_blob_token_123456";

import Module from "module";

const originalRequire = Module.prototype.require;
(Module.prototype as any).require = function (id: string) {
  if (id === "@vercel/blob") {
    return {
      put: async (pathStr: string, buffer: any, options: any) => {
        return { url: `https://blob.vercel-storage.com/${pathStr}` };
      },
      del: async (url: string) => true,
      list: async () => ({ blobs: [] })
    };
  }

  if (id.includes("next/server") || id === "next/server") {
    class MockNextRequest {
      nextUrl: URL;
      url: string;
      headers: Map<string, string>;
      bodyText: string;

      constructor(urlStr: string, options: any = {}) {
        this.nextUrl = new URL(urlStr);
        this.url = urlStr;
        this.headers = new Map();
        if (options.headers) {
          Object.entries(options.headers).forEach(([k, v]) => {
            this.headers.set(k.toLowerCase(), v as string);
          });
        }
        this.bodyText = options.body || "";
      }

      clone() {
        return {
          text: async () => this.bodyText
        };
      }
    }

    class MockNextResponse {
      status: number;
      body: any;
      constructor(body: any, options: any = {}) {
        this.body = body;
        this.status = options.status || 200;
      }
      static json(body: any, options: any = {}) {
        return new MockNextResponse(body, options);
      }
    }

    return {
      NextRequest: MockNextRequest,
      NextResponse: MockNextResponse,
      after: (cb: any) => {
        // Run synchronously/immediately in test!
        cb().catch((e: any) => console.error("Mock after block failed:", e));
      }
    };
  }

  return originalRequire.apply(this, arguments as any);
};

import { TenantDB } from "../src/lib/core/tenant-db";
import { QueueService } from "../src/lib/queue/queue.service";
import { WebhookDedupeService } from "../src/lib/services/webhook-dedupe.service";
import { FeatureFlagService } from "../src/lib/services/feature-flag.service";
import { RealtimePublisher } from "../src/lib/realtime/publisher";
import { RealtimeBus } from "../src/lib/realtime/bus";

// Realtime states to verify side effects
let publishedMessages: any[] = [];
let mockConversationsStatus = "ai";
let savedMessages: any[] = [];
let publishedQueueEvents: any[] = [];
let loggedEvents: any[] = [];
let featureFlagStates: Record<string, boolean> = {
  whatsapp_auto_reply: false, // DEFAULT IS LISTENING MODE (false)
};

// ── MONKEYPATCH REALTIME BUS TO BYPASS ABLY & ZOD SCHEMA VALIDATION ──
RealtimeBus.publish = async function (tenantId: string, event: any) {
  publishedMessages.push({ tenantId, message: event });
};

// ── MONKEYPATCH TENANT_DB ──
TenantDB.prototype.executeSafe = async function (queryObj: any) {
  const sql = queryObj.text ? queryObj.text.trim() : String(queryObj).trim();
  const vals = queryObj.values || [];

  // 1. Resolve Channel query
  if (sql.toLowerCase().includes("channels c")) {
    return [
      {
        channel_id: "test-channel-uuid",
        provider: "360dialog",
        identifier: "+905527641397",
        group_id: "test-group-uuid",
        tenant_id: "test-tenant-uuid",
        tenant_slug: "baskent",
        tenant_name: "Baskent OS",
        tenant_status: "active"
      }
    ];
  }

  // 2. Insert channel event log
  if (sql.includes("INSERT INTO channel_events")) {
    loggedEvents.push({
      channel_id: vals[0],
      event_type: vals[1],
      payload: JSON.parse(vals[1]),
      correlation_id: vals[2]
    });
    return [];
  }

  // 3. Customer profile inserts/queries
  if (sql.includes("INSERT INTO customer_profiles") || sql.includes("customer_profiles")) {
    return [{ id: "test-customer-uuid" }];
  }

  // 4. Inbound/outbound message insertion check
  if (sql.includes("INSERT INTO messages")) {
    return [{ id: "mock_saved_msg_id", conversation_id: "mock_conv_id" }];
  }

  // 5. Conversation status check
  if (sql.includes("SELECT status FROM conversations")) {
    return [{ status: mockConversationsStatus }];
  }

  // 6. Handover status update
  if (sql.includes("UPDATE conversations SET status = 'human'") || sql.includes("SET status = 'human'")) {
    mockConversationsStatus = "human";
    return [];
  }

  return [];
};

// ── MONKEYPATCH QUEUE_SERVICE ──
QueueService.prototype.publish = async function (tenantId: string, eventName: string, payload: any, metadata: any) {
  publishedQueueEvents.push({ tenantId, eventName, payload, metadata });
  return "mock-queue-message-id";
};

// ── MONKEYPATCH WEBHOOK_DEDUPE_SERVICE ──
WebhookDedupeService.prototype.checkAndLock = async function () {
  return { isDuplicate: false, lockHash: 99999 };
};

// ── MONKEYPATCH FEATURE_FLAG_SERVICE ──
FeatureFlagService.isEnabled = async function (tenantId: string, flagName: string, defaultValue = false) {
  if (flagName in featureFlagStates) {
    return featureFlagStates[flagName];
  }
  return defaultValue;
};
FeatureFlagService.getFlags = async function (tenantId: string) {
  return featureFlagStates;
};

// ── MONKEYPATCH REALTIME_PUBLISHER ──
RealtimePublisher.publishMessageCreated = async function (tenantId: string, message: any, metadata: any) {
  publishedMessages.push({ tenantId, message, metadata });
};

// Now require the mockable routes and worker dependencies
const { POST, GET } = require("../src/app/api/webhooks/360dialog/route");
const { QueueWorkerEngine } = require("../src/lib/queue/worker");
const { MessageService } = require("../src/lib/services/message.service");

// Define mock response formats
const { NextRequest } = require("next/server");

async function runValidationTests() {
  console.log("==========================================================");
  console.log("🛡️  QUBA AI — 360dialog Coexistence Adapter Security & Normalization Audit");
  console.log("==========================================================");

  // ----------------------------------------------------
  // TEST 1: Security Intrusion & Zero-Leakage Audit
  // ----------------------------------------------------
  console.log("\n🧪 [TEST 1] Webhook Security & Access Validation...");
  
  // A: Bad Secret
  const reqBadSecret = new NextRequest("http://localhost:3000/api/webhooks/360dialog?channel_id=test-channel-uuid", {
    method: "POST",
    headers: { "x-360dialog-secret": "wrong_secret" },
    body: "{}"
  });
  const resBadSecret = await POST(reqBadSecret);
  if (resBadSecret.status !== 403) {
    throw new Error(`Security failed: expected 403 status for bad secret, got ${resBadSecret.status}`);
  }
  console.log("   ✅ Bad secret returns 403 Forbidden: PASS");

  // B: Valid Header Secret
  const reqValidHeader = new NextRequest("http://localhost:3000/api/webhooks/360dialog?channel_id=test-channel-uuid", {
    method: "POST",
    headers: { "x-360dialog-secret": "super_secure_360dialog_secret_123456" },
    body: JSON.stringify({
      messages: [{ id: "msg_inbound_123", from: "905001112233", type: "text", text: { body: "Merhaba QUBA!" }, timestamp: "1780000000" }],
      contacts: [{ profile: { name: "Mustafa" }, wa_id: "905001112233" }]
    })
  });
  
  // Clear trace counters
  publishedQueueEvents = [];
  loggedEvents = [];
  
  const resValidHeader = await POST(reqValidHeader);
  if (resValidHeader.status !== 200) {
    throw new Error(`Security validation failed: expected 200 status for valid secret header, got ${resValidHeader.status}`);
  }
  console.log("   ✅ Valid secret header returns 200 OK: PASS");

  // Assert secret is NEVER printed or leaked in raw payloads log
  const lastLoggedEvent = loggedEvents[0];
  const loggedPayloadStr = JSON.stringify(lastLoggedEvent?.payload || {});
  if (loggedPayloadStr.includes("super_secure_360dialog_secret_123456")) {
    throw new Error("SECURITY BREACH: Webhook secret was logged in channel_events table raw payload!");
  }
  console.log("   ✅ Zero secret leakage guarantee: PASS");

  // ----------------------------------------------------
  // TEST 2: Inbound Message Normalization Mapping
  // ----------------------------------------------------
  console.log("\n🧪 [TEST 2] Inbound Flat Ingestion Normalization...");
  
  if (publishedQueueEvents.length === 0) {
    throw new Error("Normalizer did not publish mapped event to QueueService.");
  }
  
  const queueEvent = publishedQueueEvents[0];
  if (queueEvent.eventName !== "whatsapp.message.received") {
    throw new Error(`Invalid queue event published: ${queueEvent.eventName}`);
  }

  const normalizedPayload = queueEvent.payload;
  const changeValue = normalizedPayload.entry?.[0]?.changes?.[0]?.value;
  
  if (!changeValue) {
    throw new Error("Normalized payload structure is missing entry changes value.");
  }

  if (changeValue.messages?.[0]?.from !== "905001112233" || changeValue.messages?.[0]?.text?.body !== "Merhaba QUBA!") {
    throw new Error("Message mapping fields (from/body) did not correctly normalize.");
  }
  
  if (changeValue.metadata?.display_phone_number !== "+905527641397") {
    throw new Error("Metadata business phone number display was not resolved correctly.");
  }

  console.log("   ✅ Flat inbound payload successfully normalized to nested Meta structure: PASS");

  // ----------------------------------------------------
  // TEST 3: Listening Mode (Zero-Outbound bot replies) Validation
  // ----------------------------------------------------
  console.log("\n🧪 [TEST 3] Listening Mode Zero-Outbound bot reply validation...");
  
  // Set Feature Flag to FALSE (Listening Mode default)
  featureFlagStates.whatsapp_auto_reply = false;
  mockConversationsStatus = "ai"; // Set status to AI so it would ordinarily reply
  
  // Mock worker and run message ingestion pipeline
  const worker = new QueueWorkerEngine();
  
  // We mock saveMessageIdempotent on MessageService to see what the worker saves
  let savedMessageObj: any = null;
  MessageService.prototype.saveMessageIdempotent = async function (params: any) {
    savedMessageObj = params;
    return {
      success: true,
      isDuplicate: false,
      messageId: "mock_saved_msg_id",
      conversationId: "mock_conv_id"
    };
  };

  // We mock LLM response generation to make sure it is NEVER CALLED
  let wasLLMResponseGenerated = false;
  const originalGenerate = worker["aiOrchestrator"].generateResponse;
  worker["aiOrchestrator"].generateResponse = async function () {
    wasLLMResponseGenerated = true;
    return { text: "This should never be generated", latencyMs: 100, modelUsed: "mock-model" } as any;
  };

  // Run the message queue handler in the worker
  const mockMsgEvent = publishedQueueEvents[0];
  await worker.processEvent(
    "whatsapp.message.received",
    mockMsgEvent.tenantId,
    mockMsgEvent.payload,
    mockMsgEvent.metadata
  );

  if (wasLLMResponseGenerated) {
    throw new Error("CRITICAL FAILURE: LLM response was generated under Listening Mode (whatsapp_auto_reply=false)!");
  }
  console.log("   ✅ AI engine bypassed completely (No LLM generation): PASS");

  if (savedMessageObj?.direction === "out") {
    throw new Error("CRITICAL FAILURE: Outgoing message was saved to database when bot was muted!");
  }
  console.log("   ✅ Zero bot outgoing database message delta = 0: PASS");

  // Restore orchestrator
  worker["aiOrchestrator"].generateResponse = originalGenerate;

  // ----------------------------------------------------
  // TEST 4: App Outgoing Echo Detection & Auto-Handover
  // ----------------------------------------------------
  console.log("\n🧪 [TEST 4] WhatsApp Business App Echo Normalization & Auto-Handover...");

  // Mock an outbound message payload from 360dialog webhook representing an echo
  // where the physical app sends a message. The 'from' field of echo is the phone number of the business.
  // The 'to' field contains the customer's phone number.
  const reqEcho = new NextRequest("http://localhost:3000/api/webhooks/360dialog?channel_id=test-channel-uuid", {
    method: "POST",
    headers: { "x-360dialog-secret": "super_secure_360dialog_secret_123456" },
    body: JSON.stringify({
      messages: [{ 
        id: "msg_echo_999", 
        from: "+905527641397", // Matches identifier of resolved channel
        to: "905001112233", // Customer receiving phone number
        type: "text", 
        text: { body: "Canlı destek ekibimizden Selin ben, nasıl yardımcı olabilirim?" }, 
        timestamp: "1780000001" 
      }],
      contacts: [{ profile: { name: "Quba Business App" }, wa_id: "+905527641397" }]
    })
  });

  publishedQueueEvents = [];
  publishedMessages = [];
  mockConversationsStatus = "ai"; // Start in AI mode

  const resEcho = await POST(reqEcho);
  if (resEcho.status !== 200) {
    throw new Error(`Webhook echo POST failed, status: ${resEcho.status}`);
  }

  // Mapped inbound queue event for Echo
  const echoQueueEvent = publishedQueueEvents[0];
  const echoNormalizedMsg = echoQueueEvent.payload.entry?.[0]?.changes?.[0]?.value?.messages?.[0];

  if (!echoNormalizedMsg) {
    throw new Error("Echo message not normalized in queue event payload.");
  }

  // Let's assert echo ingestion behavior in QueueWorker
  let savedEchoDirection: string | null = null;
  let savedEchoModelUsed: any = undefined;

  MessageService.prototype.saveMessageIdempotent = async function (params: any) {
    savedEchoDirection = params.direction;
    savedEchoModelUsed = params.modelUsed;
    return {
      success: true,
      isDuplicate: false,
      messageId: "mock_saved_echo_id",
      conversationId: "mock_conv_id"
    };
  };

  // Run worker handler
  await worker.processEvent(
    "whatsapp.message.received",
    echoQueueEvent.tenantId,
    echoQueueEvent.payload,
    echoQueueEvent.metadata
  );

  // A: Direction must be OUT (not IN) for echo
  if (savedEchoDirection !== "out") {
    throw new Error(`Echo message direction mapping failed: expected out, got ${savedEchoDirection}`);
  }
  console.log("   ✅ Echo saved with direction = 'out': PASS");

  // B: model_used must be NULL for echo
  if (savedEchoModelUsed !== null) {
    throw new Error(`Echo model_used mapping failed: expected null, got ${savedEchoModelUsed}`);
  }
  console.log("   ✅ Echo saved with model_used = null: PASS");

  // C: Conversation must handover to human status
  if (mockConversationsStatus !== "human") {
    throw new Error(`Auto-handover failed: expected conversation state 'human', got ${mockConversationsStatus}`);
  }
  console.log("   ✅ Conversation status updated to 'human' (bot muted): PASS");

  // D: Realtime event published for human outgoing message
  if (publishedMessages.length === 0) {
    throw new Error("Realtime publish failed to broadcast the app echo message.");
  }
  console.log("   ✅ Realtime event broadcasted for the echo outbound: PASS");

  // ----------------------------------------------------
  // TEST 5: 360dialog Media Storage Retrieval Resolution
  // ----------------------------------------------------
  console.log("\n🧪 [TEST 5] 360dialog Media Storage Retrieval Resolution...");
  const { MediaStorageService } = require("../src/lib/services/media-storage.service");

  // Mock global fetch for media tests
  const originalFetch = global.fetch;
  let resolvedUrlsFetched: string[] = [];

  global.fetch = async function (url: any, options: any) {
    const urlStr = String(url);
    resolvedUrlsFetched.push(urlStr);

    if (urlStr.includes("waba-v2.360dialog.io/media_id_12345")) {
      // Assert D360-API-KEY header is sent
      if (options?.headers?.["D360-API-KEY"] !== "mock_api_key_abc") {
        throw new Error("Security check failed: D360-API-KEY header is missing or incorrect in media lookup");
      }
      return {
        ok: true,
        json: async () => ({
          messaging_product: "whatsapp",
          url: "https://lookaside.fbsbx.com/whatsapp_business/attachments/?mid=media_id_12345&ext=123&hash=abc"
        })
      } as any;
    }

    if (urlStr.includes("lookaside.fbsbx.com/whatsapp_business/attachments")) {
      // Assert D360-API-KEY header is NOT leaked to Meta CDN
      if (options?.headers?.["D360-API-KEY"]) {
        throw new Error("SECURITY LEAK: D360-API-KEY header was sent to fbsbx.com Meta CDN!");
      }
      return {
        ok: true,
        arrayBuffer: async () => new ArrayBuffer(500)
      } as any;
    }

    return originalFetch(url, options);
  } as any;

  // Let's call downloadAndStore
  const mediaResult = await MediaStorageService.downloadAndStore(
    "test-tenant-uuid",
    "media_id_12345",
    "mock_api_key_abc",
    "test_msg_id_123",
    {
      mimeType: "image/png",
      filename: "test_image.png",
      mediaType: "image",
      provider: "360dialog"
    }
  );

  // Restore fetch
  global.fetch = originalFetch;

  if (!mediaResult) {
    throw new Error("360dialog media downloader returned null");
  }

  if (mediaResult.fileSize !== 500) {
    throw new Error(`Expected file size 500, got ${mediaResult.fileSize}`);
  }

  console.log("   ✅ Dynamic 360dialog endpoint routing: PASS");
  console.log("   ✅ D360-API-KEY authentication headers verified: PASS");
  console.log("   ✅ Zero API Key leak to Meta CDN: PASS");

  console.log("\n🎉 ALL 360DIALOG COEXISTENCE ADAPTER VALIDATION TESTS PASSED!");
  console.log("==========================================================\n");
  process.exit(0);
}

runValidationTests().catch(e => {
  console.error("\n❌ VALIDATION TEST RUN CRASHED WITH ERROR:\n", e);
  process.exit(1);
});
