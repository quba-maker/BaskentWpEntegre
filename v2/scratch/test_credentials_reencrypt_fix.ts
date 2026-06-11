import fs from "fs";
import path from "path";
import dotenv from "dotenv";
import crypto from "crypto";
import { neon } from "@neondatabase/serverless";

// 1. Cryptographic Constants & Helpers
const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 16;
const SALT_LENGTH = 64;
const TAG_LENGTH = 16;

function getKey(secret: string, salt: Buffer): Buffer {
  return crypto.scryptSync(secret, salt, 32);
}

function decryptPayloadWithKey(payload: any, secretKey: string): Record<string, any> {
  const { version, encrypted_payload } = payload;
  if (version !== "1.0") {
    throw new Error(`Unsupported encryption version: ${version}`);
  }
  const raw = Buffer.from(encrypted_payload, "base64");
  const salt = raw.subarray(0, SALT_LENGTH);
  const iv = raw.subarray(SALT_LENGTH, SALT_LENGTH + IV_LENGTH);
  const tag = raw.subarray(SALT_LENGTH + IV_LENGTH, SALT_LENGTH + IV_LENGTH + TAG_LENGTH);
  const text = raw.subarray(SALT_LENGTH + IV_LENGTH + TAG_LENGTH);
  
  const key = getKey(secretKey, salt);
  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(tag);
  
  const decrypted = Buffer.concat([decipher.update(text), decipher.final()]);
  return JSON.parse(decrypted.toString("utf8"));
}

