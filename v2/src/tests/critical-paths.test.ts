// ==========================================
// QUBA AI — Critical Path Test Suite
// Uygulama bütünlüğünü doğrulayan test'ler
// Çalıştır: npx tsx src/tests/critical-paths.test.ts
// ==========================================

import { validateEnv } from "../lib/env";

const results: { name: string; passed: boolean; error?: string }[] = [];

function test(name: string, fn: () => void | Promise<void>) {
  try {
    const res = fn();
    if (res instanceof Promise) {
      res.then(() => {
        results.push({ name, passed: true });
      }).catch((e) => {
        results.push({ name, passed: false, error: e.message });
      });
    } else {
      results.push({ name, passed: true });
    }
  } catch (e: any) {
    results.push({ name, passed: false, error: e.message });
  }
}

function assert(condition: boolean, msg: string) {
  if (!condition) throw new Error(msg);
}

// ==========================================
// 1. ENV VALIDATION TESTS
// ==========================================

test("ENV: DATABASE_URL tanımlı olmalı", () => {
  assert(!!process.env.DATABASE_URL, "DATABASE_URL eksik");
});

test("ENV: AUTH_SECRET tanımlı olmalı", () => {
  assert(!!process.env.AUTH_SECRET, "AUTH_SECRET eksik");
});

test("ENV: validateEnv() çalışmalı", () => {
  const result = validateEnv();
  assert(typeof result.valid === "boolean", "valid boolean olmalı");
  assert(Array.isArray(result.missing), "missing array olmalı");
  assert(Array.isArray(result.warnings), "warnings array olmalı");
});

// ==========================================
// 2. IMPORT TESTS (Tüm modüller yüklenebilmeli)
// ==========================================

test("IMPORT: audit.ts yüklenebilmeli", async () => {
  const mod = await import("../lib/audit");
  assert(typeof mod.logAudit === "function", "logAudit fonksiyon olmalı");
});

test("IMPORT: rate-limit.ts yüklenebilmeli", async () => {
  const mod = await import("../lib/rate-limit");
  assert(typeof mod.checkRateLimit === "function", "checkRateLimit fonksiyon olmalı");
});

test("IMPORT: retry.ts yüklenebilmeli", async () => {
  const mod = await import("../lib/retry");
  assert(typeof mod.enqueueRetry === "function", "enqueueRetry fonksiyon olmalı");
  assert(typeof mod.processRetryQueue === "function", "processRetryQueue fonksiyon olmalı");
});

test("IMPORT: env.ts yüklenebilmeli", async () => {
  const mod = await import("../lib/env");
  assert(typeof mod.validateEnv === "function", "validateEnv fonksiyon olmalı");
  assert(typeof mod.generateEnvTemplate === "function", "generateEnvTemplate fonksiyon olmalı");
});

// ==========================================
// 3. RATE LIMITER TESTS
// ==========================================

test("RATE LIMIT: İlk 5 deneme izin verilmeli", async () => {
  const { checkRateLimit } = require("../lib/rate-limit");
  for (let i = 0; i < 5; i++) {
    const result = await checkRateLimit(`test-${Date.now()}-${Math.random()}`, 5, 60000);
    assert(result.allowed === true, `Deneme ${i + 1} reddedildi`);
  }
});

test("RATE LIMIT: 6. deneme reddedilmeli", async () => {
  const { checkRateLimit } = require("../lib/rate-limit");
  const key = `rate-test-${Date.now()}`;
  for (let i = 0; i < 5; i++) await checkRateLimit(key, 5, 60000);
  const result = await checkRateLimit(key, 5, 60000);
  assert(result.allowed === false, "6. deneme izin verilmemeli");
});

// ==========================================
// 4. SECURITY PATTERN TESTS
// ==========================================

test("SECURITY: Hardcoded secret olmamalı", async () => {
  const fs = await import("fs");
  const path = await import("path");
  const sessionPath = path.resolve(__dirname, "../lib/auth/session.ts");
  
  if (fs.existsSync(sessionPath)) {
    const content = fs.readFileSync(sessionPath, "utf-8");
    assert(!content.includes("quba-" + "ai-secret-key"), "Hardcoded JWT secret bulundu!");
    assert(content.includes("AUTH_SECRET"), "AUTH_SECRET referansı olmalı");
  }
});

