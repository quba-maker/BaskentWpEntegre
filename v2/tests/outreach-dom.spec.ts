import { test, expect } from '@playwright/test';

test('Verify Outreach Card for Halil Hanay', async ({ page }) => {
  // Go to login page
  await page.goto('http://localhost:3000/login');
  
  // Fill in credentials - guessing common selectors or just forcing cookie
  // Wait, I can just set a dummy cookie if I know the auth mechanism. 
  // Next-Auth usually uses `next-auth.session-token`.
  // Or I can just try to login with standard fields.
  try {
    await page.fill('input[type="email"], input[name="email"]', 'admin@baskent.com');
    await page.fill('input[type="password"], input[name="password"]', 'baskent2024');
    await page.click('button[type="submit"]');
    await page.waitForNavigation();
  } catch(e) {
    console.log("Login form not found or failed, maybe we need to use a generic token");
  }

  // Go to forms
  await page.goto('http://localhost:3000/baskent/forms');
  
  // Wait for the leads list to load
  await page.waitForSelector('text=Halil Hanay', { timeout: 10000 });
  
  // Click on Halil Hanay
  await page.click('text=Halil Hanay');
  
  // Wait for the Outreach card to appear
  await page.waitForSelector('text=İlk İletişim', { timeout: 5000 });
  
  // Wait a bit for readiness to load
  await page.waitForTimeout(3000);
  
  // Get the entire text of the outreach card
  const content = await page.locator('text=İlk İletişim (Outreach)').locator('..').locator('..').textContent();
  
  console.log("--- OUTREACH CARD TEXT CONTENT ---");
  console.log(content);
  console.log("----------------------------------");
  
  // Assertions
  if (content.includes('Şablon tanımlanmamış')) {
    console.error("FAIL: 'Şablon tanımlanmamış' IS IN DOM!");
  } else {
    console.log("SUCCESS: 'Şablon tanımlanmamış' is NOT in DOM");
  }
  
  if (content.includes('Şablon Eklenmeli')) {
    console.error("FAIL: 'Şablon Eklenmeli' IS IN DOM!");
  } else {
    console.log("SUCCESS: 'Şablon Eklenmeli' is NOT in DOM");
  }
  
  if (content.includes('Form Yönetimi / Şablon ayarlarından greeting template ekleyin')) {
    console.error("FAIL: 'Form Yönetimi / Şablon ayarlarından greeting template ekleyin' IS IN DOM!");
  } else {
    console.log("SUCCESS: 'Form Yönetimi / Şablon ayarlarından greeting template ekleyin' is NOT in DOM");
  }
  
  if (content.includes('Sistemde aktif şablon var: tr_form_karsilama_v1')) {
    console.log("SUCCESS: 'Sistemde aktif şablon var: tr_form_karsilama_v1' IS IN DOM!");
  } else {
    console.log("FAIL: 'Sistemde aktif şablon var: tr_form_karsilama_v1' is NOT in DOM");
  }
});
