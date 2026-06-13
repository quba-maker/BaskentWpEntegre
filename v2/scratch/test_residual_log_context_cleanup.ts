// ==========================================
// QUBA AI — Telemetry Cleanliness Test
// ==========================================

import { getNotificationCount } from "../src/app/actions/notifications";
import { getDashboardStats } from "../src/app/actions/dashboard";
import { getAiTimeline } from "../src/app/actions/ai-os";
import { getAiStatusForConversation, getConversationTraces, getCustomerAiBrain } from "../src/app/actions/ai-observability";
import { ingestSheetBatch } from "../src/lib/services/sheets-ingestion.service";

// Enable Test Mode for Action Guard
process.env.TEST_TENANT_ID = "test-tenant-uuid";
process.env.TEST_USER_ID = "test-user-uuid";
process.env.TEST_USER_ROLE = "owner";

const capturedLogs: any[] = [];
const originalConsoleLog = console.log;

// Intercept console.log to inspect structured output or JSON
console.log = (message?: any, ...optionalParams: any[]) => {
  let payload: any = null;
  if (optionalParams && optionalParams.length > 0 && typeof optionalParams[0] === "object") {
    payload = optionalParams[0];
  } else if (typeof message === "object" && message !== null) {
    payload = message;
  } else if (typeof message === "string") {
    try {
      payload = JSON.parse(message);
    } catch (_) {}
  }
  
  if (payload) {
    capturedLogs.push(payload);
  }
  
  originalConsoleLog(message, ...optionalParams);
};

// Global DB Mock
(global as any).mockDb = {
  executeSafe: async (query: any, params?: any[]) => {
    const text = typeof query === "string" ? query : query?.text || "";
    const vals = typeof query === "string" ? params : query?.values || [];
    const normText = text.replace(/\s+/g, " ");

    // Conversations queries
    if (normText.includes("FROM conversations") && normText.includes("phone_number = $1")) {
      return [{ id: "resolved-conv-uuid", phone_number: vals[0], customer_id: "customer-uuid", lead_stage: "new" }];
    }
    if (normText.includes("FROM conversations") && normText.includes("id::text = $1")) {
      return [{ id: "resolved-conv-uuid", phone_number: "905554443322", customer_id: "customer-uuid", lead_stage: "new" }];
    }
    // Notifications Count queries
    if (normText.includes("COUNT(*) FROM notifications") || normText.includes("unread")) {
      return [{ count: 3 }];
    }
    // Dashboard Stats queries
    if (normText.includes("COUNT(*) as c FROM")) {
      return [{ c: "42" }];
    }
    if (normText.includes("FROM messages WHERE tenant_id = $1 AND created_at >= NOW()")) {
      return [{ day: "2026-06-12", c: "12" }];
    }
    if (normText.includes("FROM leads l")) {
      return [{ patient_name: "Ahmet Yilmaz", phone_number: "905554443322", form_name: "Lead Form", created_at: new Date().toISOString() }];
    }
    // Timeline / AI Events
    if (normText.includes("FROM ai_events")) {
      return [{ event_type: "ai_response_generated", event_category: "orchestration", severity: "info", created_at: new Date().toISOString() }];
    }
    // Ingestion checks
    if (normText.includes("FROM leads") && normText.includes("phone_number LIKE")) {
      return []; // simulate no duplicates
    }
    if (normText.includes("INSERT INTO leads")) {
      return [{ id: "new-lead-uuid", phone_number: "905554443322", patient_name: "Ahmet", email: "ahmet@gmail.com", raw_data: "{}", stage: "new" }];
    }
    // Identity resolution
    if (normText.includes("FROM customer_profiles")) {
      return [{ id: "resolved-customer-uuid" }];
    }
    if (normText.includes("SELECT id, slug FROM tenants WHERE slug =")) {
      return [{ id: "test-tenant-uuid", name: "Test Tenant", slug: "test-tenant" }];
    }

    return [];
  }
};

