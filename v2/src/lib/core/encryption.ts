import crypto from "crypto";

const ENCRYPTION_KEY = process.env.INTEGRATION_ENCRYPTION_KEY || process.env.AUTH_SECRET || "fallback_32_byte_secret_for_dev!";
const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 16;
const SALT_LENGTH = 64;
const TAG_LENGTH = 16;

/**
 * Derives a 32-byte key from the provided secret using scrypt
 */
function getKey(salt: Buffer): Buffer {
  return crypto.scryptSync(ENCRYPTION_KEY, salt, 32);
}

export interface EncryptedPayload {
  version: string;
  provider: string;
  encrypted_payload: string;
}

export function encryptPayload(provider: string, data: Record<string, any>, version = "1.0"): EncryptedPayload {
  const text = JSON.stringify(data);
  const iv = crypto.randomBytes(IV_LENGTH);
  const salt = crypto.randomBytes(SALT_LENGTH);
  const key = getKey(salt);
  
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([cipher.update(text, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();

  // Format: salt:iv:tag:encrypted
  const combinedPayload = Buffer.concat([salt, iv, tag, encrypted]).toString("base64");

  return {
    version,
    provider,
    encrypted_payload: combinedPayload,
  };
}

export function decryptPayload(payload: EncryptedPayload): Record<string, any> {
  const { version, encrypted_payload } = payload;
  
  // Future-proofing for version changes
  if (version !== "1.0") {
    throw new Error(`Unsupported encryption version: ${version}`);
  }

  const raw = Buffer.from(encrypted_payload, "base64");
  
  const salt = raw.subarray(0, SALT_LENGTH);
  const iv = raw.subarray(SALT_LENGTH, SALT_LENGTH + IV_LENGTH);
  const tag = raw.subarray(SALT_LENGTH + IV_LENGTH, SALT_LENGTH + IV_LENGTH + TAG_LENGTH);
  const text = raw.subarray(SALT_LENGTH + IV_LENGTH + TAG_LENGTH);
  
  const key = getKey(salt);
  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(tag);
  
  const decrypted = Buffer.concat([decipher.update(text), decipher.final()]);
  return JSON.parse(decrypted.toString("utf8"));
}
