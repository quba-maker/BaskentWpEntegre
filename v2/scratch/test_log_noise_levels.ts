import { getSession } from "../src/lib/auth/session";
import { withActionGuard } from "../src/lib/core/action-guard";

// Mock cookies for Next.js Server Actions
const mockCookies: any[] = [];
jestMockCookies();

function jestMockCookies() {
  const nextHeaders = require("next/headers");
  const originalCookies = nextHeaders.cookies;
  nextHeaders.cookies = async () => {
    return {
      get: (name: string) => mockCookies.find(c => c.name === name),
      delete: (name: string) => {
        const idx = mockCookies.findIndex(c => c.name === name);
        if (idx !== -1) mockCookies.splice(idx, 1);
      },
      set: (name: string, value: string) => {
        mockCookies.push({ name, value });
      }
    };
  };
}

// Helper to capture console outputs
function captureConsole(fn: () => void | Promise<void>) {
  const originalLog = console.log;
  const originalWarn = console.warn;
  const originalError = console.error;

  const logs: string[] = [];
  const warns: string[] = [];
  const errors: string[] = [];

  console.log = (...args: any[]) => { logs.push(args.join(" ")); };
  console.warn = (...args: any[]) => { warns.push(args.join(" ")); };
  console.error = (...args: any[]) => { errors.push(args.join(" ")); };

  try {
    const res = fn();
    if (res instanceof Promise) {
      return res.then(() => {
        console.log = originalLog;
        console.warn = originalWarn;
        console.error = originalError;
        return { logs, warns, errors };
      }).catch(e => {
        console.log = originalLog;
        console.warn = originalWarn;
        console.error = originalError;
        throw e;
      });
    } else {
      console.log = originalLog;
      console.warn = originalWarn;
      console.error = originalError;
      return Promise.resolve({ logs, warns, errors });
    }
  } catch (e) {
    console.log = originalLog;
    console.warn = originalWarn;
    console.error = originalError;
    return Promise.reject(e);
  }
}

async function runTests() {
  console.log("=== Running Forensic Log Noise Levels Test ===");

  // Test 1: Successful Auth / Guard with Flag = false (Default Production Mode)
  process.env.NODE_ENV = "production";
  process.env.DEBUG_AUTH_FORENSIC = "false";
  delete process.env.TEST_TENANT_ID; // Force real session check
  mockCookies.length = 0; // Empty cookies

  // Missing session should warn and block
  const test1 = await captureConsole(async () => {
    await withActionGuard({ actionName: "testAction" }, async () => {});
  });
  console.log("Test 1 (Production, No Session) Logs captured:");
  console.log("  LOGS:", test1.logs);
  console.log("  WARNS:", test1.warns);
  if (test1.warns.some(w => w.includes("GUARD_FORENSIC") && w.includes("BLOCKED: No session"))) {
    console.log("  ✅ Passed: Blocked warning was logged.");
  } else {
    console.log("  ❌ Failed: Blocked warning not logged!");
  }
  if (test1.logs.length === 0) {
    console.log("  ✅ Passed: No successful/noisy logs in production.");
  } else {
    console.log("  ❌ Failed: Noisy logs detected in production!");
  }

  // Test 2: Successful Auth / Guard with Flag = true
  process.env.DEBUG_AUTH_FORENSIC = "true";
  process.env.TEST_TENANT_ID = "test-tenant"; // Mock authenticated mode
  process.env.TEST_USER_ROLE = "platform_admin";

  const test2 = await captureConsole(async () => {
    await withActionGuard({ actionName: "testAction" }, async () => {});
  });
  console.log("\nTest 2 (Production + DEBUG_AUTH_FORENSIC=true) Logs captured:");
  console.log("  LOGS:", test2.logs);
  if (test2.logs.some(l => l.includes("GUARD_FORENSIC") && l.includes("session=OK"))) {
    console.log("  ✅ Passed: Guard OK was logged under debug flag.");
  } else {
    console.log("  ❌ Failed: Guard OK was not logged under debug flag!");
  }

  console.log("\nAll forensic log tests completed!");
}

runTests().catch(err => {
  console.error("Test failed:", err);
  process.exit(1);
});