function encryptPayloadWithKey(provider: string, data: Record<string, any>, secretKey: string, version = "1.0") {
  const text = JSON.stringify(data);
  const iv = crypto.randomBytes(IV_LENGTH);
  const salt = crypto.randomBytes(SALT_LENGTH);
  const key = getKey(secretKey, salt);
  
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([cipher.update(text, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();

  const combinedPayload = Buffer.concat([salt, iv, tag, encrypted]).toString("base64");

  return {
    version,
    provider,
    encrypted_payload: combinedPayload,
  };
}

// Masking helpers for secure logging
function maskSpreadsheetId(id: string | undefined): string {
  if (!id) return "undefined";
  if (id.length <= 8) return "***";
  return `${id.substring(0, 4)}...${id.substring(id.length - 4)}`;
}

async function run() {
  const targetTenantId = "caab9ea1-9591-45e4-bbc5-9c9b498982c8"; // Başkent
  const isWriteMode = process.env.RECOVERY_WRITE === "true";
  
  console.log("=== GOOGLE SHEETS CREDENTIALS RE-ENCRYPTION RECOVERY ===");
  console.log(`Target Tenant ID: ${targetTenantId}`);
  console.log(`Mode: ${isWriteMode ? "⚠️ WRITE MODE" : "🔍 DRY-RUN MODE"}`);

  // Load Dev Key from local .env.local file
  const localEnvPath = path.resolve(".env.local");
  if (!fs.existsSync(localEnvPath)) {
    throw new Error("Local .env.local file not found to load DEV key.");
  }
  const localEnv = dotenv.parse(fs.readFileSync(localEnvPath, "utf8"));
  
  // Load Production Key from environment (injected via vercel env run)
  const prodKey = process.env.INTEGRATION_ENCRYPTION_KEY || process.env.AUTH_SECRET;
  if (!prodKey) {
    throw new Error("PROD encryption key not found in environment. Please run with vercel env run.");
  }

  // Connect to database
  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) {
    throw new Error("DATABASE_URL is missing in environment.");
  }
  const sql = neon(dbUrl);

  // Load tenant integrations row
  const rows = await sql`
    SELECT id, credentials, updated_at 
    FROM tenant_integrations 
    WHERE tenant_id = ${targetTenantId} AND provider = 'google_sheets' 
    LIMIT 1
  `;

  if (rows.length === 0) {
    console.log("Result: Google Sheets integration row not found for the target tenant.");
    return;
  }

  const integrationRow = rows[0];
  console.log("Tenant integration row found: true");
  console.log("Last updated at:", integrationRow.updated_at);

  const creds = typeof integrationRow.credentials === "string"
    ? JSON.parse(integrationRow.credentials)
    : integrationRow.credentials;

  if (!creds.encrypted_payload || !creds.version) {
    console.log("Result: Credentials payload is already unencrypted or invalid shape.");
    return;
  }

  console.log("Credentials payload shape: VALID (EncryptedPayload structure)");

  // Try multiple potential keys for decryption
  const candidateKeys = [
    localEnv.INTEGRATION_ENCRYPTION_KEY,
    localEnv.AUTH_SECRET,
    "fallback_32_byte_secret_for_dev!"
  ].filter(Boolean) as string[];

  let decrypted: Record<string, any> | null = null;
  let activeDecryptionKey = "";

  for (const key of candidateKeys) {
    try {
      decrypted = decryptPayloadWithKey(creds, key);
      activeDecryptionKey = key;
      break;
    } catch (_) {}
  }

  if (!decrypted) {
    throw new Error("dev_key_decrypt_failed: None of the candidate keys could decrypt the payload.");
  }

  console.log(`Decryption: SUCCESS (used key: ${activeDecryptionKey === "fallback_32_byte_secret_for_dev!" ? "fallback key" : "custom key"})`);

  // Validate decrypted fields structure
  const hasApiKey = !!decrypted.apiKey;
  const hasWebhookSecret = !!decrypted.webhookSecret;
  const hasActiveSheets = !!decrypted.activeSheets;
  const spreadsheetIdMasked = maskSpreadsheetId(decrypted.spreadsheetId);

  console.log("Decrypted payload verification:");
  console.log(`- apiKey present: ${hasApiKey}`);
  console.log(`- webhookSecret present: ${hasWebhookSecret}`);
  console.log(`- activeSheets present: ${hasActiveSheets} (${JSON.stringify(decrypted.activeSheets || [])})`);
  console.log(`- spreadsheetId: ${spreadsheetIdMasked}`);

  // 2. Perform re-encryption simulation using prod key
  let simulatedEncrypted: any;
  try {
    simulatedEncrypted = encryptPayloadWithKey("google_sheets", decrypted, prodKey);
    console.log("Prod Key Encryption Simulation: SUCCESS");
  } catch (err: any) {
    console.error("Result: Prod key encryption simulation failed.", err.message);
    throw new Error("prod_key_encrypt_failed");
  }

  // 3. Immediately verify decryption using prod key
  try {
    const verifiedDecrypted = decryptPayloadWithKey(simulatedEncrypted, prodKey);
    const verifyApiKey = !!verifiedDecrypted.apiKey;
    const verifyWebhookSecret = !!verifiedDecrypted.webhookSecret;
    const verifyActiveSheets = !!verifiedDecrypted.activeSheets;
    
    if (verifyApiKey && verifyActiveSheets && (!hasWebhookSecret || verifyWebhookSecret)) {
      console.log("Prod Key Decryption Verification: SUCCESS & PASS");
    } else {
      throw new Error("Verification checks failed (missing essential fields after decryption).");
    }
  } catch (err: any) {
    console.error("Result: Re-encryption verification failed. DB will NOT be updated.", err.message);
    throw new Error("reencryption_verification_failed");
  }

  // 4. DB Write / Backup
  if (isWriteMode) {
    // Save physical backup locally
    const backupDir = path.resolve("scratch");
    if (!fs.existsSync(backupDir)) {
      fs.mkdirSync(backupDir);
    }
    const backupPath = path.join(backupDir, "baskent_sheets_credentials_backup.json");
    fs.writeFileSync(backupPath, JSON.stringify(creds, null, 2), "utf8");
    console.log(`Physical backup saved to: ${backupPath}`);

    // Update row in DB
    console.log("Writing to DB...");
    const updateResult = await sql`
      UPDATE tenant_integrations
      SET credentials = ${JSON.stringify(simulatedEncrypted)}, updated_at = NOW()
      WHERE id = ${integrationRow.id} AND tenant_id = ${targetTenantId}
      RETURNING id, updated_at
    `;
    
    console.log("Result: DB WRITE SUCCESSFUL!");
    console.log("Updated row ID:", updateResult[0].id);
    console.log("Updated at:", updateResult[0].updated_at);
  } else {
    console.log("Result: DRY-RUN completed successfully. No changes written to DB.");
  }
}

run()
  .catch((err) => {
    console.error("Fatal Error:", err.message || err);
    process.exit(1);
  })
  .finally(() => process.exit(0));
