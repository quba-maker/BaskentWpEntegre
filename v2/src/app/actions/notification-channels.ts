"use server";

import { getSession } from "@/lib/auth/session";
import { withTenantDB } from "@/lib/core/tenant-db";
import { TelegramService } from "@/lib/services/telegram.service";
import { encryptPayload } from "@/lib/core/encryption";

// ═══════════════════════════════════════════════════════════
// NOTIFICATION CHANNEL SERVER ACTIONS
// Phase 2K-P1: Telegram notification channel CRUD + test
// ═══════════════════════════════════════════════════════════

/**
 * Get Telegram channel configuration for the current tenant.
 * Bot token is returned MASKED — never exposes raw token to client.
 */
export async function getTelegramChannelConfig() {
  const session = await getSession();
  if (!session?.tenantId) return { success: false, error: "Unauthorized" };

  const db = withTenantDB(session.tenantId);

  try {
    const rows = await db.executeSafe({
      text: `SELECT id, is_enabled, config, enabled_categories, min_priority,
                    quiet_hours_start, quiet_hours_end, quiet_hours_tz,
                    created_at, updated_at
             FROM notification_channels
             WHERE tenant_id = $1 AND channel_type = 'telegram'
             LIMIT 1`,
      values: [session.tenantId]
    }) as any[];

    if (!rows || rows.length === 0) {
      return {
        success: true,
        exists: false,
        config: {
          isEnabled: false,
          hasToken: false,
          tokenMask: "",
          chatId: "",
          enabledCategories: [],
          minPriority: "high",
        }
      };
    }

    const row = rows[0];
    const cfg = row.config || {};

    // Determine if token exists (encrypted or plain)
    const hasToken = !!(cfg.botTokenEncrypted || cfg.botToken);
    let tokenMask = "";
    if (hasToken) {
      // Show masked version: first 5 + last 5 chars
      try {
        let rawToken = "";
        if (cfg.botTokenEncrypted) {
          rawToken = TelegramService.decryptBotToken(cfg.botTokenEncrypted);
        } else if (cfg.botToken) {
          rawToken = cfg.botToken;
        }
        if (rawToken.length > 10) {
          tokenMask = `${rawToken.substring(0, 5)}...${rawToken.substring(rawToken.length - 5)}`;
        } else {
          tokenMask = "***configured***";
        }
      } catch {
        tokenMask = "***configured***";
      }
    }

    return {
      success: true,
      exists: true,
      config: {
        isEnabled: row.is_enabled,
        hasToken,
        tokenMask,
        chatId: cfg.chatId || "",
        enabledCategories: row.enabled_categories || [],
        minPriority: row.min_priority || "high",
      }
    };
  } catch (err) {
    // Table might not exist yet
    return {
      success: true,
      exists: false,
      config: {
        isEnabled: false,
        hasToken: false,
        tokenMask: "",
        chatId: "",
        enabledCategories: [],
        minPriority: "high",
      }
    };
  }
}

/**
 * Save Telegram channel configuration.
 * Bot token is encrypted before storage — NEVER stored in plaintext.
 */
export async function saveTelegramChannel(params: {
  botToken?: string;       // Only provided when changing token
  chatId: string;
  isEnabled: boolean;
  enabledCategories: string[];
  minPriority: string;
}) {
  const session = await getSession();
  if (!session?.tenantId) return { success: false, error: "Unauthorized" };

  const db = withTenantDB(session.tenantId);

  try {
    // Build config JSONB
    const config: Record<string, any> = { chatId: params.chatId };

    if (params.botToken && params.botToken.trim()) {
      // Encrypt bot token
      config.botTokenEncrypted = encryptPayload('telegram', { bot_token: params.botToken.trim() });
    } else {
      // Keep existing encrypted token (don't overwrite if not provided)
      const existing = await db.executeSafe({
        text: `SELECT config FROM notification_channels WHERE tenant_id = $1 AND channel_type = 'telegram' LIMIT 1`,
        values: [session.tenantId]
      }) as any[];

      if (existing?.[0]?.config?.botTokenEncrypted) {
        config.botTokenEncrypted = existing[0].config.botTokenEncrypted;
      }
    }

    await db.executeSafe({
      text: `INSERT INTO notification_channels (
               tenant_id, channel_type, is_enabled, config,
               enabled_categories, min_priority, updated_at
             ) VALUES ($1, 'telegram', $2, $3::jsonb, $4::text[], $5, NOW())
             ON CONFLICT (tenant_id, channel_type) 
             DO UPDATE SET 
               is_enabled = $2,
               config = $3::jsonb,
               enabled_categories = $4::text[],
               min_priority = $5,
               updated_at = NOW()`,
      values: [
        session.tenantId,
        params.isEnabled,
        JSON.stringify(config),
        params.enabledCategories,
        params.minPriority,
      ]
    });

    return { success: true };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * Send a test notification to verify Telegram configuration.
 * Test message contains NO real patient data.
 */
export async function testTelegramChannel() {
  const session = await getSession();
  if (!session?.tenantId) return { success: false, error: "Unauthorized" };

  const db = withTenantDB(session.tenantId);

  try {
    const rows = await db.executeSafe({
      text: `SELECT config FROM notification_channels 
             WHERE tenant_id = $1 AND channel_type = 'telegram' 
             LIMIT 1`,
      values: [session.tenantId]
    }) as any[];

    if (!rows || rows.length === 0) {
      return { success: false, error: "Telegram kanalı henüz yapılandırılmadı." };
    }

    const config = TelegramService.resolveConfig(rows[0] as any);
    if (!config) {
      return { success: false, error: "Bot token veya Chat ID eksik." };
    }

    const result = await TelegramService.sendTestMessage(config);
    return result;
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * Delete (disable) Telegram channel.
 */
export async function deleteTelegramChannel() {
  const session = await getSession();
  if (!session?.tenantId) return { success: false, error: "Unauthorized" };

  const db = withTenantDB(session.tenantId);

  try {
    await db.executeSafe({
      text: `UPDATE notification_channels 
             SET is_enabled = false, updated_at = NOW()
             WHERE tenant_id = $1 AND channel_type = 'telegram'`,
      values: [session.tenantId]
    });

    return { success: true };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
}
