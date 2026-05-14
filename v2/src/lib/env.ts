// ==========================================
// QUBA AI — Environment Variable Validation
// Uygulama başlangıcında kritik env var'ları kontrol eder
// ==========================================

interface EnvVar {
  name: string;
  required: boolean;
  description: string;
}

const ENV_SCHEMA: EnvVar[] = [
  // Platform (Zorunlu)
  { name: "DATABASE_URL", required: true, description: "Neon PostgreSQL connection string" },
  { name: "AUTH_SECRET", required: true, description: "JWT imzalama anahtarı (min 32 karakter)" },

  // Meta/WhatsApp (İlk tenant için zorunlu, sonra tenant DB'den)
  { name: "META_ACCESS_TOKEN", required: false, description: "Meta Graph API token (fallback)" },
  { name: "PHONE_NUMBER_ID", required: false, description: "WhatsApp Phone Number ID (fallback)" },
  { name: "META_APP_SECRET", required: false, description: "Meta App Secret (webhook HMAC doğrulaması)" },
  { name: "WEBHOOK_VERIFY_TOKEN", required: false, description: "Meta Webhook doğrulama token'ı" },

  // AI
  { name: "GEMINI_API_KEY", required: false, description: "Google Gemini API key" },

  // Telegram
  { name: "TELEGRAM_BOT_TOKEN", required: false, description: "Telegram CRM bot token'ı" },
  { name: "TELEGRAM_CHAT_ID", required: false, description: "Telegram bildirim grubu ID" },

  // Instagram
  { name: "IG_TOKEN_1", required: false, description: "Instagram Graph API token (Türkçe sayfa)" },

  // Setup & Security
  { name: "SETUP_KEY", required: false, description: "Setup API güvenlik anahtarı" },
  { name: "CRON_SECRET", required: false, description: "Vercel Cron güvenlik token'ı" },
];

export interface EnvValidationResult {
  valid: boolean;
  missing: string[];
  warnings: string[];
  configured: string[];
}

/**
 * Tüm ortam değişkenlerini doğrula
 */
export function validateEnv(): EnvValidationResult {
  const missing: string[] = [];
  const warnings: string[] = [];
  const configured: string[] = [];

  for (const envVar of ENV_SCHEMA) {
    const value = process.env[envVar.name];

    if (!value || value.trim() === "") {
      if (envVar.required) {
        missing.push(`${envVar.name} — ${envVar.description}`);
      } else {
        warnings.push(`${envVar.name} — ${envVar.description}`);
      }
    } else {
      configured.push(envVar.name);
    }
  }

  // Özel doğrulamalar
  if (process.env.AUTH_SECRET && process.env.AUTH_SECRET.length < 32) {
    warnings.push("AUTH_SECRET 32 karakterden kısa — güvenlik riski!");
  }

  if (!process.env.META_APP_SECRET) {
    warnings.push("META_APP_SECRET tanımlı değil — webhook HMAC doğrulaması devre dışı");
  }

  if (!process.env.CRON_SECRET) {
    warnings.push("CRON_SECRET tanımlı değil — cron endpoint'leri korumasız");
  }

  return {
    valid: missing.length === 0,
    missing,
    warnings,
    configured,
  };
}

/**
 * .env.example şablonu oluştur
 */
export function generateEnvTemplate(): string {
  const lines: string[] = [
    "# ==========================================",
    "# QUBA AI — Environment Variables",
    "# ==========================================",
    "",
  ];

  for (const envVar of ENV_SCHEMA) {
    lines.push(`# ${envVar.description}${envVar.required ? " (ZORUNLU)" : ""}`);
    lines.push(`${envVar.name}=`);
    lines.push("");
  }

  return lines.join("\n");
}
