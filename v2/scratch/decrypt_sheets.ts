import dotenv from "dotenv";
import path from "path";
import { neon } from "@neondatabase/serverless";
import crypto from "crypto";

dotenv.config({ path: path.resolve(process.cwd(), ".env.local") });
dotenv.config({ path: path.resolve(process.cwd(), ".env") });

console.log("INTEGRATION_ENCRYPTION_KEY:", process.env.INTEGRATION_ENCRYPTION_KEY);
console.log("AUTH_SECRET:", process.env.AUTH_SECRET);

function getKey(secret: string, salt: Buffer): Buffer {
  return crypto.scryptSync(secret, salt, 32);
}

function decryptPayloadWithSecret(payload: any, secret: string): Record<string, any> {
  const { version, encrypted_payload } = payload;
  const raw = Buffer.from(encrypted_payload, "base64");
  const salt = raw.subarray(0, 64);
  const iv = raw.subarray(64, 64 + 16);
  const tag = raw.subarray(64 + 16, 64 + 16 + 16);
  const text = raw.subarray(64 + 16 + 16);
  
  const key = getKey(secret, salt);
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  
  const decrypted = Buffer.concat([decipher.update(text), decipher.final()]);
  return JSON.parse(decrypted.toString("utf8"));
}

async function run() {
  const sql = neon(process.env.DATABASE_URL!);
  const rows = await sql`
    SELECT credentials FROM tenant_integrations WHERE provider = 'google_sheets'
  `;
  const secrets = [
    process.env.INTEGRATION_ENCRYPTION_KEY || "",
    process.env.AUTH_SECRET || "",
    "fallback_32_byte_secret_for_dev!"
  ].filter(Boolean);

  for (const row of rows) {
    let success = false;
    for (const secret of secrets) {
      try {
        const decrypted = decryptPayloadWithSecret(row.credentials, secret);
        console.log(`Successfully decrypted with key suffix ...${secret.slice(-6)}:`, JSON.stringify(decrypted, null, 2));
        success = true;
        break;
      } catch (e: any) {
        // failed
      }
    }
    if (!success) {
      console.log("Failed to decrypt credentials with any known secret.");
    }
  }
}

run();
