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
