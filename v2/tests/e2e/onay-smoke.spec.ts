import { test, expect } from "@playwright/test";
import { execSync } from "child_process";
import fs from "fs";
import path from "path";

// =========================================================================
// QUBA AI OS — Draft Approval Center E2E & Smoke Validation Suite
// =========================================================================
// This script verifies the end-to-end user experience and dashboard
// regression metrics under realistic operational conditions.
// =========================================================================

test.describe("QUBA AI CRM — Onay Merkezi E2E & Smoke Suite", () => {
  const tenantSlug = "baskent";
  let injectedData: any = null;
  const consoleErrors: string[] = [];

  // Before all tests, inject E2E mock draft data using our helper script
  test.beforeAll(async () => {
    console.log("💉 Injecting test drafts into the database...");
    execSync("npx tsx scripts/manage-e2e-data.ts --prepare");

    const dataFile = path.join(process.cwd(), "scratch-e2e-data.json");
    if (fs.existsSync(dataFile)) {
      injectedData = JSON.parse(fs.readFileSync(dataFile, "utf-8"));
      console.log("💉 Loaded injected test data:", injectedData);
    } else {
      throw new Error("❌ Injected data file scratch-e2e-data.json was not generated!");
    }
  });

  // After all tests, clean up our test data so we leave a pristine database
  test.afterAll(async () => {
    console.log("🧹 Cleaning up injected test drafts from database...");
    execSync("npx tsx scripts/manage-e2e-data.ts --cleanup");
  });

  // Set up console error listeners for each page context
  test.beforeEach(async ({ page, context }) => {
    // Grant clipboard read/write permissions for headless browser context
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);

    consoleErrors.length = 0;
    page.on("pageerror", (exception) => {
      const msg = exception.message.toLowerCase();
      if (
        msg.includes("ably") ||
        msg.includes("detached") ||
        msg.includes("unexpected response") ||
        msg.includes("websocket") ||
        msg.includes("connection closed") ||
        msg.includes("fetch")
      ) {
        console.log(`ℹ️ [IGNORED PAGE ERROR] ${exception.message}`);
        return;
      }
      console.error("❌ Uncaught exception on page:", exception.message);
      consoleErrors.push(exception.message);
    });
    page.on("console", (msg) => {
      if (msg.type() === "error") {
        const txt = msg.text().toLowerCase();
        if (
          txt.includes("ably") ||
          txt.includes("detached") ||
          txt.includes("unexpected response") ||
          txt.includes("websocket") ||
          txt.includes("network") ||
          txt.includes("clipboard") ||
          txt.includes("fetch") ||
          txt.includes("connection closed")
        ) {
          return; // Ignore network/ably/clipboard/fetch issues
        }
        console.warn("⚠️ Console error logged:", msg.text());
        consoleErrors.push(msg.text());
      }
    });
  });

  // =========================================================================
  // CORE ON-PAGE SMOKE TEST
  // =========================================================================
  test("should authenticate, verify navigation, filter/search drafts, edit, copy, approve, and check regression", async ({ page }) => {
    // 1. Local browser login works?
    console.log("🔑 [STEP 1] Testing local browser login...");
    await page.goto("/login");
    await expect(page).toHaveTitle(/Quba AI/);

    const emailInput = page.locator("input[type='email']");
    const passwordInput = page.locator("input[type='password']");
    const loginButton = page.locator("button[type='submit']");

    await emailInput.fill("admin@baskent.com");
    await passwordInput.fill("admin1234");
    await loginButton.click();

    // Verify it redirects to the active tenant dashboard
    await page.waitForURL(`**/${tenantSlug}`, { timeout: 15000 });
    console.log("✅ Authenticated and redirected to dashboard successfully!");

    // 2. Sidebar contains `Onay Merkezi`?
    console.log("🔗 [STEP 2] Verifying sidebar menu and navigation...");
    const sidebarLink = page.locator("a:has-text('Onay Merkezi')");
    await expect(sidebarLink).toBeVisible();

    // 3. Page `/{tenant_slug}/onay` loads?
    await sidebarLink.click();
    await page.waitForURL(`**/${tenantSlug}/onay`, { timeout: 10000 });
    console.log("✅ Navigation to Onay Merkezi confirmed!");

    // 4. Taslak listesi render oluyor mu?
    const headerTitle = page.locator("h2:has-text('Taslak Onay Merkezi')");
    await expect(headerTitle).toBeVisible();

    // Verify Zero Outbound warning banner
    const warningBanner = page.locator("span:has-text('🔒 P0 Denetim Modu Güvenlik Kuralı:')");
    await expect(warningBanner).toBeVisible();

    // 5. Bot Delegation draft listed? (Filter tabs test)
    console.log("🤖 [STEP 3] Filtering and validating draft pipelines...");
    await page.click("div.overflow-x-auto button:has-text('Bot Takip')");
    await page.waitForTimeout(500); // Allow list animation
    const botDraftCard = page.locator("div.cursor-pointer:has-text('E2E BOT DRAFT')");
    await expect(botDraftCard).toBeVisible({ timeout: 15000 });

    // 6. Appointment Reminder draft listed?
    await page.click("div.overflow-x-auto button:has-text('Randevular')");
    await page.waitForTimeout(500);
    const reminderDraftCard = page.locator("div.cursor-pointer:has-text('E2E REMINDER DRAFT')");
    await expect(reminderDraftCard).toBeVisible({ timeout: 15000 });

    // 7. Remarketing draft listed?
    await page.click("div.overflow-x-auto button:has-text('Remarketing')");
    await page.waitForTimeout(500);
    const remarketingDraftCard = page.locator("div.cursor-pointer:has-text('E2E REMARKETING DRAFT')");
    await expect(remarketingDraftCard).toBeVisible({ timeout: 15000 });

    // 8. Greeting draft listed?
    await page.click("div.overflow-x-auto button:has-text('Karşılama')");
    await page.waitForTimeout(500);
    const greetingDraftCard = page.locator("div.cursor-pointer:has-text('Merve Test')");
    await expect(greetingDraftCard).toBeVisible({ timeout: 15000 });

    // 9. Filters & 10. Search çalışıyor mu?
    console.log("🔍 [STEP 4] Testing query search input...");
    await page.click("button:has-text('Tümü')");
    const searchInput = page.locator("input[placeholder*='Hasta adı']");
    await searchInput.fill("Merve Test");
    await page.click("button:has-text('Ara')");
    await page.waitForTimeout(500);
    
    // We searched for "Merve Test" (the Greeting lead name), so only that should be listed
    await expect(page.locator("div.cursor-pointer")).toHaveCount(1);
    await searchInput.fill(""); // Clear search
    await page.click("button:has-text('Ara')");
    await page.waitForTimeout(500);

    // 11. Satıra tıklayınca drawer açılıyor mu?
    console.log("📋 [STEP 5] Testing Apple-style sliding drawer...");
    // Let's click on the Bot Takip tab first, then open its drawer
    await page.click("button:has-text('Bot Takip')");
    await page.waitForTimeout(500);
    await page.click("div.cursor-pointer:has-text('E2E BOT DRAFT')");

    const drawerTitle = page.locator("h3:has-text('Bot Takip İncelemesi')");
    // Wait for drawer to slide in
    await expect(page.locator("div.fixed.right-0")).toBeVisible({ timeout: 5000 });
    console.log("✅ Slide-over drawer opened successfully!");

    // 12. Drawer içinde hasta bilgisi, AI özeti, risk flags, 24h window bilgisi görünüyor mu?
    const drawerPhone = page.locator("div.fixed.right-0 span:has-text('+90 *** **')").first();
    await expect(drawerPhone).toBeVisible();

    const windowBadge = page.locator("div.fixed.right-0 span:has-text('KAPALI')").first();
    await expect(windowBadge).toBeVisible();

    const riskBadge = page.locator("div.fixed.right-0 span:has-text('PENCERE KAPALI')").first();
    await expect(riskBadge).toBeVisible();

    // 13. Draft textarea editable mı? & 14. Karakter sayacı çalışıyor mu?
    console.log("✍️ [STEP 6] Testing draft editing and character counters...");
    const textarea = page.locator("div.fixed.right-0 textarea").first();
    await expect(textarea).toBeVisible();
    
    const initialText = await textarea.inputValue();
    expect(initialText).toContain("E2E BOT DRAFT");

    const charCounter = page.locator("div.fixed.right-0 span:has-text('karakter')").first();
    const initialCharCount = await charCounter.textContent();
    console.log(`   - Initial count: ${initialCharCount}`);

    // Modify the textarea content
    await textarea.fill("Düzenlenmiş E2E Deneme Taslak Metni.");
    await page.waitForTimeout(300);

    const updatedCharCount = await charCounter.textContent();
    console.log(`   - Updated count: ${updatedCharCount}`);
    expect(updatedCharCount).not.toBe(initialCharCount);

    // 16. `Düzenlemeyi Kaydet` çalışıyor mu?
    await page.click("div.fixed.right-0 button:has-text('Düzenlemeyi Kaydet')");
    const toast = page.getByText("Taslak güncellendi.");
    await expect(toast).toBeVisible({ timeout: 5000 });
    console.log("✅ Saved draft text edit successfully!");

    // 15. `Kopyala` çalışıyor mu?
    console.log("📋 [STEP 7] Testing copy to clipboard action...");
    await page.click("div.fixed.right-0 button:has-text('Kopyala')");
    const copyToast = page.getByText("Taslak kopyalandı!");
    await expect(copyToast).toBeVisible({ timeout: 5000 });
    console.log("✅ Clipboard copy functionality validated!");

    // 19. `Hasta Detayına Git` & 20. `Mesajlara Git` çalışıyor mu?
    console.log("🔗 [STEP 8] Validating navigation deep links...");
    const profileLink = page.locator("div.fixed.right-0 a:has-text('Hasta Detayına Git')").first();
    await expect(profileLink).toHaveAttribute("href", `/${tenantSlug}/takip`);
    
    const inboxLink = page.locator("div.fixed.right-0 a:has-text('Mesajlara Git')").first();
    await expect(inboxLink).toHaveAttribute("href", `/${tenantSlug}/inbox`);

    // 21. UI’da aktif bir `Gönder` butonu yok mu? (Zero-outbound verification)
    const sendButtonCount = await page.locator("button:has-text('Gönder')").count();
    expect(sendButtonCount).toBe(0);
    console.log("✅ Double-checked: 0 'Gönder' buttons exist on the Onay Merkezi UI!");

    // 17. `Onayla` çalışıyor mu?
    console.log("👍 [STEP 9] Testing draft approval...");
    await page.click("div.fixed.right-0 button:has-text('Onayla')");
    const approveToast = page.getByText("Taslak başarıyla onaylandı");
    await expect(approveToast).toBeVisible({ timeout: 5000 });
    
    // The drawer should close
    await expect(page.locator("div.fixed.right-0")).not.toBeVisible({ timeout: 5000 });
    
    // The bot draft should no longer be listed
    await page.click("div.overflow-x-auto button:has-text('Bot Takip')");
    await expect(botDraftCard).not.toBeVisible({ timeout: 5000 });
    console.log("✅ Approved action processed successfully!");

    // 18. `Reddet` çalışıyor mu?
    console.log("👎 [STEP 10] Testing draft rejection...");
    // Let's filter by Randevular, open drawer, and reject it
    await page.click("div.overflow-x-auto button:has-text('Randevular')");
    await page.waitForTimeout(500);
    await page.click("div.cursor-pointer:has-text('E2E REMINDER DRAFT')");
    await expect(page.locator("div.fixed.right-0")).toBeVisible({ timeout: 5000 });

    // Handle the browser prompt input
    page.once("dialog", async (dialog) => {
      expect(dialog.message()).toContain("reddetme sebebini");
      await dialog.accept("Uygun görülmedi (E2E Test)");
    });

    await page.click("div.fixed.right-0 button:has-text('Reddet')");
    const rejectToast = page.getByText("Taslak reddedildi.");
    await expect(rejectToast).toBeVisible({ timeout: 5000 });
    
    // The drawer should close and the reminder draft should be removed
    await expect(page.locator("div.fixed.right-0")).not.toBeVisible({ timeout: 5000 });
    await expect(reminderDraftCard).not.toBeVisible({ timeout: 5000 });
    console.log("✅ Rejected action processed successfully!");

    // =========================================================================
    // REGRESSION UI CHECKLIST
    // =========================================================================
    console.log("🔄 [STEP 11] Running regression checklist on other modules...");
    
    // * Hasta Takibi açılıyor mu?
    await page.goto(`/${tenantSlug}/takip`);
    await page.waitForURL(`**/${tenantSlug}/takip`, { timeout: 10000 });
    const trackingHeader = page.locator("h1:has-text('Takip Merkezi')");
    await expect(trackingHeader).toBeVisible();
    console.log("✅ Patient tracking regression page loaded successfully!");

    // Take verification screenshots as artifacts
    const screenshotDir = path.join(process.cwd(), "..", "..", ".gemini", "antigravity-ide", "brain", "548c1de1-8738-4c5c-b646-783619379da7");
    if (fs.existsSync(screenshotDir)) {
      console.log("📸 Saving validation screenshots...");
      await page.screenshot({ path: path.join(screenshotDir, "03-takip-list.png") });
      
      // Navigate back to onay page to capture visual state evidence
      await page.goto(`/${tenantSlug}/onay`);
      await page.waitForURL(`**/${tenantSlug}/onay`);
      await page.screenshot({ path: path.join(screenshotDir, "01-onay-list.png") });
      
      // Open drawer of greeting draft to capture detail state screenshot
      await page.click("button:has-text('Karşılama')");
      await page.waitForTimeout(500);
      await page.click("div.cursor-pointer:has-text('Merve Test')");
      await expect(page.locator("div.fixed.right-0")).toBeVisible({ timeout: 5000 });
      await page.screenshot({ path: path.join(screenshotDir, "02-onay-drawer-open.png") });
      console.log("✅ Captured high-fidelity evidence screenshots!");
    }

    // Assert there were no critical uncaught console errors
    console.log("🛡️ Checking console and network errors logs...");
    const criticalErrors = consoleErrors.filter(err => err.toLowerCase().includes("fail") || err.toLowerCase().includes("error") || err.toLowerCase().includes("exception"));
    console.log(`   - Captured ${criticalErrors.length} critical console errors during runtime.`);
    expect(criticalErrors.length).toBe(0);
    console.log("✅ Smoke verification completed with 0 errors!");
  });
});