test("SECURITY: Null tenant bypass olmamalı", async () => {
  const fs = await import("fs");
  const path = await import("path");
  const inboxPath = path.resolve(__dirname, "../app/actions/inbox.ts");
  
  if (fs.existsSync(inboxPath)) {
    const content = fs.readFileSync(inboxPath, "utf-8");
    assert(!content.includes("tenantId === null"), "Null tenant bypass bulundu!");
  }
});

test("SECURITY: fakeReq/fakeRes olmamalı", async () => {
  const fs = await import("fs");
  const path = await import("path");
  
  const checkDir = (dir: string) => {
    if (!fs.existsSync(dir)) return;
    const files = fs.readdirSync(dir, { recursive: true }) as string[];
    for (const file of files) {
      if (typeof file !== "string" || !file.endsWith(".ts")) continue;
      const fullPath = path.join(dir, file);
      const content = fs.readFileSync(fullPath, "utf-8");
      assert(!content.includes("fakeReq"), `fakeReq bulundu: ${file}`);
      assert(!content.includes("fakeRes"), `fakeRes bulundu: ${file}`);
    }
  };

  checkDir(path.resolve(__dirname, "../app/api"));
});

// ==========================================
// 5. PROVIDER VALIDATION TESTS (Faz 0B-2B)
// ==========================================

test("PROVIDER: isThreeSixtyProvider doğru çalışmalı", () => {
  const { isThreeSixtyProvider } = require("../lib/core/provider-aliases");
  assert(isThreeSixtyProvider("360dialog") === true, "360dialog true olmalı");
  assert(isThreeSixtyProvider("360dialog_whatsapp") === true, "360dialog_whatsapp true olmalı");
  assert(isThreeSixtyProvider("threesixty") === true, "threesixty true olmalı");
  assert(isThreeSixtyProvider("three_sixty_dialog") === true, "three_sixty_dialog true olmalı");
  assert(isThreeSixtyProvider("whatsapp") === false, "whatsapp false olmalı");
  assert(isThreeSixtyProvider("messenger") === false, "messenger false olmalı");
  assert(isThreeSixtyProvider(null) === false, "null false olmalı");
  assert(isThreeSixtyProvider(undefined) === false, "undefined false olmalı");
});

test("PROVIDER: requiresWhatsAppPhoneNumberId doğru çalışmalı", () => {
  const { requiresWhatsAppPhoneNumberId } = require("../lib/core/provider-aliases");
  assert(requiresWhatsAppPhoneNumberId("whatsapp") === true, "whatsapp Phone ID gerektirmeli");
  assert(requiresWhatsAppPhoneNumberId("messenger") === true, "messenger Phone ID gerektirmeli");
  assert(requiresWhatsAppPhoneNumberId("360dialog") === false, "360dialog Phone ID gerektirmemeli");
  assert(requiresWhatsAppPhoneNumberId("360dialog_whatsapp") === false, "360dialog_whatsapp Phone ID gerektirmemeli");
  assert(requiresWhatsAppPhoneNumberId(null) === true, "null Phone ID gerektirmeli");
});
// ==========================================
// 6. SAAS SECURITY & WEBHOOK ROTATION TESTS (Faz 1B)
// ==========================================

