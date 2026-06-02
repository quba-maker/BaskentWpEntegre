const dotenv = require("dotenv");
dotenv.config({ path: "./.env.local" });

const crypto = require("crypto");

const ENCRYPTION_KEY = process.env.INTEGRATION_ENCRYPTION_KEY || process.env.AUTH_SECRET || "fallback_32_byte_secret_for_dev!";
const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 16;
const SALT_LENGTH = 64;
const TAG_LENGTH = 16;

function getKey(salt) {
  return crypto.scryptSync(ENCRYPTION_KEY, salt, 32);
}

function decryptPayload(payload) {
  const { version, encrypted_payload } = payload;
  
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

const payload = {
  version: "1.0",
  provider: "whatsapp",
  encrypted_payload: "O78S5gb5rvZc2ydtSz6HUc62SapaikCxjBifkfMYQwFOImlm71JFtJeVlNZpAKKfPj/uxHIzBoDC33mZm4IKUEmUPhgnhG0LGI+prWiIb9GSA3vxnyhYqpOZpzRYHuMYCem2wyGoN1gM0fL11x8qHrnvoBy5G15diIKZTrqrdHQJwVtdVWa4IyGxBNAHvGBV+AwvyLJGXf0feoLThDCn3jpWRwrhtdnzrsfaiegi8HN/twbLj0qgV6MBFA7ROnJuz2Cf8AdnMvL5qIXoAJ7jcqo7JloPfDyXSzWHwPtApqW/pE2c2F5Aa5jSSjGxD0wHwe9g/qgozZBDscHeA4Ozh4HyTVnW4jkWbxbAOu2MLWgIBIf+chZp3R9i+CtTciVUIY4kIEjX6yi2j3Z3dac1B5USkiQfmhOLmuIMXsSGBWI="
};

try {
  const decrypted = decryptPayload(payload);
  console.log("Decrypted successfully!");
  console.log("Keys available in decrypted payload:", Object.keys(decrypted));
  // Print access token length
  const token = decrypted.access_token || decrypted.accessToken;
  console.log("Token length:", token ? token.length : "N/A");
  // Print masked token for verification
  if (token) {
    console.log("Masked token prefix:", token.substring(0, 8) + "...");
  }
} catch (e) {
  console.error("Decryption failed:", e.message);
}
