import { chromium } from "playwright";
import fs from "fs";
import path from "path";

async function run() {
  const screenshotDir = "/Users/mustafa/.gemini/antigravity-ide/brain/49e3126e-a044-445a-ac1b-7db5d258b66a";
  if (!fs.existsSync(screenshotDir)) {
    fs.mkdirSync(screenshotDir, { recursive: true });
  }

  console.log("Launching Chromium...");
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 }
  });
  const page = await context.newPage();

  try {
    console.log("Navigating to /login...");
    await page.goto("http://localhost:3000/login");
    await page.waitForSelector("input[type='email']", { timeout: 10000 });

    console.log("Logging in...");
    await page.locator("input[type='email']").fill("admin@baskent.com");
    await page.locator("input[type='password']").fill("admin1234");
    await page.locator("button[type='submit']").click();

    console.log("Waiting for dashboard redirect...");
    await page.waitForURL("**/baskent", { timeout: 15000 });

    console.log("Navigating to /baskent/inbox...");
    await page.goto("http://localhost:3000/baskent/inbox");
    await page.waitForTimeout(4000);

    console.log("Searching for E2E Kalite...");
    const searchInput = page.locator("input[placeholder*='İsim veya numara ara...']").first();
    await searchInput.fill("E2E Kalite");
    await page.waitForTimeout(3000);

    console.log("Clicking the first search result...");
    const contactChat = page.locator("div[class*='cursor-pointer']").first();
    await contactChat.click();
    await page.waitForTimeout(5000);

    console.log("Capturing warning banner screenshot...");
    await page.screenshot({ path: path.join(screenshotDir, "form_greeting_ineligible_warning.png") });
    console.log("Saved form_greeting_ineligible_warning.png");

  } catch (error) {
    console.error("Error during warning capture:", error);
  } finally {
    await browser.close();
  }
}

run();
