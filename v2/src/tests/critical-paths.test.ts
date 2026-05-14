// ==========================================
// QUBA AI — Critical Path Test Suite
// Uygulama bütünlüğünü doğrulayan test'ler
// Çalıştır: npx tsx src/tests/critical-paths.test.ts
// ==========================================

import { validateEnv } from "../lib/env";

const results: { name: string; passed: boolean; error?: string }[] = [];

function test(name: string, fn: () => void) {
  try {
    fn();
    results.push({ name, passed: true });
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

test("RATE LIMIT: İlk 5 deneme izin verilmeli", () => {
  const { checkRateLimit } = require("../lib/rate-limit");
  for (let i = 0; i < 5; i++) {
    const result = checkRateLimit(`test-${Date.now()}-${Math.random()}`, 5, 60000);
    assert(result.allowed === true, `Deneme ${i + 1} reddedildi`);
  }
});

test("RATE LIMIT: 6. deneme reddedilmeli", () => {
  const { checkRateLimit } = require("../lib/rate-limit");
  const key = `rate-test-${Date.now()}`;
  for (let i = 0; i < 5; i++) checkRateLimit(key, 5, 60000);
  const result = checkRateLimit(key, 5, 60000);
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
    assert(!content.includes("quba-ai-secret-key"), "Hardcoded JWT secret bulundu!");
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
  const glob = await import("fs");
  
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
