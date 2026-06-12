import dotenv from "dotenv";
import path from "path";
import { neon } from "@neondatabase/serverless";

// Load env before importing encryption module
dotenv.config({ path: path.resolve(process.cwd(), ".env.local") });
dotenv.config({ path: path.resolve(process.cwd(), ".env") });

const tenantId = "caab9ea1-9591-45e4-bbc5-9c9b498982c8";

async function run() {
  const { decryptPayload, encryptPayload } = await import("../src/lib/core/encryption");
  const sql = neon(process.env.DATABASE_URL!);
  
  // 1. Fetch integration
  const integrations = await sql`
    SELECT credentials FROM tenant_integrations 
    WHERE tenant_id = ${tenantId} AND provider = 'google_sheets' LIMIT 1
  `;
  
  if (integrations.length === 0) {
    console.error("No google_sheets integration found for tenant", tenantId);
    return;
  }
  
  const decrypted = decryptPayload(integrations[0].credentials as any);
  console.log("Existing decrypted credentials:", decrypted);
  
  // 2. Fetch pipeline
  const pipelines = await sql`
    SELECT config FROM ingestion_pipelines 
    WHERE tenant_id = ${tenantId} AND provider = 'google_sheets' LIMIT 1
  `;
  
  if (pipelines.length === 0) {
    console.error("No google_sheets pipeline found for tenant", tenantId);
    return;
  }
  
  const pipeConfig = pipelines[0].config as any;
  console.log("Pipeline config:", pipeConfig);
  
  // 3. Merge activeSheets & spreadsheetId
  const newActiveSheets = pipeConfig.activeSheets || [];
  const newSpreadsheetId = pipeConfig.spreadsheetId || decrypted.spreadsheetId;
  
  console.log("Updating activeSheets to:", newActiveSheets);
  console.log("Updating spreadsheetId to:", newSpreadsheetId);
  
  const updatedPayload = {
    ...decrypted,
    spreadsheetId: newSpreadsheetId,
    activeSheets: newActiveSheets
  };
  
  const encrypted = encryptPayload('google_sheets', updatedPayload);
  
  // 4. Update DB
  await sql`
    UPDATE tenant_integrations 
    SET credentials = ${JSON.stringify(encrypted)}, updated_at = NOW()
    WHERE tenant_id = ${tenantId} AND provider = 'google_sheets'
  `;
  
  console.log("Successfully updated tenant_integrations in DB!");
}

run().catch(console.error);
