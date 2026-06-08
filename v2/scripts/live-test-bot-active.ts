import { chromium } from "playwright";

async function run() {
  console.log("Launching Headless Chromium for live test...");
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 }
  });
  const page = await context.newPage();

  try {
    console.log("1. Navigating to live /login...");
    await page.goto("https://ai.qubamedya.com/login");
    await page.waitForSelector("input[type='email']");

    console.log("2. Logging in as admin@baskent.com...");
    await page.locator("input[type='email']").fill("admin@baskent.com");
    await page.locator("input[type='password']").fill("admin1234");
    await page.locator("button[type='submit']").click();

    console.log("3. Waiting for live dashboard redirect...");
    await page.waitForURL("**/baskent");

    console.log("4. Navigating to live /inbox?primary=bot_active...");
    await page.goto("https://ai.qubamedya.com/baskent/inbox?primary=bot_active");
    
    console.log("5. Waiting for live Page load/settling...");
    await page.waitForTimeout(6000);

    const itemsCount = await page.locator(".q-list-item").count();
    console.log(`\nLive Sidebar Items Count: ${itemsCount}`);
    
    console.log("6. Taking screenshot...");
    const screenshotPath = "/Users/mustafa/.gemini/antigravity-ide/brain/1b413590-783a-4c4b-b35b-50cee9a7546a/live_bot_active_screenshot.png";
    await page.screenshot({ path: screenshotPath, fullPage: true });
    console.log(`Live Screenshot saved to ${screenshotPath}`);
  } catch (error) {
    console.error("Live test failed:", error);
  } finally {
    await browser.close();
    console.log("Browser closed.");
  }
}

run();
