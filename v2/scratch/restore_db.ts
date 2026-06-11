import dotenv from "dotenv";
import path from "path";
import { neon } from "@neondatabase/serverless";

dotenv.config({ path: path.resolve(process.cwd(), ".env.local") });
dotenv.config({ path: path.resolve(process.cwd(), ".env") });

const tenantId = "caab9ea1-9591-45e4-bbc5-9c9b498982c8";

async function run() {
  const { encryptPayload } = await import("../src/lib/core/encryption");
  const sql = neon(process.env.DATABASE_URL!);
  
  const payload = {
    apiKey: "AIzaSyAxNUHQCrXzmATX4YuMgcFP3u4EW_jsJYc",
    spreadsheetId: "1oSKJ-iYiZPltYUQ73_O-FaFdelhwAwtf09wVKKVs1GQ",
    activeSheets: [
      "Form Yanıtları 1",
      "TR-ORTADOĞU-ORTAPEDİ-BF 2026 FORM",
      "TR-ORTADOĞU-KARDİYOLOJİ 2026 (v2)",
      "Gurbetçiler Form Randevu-Kardiyoloji (2)",
      "Gurbetçiler Form Randevu"
    ],
    webhookSecret: "wh_sec_6b12d5929bd72783a4f90a7924df152ee99b5" // from audit logs / similar
  };
  
  const encrypted = encryptPayload('google_sheets', payload);
  
  await sql`
    INSERT INTO tenant_integrations (tenant_id, provider, credentials, health_status)
    VALUES (${tenantId}, 'google_sheets', ${JSON.stringify(encrypted)}, 'healthy')
    ON CONFLICT (tenant_id, provider)
    DO UPDATE SET credentials = EXCLUDED.credentials, updated_at = NOW()
  `;
  
  console.log("Restored Google Sheets integration record in DB!");
}

run().catch(console.error);