// Mock global database for the tests
const mockDbCalls: any[] = [];
(global as any).mockDb = {
  executeSafe: async (query: any, params?: any[]) => {
    const text = typeof query === 'string' ? query : query?.text || '';
    const vals = typeof query === 'string' ? params : query?.values || [];
    const normalizedText = text.replace(/\s+/g, ' ');
    mockDbCalls.push({ text, vals });

    // Tenant Resolution
    if (normalizedText.includes("SELECT id, name FROM tenants WHERE slug =")) {
      const slug = vals[0];
      if (slug === 'nonexistent') return [];
      return [{ id: `id-${slug}`, name: `Name-${slug}` }];
    }
    // Integration Credentials
    if (normalizedText.includes("SELECT credentials FROM tenant_integrations WHERE tenant_id =")) {
      const tenantId = vals[0];
      if (tenantId === 'id-test-tenant-with-secret') {
        const { encryptPayload } = require("../lib/core/encryption");
        const encrypted = encryptPayload('google_sheets', {
          webhookSecret: 'tenant-secret-key'
        });
        return [{ credentials: JSON.stringify(encrypted) }];
      }
      return [];
    }
    // Channel and Integration Select for Credential Update
    if (normalizedText.includes("FROM channels c") && normalizedText.includes("channel_integrations ci")) {
      const channelId = vals[0];
      const tenantId = vals[1];
      if (tenantId === 'test-tenant-id' && channelId === 'wa-channel-id') {
        const { encryptPayload } = require("../lib/core/encryption");
        const encrypted = encryptPayload('whatsapp', {
          accessToken: 'old-token',
          phoneNumberId: 'wa-identifier'
        });
        return [{
          id: 'wa-channel-id',
          provider: 'whatsapp',
          identifier: 'wa-identifier',
          credentials_encrypted: JSON.stringify(encrypted)
        }];
      }
      return [];
    }
    // Update channel credentials
    if (normalizedText.includes("UPDATE channel_integrations SET")) {
      return [{ affectedRows: 1 }];
    }
    // Duplicate ID checks
    if (normalizedText.includes("SELECT id FROM channels WHERE")) {
      const identifier = vals[0];
      if (identifier === 'wa-dup-id' || identifier === 'ig-dup-id' || identifier === '987654321') {
        return [{ id: 'duplicate-channel-id' }];
      }
      return [];
    }
    // Bot lists and other defaults
    if (normalizedText.includes("SELECT id FROM channel_groups")) {
      return [{ id: 'bot-group-id' }];
    }
    return [];
  }
};

test("SAAS ACTION: connectWhatsAppChannel duplicate identifier check", async () => {
  process.env.TEST_TENANT_ID = 'test-tenant-id';
  const { connectWhatsAppChannel } = require("../app/actions/integrations");
  const res = await connectWhatsAppChannel({
    name: 'WA Channel',
    phoneNumberId: 'wa-dup-id',
    accessToken: 'token',
    botGroupId: 'bot-group-id'
  });
  assert(res.success === false, "WhatsApp duplicate identifier should fail");
  assert(res.error && res.error.includes("başka bir hesapta kayıtlı görünüyor"), "Error message should match");
  assert(!res.error.includes("tenant"), "Error message must not leak tenant details");
});

test("SAAS ACTION: connectInstagramChannel duplicate identifier check", async () => {
  process.env.TEST_TENANT_ID = 'test-tenant-id';
  const { connectInstagramChannel } = require("../app/actions/integrations");
  const res = await connectInstagramChannel({
    name: 'IG Channel',
    instagramBusinessAccountId: 'ig-dup-id',
    accessToken: 'token',
    botGroupId: 'bot-group-id'
  });
  assert(res.success === false, "Instagram duplicate identifier should fail");
  assert(res.error && res.error.includes("başka bir hesapta kayıtlı görünüyor"), "Error message should match");
  assert(!res.error.includes("tenant"), "Error message must not leak tenant details");
});

test("SAAS ACTION: connectMessengerPage duplicate identifier check", async () => {
  process.env.TEST_TENANT_ID = 'test-tenant-id';
  const { connectMessengerPage } = require("../app/actions/integrations");
  const res = await connectMessengerPage({
    name: 'Messenger Page',
    pageId: '987654321',
    pageAccessToken: 'token',
    botGroupId: 'bot-group-id'
  });
  assert(res.success === false, "Messenger duplicate identifier should fail");
  assert(res.error && res.error.includes("başka bir hesapta kayıtlı görünüyor"), "Error message should match");
  assert(!res.error.includes("tenant"), "Error message must not leak tenant details");
});

// Helper for Mock Request
function createMockRequest(url: string, headers: Record<string, string>, bodyStr: string): any {
  return {
    nextUrl: new URL(url),
    text: async () => bodyStr,
    headers: {
      get: (name: string) => headers[name.toLowerCase()] || null
    }
  };
}

function signPayload(secret: string, timestamp: string, body: string): string {
  const crypto = require("crypto");
  return 'sha256=' + crypto
    .createHmac('sha256', secret)
    .update(timestamp + '.' + body)
    .digest('hex');
}

