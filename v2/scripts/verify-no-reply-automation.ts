import dotenv from "dotenv";
import path from "path";
dotenv.config({ path: path.join(__dirname, "../.env.local") });

async function main() {
  console.log("=== STARTING NO-REPLY AUTOMATION DIAGNOSTIC ===");
  
  const { withTenantDB } = await import("../src/lib/core/tenant-db");
  const { NoReplyAutomationService } = await import("../src/lib/services/automation/no-reply-automation.service");

  // Enforce test tenant context
  const systemDb = withTenantDB('admin-system', true);
  const tenants = await systemDb.executeSafe({
    text: "SELECT id, slug FROM tenants WHERE slug = 'baskent'"
  }) as any[];

  if (tenants.length === 0) {
    console.error("No active tenants found.");
    return;
  }

  const tenant = tenants[0];
  console.log(`Using Tenant: ${tenant.slug} (${tenant.id})`);

  const db = withTenantDB(tenant.id);

  // 1. Get Settings
  console.log("\n1. Fetching Settings...");
  const initialSettings = await NoReplyAutomationService.getNoReplyAutomationSettings(db, tenant.id);
  console.log("Current settings:", initialSettings);

  // 2. Enable temporarily for dry-run testing
  console.log("\n2. Enabling settings temporarily...");
  const testSettings = await NoReplyAutomationService.updateNoReplyAutomationSettings(db, tenant.id, {
    enabled: true,
    firstReminderAfterHours: 1, // trigger easily
    secondReminderAfterHours: 2,
    thirdReminderAfterHours: 24,
    maxAttempts: 3
  });
  console.log("Updated settings for test:", testSettings);

  // 3. Execute Dry-Run
  console.log("\n3. Running Dry-Run Simulation...");
  const dryRunRes = await NoReplyAutomationService.runNoReplyAutomationDryRun(db, tenant.id);
  console.log("Dry-Run Summary:", dryRunRes.summary);
  console.log("Sample Candidates (up to 10):");
  console.table(dryRunRes.samples);

  // 4. Run Tick in Simulation mode
  console.log("\n4. Running real tick...");
  process.env.ENABLE_NO_REPLY_AUTOMATION = 'true';
  const tickResult = await NoReplyAutomationService.runNoReplyAutomationTick(db, tenant.id, { dryRun: false });
  console.log("Tick Result:", tickResult);

  // 5. Restore initial settings
  console.log("\n5. Restoring initial settings...");
  await NoReplyAutomationService.updateNoReplyAutomationSettings(db, tenant.id, {
    enabled: initialSettings.enabled,
    firstReminderAfterHours: initialSettings.firstReminderAfterHours,
    secondReminderAfterHours: initialSettings.secondReminderAfterHours,
    thirdReminderAfterHours: initialSettings.thirdReminderAfterHours,
    maxAttempts: initialSettings.maxAttempts
  });
  console.log("Settings successfully restored.");
  console.log("=== DIAGNOSTIC FINISHED ===");
}

main().catch(err => {
  console.error("Diagnostic failed:", err);
});