// Global Fetch Mock for Sheets Ingestion
const originalFetch = global.fetch;
global.fetch = async (url: RequestInfo | URL, options?: RequestInit): Promise<Response> => {
  const urlStr = url.toString();
  if (urlStr.includes("spreadsheets") && urlStr.endsWith("fields=sheets.properties")) {
    return {
      ok: true,
      status: 200,
      json: async () => ({
        sheets: [{ properties: { title: "Google Sheets", hidden: false } }]
      }),
      text: async () => ""
    } as any;
  }
  if (urlStr.includes("values:batchGet")) {
    return {
      ok: true,
      status: 200,
      json: async () => ({
        valueRanges: [{
          range: "Google Sheets!A1:Z",
          values: [
            ["WhatsApp_Number", "Full Name", "Email", "Date", "Notes", "Campaign_Name"],
            ["905554443322", "Ahmet Yilmaz", "ahmet@gmail.com", "12.06.2026 12:00:00", "Sırt ağrısı", "TR Kampanya"]
          ]
        }]
      }),
      text: async () => ""
    } as any;
  }
  return originalFetch(url, options);
};

async function runTests() {
  console.log("Starting Telemetry Cleanliness Tests...\n");

  let testPassed = true;

  const assertCleanLogs = (actionLabel: string, expectedConvId?: string) => {
    const actionLogs = capturedLogs.filter(l => l.action === actionLabel || l.module === actionLabel);
    if (actionLogs.length === 0) {
      console.log(`❌ No logs captured for action: ${actionLabel}`);
      testPassed = false;
      return;
    }
    for (const log of actionLogs) {
      if (log.tenantId === "MISSING_TENANT_ID") {
        console.log(`❌ [${actionLabel}] Log contains MISSING_TENANT_ID:`, log);
        testPassed = false;
      }
      if (log.conversationId === "MISSING_CONVERSATION_ID") {
        console.log(`❌ [${actionLabel}] Log contains MISSING_CONVERSATION_ID:`, log);
        testPassed = false;
      }
      // Check that the completion log resolved the conversationId
      if (expectedConvId && log.message === "Action completed successfully" && log.conversationId !== expectedConvId) {
        console.log(`❌ [${actionLabel}] Expected completion conversationId to resolve to ${expectedConvId}, but got ${log.conversationId}`);
        testPassed = false;
      }
    }
  };

  // Test 1: getNotificationCount
  capturedLogs.length = 0;
  await getNotificationCount();
  assertCleanLogs("getNotificationCount", "notification_action_no_conversation");

  // Test 2: getDashboardStats
  capturedLogs.length = 0;
  await getDashboardStats();
  assertCleanLogs("getDashboardStats", "dashboard_action_no_conversation");

  // Test 3: getAiTimeline (with conversation found)
  capturedLogs.length = 0;
  await getAiTimeline("905554443322");
  assertCleanLogs("getAiTimeline", "resolved-conv-uuid");

  // Test 4: getAiStatusForConversation (with conversation found)
  capturedLogs.length = 0;
  await getAiStatusForConversation("905554443322");
  assertCleanLogs("getAiStatusForConversation", "resolved-conv-uuid");

  // Test 5: getConversationTraces
  capturedLogs.length = 0;
  await getConversationTraces("resolved-conv-uuid");
  assertCleanLogs("getConversationTraces", "resolved-conv-uuid");

  // Test 6: getCustomerAiBrain
  capturedLogs.length = 0;
  await getCustomerAiBrain("905554443322");
  assertCleanLogs("getCustomerAiBrain", "resolved-conv-uuid");

  // Test 7: ingestSheetBatch (Cron Sync)
  capturedLogs.length = 0;
  await ingestSheetBatch({
    tenantId: "test-tenant-uuid",
    tenantName: "Test Tenant",
    apiKey: "dummy-api-key",
    spreadsheetId: "dummy-spreadsheet-id",
    activeSheets: ["Google Sheets"],
    skipAutoMessage: true,
    source: "cron_sync"
  });
  assertCleanLogs("SheetsIngestion", "cron_sync_no_conversation");

  if (testPassed) {
    console.log("\n==========================================");
    console.log("  🎉 ALL TELEMETRY CLEANUP TESTS PASSED!");
    console.log("  No MISSING_TENANT_ID or MISSING_CONVERSATION_ID found.");
    console.log("==========================================\n");
    process.exit(0);
  } else {
    console.log("\n==========================================");
    console.log("  ❌ TELEMETRY CLEANUP TESTS FAILED!");
    console.log("==========================================\n");
    process.exit(1);
  }
}

runTests().catch(e => {
  console.error("Test execution crashed:", e);
  process.exit(1);
});