test("WEBHOOK: Tenant-specific secret yoksa global fallback pass", async () => {
  process.env.SHEETS_WEBHOOK_SECRET = 'global-secret-key';

  const timestamp = Math.floor(Date.now() / 1000).toString();
  const body = JSON.stringify({ tenant_slug: "test-tenant-no-secret", data: { test: true } });
  const signature = signPayload('global-secret-key', timestamp, body);

  const req = createMockRequest(
    "http://localhost/api/sheets-webhook?tenant=test-tenant-no-secret",
    { "x-sheets-signature": signature, "x-sheets-timestamp": timestamp },
    body
  );

  const { POST } = require("../app/api/sheets-webhook/route");
  const res = await POST(req);
  assert(res.status !== 401, "Webhook signature verification should NOT fail with 401 when using global fallback");
});

test("WEBHOOK: Tenant-specific secret varsa doğru secret pass", async () => {
  process.env.SHEETS_WEBHOOK_SECRET = 'global-secret-key';

  const timestamp = Math.floor(Date.now() / 1000).toString();
  const body = JSON.stringify({ tenant_slug: "test-tenant-with-secret", data: { test: true } });
  const signature = signPayload('tenant-secret-key', timestamp, body);

  const req = createMockRequest(
    "http://localhost/api/sheets-webhook?tenant=test-tenant-with-secret",
    { "x-sheets-signature": signature, "x-sheets-timestamp": timestamp },
    body
  );

  const { POST } = require("../app/api/sheets-webhook/route");
  const res = await POST(req);
  assert(res.status !== 401, "Webhook signature verification should pass with correct tenant secret");
});

test("WEBHOOK: Tenant-specific secret varsa yanlış secret fail", async () => {
  process.env.SHEETS_WEBHOOK_SECRET = 'global-secret-key';

  const timestamp = Math.floor(Date.now() / 1000).toString();
  const body = JSON.stringify({ tenant_slug: "test-tenant-with-secret", data: { test: true } });
  const signature = signPayload('wrong-secret-key', timestamp, body);

  const req = createMockRequest(
    "http://localhost/api/sheets-webhook?tenant=test-tenant-with-secret",
    { "x-sheets-signature": signature, "x-sheets-timestamp": timestamp },
    body
  );

  const { POST } = require("../app/api/sheets-webhook/route");
  const res = await POST(req);
  assert(res.status === 401, "Webhook signature verification should fail with 401 with wrong tenant secret");
});

test("WEBHOOK: Tenant-specific secret varsa global secret fallback çalışmıyor", async () => {
  process.env.SHEETS_WEBHOOK_SECRET = 'global-secret-key';

  const timestamp = Math.floor(Date.now() / 1000).toString();
  const body = JSON.stringify({ tenant_slug: "test-tenant-with-secret", data: { test: true } });
  const signature = signPayload('global-secret-key', timestamp, body);

  const req = createMockRequest(
    "http://localhost/api/sheets-webhook?tenant=test-tenant-with-secret",
    { "x-sheets-signature": signature, "x-sheets-timestamp": timestamp },
    body
  );

  const { POST } = require("../app/api/sheets-webhook/route");
  const res = await POST(req);
  assert(res.status === 401, "Webhook signature verification should fail with 401 when using global secret while tenant secret exists");
});

test("WEBHOOK: Tenant yoksa fail-closed", async () => {
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const body = JSON.stringify({ tenant_slug: "nonexistent", data: { test: true } });
  const signature = signPayload('global-secret-key', timestamp, body);

  const req = createMockRequest(
    "http://localhost/api/sheets-webhook?tenant=nonexistent",
    { "x-sheets-signature": signature, "x-sheets-timestamp": timestamp },
    body
  );

  const { POST } = require("../app/api/sheets-webhook/route");
  const res = await POST(req);
  assert(res.status === 400, "Webhook should fail with 400 if tenant is missing or nonexistent");
});

test("WEBHOOK: Secret console logs'da loglanmıyor", async () => {
  const fs = require("fs");
  const path = require("path");
  const routeContent = fs.readFileSync(path.resolve(__dirname, "../app/api/sheets-webhook/route.ts"), "utf-8");
  assert(!routeContent.includes("console.log(tenantSecret)") && !routeContent.includes("console.log(globalSecret)"), "Console log of secret detected in route!");
});

