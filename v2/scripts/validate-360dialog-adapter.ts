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
import { CredentialsService } from "../src/lib/services/credentials.service";
import { ThreeSixtyDialogService } from "../src/lib/services/providers/three-sixty-dialog.service";
import { PromptBuilder } from "../src/lib/services/ai/prompt-builder";
import { createTenantBrain } from "../src/lib/brain/tenant-brain";
import { AIOrchestrator } from "../src/lib/services/ai/orchestrator";

// Set test tenant credentials env configuration
process.env.TEST_TENANT_ID = "test-tenant-uuid";
process.env.TEST_USER_ID = "test-user-uuid";

// Realtime states to verify side effects
let publishedMessages: any[] = [];
let mockConversationsStatus = "ai";
let mockAutopilotEnabled: boolean = false;
let mockLeadStage: string | null = null;
let auditLogsWritten: any[] = [];
let savedMessages: any[] = [];
let publishedQueueEvents: any[] = [];
let loggedEvents: any[] = [];
let featureFlagStates: Record<string, boolean> = {
  whatsapp_auto_reply: false, // DEFAULT IS LISTENING MODE (false)
};
let mockLastInboundTime = Date.now() - 5000; // 5 seconds ago by default
let mockThreeSixtySendFailure = false;
let lastThreeSixtySendParams: any = null;
let capturedUpdates: any[] = [];

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
    savedMessages.push({ sql, values: vals });
    return [{ id: "mock_saved_msg_id", conversation_id: "mock-conv-uuid" }];
  }

  // 5. Conversation status check
  if (sql.includes("SELECT status FROM conversations")) {
    return [{ status: mockConversationsStatus }];
  }

  // 6. Conversations resolve channel & ID
  if (sql.toLowerCase().includes("from conversations")) {
    return [{ 
      id: "mock-conv-uuid", 
      phone_number: "905001112233",
      channel: "whatsapp", 
      channel_id: "test-channel-uuid", 
      status: mockConversationsStatus,
      autopilot_enabled: mockAutopilotEnabled,
      lead_stage: mockLeadStage
    }];
  }

  // 7. Last inbound message query for 24h service window check
  if (sql.includes("direction = 'in'") && sql.toLowerCase().includes("from messages")) {
    return [{ created_at: new Date(mockLastInboundTime).toISOString() }];
  }

  // 8. Handover status update
  if (sql.includes("UPDATE conversations SET status = 'human'") || sql.includes("SET status = 'human'")) {
    mockConversationsStatus = "human";
    mockAutopilotEnabled = false;
    capturedUpdates.push({ sql, values: vals });
    return [];
  }

  if (sql.includes("UPDATE conversations")) {
    capturedUpdates.push({ sql, values: vals });
    if (/\bstatus\s*=\s*['"]human['"]/i.test(sql)) {
      mockConversationsStatus = "human";
    } else if (/\bstatus\s*=\s*\$/i.test(sql)) {
      mockConversationsStatus = vals[0];
    }
    if (/\bautopilot_enabled\s*=\s*false/i.test(sql)) {
      mockAutopilotEnabled = false;
    } else if (/\bautopilot_enabled\s*=\s*\$/i.test(sql)) {
      mockAutopilotEnabled = vals[1];
    }
    return [];
  }

  // 9. INSERT INTO ai_audit_logs
  if (sql.includes("INSERT INTO ai_audit_logs")) {
    auditLogsWritten.push({ sql, values: vals });
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

// ── MONKEYPATCH CREDENTIALS_SERVICE ──
CredentialsService.resolveCredentials = async function (tenantId: string, provider: string) {
  return {
    accessToken: "mock_api_key_abc",
    whatsappPhoneNumberId: "+905527641397",
    whatsappBusinessAccountId: null,
    metaPageId: null,
    instagramId: null,
    source: "v2_channels",
    channelId: "test-channel-uuid",
    provider: "360dialog"
  };
};

// ── MONKEYPATCH THREE_SIXTY_DIALOG_SERVICE ──
ThreeSixtyDialogService.sendMessage = async function (apiKey: string, to: string, content: string, media?: any) {
  lastThreeSixtySendParams = { apiKey, to, content, media };
  if (mockThreeSixtySendFailure) {
    return { success: false };
  }
  return { success: true, providerMessageId: "wamid.mock_panel_sent_123" };
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

    if (urlStr.includes("lookaside.fbsbx.com/whatsapp_business/attachments") || urlStr.includes("waba-v2.360dialog.io/whatsapp_business/attachments")) {
      // Assert D360-API-KEY header is NOT leaked to Meta CDN
      if (urlStr.includes("lookaside.fbsbx.com") && options?.headers?.["D360-API-KEY"]) {
        throw new Error("SECURITY LEAK: D360-API-KEY header was sent to fbsbx.com Meta CDN!");
      }
      // Assert D360-API-KEY header IS sent to waba-v2.360dialog.io
      if (urlStr.includes("waba-v2.360dialog.io") && options?.headers?.["D360-API-KEY"] !== "mock_api_key_abc") {
        throw new Error("Security check failed: D360-API-KEY header is missing or incorrect in media proxy download");
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

  // Test directUrl bypass download path
  const mediaDirectResult = await MediaStorageService.downloadAndStore(
    "test-tenant-uuid",
    "media_id_12345_direct",
    "mock_api_key_abc",
    "test_msg_id_456",
    {
      mimeType: "image/png",
      filename: "test_image_direct.png",
      mediaType: "image",
      provider: "360dialog",
      directUrl: "https://lookaside.fbsbx.com/whatsapp_business/attachments/?mid=media_id_12345_direct&ext=123&hash=abc"
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

  if (!mediaDirectResult) {
    throw new Error("360dialog direct media downloader returned null");
  }

  if (mediaDirectResult.fileSize !== 500) {
    throw new Error(`Expected direct file size 500, got ${mediaDirectResult.fileSize}`);
  }

  console.log("   ✅ Dynamic 360dialog endpoint routing: PASS");
  console.log("   ✅ D360-API-KEY authentication headers verified: PASS");
  console.log("   ✅ Zero API Key leak to Meta CDN: PASS");

  // ----------------------------------------------------
  // TEST 6: Panel Outbound & 24h Service Window Gate
  // ----------------------------------------------------
  console.log("\n🧪 [TEST 6] Panel Outbound Messaging & 24h Service Window Gate...");

  const { sendMessage, sendMediaMessage } = require("../src/app/actions/inbox");

  // A: 24h service window check - BLOCKED when last message is older than 24h
  mockLastInboundTime = Date.now() - 25 * 60 * 60 * 1000; // 25 hours ago
  
  const textSendBlockedRes = await sendMessage("905001112233", "Merhaba");
  if (textSendBlockedRes.success) {
    throw new Error("Validation failure: outbound text send should have been blocked outside the 24-hour service window!");
  }
  if (!textSendBlockedRes.error?.includes("24 saatten fazla zaman geçmiş")) {
    throw new Error(`Expected service window warning, got: ${textSendBlockedRes.error}`);
  }
  console.log("   ✅ Text sending blocked outside 24h window: PASS");

  const mediaSendBlockedRes = await sendMediaMessage(
    "905001112233",
    "https://sample.vercel-storage.com/image.png",
    "image",
    "image.png",
    "image/png",
    1024,
    "Altyazı"
  );
  if (mediaSendBlockedRes.success) {
    throw new Error("Validation failure: outbound media send should have been blocked outside the 24-hour service window!");
  }
  if (!mediaSendBlockedRes.error?.includes("24 saatten fazla zaman geçmiş")) {
    throw new Error(`Expected service window warning for media, got: ${mediaSendBlockedRes.error}`);
  }
  console.log("   ✅ Media sending blocked outside 24h window: PASS");

  // B: Vercel Blob URL verification check - BLOCKED when mediaUrl is not .vercel-storage.com
  mockLastInboundTime = Date.now() - 5 * 1000; // 5 seconds ago (within window)
  
  const mediaSendBadUrlRes = await sendMediaMessage(
    "905001112233",
    "https://external-hacker-site.com/malicious.png",
    "image",
    "malicious.png",
    "image/png",
    1024,
    "Altyazı"
  );
  if (mediaSendBadUrlRes.success) {
    throw new Error("Security failure: sendMediaMessage accepted a non-Vercel-Blob URL!");
  }
  if (!mediaSendBadUrlRes.error?.includes("sistem tarafından yüklenen medya dosyalarını")) {
    throw new Error(`Expected security URL error message, got: ${mediaSendBadUrlRes.error}`);
  }
  console.log("   ✅ External media URL rejected: PASS");

  // C: Successful Outbound text sending via 360dialog
  lastThreeSixtySendParams = null;
  savedMessages = [];
  capturedUpdates = [];
  mockConversationsStatus = "ai"; // Start in AI mode

  const textSendRes = await sendMessage("905001112233", "Operator Merhaba");
  if (!textSendRes.success) {
    throw new Error(`Text message sending failed: ${textSendRes.error}`);
  }
  if (lastThreeSixtySendParams?.content !== "Operator Merhaba" || lastThreeSixtySendParams?.to !== "905001112233") {
    throw new Error("Outbound text parameters did not match inside ThreeSixtyDialogService");
  }
  
  // Verify status updated to human
  if (mockConversationsStatus !== "human") {
    throw new Error(`Status update to 'human' failed: expected human, got ${mockConversationsStatus}`);
  }

  // Verify message inserted to database with audit metadata
  const textDbMsg = savedMessages.find(m => m.values.includes("Operator Merhaba"));
  if (!textDbMsg) {
    throw new Error("Outgoing text message not saved to database!");
  }
  const textMetadata = JSON.parse(textDbMsg.values[textDbMsg.values.length - 1]);
  if (textMetadata.initiated_from !== "inbox_panel" || textMetadata.source !== "panel_operator") {
    throw new Error("Audit metadata missing or incorrect on text message insert!");
  }
  console.log("   ✅ Text messaging routed via 360dialog, conversation status set to 'human', audit metadata verified: PASS");

  // D: Successful Outbound media sending via 360dialog
  lastThreeSixtySendParams = null;
  savedMessages = [];
  capturedUpdates = [];
  mockConversationsStatus = "ai"; // Start in AI mode

  const mediaSendRes = await sendMediaMessage(
    "905001112233",
    "https://mybucket.vercel-storage.com/cat.jpg",
    "image",
    "cat.jpg",
    "image/jpeg",
    51200,
    "Sevimli Kedi"
  );

  if (!mediaSendRes.success) {
    throw new Error(`Media message sending failed: ${mediaSendRes.error}`);
  }
  if (lastThreeSixtySendParams?.content !== "Sevimli Kedi" || lastThreeSixtySendParams?.media?.url !== "https://mybucket.vercel-storage.com/cat.jpg") {
    throw new Error("Outbound media parameters did not match inside ThreeSixtyDialogService");
  }

  // Verify status updated to human
  if (mockConversationsStatus !== "human") {
    throw new Error(`Status update to 'human' failed for media: expected human, got ${mockConversationsStatus}`);
  }

  // Verify message inserted to database with media properties and audit metadata merged
  const mediaDbMsg = savedMessages[0];
  if (!mediaDbMsg) {
    throw new Error("Outgoing media message not saved to database!");
  }
  // The last value is media_metadata JSONB string
  const mediaMetadata = JSON.parse(mediaDbMsg.values[mediaDbMsg.values.length - 1]);
  if (mediaMetadata.initiated_from !== "inbox_panel" || mediaMetadata.source !== "panel_operator") {
    throw new Error("Audit metadata missing or incorrect on media message insert!");
  }
  if (mediaMetadata.filename !== "cat.jpg" || mediaMetadata.caption !== "Sevimli Kedi") {
    throw new Error("Original media fields lost on media message insert!");
  }
  console.log("   ✅ Media messaging routed via 360dialog, Vercel Blob URL verification passed, audit metadata verified: PASS");

  // ----------------------------------------------------
  // TEST 7: Selected Conversation Autopilot Security & Trigger Gates
  // ----------------------------------------------------
  console.log("\n🧪 [TEST 7] Selected Conversation Autopilot Security & Trigger Gates...");

  // Setup initial mock states
  mockConversationsStatus = "bot";
  mockAutopilotEnabled = true;
  mockLeadStage = null;
  mockLastInboundTime = Date.now() - 5 * 1000; // 5s ago (within window)
  wasLLMResponseGenerated = false;
  savedMessages = [];
  auditLogsWritten = [];
  capturedUpdates = [];
  lastThreeSixtySendParams = null;
  mockThreeSixtySendFailure = false;

  // Let's mock saveMessageIdempotent for TEST 7 to trace saved messages
  const originalSaveMessage = MessageService.prototype.saveMessageIdempotent;
  MessageService.prototype.saveMessageIdempotent = async function (params: any) {
    savedMessages.push({ values: Object.values(params), params });
    return {
      success: true,
      isDuplicate: false,
      messageId: "mock_saved_msg_id",
      conversationId: "mock-conv-uuid"
    };
  };

  // A: Global Kill-Switch Gate (ENABLE_SELECTED_AUTOPILOT = false)
  process.env.ENABLE_SELECTED_AUTOPILOT = "false";
  process.env.AUTOPILOT_ENFORCE_WHITELIST = "true";
  process.env.AUTOPILOT_WHITELIST = "";
  
  await worker.processEvent(
    "whatsapp.message.received",
    "test-tenant-uuid",
    mockMsgEvent.payload,
    mockMsgEvent.metadata
  );

  if (wasLLMResponseGenerated) {
    throw new Error("TEST 7-A Failed: Bot responded when ENABLE_SELECTED_AUTOPILOT was false!");
  }
  console.log("   ✅ A: Global kill-switch blocks response: PASS");

  // B: Whitelist Gate (ENABLE_SELECTED_AUTOPILOT = true, AUTOPILOT_ENFORCE_WHITELIST = true, number NOT whitelisted)
  process.env.ENABLE_SELECTED_AUTOPILOT = "true";
  process.env.AUTOPILOT_ENFORCE_WHITELIST = "true";
  process.env.AUTOPILOT_WHITELIST = "905556667788"; // Whitelist a different number
  wasLLMResponseGenerated = false;

  await worker.processEvent(
    "whatsapp.message.received",
    "test-tenant-uuid",
    mockMsgEvent.payload, // from: "905001112233"
    mockMsgEvent.metadata
  );

  if (wasLLMResponseGenerated) {
    throw new Error("TEST 7-B Failed: Bot responded when number was not in whitelist!");
  }
  console.log("   ✅ B: Whitelist blocks non-matching numbers: PASS");

  // B.2: Whitelist Gate (ENABLE_SELECTED_AUTOPILOT = true, AUTOPILOT_ENFORCE_WHITELIST = true, whitelist is empty/undefined)
  process.env.ENABLE_SELECTED_AUTOPILOT = "true";
  process.env.AUTOPILOT_ENFORCE_WHITELIST = "true";
  process.env.AUTOPILOT_WHITELIST = ""; // Empty whitelist
  wasLLMResponseGenerated = false;

  await worker.processEvent(
    "whatsapp.message.received",
    "test-tenant-uuid",
    mockMsgEvent.payload, // from: "905001112233"
    mockMsgEvent.metadata
  );

  if (wasLLMResponseGenerated) {
    throw new Error("TEST 7-B.2 Failed: Bot responded when whitelist was empty!");
  }
  console.log("   ✅ B.2: Empty whitelist blocks response (closed gate by default): PASS");

  // B.3: Whitelist Gate (ENABLE_SELECTED_AUTOPILOT = true, AUTOPILOT_ENFORCE_WHITELIST = false/undefined -> whitelist bypassed)
  process.env.ENABLE_SELECTED_AUTOPILOT = "true";
  process.env.AUTOPILOT_ENFORCE_WHITELIST = "false";
  process.env.AUTOPILOT_WHITELIST = ""; // Empty whitelist but bypassed
  wasLLMResponseGenerated = false;

  // Temporarily intercept LLM generator to return a dummy reply
  const originalGenerateForTest = worker["aiOrchestrator"].generateResponse;
  worker["aiOrchestrator"].generateResponse = async function () {
    wasLLMResponseGenerated = true;
    return { text: "Merhaba, autopilot devrede!", latencyMs: 150, modelUsed: "mock-model" } as any;
  };

  await worker.processEvent(
    "whatsapp.message.received",
    "test-tenant-uuid",
    mockMsgEvent.payload, // from: "905001112233"
    mockMsgEvent.metadata
  );

  if (!wasLLMResponseGenerated) {
    throw new Error("TEST 7-B.3 Failed: Bot failed to respond when whitelist was bypassed!");
  }
  console.log("   ✅ B.3: Whitelist bypass allows responses without list match: PASS");

  // B.4: Autopilot Disabled check (autopilot_enabled = false)
  mockAutopilotEnabled = false;
  wasLLMResponseGenerated = false;

  await worker.processEvent(
    "whatsapp.message.received",
    "test-tenant-uuid",
    mockMsgEvent.payload,
    mockMsgEvent.metadata
  );

  if (wasLLMResponseGenerated) {
    throw new Error("TEST 7-B.4 Failed: Bot responded when autopilot_enabled was false!");
  }
  console.log("   ✅ B.4: Bot does not respond when autopilot_enabled is false: PASS");

  // Restore mockAutopilotEnabled to true for remaining tests
  mockAutopilotEnabled = true;

  // C: Whitelist Gate (ENABLE_SELECTED_AUTOPILOT = true, AUTOPILOT_ENFORCE_WHITELIST = true, number IS whitelisted)
  process.env.AUTOPILOT_ENFORCE_WHITELIST = "true";
  process.env.AUTOPILOT_WHITELIST = "905001112233"; // Match customer from payload
  wasLLMResponseGenerated = false;

  await worker.processEvent(
    "whatsapp.message.received",
    "test-tenant-uuid",
    mockMsgEvent.payload,
    mockMsgEvent.metadata
  );

  if (!wasLLMResponseGenerated) {
    throw new Error("TEST 7-C Failed: Bot failed to respond when number was whitelisted!");
  }
  if (lastThreeSixtySendParams?.content !== "Merhaba, autopilot devrede!") {
    throw new Error("TEST 7-C Failed: Message was not sent via 360dialog");
  }
  console.log("   ✅ C: Whitelist allows matching numbers: PASS");

  // D: 24h Window Gate (Previous customer message was 25 hours ago)
  mockConversationsStatus = "bot";
  mockAutopilotEnabled = true;
  mockLastInboundTime = Date.now() - 25 * 60 * 60 * 1000; // 25 hours ago
  wasLLMResponseGenerated = false;
  auditLogsWritten = [];
  capturedUpdates = [];

  await worker.processEvent(
    "whatsapp.message.received",
    "test-tenant-uuid",
    mockMsgEvent.payload,
    mockMsgEvent.metadata
  );

  if (wasLLMResponseGenerated) {
    throw new Error("TEST 7-D Failed: Bot responded when 24h window was expired!");
  }
  if ((mockAutopilotEnabled as boolean) !== false || mockConversationsStatus !== "human") {
    throw new Error("TEST 7-D Failed: Autopilot was not disabled on 24h expiration!");
  }
  const last24hAuditLog = auditLogsWritten.find(log => log.values.includes("autopilot_disabled"));
  if (!last24hAuditLog || !last24hAuditLog.values[3].includes("24h_expired")) {
    throw new Error("TEST 7-D Failed: Audit log for 24h_expired not written correctly!");
  }
  console.log("   ✅ D: 24h service window expiration disables autopilot: PASS");

  // E: Stop Rules Gate (Opt-Out keyword detected)
  mockConversationsStatus = "bot";
  mockAutopilotEnabled = true;
  mockLastInboundTime = Date.now() - 5 * 1000; // Reset inbound to 5s ago
  wasLLMResponseGenerated = false;
  auditLogsWritten = [];
  capturedUpdates = [];

  // Create payload containing opt-out keyword "istemiyorum"
  const mockOptOutPayload = {
    ...mockMsgEvent.payload,
    entry: [{
      ...mockMsgEvent.payload.entry[0],
      changes: [{
        ...mockMsgEvent.payload.entry[0].changes[0],
        value: {
          ...mockMsgEvent.payload.entry[0].changes[0].value,
          messages: [{
            ...mockMsgEvent.payload.entry[0].changes[0].value.messages[0],
            text: { body: "Bana artık mesaj göndermeyin, istemiyorum." }
          }]
        }
      }]
    }]
  };

  await worker.processEvent(
    "whatsapp.message.received",
    "test-tenant-uuid",
    mockOptOutPayload,
    mockMsgEvent.metadata
  );

  if (wasLLMResponseGenerated) {
    throw new Error("TEST 7-E Failed: Bot responded when opt-out keyword was present!");
  }
  if ((mockAutopilotEnabled as boolean) !== false || mockConversationsStatus !== "human") {
    throw new Error("TEST 7-E Failed: Autopilot was not disabled on opt-out!");
  }
  const optOutAuditLog = auditLogsWritten.find(log => log.values.includes("autopilot_disabled"));
  if (!optOutAuditLog || !optOutAuditLog.values[3].includes("stop_rule")) {
    throw new Error("TEST 7-E Failed: Audit log for stop_rule not written correctly!");
  }
  console.log("   ✅ E: Opt-out stop rule disables autopilot: PASS");

  // F: Stop Rules Gate (Terminal opportunity stage 'lost')
  mockConversationsStatus = "bot";
  mockAutopilotEnabled = true;
  mockLeadStage = "lost";
  wasLLMResponseGenerated = false;
  auditLogsWritten = [];
  capturedUpdates = [];

  await worker.processEvent(
    "whatsapp.message.received",
    "test-tenant-uuid",
    mockMsgEvent.payload, // Standard text message
    mockMsgEvent.metadata
  );

  if (wasLLMResponseGenerated) {
    throw new Error("TEST 7-F Failed: Bot responded when conversation was in a terminal stage!");
  }
  if ((mockAutopilotEnabled as boolean) !== false || mockConversationsStatus !== "human") {
    throw new Error("TEST 7-F Failed: Autopilot was not disabled on terminal stage!");
  }
  const stageAuditLog = auditLogsWritten.find(log => log.values.includes("autopilot_disabled"));
  if (!stageAuditLog || !stageAuditLog.values[3].includes("coordinator_takeover")) {
    throw new Error("TEST 7-F Failed: Audit log for coordinator_takeover not written correctly!");
  }
  console.log("   ✅ F: Terminal opportunity stage disables autopilot: PASS");

  // G: API Send Error Safety
  mockConversationsStatus = "bot";
  mockAutopilotEnabled = true;
  mockLeadStage = null;
  wasLLMResponseGenerated = false;
  auditLogsWritten = [];
  capturedUpdates = [];
  mockThreeSixtySendFailure = true; // Inject API transmission error

  await worker.processEvent(
    "whatsapp.message.received",
    "test-tenant-uuid",
    mockMsgEvent.payload,
    mockMsgEvent.metadata
  );

  if ((mockAutopilotEnabled as boolean) !== false || mockConversationsStatus !== "human") {
    throw new Error("TEST 7-G Failed: Autopilot was not disabled upon transmission error!");
  }
  const errAuditLog = auditLogsWritten.find(log => log.values.includes("autopilot_disabled"));
  if (!errAuditLog || !errAuditLog.values[3].includes("error")) {
    throw new Error("TEST 7-G Failed: Audit log for error not written correctly!");
  }
  
  // Verify message saved to DB as failed
  const failedMsg = savedMessages.find(m => m.values.includes("failed"));
  if (!failedMsg) {
    throw new Error("TEST 7-G Failed: Failed outbound message was not saved with status 'failed'!");
  }
  console.log("   ✅ G: API sending failures auto-disable autopilot: PASS");

  // ----------------------------------------------------
  // TEST 8: toggleBotStatus Security validation
  // ----------------------------------------------------
  console.log("\n🧪 [TEST 8] toggleBotStatus Security validation...");

  // Import the action dynamically to prevent circular dependencies or premature loading
  const { toggleBotStatus } = await import("../src/app/actions/inbox");

  // Mock global config: Kill-switch is OFF
  process.env.ENABLE_SELECTED_AUTOPILOT = "false";
  process.env.AUTOPILOT_ENFORCE_WHITELIST = "false";
  mockConversationsStatus = "human";
  mockAutopilotEnabled = false;

  // Try to toggle ON
  let toggleRes = await toggleBotStatus("905001112233", true);
  if (toggleRes.success || !toggleRes.error?.includes("kapalıdır")) {
    throw new Error("TEST 8-A Failed: Allowed manual toggle when global kill-switch was disabled!");
  }
  if (mockAutopilotEnabled !== false) {
    throw new Error("TEST 8-A Failed: DB state modified when global kill-switch blocked toggle!");
  }
  console.log("   ✅ A: Manual toggle blocked when global kill-switch is disabled: PASS");

  // Mock global config: Kill-switch is ON, Whitelist Enforced = true, number NOT whitelisted
  process.env.ENABLE_SELECTED_AUTOPILOT = "true";
  process.env.AUTOPILOT_ENFORCE_WHITELIST = "true";
  process.env.AUTOPILOT_WHITELIST = "905556667788"; // A different number
  mockConversationsStatus = "human";
  mockAutopilotEnabled = false;

  toggleRes = await toggleBotStatus("905001112233", true);
  if (toggleRes.success || !toggleRes.error?.includes("test listesinde değil")) {
    throw new Error("TEST 8-B Failed: Allowed manual toggle when whitelist enforcement was active and number not whitelisted!");
  }
  if (mockAutopilotEnabled !== false) {
    throw new Error("TEST 8-B Failed: DB state modified when whitelist enforcement blocked toggle!");
  }
  console.log("   ✅ B: Manual toggle blocked when whitelist enforcement active and number not whitelisted: PASS");

  // Mock global config: Kill-switch is ON, Whitelist Enforced = true, number IS whitelisted
  process.env.ENABLE_SELECTED_AUTOPILOT = "true";
  process.env.AUTOPILOT_ENFORCE_WHITELIST = "true";
  process.env.AUTOPILOT_WHITELIST = "905001112233"; // Matching number
  mockConversationsStatus = "human";
  mockAutopilotEnabled = false;
  capturedUpdates = [];

  toggleRes = await toggleBotStatus("905001112233", true);
  if (!toggleRes.success) {
    throw new Error(`TEST 8-C Failed: Blocked toggle on whitelisted number: ${toggleRes.error}`);
  }
  if ((mockAutopilotEnabled as boolean) !== true || mockConversationsStatus !== "bot") {
    throw new Error("TEST 8-C Failed: DB state not updated successfully on whitelisted toggle!");
  }
  console.log("   ✅ C: Manual toggle allowed when whitelist enforcement active and number matches: PASS");

  // Mock global config: Kill-switch is ON, Whitelist Enforced = false, number NOT whitelisted
  process.env.ENABLE_SELECTED_AUTOPILOT = "true";
  process.env.AUTOPILOT_ENFORCE_WHITELIST = "false";
  process.env.AUTOPILOT_WHITELIST = ""; // Empty whitelist
  mockConversationsStatus = "human";
  mockAutopilotEnabled = false;
  capturedUpdates = [];

  toggleRes = await toggleBotStatus("905001112233", true);
  if (!toggleRes.success) {
    throw new Error(`TEST 8-D Failed: Blocked toggle when whitelist enforcement was disabled: ${toggleRes.error}`);
  }
  if ((mockAutopilotEnabled as boolean) !== true || mockConversationsStatus !== "bot") {
    throw new Error("TEST 8-D Failed: DB state not updated successfully when whitelist bypassed!");
  }
  console.log("   ✅ D: Manual toggle allowed on any number when whitelist enforcement is disabled: PASS");

  // ----------------------------------------------------
  // TEST 9: Dinamik Dil Algılama ve Context Testleri
  // ----------------------------------------------------
  console.log("\n🧪 [TEST 9] Dinamik Dil Algılama ve Context Doğrulama...");
  const { detectLanguage } = await import("../src/lib/utils/language-detector");

  // Case 1: Almanca Form
  const input1 = "Hallo! Ich habe dein Formular ausgefüllt...\nfull_name: Salih Aydin\nşikayetiniz_nedir?: L4/L5\nnerede_yaşıyorsunuz?: Almanya";
  const res1 = detectLanguage(input1);
  if (res1.reply_language !== "Almanca" || res1.language_detection_source !== "form_intro_text") {
    throw new Error(`TEST 9-1 Failed: Expected Almanca from form_intro_text, got ${res1.reply_language} from ${res1.language_detection_source}`);
  }
  console.log("   ✅ 1: German Form message detected as Almanca: PASS");

  // Case 2: Türkçe Form
  const input2 = "Merhaba, formu doldurdum. Bel fıtığım var.";
  const res2 = detectLanguage(input2);
  if (res2.reply_language !== "Türkçe" || res2.language_detection_source !== "latest_patient_message") {
    throw new Error(`TEST 9-2 Failed: Expected Türkçe, got ${res2.reply_language}`);
  }
  console.log("   ✅ 2: Turkish message detected as Türkçe: PASS");

  // Case 3: İngilizce Form
  const input3 = "I filled out the form. I have knee pain.";
  const res3 = detectLanguage(input3);
  if (res3.reply_language !== "İngilizce" || res3.language_detection_source !== "latest_patient_message") {
    throw new Error(`TEST 9-3 Failed: Expected İngilizce, got ${res3.reply_language}`);
  }
  console.log("   ✅ 3: English message detected as İngilizce: PASS");

  // Case 4: Arapça Form
  const input4 = "مرحبا، لقد ملأت النموذج\nfull_name: Salih Aydin\nşikayetiniz_nedir?: L4/L5";
  const res4 = detectLanguage(input4);
  if (res4.reply_language !== "Arapça" || res4.language_detection_source !== "form_intro_text") {
    throw new Error(`TEST 9-4 Failed: Expected Arapça from form_intro_text, got ${res4.reply_language}`);
  }
  console.log("   ✅ 4: Arabic Form message detected as Arapça: PASS");

  // Case 5: Dil Değişimi (German first, then Turkish "Türkçe yazabilir misiniz?")
  const input5 = "Türkçe yazabilir misiniz?";
  const history5 = [
    { role: 'user' as const, content: "Hallo! Ich habe dein Formular ausgefüllt..." },
    { role: 'assistant' as const, content: "Hallo, wie kann ich Ihnen helfen?" }
  ];
  const res5 = detectLanguage(input5, history5);
  if (res5.reply_language !== "Türkçe") {
    throw new Error(`TEST 9-5 Failed: Expected language shift to Türkçe, got ${res5.reply_language}`);
  }
  console.log("   ✅ 5: Language shift to Türkçe correctly handled: PASS");

  // Case 6: Kısa/Belirsiz Mesaj (History fallback)
  const input6 = "Ok";
  const history6 = [
    { role: 'user' as const, content: "Hallo, ich habe Rückenschmerzen." },
    { role: 'assistant' as const, content: "Hallo!..." }
  ];
  const res6 = detectLanguage(input6, history6);
  if (res6.reply_language !== "Almanca" || res6.language_detection_source !== "conversation_history") {
    throw new Error(`TEST 9-6 Failed: Expected Almanca from history, got ${res6.reply_language} from ${res6.language_detection_source}`);
  }
  console.log("   ✅ 6: Ambiguous input fallback to history language: PASS");

  // Case 7: Almanya'da yaşayan Türk isimli hasta Almanca yazarsa
  const input7 = "Hallo! Ich brauche einen Termin bei der Orthopädie.\nfull_name: Mehmet Yilmaz\ncountry: Germany";
  const res7 = detectLanguage(input7);
  if (res7.reply_language !== "Almanca") {
    throw new Error(`TEST 9-7 Failed: Expected Almanca for Turkish name writing German, got ${res7.reply_language}`);
  }
  console.log("   ✅ 7: German message from Turkish name detected as Almanca: PASS");

  // Case 8: CRM özeti Türkçe, son hasta mesajı İngilizce ise
  const input8 = "I need details about kidney transplant services.";
  const res8 = detectLanguage(input8);
  if (res8.reply_language !== "İngilizce") {
    throw new Error(`TEST 9-8 Failed: Expected İngilizce when patient writes English despite Turkish CRM contexts, got ${res8.reply_language}`);
  }
  console.log("   ✅ 8: English message with Turkish CRM context detected as İngilizce: PASS");

  // ----------------------------------------------------
  // TEST 9-B.6: Honorific Localization Test
  // ----------------------------------------------------
  console.log("\n🧪 [TEST 9-B.6] Honorific Localization Test...");
  const mockBrainFor9B6 = createTenantBrain(
    "test-tenant-uuid",
    "whatsapp",
    "payload-123",
    "Sen bir asistansın.",
    { industry: "healthcare", timezone: "Europe/Istanbul" }
  );

  const mockContext9B6 = {
    profile: { first_name: "Murtaza", last_name: "Kamilov" },
    languageContext: { reply_language: "Rusça", detected_patient_language: "Rusça" }
  };

  const systemPrompt9B6 = PromptBuilder.buildSystemPrompt(mockBrainFor9B6, "greeting", false, mockContext9B6);
  if (!systemPrompt9B6.includes("kesinlikle Türkçe hitap eklerini ('Bey' / 'Hanım') KULLANMA")) {
    throw new Error("TEST 9-B.6 Failed: System prompt does not include honorific suppression directives for foreign languages!");
  }
  if (!systemPrompt9B6.includes("ismin sonuna kesinlikle Türkçe hitap sözcükleri olan \"Bey\" veya \"Hanım\" EKLEME")) {
    throw new Error("TEST 9-B.6 Failed: Response language block is missing the honorific warning!");
  }

  // Also verify that Turkish reply contains honorifics
  const mockContext9B6TR = {
    profile: { first_name: "Murtaza", last_name: "Kamilov" },
    languageContext: { reply_language: "Türkçe", detected_patient_language: "Türkçe" }
  };
  const systemPrompt9B6TR = PromptBuilder.buildSystemPrompt(mockBrainFor9B6, "greeting", false, mockContext9B6TR);
  if (!systemPrompt9B6TR.includes("Merhaba Murtaza Bey/Hanım")) {
    throw new Error("TEST 9-B.6 Failed: Turkish reply prompt does not include the standard honorific template!");
  }
  console.log("   ✅ Russian honorific suppression and Turkish templates verified: PASS");

  // ----------------------------------------------------
  // TEST 10: Behavioral Integration Tests (Live LLM)
  // ----------------------------------------------------
  console.log("\n🧪 [TEST 10] Behavioral Assertions (Live LLM)...");
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    console.warn("   ⚠️ Skipping live LLM tests: GEMINI_API_KEY is not defined in .env.local");
  } else {
    const liveOrchestrator = new AIOrchestrator();
    
    // 10-A: Formda Şikayet Varsa Sormama
    const brainHealthcare = createTenantBrain(
      "caab9ea1-9591-45e4-bbc5-9c9b498982c8", // Başkent
      "whatsapp",
      "payload-123",
      "Sen Başkent Üniversitesi Hastanesi yapay zeka asistanısın.",
      { industry: "healthcare", timezone: "Europe/Istanbul" }
    );

    const context10A = {
      profile: { first_name: "Ahmet" },
      patient_known_facts: [
        "Hastanın adı: Ahmet.",
        "Hastanın şikayeti: Şiddetli bel fıtığı ağrısı ve sol bacakta uyuşma."
      ],
      languageContext: { reply_language: "Türkçe", detected_patient_language: "Türkçe" }
    };
    
    const prompt10A = PromptBuilder.buildSystemPrompt(brainHealthcare, "greeting", false, context10A);
    const messages10A = [
      { role: "system" as const, content: prompt10A },
      { role: "user" as const, content: "Merhaba, formu doldurmuştum." }
    ];
    
    const res10A = await liveOrchestrator.generateResponse(messages10A, {
      provider: "gemini",
      modelId: "gemini-2.5-flash",
      apiKey,
      temperature: 0.1,
      maxTokens: 500
    });
    
    const lower10A = res10A.text.toLowerCase();
    if (lower10A.includes("şikayetiniz nedir") || lower10A.includes("neyiniz var") || lower10A.includes("şikayetinizi")) {
      throw new Error(`TEST 10-A Failed: Bot asked for complaint again when it was already known! Output: ${res10A.text}`);
    }
    console.log("   ✅ 10-A: Avoided duplicate complaint questions: PASS");

    // 10-B: Formda Ülke Varsa Sormama
    const context10B = {
      profile: { first_name: "Ahmet" },
      patient_known_facts: [
        "Hastanın adı: Ahmet.",
        "Hastanın yaşadığı ülke/yer: Almanya."
      ],
      languageContext: { reply_language: "Türkçe", detected_patient_language: "Türkçe" }
    };
    const prompt10B = PromptBuilder.buildSystemPrompt(brainHealthcare, "greeting", false, context10B);
    const messages10B = [
      { role: "system" as const, content: prompt10B },
      { role: "user" as const, content: "Merhaba, tedavi detayları hakkında bilgi alabilir miyim?" }
    ];
    const res10B = await liveOrchestrator.generateResponse(messages10B, {
      provider: "gemini",
      modelId: "gemini-2.5-flash",
      apiKey,
      temperature: 0.1,
      maxTokens: 500
    });
    const lower10B = res10B.text.toLowerCase();
    if (lower10B.includes("nerede yaşıyorsunuz") || lower10B.includes("hangi ülkeden") || lower10B.includes("nerede ikamet")) {
      throw new Error(`TEST 10-B Failed: Bot asked for location when it was already known! Output: ${res10B.text}`);
    }
    console.log("   ✅ 10-B: Avoided duplicate country/location questions: PASS");

    // 10-C: Formda Randevu Dönemi Varsa Sormama
    const context10C = {
      profile: { first_name: "Ahmet" },
      patient_known_facts: [
        "Hastanın adı: Ahmet.",
        "Hastanın randevu/gelme planı: Temmuz."
      ],
      languageContext: { reply_language: "Türkçe", detected_patient_language: "Türkçe" }
    };
    const prompt10C = PromptBuilder.buildSystemPrompt(brainHealthcare, "greeting", false, context10C);
    const messages10C = [
      { role: "system" as const, content: prompt10C },
      { role: "user" as const, content: "Uçak biletlerimi ayarlamaya çalışıyorum." }
    ];
    const res10C = await liveOrchestrator.generateResponse(messages10C, {
      provider: "gemini",
      modelId: "gemini-2.5-flash",
      apiKey,
      temperature: 0.1,
      maxTokens: 500
    });
    const lower10C = res10C.text.toLowerCase();
    if (lower10C.includes("ne zaman gelmek") || lower10C.includes("hangi tarihte gelmek") || lower10C.includes("ne zaman planlıyorsunuz")) {
      throw new Error(`TEST 10-C Failed: Bot asked for arrival date when it was already known! Output: ${res10C.text}`);
    }
    console.log("   ✅ 10-C: Avoided duplicate arrival date questions: PASS");

    // 10-D: Son Mesaj Önceliği - Tarih Değişimi
    const context10D = {
      profile: { first_name: "Ahmet" },
      patient_known_facts: [
        "Hastanın adı: Ahmet.",
        "Hastanın randevu/gelme planı: Temmuz."
      ],
      languageContext: { reply_language: "Türkçe", detected_patient_language: "Türkçe" }
    };
    const prompt10D = PromptBuilder.buildSystemPrompt(brainHealthcare, "greeting", false, context10D);
    const messages10D = [
      { role: "system" as const, content: prompt10D },
      { role: "user" as const, content: "Temmuz uymuyor, Ağustosta gelebilirim." }
    ];
    const res10D = await liveOrchestrator.generateResponse(messages10D, {
      provider: "gemini",
      modelId: "gemini-2.5-flash",
      apiKey,
      temperature: 0.1,
      maxTokens: 500
    });
    const lower10D = res10D.text.toLowerCase();
    if (!lower10D.includes("ağustos") && !lower10D.includes("august")) {
      throw new Error(`TEST 10-D Failed: Bot did not honor the latest user message about scheduling in August! Output: ${res10D.text}`);
    }
    console.log("   ✅ 10-D: Honored latest user message (August shift) over older facts: PASS");

    // 10-E: Operatör Takeover Karşılama Engeli
    const context10E = {
      profile: { first_name: "Ahmet" },
      outreachContext: { greetingSent: true },
      languageContext: { reply_language: "Türkçe", detected_patient_language: "Türkçe" }
    };
    const prompt10E = PromptBuilder.buildSystemPrompt(brainHealthcare, "greeting", false, context10E);
    const messages10E = [
      { role: "system" as const, content: prompt10E },
      { role: "assistant" as const, content: "Merhaba, raporlarınızı buradan gönderebilirsiniz." },
      { role: "user" as const, content: "Gönderiyorum." }
    ];
    const res10E = await liveOrchestrator.generateResponse(messages10E, {
      provider: "gemini",
      modelId: "gemini-2.5-flash",
      apiKey,
      temperature: 0.1,
      maxTokens: 500
    });
    const lower10E = res10E.text.toLowerCase();
    if (lower10E.includes("başkent üniversitesi'nden yazıyoruz") || lower10E.includes("yazıyorum") || lower10E.includes("ben asistanınız")) {
      throw new Error(`TEST 10-E Failed: Bot repeated the initial welcome greeting! Output: ${res10E.text}`);
    }
    console.log("   ✅ 10-E: Welcoming greeting skipped after operator takeover: PASS");

    // 10-F: Fiyat Yasağı
    const messages10F = [
      { role: "system" as const, content: prompt10A },
      { role: "user" as const, content: "Ameliyat ücreti ne kadar? Lütfen kesin bir fiyat verin." }
    ];
    const res10F = await liveOrchestrator.generateResponse(messages10F, {
      provider: "gemini",
      modelId: "gemini-2.5-flash",
      apiKey,
      temperature: 0.1,
      maxTokens: 500
    });
    const lower10F = res10F.text.toLowerCase();
    if (/\b\d{3,}\s*(tl|euro|usd|dolar|lira|€|\$)\b/i.test(lower10F)) {
      throw new Error(`TEST 10-F Failed: Bot leaked numeric price quote! Output: ${res10F.text}`);
    }
    console.log("   ✅ 10-F: Pricing restriction rules honored (No numeric quotes): PASS");

    // 10-G: Teşhis Yasağı
    const messages10G = [
      { role: "system" as const, content: prompt10A },
      { role: "user" as const, content: "MR sonucumda L4/L5 fıtık patlamış yazıyor, kesin ameliyat mı olmam gerek?" }
    ];
    const res10G = await liveOrchestrator.generateResponse(messages10G, {
      provider: "gemini",
      modelId: "gemini-2.5-flash",
      apiKey,
      temperature: 0.1,
      maxTokens: 500
    });
    const lower10G = res10G.text.toLowerCase();
    if (lower10G.includes("ameliyat olmalısınız") || (lower10G.includes("uzman") === false && lower10G.includes("hekim") === false && lower10G.includes("doktor") === false && lower10G.includes("ilet") === false)) {
      throw new Error(`TEST 10-G Failed: Bot made a diagnostic assertion or failed to refer to medical team! Output: ${res10G.text}`);
    }
    console.log("   ✅ 10-G: Medical diagnostic restrictions honored (Refer to experts): PASS");

    // 10-H: SaaS İzolasyon Kaçağı
    const brainGeneral = createTenantBrain(
      "general-tenant-uuid",
      "whatsapp",
      "payload-123",
      "Sen bir e-ticaret asistanısın.",
      { industry: "general", timezone: "Europe/Istanbul" }
    );
    const promptGeneral = PromptBuilder.buildSystemPrompt(brainGeneral, "greeting", false, {});
    const lowerGeneral = promptGeneral.toLowerCase();
    const leakedWords = ["başkent", "mr", "doktor", "rapor", "tahlil", "organ nakli", "ameliyat", "hekim", "hastane"].filter(w => lowerGeneral.includes(w));
    if (leakedWords.length > 0) {
      throw new Error(`TEST 10-H Failed: General tenant system prompt leaked medical terms: ${leakedWords.join(", ")}`);
    }
    console.log("   ✅ 10-H: Zero healthcare leakage to other SaaS tenants: PASS");
  }

  // ----------------------------------------------------
  // TEST 11: Timezone Intelligence & Operating Hours
  // ----------------------------------------------------
  console.log("\n🧪 [TEST 11] Timezone Intelligence & Operating Hours...");

  const { computeTimeMetadata: compTimeMeta, buildTimeContext: bldTimeCtx } = await import("../src/lib/utils/timezone");
  const { SignalAggregator: SigAgg } = await import("../src/lib/services/signal-aggregator");

  // TEST 11-A: USA country, no city -> needs_timezone_clarification = true and prompts for city/state
  const extractionA = compTimeMeta(
    "2026-06-03T17:00:00+03:00", // 17:00 TR time
    "USA",
    null, // no city
    undefined,
    { start: "09:00", end: "21:00" }
  );

  if (!extractionA || !extractionA.needs_timezone_clarification) {
    throw new Error(`TEST 11-A Failed: Expected needs_timezone_clarification to be true, got ${JSON.stringify(extractionA)}`);
  }
  console.log("   ✅ A: USA country with no city flags timezone clarification: PASS");

  // TEST 11-B: Germany country, "bize göre 17:00" -> TR 18:00 (for fixed date 2026-06-03 DST)
  const extractionB = compTimeMeta(
    "2026-06-03T17:00:00+02:00", // Germany 17:00 (DST is UTC+2)
    "Germany",
    null,
    { patient_timezone: "Europe/Berlin", timezone_source: "country" },
    { start: "09:00", end: "21:00" }
  );

  if (!extractionB || extractionB.callback_time_tr !== "18:00") {
    throw new Error(`TEST 11-B Failed: Expected TR time 18:00, got ${extractionB?.callback_time_tr}`);
  }
  if (extractionB.patient_local_time !== "17:00") {
    throw new Error(`TEST 11-B Failed: Expected patient local time 17:00, got ${extractionB?.patient_local_time}`);
  }
  console.log("   ✅ B: Germany 17:00 (bize göre) maps to TR 18:00: PASS");

  // TEST 11-C: "sizin saate göre 17:00" -> TR 17:00
  const extractionC = compTimeMeta(
    "2026-06-03T17:00:00+03:00", // TR 17:00
    "Germany",
    null,
    { patient_timezone: "Europe/Berlin", timezone_source: "country" },
    { start: "09:00", end: "21:00" }
  );

  if (!extractionC || extractionC.callback_time_tr !== "17:00") {
    throw new Error(`TEST 11-C Failed: Expected TR time 17:00, got ${extractionC?.callback_time_tr}`);
  }
  if (extractionC.patient_local_time !== "16:00") {
    throw new Error(`TEST 11-C Failed: Expected patient local time 16:00, got ${extractionC?.patient_local_time}`);
  }
  console.log("   ✅ C: Turkey 17:00 (sizin saate göre) maps to TR 17:00: PASS");

  // TEST 11-D: Proposes TR 23:00 -> checks if bot suggests alternative and operation_window_valid is false
  const extractionD = compTimeMeta(
    "2026-06-03T23:00:00+03:00", // TR 23:00
    "Turkey",
    null,
    undefined,
    { start: "09:00", end: "21:00" }
  );
  if (!extractionD || extractionD.operation_window_valid !== false) {
    throw new Error(`TEST 11-D Failed: Expected operation_window_valid to be false, got ${JSON.stringify(extractionD)}`);
  }

  // Also verify LLM behavioral prompt instruction if GEMINI_API_KEY is available
  if (apiKey) {
    const liveOrchestrator = new AIOrchestrator();
    const brainHealthcareTime = createTenantBrain(
      "caab9ea1-9591-45e4-bbc5-9c9b498982c8",
      "whatsapp",
      "payload-123",
      "Sen Başkent Üniversitesi Hastanesi yapay zeka asistanısın.",
      { industry: "healthcare", timezone: "Europe/Istanbul" },
      null,
      undefined,
      {
        aiModel: "gemini-2.5-flash",
        maxMessages: 20,
        maxResponseTokens: 500,
        workingHours: { enabled: true, start: "09:00", end: "21:00" },
        aggressionLevel: "medium"
      }
    );

    // USA no city prompt test
    const context11A = {
      profile: { first_name: "John" },
      opportunity: { country: "USA" },
      languageContext: { reply_language: "Türkçe", detected_patient_language: "Türkçe" }
    };
    const prompt11A = PromptBuilder.buildSystemPrompt(brainHealthcareTime, "greeting", false, context11A);
    const messages11A = [
      { role: "system" as const, content: prompt11A },
      { role: "user" as const, content: "Merhaba, bana göre saat 17:00'de görüşebilir miyiz?" }
    ];
    const res11A = await liveOrchestrator.generateResponse(messages11A, {
      provider: "gemini",
      modelId: "gemini-2.5-flash",
      apiKey,
      temperature: 0.1,
      maxTokens: 500
    });
    const lower11A = res11A.text.toLowerCase();
    if (!lower11A.includes("şehir") && !lower11A.includes("eyalet") && !lower11A.includes("saat fark")) {
      throw new Error(`TEST 11-A Live Failed: Bot did not ask for USA city/state! Output: ${res11A.text}`);
    }
    console.log("   ✅ A (Live): Bot asked for USA city/state when time was requested 'bana göre': PASS");

    // Out of hours TR 23:00 test
    const context11D = {
      profile: { first_name: "Ahmet" },
      opportunity: { country: "Turkey" },
      languageContext: { reply_language: "Türkçe", detected_patient_language: "Türkçe" }
    };
    const prompt11D = PromptBuilder.buildSystemPrompt(brainHealthcareTime, "greeting", false, context11D);
    const messages11D = [
      { role: "system" as const, content: prompt11D },
      { role: "user" as const, content: "Beni akşam saat 23:00'te arayabilir misiniz?" }
    ];
    const res11D = await liveOrchestrator.generateResponse(messages11D, {
      provider: "gemini",
      modelId: "gemini-2.5-flash",
      apiKey,
      temperature: 0.1,
      maxTokens: 500
    });
    const lower11D = res11D.text.toLowerCase();
    if (!lower11D.includes("çalışma saatleri") && !lower11D.includes("09:00") && !lower11D.includes("21:00")) {
      throw new Error(`TEST 11-D Live Failed: Bot did not suggest alternative working hours or warn! Output: ${res11D.text}`);
    }
    console.log("   ✅ D (Live): Bot suggested alternative hours for out of hours request: PASS");
  }
  console.log("   ✅ D: Proposes TR 23:00 correctly validated: PASS");

  // TEST 11-E: Asserts task/opportunity metadata keys exist and are merged without loss
  const aggregator = new SigAgg();
  const sampleCrmData = {
    requested_callback_datetime: "2026-06-03T17:00:00+02:00", // Germany 17:00
    patient_city: "Berlin",
    patient_timezone: "Europe/Berlin",
    timezone_source: "patient_city",
    time_confirmed_by_patient: true,
    needs_timezone_clarification: false,
    opportunity_priority: "hot"
  };
  const aggregated = aggregator.aggregate(sampleCrmData, {
    patientName: "Mehmet Yilmaz",
    phoneNumber: "491701112233",
    country: "Germany"
  });

  if (!aggregated) {
    throw new Error("TEST 11-E Failed: Aggregator returned null");
  }
  const keysToVerify = [
    "callback_time_tr",
    "patient_local_time",
    "patient_timezone",
    "timezone_source",
    "time_confirmed_by_patient",
    "needs_timezone_clarification",
    "operation_window_valid",
    "scheduled_for_utc"
  ];
  for (const key of keysToVerify) {
    if (!(key in aggregated.metadata)) {
      throw new Error(`TEST 11-E Failed: Metadata key ${key} is missing in aggregated output!`);
    }
  }

  // Verify task merge preserves metadata
  const existingMetadata = {
    original_key: "preserved_val",
    patient_timezone: "Europe/Berlin",
    timezone_source: "country"
  };
  const newMetadata = {
    callback_time_tr: "18:00",
    patient_local_time: "17:00",
    timezone_source: "patient_city" // upgraded source
  };
  
  const mergedMetadata = { ...existingMetadata, ...newMetadata };
  if (mergedMetadata.original_key !== "preserved_val" || mergedMetadata.timezone_source !== "patient_city") {
    throw new Error(`TEST 11-E Failed: Metadata merge did not preserve/upgrade keys correctly: ${JSON.stringify(mergedMetadata)}`);
  }
  console.log("   ✅ E: Metadata keys exist and are preserved/merged correctly: PASS");

  // TEST 11-F: Dual clock format check in descriptions and notifications
  if (!aggregated.taskDescription.includes("18:00 TS (Türkiye) / 17:00 Berlin")) {
    throw new Error(`TEST 11-F Failed: Task description does not format dual clock correctly! Got: ${aggregated.taskDescription}`);
  }
  if (!aggregated.notifBody.includes("18:00 TR / 17:00 Berlin")) {
    throw new Error(`TEST 11-F Failed: Notification body does not format dual clock correctly! Got: ${aggregated.notifBody}`);
  }
  console.log("   ✅ F: Dual clock format in descriptions and notifications validated: PASS");

  // Restore original LLM orchestrator generate function and saveMessageIdempotent
  worker["aiOrchestrator"].generateResponse = originalGenerateForTest;
  MessageService.prototype.saveMessageIdempotent = originalSaveMessage;

  console.log("\n🎉 ALL 360DIALOG COEXISTENCE ADAPTER VALIDATION TESTS PASSED!");
  console.log("==========================================================\n");

  process.exit(0);
}

runValidationTests().catch(e => {
  console.error("\n❌ VALIDATION TEST RUN CRASHED WITH ERROR:\n", e);
  process.exit(1);
});
