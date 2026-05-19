import { test, expect, chromium } from "@playwright/test";

// =========================================================================
// QUBA AI OS — Playwright E2E & Chaos Engineering Suite
// =========================================================================
// This suite tests the resilience and data integrity of the realtime chat,
// inbox, AI streaming, and isolation layer under severe failure states.
// =========================================================================

test.describe("QUBA AI CRM — Inbox & Realtime Chaos Suite", () => {

  // A helper function to create a validated mock active session in the browser
  async function setupMockSession(page: any, tenantSlug = "baskent-saglik") {
    await page.goto(`/${tenantSlug}/inbox`);
    
    // Inject mock JWT token & session state to localStorage to bypass login during tests
    await page.evaluate(() => {
      window.localStorage.setItem("quba_auth_token", "mock-session-jwt-12345");
      window.localStorage.setItem("quba_active_tenant", "baskent-saglik");
      window.localStorage.setItem("quba_user", JSON.stringify({
        id: "usr_active",
        name: "Test Engineer",
        role: "admin"
      }));
    });

    // Reload page to apply session changes
    await page.reload();
  }

  // 1. RECONNECT & OFFLINE RECOVERY
  test("should gracefully handle disconnection, buffer actions, and recover state when online", async ({ page, context }) => {
    await setupMockSession(page);
    
    // Ensure we are in the active inbox list
    const inputArea = page.locator("textarea[placeholder*='Mesaj']");
    await expect(inputArea).toBeVisible({ timeout: 15000 });

    // Emulate network going offline
    console.log("🔌 Emulating server disconnection (Network Offline)...");
    await context.setOffline(true);

    // Verify offline banner/toast is rendered in the UI
    const offlineIndicator = page.locator("[id='offline-sync-status']");
    await expect(offlineIndicator).toContainText("Bağlantı Kesildi", { timeout: 5000 });

    // Type a message and hit send while offline
    await inputArea.fill("Offline message attempt");
    await page.keyboard.press("Enter");

    // The message bubble should be shown in "pending" or "optimistic" state (visually pending/grayed)
    const pendingBubble = page.locator(".message-bubble-pending");
    await expect(pendingBubble).toBeVisible();

    // Emulate network coming back online
    console.log("⚡ Restoring network connection (Network Online)...");
    await context.setOffline(false);

    // Verify the offline indicator resolves to connected
    await expect(offlineIndicator).toContainText("Bağlı", { timeout: 10000 });

    // The message bubble should be successfully delivered and marked sent (not pending)
    await expect(pendingBubble).not.toBeVisible({ timeout: 15000 });
    const sentBubble = page.locator(".message-bubble").last();
    await expect(sentBubble).toContainText("Offline message attempt");
  });

  // 2. DUPLICATE DELIVERY RECONCILIATION
  test("should deduplicate multiple rapid identical webhook messages at client level", async ({ page }) => {
    await setupMockSession(page);
    
    // Inject two identical messages into local state via EventHub/SSE event simulation
    await page.evaluate(() => {
      const duplicatePayload = {
        id: "msg_duplicate_999",
        providerMessageId: "wamid.HBgLOTE1NTE...",
        body: "Duplicate Event Testing",
        senderId: "905321111111",
        timestamp: Date.now(),
        direction: "inbound"
      };

      // Dispatch event twice in rapid succession simulating duplicate webhook deliveries
      window.dispatchEvent(new CustomEvent("realtime:message", { detail: duplicatePayload }));
      window.dispatchEvent(new CustomEvent("realtime:message", { detail: duplicatePayload }));
    });

    // Check message inbox feed
    const matchingBubbles = page.locator(".message-bubble:has-text('Duplicate Event Testing')");
    
    // Expect only a single instance of the message to be rendered in the DOM
    await expect(matchingBubbles).toHaveCount(1, { timeout: 5000 });
  });

  // 3. CROSS-TAB FAILOVER & SYNC
  test("should seamlessly sync active state and events between multiple active browser tabs", async ({ context }) => {
    const page1 = await context.newPage();
    const page2 = await context.newPage();

    await setupMockSession(page1);
    await setupMockSession(page2);

    // Both pages must be on inbox
    await page1.goto("/baskent-saglik/inbox");
    await page2.goto("/baskent-saglik/inbox");

    // Type message in tab 1
    const input1 = page1.locator("textarea[placeholder*='Mesaj']");
    await expect(input1).toBeVisible({ timeout: 10000 });
    await input1.fill("Cross-tab sync message");
    await page1.keyboard.press("Enter");

    // Expect tab 1 to display the sent message
    await expect(page1.locator(".message-bubble").last()).toContainText("Cross-tab sync message");

    // Expect tab 2 to automatically sync and display the exact same message without reloading
    await expect(page2.locator(".message-bubble").last()).toContainText("Cross-tab sync message", { timeout: 10000 });
  });

  // 4. SESSION TOKEN EXPIRY & SILENT AUTOMATIC REFRESH
  test("should silently refresh expired session tokens without throwing user out of active chat", async ({ page }) => {
    await setupMockSession(page);
    
    // Set token to an expired state in localStorage
    await page.evaluate(() => {
      window.localStorage.setItem("quba_auth_token", "expired_token_signature");
    });

    // Intercept token refresh endpoint to simulate a successful silent token rotation
    await page.route("**/api/auth/refresh", async (route) => {
      console.log("🔄 Playwright intercepted token refresh endpoint. Returning valid tokens...");
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ token: "refreshed_valid_jwt_token" })
      });
    });

    // Trigger a backend-reliant action (e.g., fetch conversation details)
    await page.click(".conversation-item:first-child");

    // The token in localStorage should automatically rotate to the refreshed token
    await page.waitForFunction(() => {
      return window.localStorage.getItem("quba_auth_token") === "refreshed_valid_jwt_token";
    }, { timeout: 10000 });

    // Assert that we did not get redirected back to /login
    expect(page.url()).not.toContain("/login");
  });

  // 5. WEBSOCKET FAILURE & HTTP POLLING FALLBACK
  test("should seamlessly degrade to HTTP Polling when Ably/Websocket connections are blocked", async ({ page }) => {
    // Intercept and block Ably websocket/SSE initialization traffic
    await page.route("**/*ably*", async (route) => {
      console.log(`❌ Blocking Ably Connection: ${route.request().url()}`);
      await route.abort("failed");
    });

    // Initialize session
    await setupMockSession(page);

    // Watch for fallback HTTP polling requests to the fallback message API
    let pollingTriggered = false;
    await page.route("**/api/messages/poll*", async (route) => {
      console.log("🔄 Fallback HTTP polling request intercepted!");
      pollingTriggered = true;
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ messages: [] })
      });
    });

    // Wait a brief duration and check if fallback polling is active
    await page.waitForTimeout(5000);
    expect(pollingTriggered).toBe(true);

    // The UI connection status indicator should reflect "Fallback mode (Polling)"
    const offlineIndicator = page.locator("[id='offline-sync-status']");
    await expect(offlineIndicator).toContainText("Yedek Mod", { timeout: 5000 });
  });
});
