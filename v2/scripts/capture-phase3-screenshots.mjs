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
    try {
      await page.waitForURL("**/baskent", { timeout: 15000 });
      console.log("Authenticated successfully!");
    } catch (err) {
      console.log("Current URL after timeout:", page.url());
      await page.screenshot({ path: path.join(screenshotDir, "login_timeout_diagnostic.png") });
      console.log("Saved login_timeout_diagnostic.png");
      throw err;
    }

    console.log("Navigating to /baskent/inbox...");
    await page.goto("http://localhost:3000/baskent/inbox");
    await page.waitForTimeout(4000);

    console.log("Searching for E2E Kalite...");
    const searchInput = page.locator("input[placeholder*='İsim veya numara ara...']").first();
    await searchInput.fill("E2E Kalite");
    await page.waitForTimeout(3000);

    // Save a screenshot of the search results
    await page.screenshot({ path: path.join(screenshotDir, "search_results_diagnostic.png") });
    console.log("Saved search_results_diagnostic.png");

    // Print all visible conversation names in the list
    const items = await page.locator("div[class*='cursor-pointer']").all();
    console.log(`Found ${items.length} conversation items in list:`);
    for (let i = 0; i < items.length; i++) {
      const text = await items[i].innerText();
      console.log(`  [${i}]:`, text.replace(/\n/g, " | "));
    }

    console.log("Clicking the first search result...");
    const contactChat = page.locator("div[class*='cursor-pointer']").first();
    await contactChat.click();
    await page.waitForTimeout(5000);

    // Capture initial right panel view
    console.log("Capturing initial CRM panel view...");
    await page.screenshot({ path: path.join(screenshotDir, "crm_panel_initial.png") });

    // Look for Form Karşılama section and click prepare
    console.log("Looking for Form Karşılama card...");
    const prepareBtn = page.locator("button:has-text('Karşılama Taslağı Hazırla')").first();
    if (await prepareBtn.isVisible()) {
      console.log("Clicking 'Karşılama Taslağı Hazırla'...");
      await prepareBtn.click();
      await page.waitForTimeout(4000);

      // Capture generated draft text area
      console.log("Capturing generated draft view...");
      await page.screenshot({ path: path.join(screenshotDir, "form_greeting_draft_ready.png") });

      // Edit draft
      console.log("Editing the draft...");
      const textarea = page.locator("textarea").first();
      await textarea.fill(await textarea.inputValue() + " - TEST DRAFT NOTE");
      await page.waitForTimeout(1000);

      // Save draft as internal note
      console.log("Clicking 'Taslağı İç Not Olarak Kaydet'...");
      const saveDraftBtn = page.locator("button:has-text('Taslağı İç Not Olarak Kaydet')").first();
      await saveDraftBtn.click();
      await page.waitForTimeout(3000);

      console.log("Capturing draft saved view...");
      await page.screenshot({ path: path.join(screenshotDir, "form_greeting_draft_saved.png") });
    } else {
      console.log("Form greeting prepare button not visible, check eligibility!");
    }

    // Now test Bot Steering Accordion
    console.log("Locating 'Botu Yönlendir' accordion...");
    const accordionHeader = page.locator("button:has-text('Botu Yönlendir')").first();
    if (await accordionHeader.isVisible()) {
      console.log("Clicking 'Botu Yönlendir' accordion...");
      await accordionHeader.click();
      await page.waitForTimeout(1000);

      console.log("Entering bot directive...");
      const directiveInput = page.locator("textarea[placeholder*='Fiyat ver ama indirim yapma']").first();
      await directiveInput.fill("Hastadan bütçe hassasiyetini sorgula");
      await page.waitForTimeout(1000);

      console.log("Capturing directive input view...");
      await page.screenshot({ path: path.join(screenshotDir, "bot_steering_input.png") });

      console.log("Clicking 'Direktifi Kaydet'...");
      const saveSteeringBtn = page.locator("button:has-text('Direktifi Kaydet')").first();
      await saveSteeringBtn.click();
      await page.waitForTimeout(3500);

      console.log("Capturing directive saved view...");
      await page.screenshot({ path: path.join(screenshotDir, "bot_steering_saved.png") });
    } else {
      console.log("Bot steering accordion not visible!");
    }

    console.log("All screenshots captured successfully!");
  } catch (error) {
    console.error("Error during automation:", error);
  } finally {
    await browser.close();
  }
}

run();
