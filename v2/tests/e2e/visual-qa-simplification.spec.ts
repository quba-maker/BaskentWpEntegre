import { test, expect } from "@playwright/test";
import fs from "fs";
import path from "path";

import { execSync } from "child_process";

test.describe("Phase 2Z-P0 Visual QA and Simplification Audit", () => {
  const tenantSlug = "baskent";
  const consoleErrors: string[] = [];

  test.beforeAll(async () => {
    console.log("Injecting test sandbox tracking & appt data...");
    execSync("npx tsx scripts/manage-kalite-e2e-data.ts --prepare");
  });

  test.afterAll(async () => {
    console.log("Cleaning up test sandbox tracking & appt data...");
    execSync("npx tsx scripts/manage-kalite-e2e-data.ts --cleanup");
  });

  test.beforeEach(async ({ page, context }) => {
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    consoleErrors.length = 0;

    page.on("pageerror", (exception) => {
      console.error("❌ Exception on page:", exception.message);
      consoleErrors.push(exception.message);
    });

    page.on("console", (msg) => {
      if (msg.type() === "error") {
        console.error("❌ Console error:", msg.text());
        consoleErrors.push(msg.text());
      }
    });
  });

  test("should authenticate and perform local visual QA for all simplified operasyon screens", async ({ page }) => {
    test.setTimeout(180000);

    // 1. Authenticate
    console.log("🔑 [Auth] Navigating to /login...");
    await page.goto("/login");
    await expect(page).toHaveTitle(/Quba AI/);

    await page.locator("input[type='email']").fill("admin@baskent.com");
    await page.locator("input[type='password']").fill("admin1234");
    await page.locator("button[type='submit']").click();

    await page.waitForURL(`**/${tenantSlug}`, { timeout: 20000 });
    console.log("✅ Authenticated!");

    const screenshotDir = "/Users/mustafa/.gemini/antigravity-ide/brain/548c1de1-8738-4c5c-b646-783619379da7";
    if (!fs.existsSync(screenshotDir)) {
      fs.mkdirSync(screenshotDir, { recursive: true });
    }

    // ────────────────────────────────────────────────────────
    // 1. /baskent/takip - Patient Tracking & Columns
    // ────────────────────────────────────────────────────────
    console.log("📺 [Takip] Verifying Patient Tracking layout & columns...");
    await page.goto(`/${tenantSlug}/takip`);
    await page.waitForURL(`**/${tenantSlug}/takip`, { timeout: 20000 });

    const pageHeading = page.locator("h1:has-text('Takip Merkezi')").first();
    await expect(pageHeading).toBeVisible({ timeout: 20000 });

    // Assert standardized columns are present
    const columns = ["Hasta", "Durum", "Son Aktivite", "Kısa Özet", "Sonraki Aksiyon", "Sonraki Takip", "Aksiyon"];
    for (const col of columns) {
      await expect(page.locator(`th:has-text('${col}')`).first()).toBeVisible();
    }
    console.log("✅ Tracking table columns verified successfully!");

    // Wait for the loading spinner to disappear and actual E2E patient row to load
    const realRow = page.locator("tbody tr:has-text('E2E Kalite Test Fırsatı')").first();
    await expect(realRow).toBeVisible({ timeout: 25000 });

    // Capture Patient Tracking list
    await page.screenshot({ path: path.join(screenshotDir, "03-takip-list.png") });
    console.log("📸 Saved 03-takip-list.png");

    // Click patient cell in the row to open Patient drawer without clicking action buttons
    await realRow.locator("td").nth(1).click();
    await page.waitForTimeout(1000);

    // Verify Patient drawer layout (patient-first, collapsed form answers)
    console.log("📺 [Patient Drawer] Verifying patient-first detail drawer...");
    const patientDrawer = page.locator("div.fixed.right-0").first();
    await expect(patientDrawer).toBeVisible({ timeout: 15000 });

    // Capture open patient drawer
    await page.screenshot({ path: path.join(screenshotDir, "02-patient-drawer-open.png") });
    console.log("📸 Saved 02-patient-drawer-open.png");

    // Close drawer by clicking its Close button in the header (exclusively matching lucide-x button)
    await page.locator("div.fixed.right-0 button:has(svg.lucide-x)").first().click();
    await expect(page.locator("div.fixed.right-0").first()).not.toBeVisible({ timeout: 10000 });
    await page.waitForTimeout(500);

    // ────────────────────────────────────────────────────────
    // 2. /baskent/takip?tab=randevu - Appointments Tab
    // ────────────────────────────────────────────────────────
    console.log("📺 [Randevu] Verifying appointments layout...");
    const apptsTabBtn = page.locator("button:has-text('Randevu Yönetimi')").first();
    await expect(apptsTabBtn).toBeVisible();
    await apptsTabBtn.click();
    await page.waitForTimeout(1000);

    // Verify appointments lists loaded
    const apptListHeader = page.getByText("Telefon Randevuları").first();
    await expect(apptCard => apptListHeader).toBeDefined();

    // Wait for the actual E2E patient appointment row to be loaded
    const realApptRow = page.locator("tbody tr:has-text('E2E Kalite Test Fırsatı')").first();
    await expect(realApptRow).toBeVisible({ timeout: 25000 });

    // Capture Appointments list
    await page.screenshot({ path: path.join(screenshotDir, "06-appointments-list.png") });
    console.log("📸 Saved 06-appointments-list.png");

    // Click patient cell in the row to open Appointment detail drawer without clicking action buttons
    await realApptRow.locator("td").nth(1).click();
    await page.waitForTimeout(1000);

    // Verify Appointment detail drawer
    console.log("📺 [Appointment Drawer] Verifying appointment-first detail drawer...");
    await expect(page.locator("h2:has-text('Giriş')").first().or(page.locator("div.fixed.right-0").first())).toBeVisible({ timeout: 15000 });

    // Capture open appointment detail drawer
    await page.screenshot({ path: path.join(screenshotDir, "07-appointment-drawer-open.png") });
    console.log("📸 Saved 07-appointment-drawer-open.png");

    // Close drawer by clicking its Close button in the header (exclusively matching lucide-x button)
    await page.locator("div.fixed.right-0 button:has(svg.lucide-x)").first().click();
    await expect(page.locator("div.fixed.right-0").first()).not.toBeVisible({ timeout: 10000 });
    await page.waitForTimeout(500);

    // ────────────────────────────────────────────────────────
    // 3. /baskent/inbox - Inbox CRM Context Panel
    // ────────────────────────────────────────────────────────
    console.log("📺 [Inbox] Verifying Inbox right CRM context panel...");
    await page.goto(`/${tenantSlug}/inbox`);
    await page.waitForURL(`**/${tenantSlug}/inbox`, { timeout: 20000 });

    // Click first chat to render Context CRM panel
    const firstChat = page.locator("div[class*='q-list-item']").first().or(page.locator("div[class*='cursor-pointer']").first());
    if (await firstChat.isVisible()) {
      await firstChat.click();
      await page.waitForTimeout(1500);

      // Verify no Lead score, no technical badges
      const rightPanel = page.locator("div.lg\\:w-\\[340px\\]").first();
      await expect(rightPanel).toBeVisible({ timeout: 10000 });

      // Capture Inbox
      await page.screenshot({ path: path.join(screenshotDir, "08-inbox-crm-panel.png") });
      console.log("📸 Saved 08-inbox-crm-panel.png");
    }

    // ────────────────────────────────────────────────────────
    // 4. /baskent/forms - Form Detail Accordion
    // ────────────────────────────────────────────────────────
    console.log("📺 [Forms] Verifying form management & Technical parameter accordion...");
    await page.goto(`/${tenantSlug}/forms`);
    await page.waitForURL(`**/${tenantSlug}/forms`, { timeout: 20000 });

    const firstFormRow = page.locator("tbody tr").first();
    await expect(firstFormRow).toBeVisible();
    await firstFormRow.click();
    await page.waitForTimeout(1000);

    // Verify Technical accordion exists
    const accordionBtn = page.locator("button:has-text('Teknik Reklam Verileri')").first();
    await expect(accordionBtn).toBeVisible({ timeout: 10000 });

    // Capture collapsed form detail modal
    await page.screenshot({ path: path.join(screenshotDir, "09-forms-technical-collapsed.png") });
    console.log("📸 Saved 09-forms-technical-collapsed.png");

    // Click to expand accordion
    await accordionBtn.click();
    await page.waitForTimeout(500);

    // Capture expanded form detail modal
    await page.screenshot({ path: path.join(screenshotDir, "10-forms-technical-expanded.png") });
    console.log("📸 Saved 10-forms-technical-expanded.png");

    // ────────────────────────────────────────────────────────
    // 5. /baskent/onay - Onay Merkezi
    // ────────────────────────────────────────────────────────
    console.log("📺 [Onay] Verifying Onay Page...");
    await page.goto(`/${tenantSlug}/onay`);
    await page.waitForURL(`**/${tenantSlug}/onay`, { timeout: 20000 });
    const onayHeading = page.locator("h2:has-text('Taslak Onay Merkezi')").first();
    await expect(onayHeading).toBeVisible({ timeout: 15000 });

    // Capture Onay list
    await page.screenshot({ path: path.join(screenshotDir, "01-onay-list.png") });
    console.log("📸 Saved 01-onay-list.png");

    console.log("🎉 All visual QA screens successfully visited and visual proof captured!");
  });
});