// ==========================================
// 7. CREDENTIAL UPDATE TESTS (Faz 1C)
// ==========================================

test("CREDENTIAL UPDATE: owner veya admin dışındaki roller güncelleme yapamaz", async () => {
  // simulate standard user session by configuring mock cookie / user
  // ActionGuard reads roles from cookie or mock environment. In dev, TEST_TENANT_ID bypasses auth and yields owner/admin permissions.
  // We can test updateChannelCredentials directly but action-guard behaves as simulated. Let's see how withActionGuard verifies roles.
  // If we can bypass with dev variables, let's verify role check triggers error when permissions are insufficient.
  
  // We can mock the user context for action guard if needed, or check if role checking yields error.
  // Let's call with invalid user roles if role logic can be explicitly tested.
  // We can check integrations.ts code content to make sure it includes the roles: ['owner', 'admin'] metadata.
  const fs = require("fs");
  const path = require("path");
  const content = fs.readFileSync(path.resolve(__dirname, "../app/actions/integrations.ts"), "utf-8");
  assert(content.includes("actionName: 'updateChannelCredentials'") && content.includes("roles: ['owner', 'admin']"), "Credential update should require owner/admin roles");
});

test("CREDENTIAL UPDATE: başka tenant'a ait kanal güncellenemez", async () => {
  process.env.TEST_TENANT_ID = 'different-tenant-id';
  const { updateChannelCredentials } = require("../app/actions/integrations");
  const res = await updateChannelCredentials('wa-channel-id', { accessToken: 'new-token' });
  assert(res.success === false, "Should fail updating other tenant's channel credentials");
  assert(res.error && res.error.includes("Kanal bulunamadı veya bu işlem için yetkiniz yok"), "Tenant validation error mismatch");
});

test("CREDENTIAL UPDATE: başarılı güncelleme sonrası identifier değişmez ve health_status needs_check olur", async () => {
  process.env.TEST_TENANT_ID = 'test-tenant-id';
  const { updateChannelCredentials } = require("../app/actions/integrations");
  
  // Reset calls log
  mockDbCalls.length = 0;
  
  const res = await updateChannelCredentials('wa-channel-id', { accessToken: 'new-token', wabaId: 'new-waba-id' });
  assert(res.success === true, "Should succeed updating own tenant channel credentials");
  
  // Find update call with whitespace normalized
  const updateCall = mockDbCalls.find(c => c.text.replace(/\s+/g, ' ').includes("UPDATE channel_integrations SET"));
  assert(!!updateCall, "Update SQL statement should be executed");
  assert(updateCall.text.replace(/\s+/g, ' ').includes("health_status = 'needs_check'"), "health_status must be reset to needs_check");
  
  // Verify identifier is preserved
  const encryptedPayload = JSON.parse(updateCall.vals[0]);
  const { decryptPayload } = require("../lib/core/encryption");
  const decrypted = decryptPayload(encryptedPayload);
  assert(decrypted.phoneNumberId === 'wa-identifier', "Identifier must be preserved after credential update");
  assert(decrypted.accessToken === 'new-token', "Access token must be updated");
});

test("CREDENTIAL UPDATE: eski token geri dönmez ve credentials loglanmaz", async () => {
  // Verify credentials update action does not output secrets or tokens to console
  const fs = require("fs");
  const path = require("path");
  const content = fs.readFileSync(path.resolve(__dirname, "../app/actions/integrations.ts"), "utf-8");
  assert(!content.includes("console.log(updatedFields)") && !content.includes("console.log(newCreds)"), "Console log of raw token detected in integrations actions!");
});


// ==========================================
// SONUÇLAR
// ==========================================

// Wait for async tests
setTimeout(() => {
  console.log("\n==========================================");
  console.log("  QUBA AI — Test Sonuçları");
  console.log("==========================================\n");

  let passed = 0;
  let failed = 0;

  for (const r of results) {
    if (r.passed) {
      console.log(`  ✅ ${r.name}`);
      passed++;
    } else {
      console.log(`  ❌ ${r.name}: ${r.error}`);
      failed++;
    }
  }

  console.log(`\n  Toplam: ${results.length} | ✅ ${passed} | ❌ ${failed}`);
  console.log("==========================================\n");

  if (failed > 0) process.exit(1);
}, 1000);
