import dotenv from "dotenv";
import path from "path";
import { neon } from "@neondatabase/serverless";

// Load env before importing encryption
dotenv.config({ path: path.resolve(process.cwd(), ".env.local") });
dotenv.config({ path: path.resolve(process.cwd(), ".env") });

process.env.TEST_TENANT_ID = "caab9ea1-9591-45e4-bbc5-9c9b498982c8";
process.env.TEST_USER_ROLE = "owner";

async function runTests() {
  const { saveGoogleSheetsConfig } = await import("../src/app/actions/integrations");
  const { decryptPayload } = await import("../src/lib/core/encryption");
  const sql = neon(process.env.DATABASE_URL!);

  console.log("==================================================");
  console.log("  RUNNING DRIFT FIX SIMULATION TESTS");
  console.log("==================================================");

  // ── Test Setup ──
  const testTenantId = "caab9ea1-9591-45e4-bbc5-9c9b498982c8";
  
  // Backup existing integration record
  const originalRow = await sql`
    SELECT credentials, config FROM tenant_integrations ti
    LEFT JOIN ingestion_pipelines ip ON ti.tenant_id = ip.tenant_id AND ip.provider = 'google_sheets'
    WHERE ti.tenant_id = ${testTenantId} AND ti.provider = 'google_sheets' LIMIT 1
  `;
  const originalCreds = originalRow[0]?.credentials;
  const originalPipeConfig = originalRow[0]?.config;

  const restore = async () => {
    console.log("Restoring original DB configuration...");
    if (originalCreds) {
      await sql`
        INSERT INTO tenant_integrations (tenant_id, provider, credentials, health_status)
        VALUES (${testTenantId}, 'google_sheets', ${JSON.stringify(originalCreds)}, 'healthy')
        ON CONFLICT (tenant_id, provider)
        DO UPDATE SET credentials = EXCLUDED.credentials, updated_at = NOW()
      `;
    }
    if (originalPipeConfig) {
      await sql`
        UPDATE ingestion_pipelines SET config = ${JSON.stringify(originalPipeConfig)}, updated_at = NOW()
        WHERE tenant_id = ${testTenantId} AND provider = 'google_sheets'
      `;
    }
  };

  try {
    // ──────────────────────────────────────────────────
    // Scenario 1: User changes only activeSheets, no apiKey
    // ──────────────────────────────────────────────────
    console.log("\n[Scenario 1] Saving activeSheets change only (no apiKey)...");
    const testTabs = ["Tab A", "Tab B"];
    const res1 = await saveGoogleSheetsConfig({
      spreadsheetId: "1oSKJ-iYiZPltYUQ73_O-FaFdelhwAwtf09wVKKVs1GQ",
      activeSheets: testTabs
    });

    if (!res1.success) {
      throw new Error(`Scenario 1 failed: ${res1.error}`);
    }
    
    // Read and verify
    const dbRow1 = await sql`
      SELECT credentials FROM tenant_integrations WHERE tenant_id = ${testTenantId} AND provider = 'google_sheets' LIMIT 1
    `;
    const decrypted1 = decryptPayload(dbRow1[0].credentials as any);
    console.log("Decrypted credentials after Tab change:");
    console.log("- activeSheets:", decrypted1.activeSheets);
    console.log("- apiKey exists:", !!decrypted1.apiKey);
    console.log("- spreadsheetId:", decrypted1.spreadsheetId);

    if (JSON.stringify(decrypted1.activeSheets) !== JSON.stringify(testTabs)) {
      throw new Error("activeSheets mismatch in Scenario 1!");
    }
    if (!decrypted1.apiKey) {
      throw new Error("apiKey was wiped out in Scenario 1!");
    }
    console.log("✅ Scenario 1 Passed.");

    // ──────────────────────────────────────────────────
    // Scenario 2: User changes spreadsheetId only, no apiKey
    // ──────────────────────────────────────────────────
    console.log("\n[Scenario 2] Saving spreadsheetId change only (no apiKey)...");
    const testSpreadsheetId = "1oSKJ-NEW-SPREADSHEET-ID";
    const res2 = await saveGoogleSheetsConfig({
      spreadsheetId: testSpreadsheetId,
      activeSheets: testTabs
    });

    if (!res2.success) {
      throw new Error(`Scenario 2 failed: ${res2.error}`);
    }

    const dbRow2 = await sql`
      SELECT credentials FROM tenant_integrations WHERE tenant_id = ${testTenantId} AND provider = 'google_sheets' LIMIT 1
    `;
    const decrypted2 = decryptPayload(dbRow2[0].credentials as any);
    console.log("Decrypted credentials after Spreadsheet ID change:");
    console.log("- activeSheets:", decrypted2.activeSheets);
    console.log("- apiKey exists:", !!decrypted2.apiKey);
    console.log("- spreadsheetId:", decrypted2.spreadsheetId);

    if (decrypted2.spreadsheetId !== testSpreadsheetId) {
      throw new Error("spreadsheetId mismatch in Scenario 2!");
    }
    if (JSON.stringify(decrypted2.activeSheets) !== JSON.stringify(testTabs)) {
      throw new Error("activeSheets was wiped in Scenario 2!");
    }
    if (!decrypted2.apiKey) {
      throw new Error("apiKey was wiped in Scenario 2!");
    }
    console.log("✅ Scenario 2 Passed.");

    // ──────────────────────────────────────────────────
    // Scenario 3: No existing credentials, and no apiKey sent
    // ──────────────────────────────────────────────────
    console.log("\n[Scenario 3] Deleting integration record, then saving config without apiKey...");
    await sql`
      DELETE FROM tenant_integrations WHERE tenant_id = ${testTenantId} AND provider = 'google_sheets'
    `;

    const res3 = await saveGoogleSheetsConfig({
      spreadsheetId: testSpreadsheetId,
      activeSheets: testTabs
    });

    console.log("Scenario 3 response success:", res3.success);
    console.log("Scenario 3 response error:", res3.error);

    if (res3.success) {
      throw new Error("Scenario 3 expected failure but succeeded!");
    }

    if (res3.error && res3.error.includes("credentials_required")) {
      console.log("✅ Scenario 3 Passed.");
    } else {
      throw new Error(`Scenario 3 failed with unexpected error message: ${res3.error}`);
    }

  } finally {
    // Restore original configuration
    await restore();
  }

  console.log("\n==================================================");
  console.log("  ALL DRIFT FIX TESTS COMPLETED SUCCESSFULLY");
  console.log("==================================================");
}

runTests().catch(async (err) => {
  console.error("Test execution failed:", err);
  process.exit(1);
});
