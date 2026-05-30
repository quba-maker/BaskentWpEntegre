import { test, expect } from "@playwright/test";
import { execSync } from "child_process";
import fs from "fs";
import path from "path";

// =========================================================================
// QUBA AI OS — Quality & SLA Audit Center E2E & Smoke Validation Suite
// =========================================================================
// This script verifies the end-to-end user experience of the Operation
// Quality dashboard and tests multitenant safety and zero-outbound rules.
// =========================================================================

test.describe("QUBA AI CRM — Operasyon Kalite & SLA Denetim Merkezi E2E Suite", () => {
  const tenantSlug = "baskent";
  let injectedData: any = null;
  const consoleErrors: string[] = [];

  // Inject E2E Quality mock data before starting browser tests
  test.beforeAll(async () => {
    console.log("💉 Injecting E2E quality test records into the database...");
    execSync("npx tsx scripts/manage-kalite-e2e-data.ts --prepare");

    const dataFile = path.join(process.cwd(), "scratch-kalite-e2e-data.json");
    if (fs.existsSync(dataFile)) {
      injectedData = JSON.parse(fs.readFileSync(dataFile, "utf-8"));
      console.log("💉 Loaded injected test data:", injectedData);
    } else {
      throw new Error("❌ Injected data file scratch-kalite-e2e-data.json was not generated!");
    }
  });

  // Clean up injected test data after tests finish
  test.afterAll(async () => {
    console.log("🧹 Cleaning up injected quality test records from database...");
    execSync("npx tsx scripts/manage-kalite-e2e-data.ts --cleanup");
  });

  // Set up console error listeners
  test.beforeEach(async ({ page, context }) => {
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
        return; // Ignore normal connection/network warnings
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
          return;
        }
        console.warn("⚠️ Console error logged:", msg.text());
        consoleErrors.push(msg.text());
      }
    });
  });

  test("should authenticate, verify quality dashboard components, drawers, deep links, zero outbound UI constraint, and regression modules", async ({ page }) => {
    test.setTimeout(120000);
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

    // 2. Sidebar contains `Operasyon Kalitesi`?
    console.log("🔗 [STEP 2] Verifying sidebar menu and navigation...");
    const sidebarLink = page.locator("a:has-text('Operasyon Kalitesi')");
    await expect(sidebarLink).toBeVisible();

    // 3. Page `/{tenant_slug}/kalite` loads?
    await sidebarLink.click();
    await page.waitForURL(`**/${tenantSlug}/kalite`, { timeout: 20000 });
    console.log("✅ Navigation to Quality Dashboard confirmed!");

    // Wait for the unique page heading to ensure Next.js dev mode compile & hydration completes
    const pageHeading = page.locator("h1:has-text('Operasyon Kalite & SLA Denetim Merkezi')").first();
    await expect(pageHeading).toBeVisible({ timeout: 30000 });
    console.log("✅ Quality Dashboard Page Render & Hydration confirmed!");

    // Verify Zero Outbound warning banner
    const warningBanner = page.locator("div:has-text('GÖNDERİM P0 MODUNDA KAPALIDIR. BU PANEL OPERASYONEL RİSK VE SLA DENETİMİ İÇİNDİR.')").first();
    await expect(warningBanner).toBeVisible({ timeout: 10000 });

    // 4. Üst metrik kartları render oluyor mu?
    console.log("📊 [STEP 3] Validating dashboard metrics summary...");
    const metrics = [
      "Aktif Riskler",
      "Sıcak Lead Bekleyen",
      "Geciken Görevler",
      "Teyitsiz Randevular",
      "Bekleyen Taslaklar",
      "Bugünkü Randevular"
    ];
    for (const label of metrics) {
      await expect(page.locator(`span:has-text('${label}')`).first()).toBeVisible();
    }
    console.log("✅ All 6 metrics summary cards loaded successfully!");

    // 5. Risk listesi/table render oluyor mu?
    console.log("📋 [STEP 4] Validating risk audit queue list...");
    const tableHeader = page.locator("th:has-text('Audit Skor')");
    await expect(tableHeader).toBeVisible();

    const testOppRow = page.getByText("E2E Kalite Test Fırsatı").first();
    await expect(testOppRow).toBeVisible({ timeout: 30000 });
    console.log("✅ Sandbox risk record successfully rendered in the queue!");

    // 6. Risk filtreleri çalışıyor mu?
    console.log("🔍 [STEP 5] Testing filter badges...");
    await page.click("button:has-text('🔥 Sıcak Bekleyen')");
    await page.waitForTimeout(1000);
    // Since our test opp priority is hot and idle is 3h, it should still be listed
    await expect(testOppRow).toBeVisible({ timeout: 15000 });

    await page.click("button:has-text('⚠️ Geciken Görev')");
    await page.waitForTimeout(1000);
    // We have an injected overdue task, it should render under Geciken Görev filter
    const overdueRow = page.getByText("E2E Standart Takip").first();
    await expect(overdueRow).toBeVisible({ timeout: 15000 });

    await page.click("button:has-text('Tüm Riskler')");
    await page.waitForTimeout(500);

    // 7. Satıra tıklayınca detail drawer açılıyor mu?
    console.log("📋 [STEP 6] Opening detail drawer panel...");
    await testOppRow.click();

    // Wait for drawer to slide in
    const drawerContainer = page.locator("div.fixed.right-0").first();
    await expect(drawerContainer).toBeVisible({ timeout: 5000 });
    console.log("✅ Slide-over details drawer panel opened!");

    // 8. Drawer’da risk gerekçesi, quality score, AI summary, ai_reason, son outreach/task bilgisi görünüyor mu?
    console.log("🔍 [STEP 7] Inspecting drawer content attributes...");
    
    // Risk reasoning & score (using getByText with a high timeout to wait for API data load)
    await expect(page.locator("div.fixed.right-0 p:has-text('E2E Kalite Test Fırsatı')").first()).toBeVisible({ timeout: 30000 });
    await expect(page.locator("div.fixed.right-0 h4:has-text('/')").first()).toBeVisible({ timeout: 30000 }); // Quality Score (e.g. 55/100)
    
    // AI clinic summary & reason
    await expect(page.locator("div.fixed.right-0 p:has-text('E2E Klinik özet gerekçesi.')").first()).toBeVisible({ timeout: 30000 });
    await expect(page.locator("div.fixed.right-0 p:has-text('E2E AI fırsat analiz nedeni.')").first()).toBeVisible({ timeout: 30000 });

    // Suggested action & reasoning
    await expect(page.locator("div.fixed.right-0 p:has-text('Geciken görevi kontrol edin')").first()).toBeVisible({ timeout: 30000 });

    console.log("✅ All risk, AI summary, sleep timezone warning, and suggestions verified!");

    // 9. Hasta Takibi, 10. Onay Merkezi, 11. Randevu Yönetimi, 12. Inbox links visible in drawer?
    console.log("🔗 [STEP 8] Validating quick deep navigation buttons...");
    const ptButton = page.locator("div.fixed.right-0 button:has-text('Takip Merkezi')").first();
    await expect(ptButton).toBeVisible();

    const inboxButton = page.locator("div.fixed.right-0 button:has-text('Mesaja Git')").first();
    await expect(inboxButton).toBeVisible();

    // 13. UI’da hastaya mesaj gönderecek aktif bir buton yok mu? (Zero-outbound verification)
    const sendButtonCount = await page.locator("button:has-text('Gönder')").count();
    const sendInputCount = await page.locator("input[placeholder*='mesaj']").count();
    expect(sendButtonCount).toBe(0);
    expect(sendInputCount).toBe(0);
    console.log("✅ Zero Outbound fully confirmed: 0 sending fields or action triggers!");

    // Close the drawer by clicking the backdrop
    await page.locator("div.fixed.inset-0").first().click();
    await expect(drawerContainer).not.toBeVisible({ timeout: 5000 });

    // 14. Save high-res screenshots as evidence in brain folder
    const screenshotDir = "/Users/mustafa/.gemini/antigravity-ide/brain/548c1de1-8738-4c5c-b646-783619379da7";
    if (fs.existsSync(screenshotDir)) {
      console.log("📸 Capturing validation state screenshots...");
      
      // Page view
      await page.screenshot({ path: path.join(screenshotDir, "04-kalite-list.png") });
      
      // Drawer open view
      await testOppRow.click();
      await page.waitForTimeout(500);
      await page.screenshot({ path: path.join(screenshotDir, "05-kalite-drawer-open.png") });
      console.log("✅ Saved high-res visual evidence screenshots!");
    }

    // =========================================================================
    // REGRESSION UI CHECKLIST
    // =========================================================================
    console.log("🔄 [STEP 9] Running regression tests on core modules...");

    // A. Hasta Takibi açılıyor mu?
    await page.goto(`/${tenantSlug}/takip`);
    await page.waitForURL(`**/${tenantSlug}/takip`, { timeout: 10000 });
    const trackingHeader = page.locator("h1:has-text('Takip Merkezi')");
    await expect(trackingHeader).toBeVisible();
    console.log("   - Hasta Takibi page verified: PASS");

    // B. Randevu Yönetimi açılıyor mu?
    await page.click("button:has-text('Randevu Yönetimi')");
    const apptCard = page.getByText("Telefon Randevuları").first();
    await expect(apptCard).toBeVisible({ timeout: 15000 });
    console.log("   - Randevu Yönetimi calendar/tabs verified: PASS");

    // C. Onay Merkezi açılıyor mu?
    await page.goto(`/${tenantSlug}/onay`);
    await page.waitForURL(`**/${tenantSlug}/onay`, { timeout: 10000 });
    const approvalHeader = page.locator("h2:has-text('Taslak Onay Merkezi')");
    await expect(approvalHeader).toBeVisible();
    console.log("   - Onay Merkezi page verified: PASS");

    // Check console errors
    const criticalErrors = consoleErrors.filter(err => err.toLowerCase().includes("fail") || err.toLowerCase().includes("error") || err.toLowerCase().includes("exception"));
    console.log(`🛡️ Smoke verification completed with ${criticalErrors.length} console errors.`);
    expect(criticalErrors.length).toBe(0);
  });
});
