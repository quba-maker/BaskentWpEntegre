"use server";

import { withActionGuard } from "@/lib/core/action-guard";
import { decryptPayload, encryptPayload, EncryptedPayload } from "@/lib/core/encryption";
import { canonicalProvider, isValidMessengerIdentifier } from "@/lib/core/provider-aliases";

// ==========================================
// QUBA AI — Integrations Actions (Zero-Trust, V2-Native)
// V2: google_sheets config from ingestion_pipelines + tenant_integrations
// Rollback: USE_V2_INTEGRATIONS=false → settings table
// ==========================================

function isV2IntegrationsEnabled(): boolean {
  return process.env.USE_V2_INTEGRATIONS !== 'false'; // default: true
}

// ── GET CONFIG ──────────────────────────────────────────
export async function getGoogleSheetsConfig() {
  return withActionGuard(
    { actionName: 'getGoogleSheetsConfig' },
    async (ctx) => {
      if (isV2IntegrationsEnabled()) {
        // V2: Read from ingestion_pipelines (config) + tenant_integrations (credentials)
        const pipeline = await ctx.db.executeSafe({
          text: `SELECT config FROM ingestion_pipelines 
                 WHERE tenant_id = $1 AND provider = 'google_sheets' LIMIT 1`,
          values: [ctx.tenantId]
        });

        const integration = await ctx.db.executeSafe({
          text: `SELECT credentials FROM tenant_integrations 
                 WHERE tenant_id = $1 AND provider = 'google_sheets' LIMIT 1`,
          values: [ctx.tenantId]
        });

        if (pipeline.length === 0 && integration.length === 0) {
          return { config: null };
        }

        // Build unified config shape (same as V1 for UI compatibility)
        const pipelineConfig = pipeline.length > 0 
          ? (typeof pipeline[0].config === 'string' ? JSON.parse(pipeline[0].config) : pipeline[0].config)
          : {};
        
        let apiKey = '';
        if (integration.length > 0 && integration[0].credentials) {
          try {
            const creds = typeof integration[0].credentials === 'string' 
              ? JSON.parse(integration[0].credentials) 
              : integration[0].credentials;
            // If encrypted, decrypt (EncryptedPayload format: {version, provider, encrypted_payload})
            if (creds.encrypted_payload && creds.version) {
              const decrypted = decryptPayload(creds as EncryptedPayload);
              apiKey = decrypted.apiKey || '';
            } else {
              apiKey = creds.apiKey || '';
            }
          } catch (e) {
            console.warn('[V2_INTEGRATIONS] Failed to decrypt credentials, continuing without apiKey');
          }
        }

        return {
          config: {
            spreadsheetId: pipelineConfig.spreadsheetId || '',
            activeSheets: pipelineConfig.activeSheets || [],
            ...(apiKey ? { apiKey } : {})
          }
        };
      }

      // V1 FALLBACK: Read from settings table
      const res = await ctx.db.executeSafe({
        text: `SELECT value FROM settings WHERE key = 'google_sheets_config' AND tenant_id = $1 LIMIT 1`,
        values: [ctx.tenantId]
      });
      
      if (res.length > 0) {
        return { config: JSON.parse(res[0].value) };
      }
      return { config: null };
    }
  ).then(res => {
    if (!res.success) return { success: false, error: res.error };
    return { success: true, config: res.data?.config };
  });
}

// ── SAVE CONFIG ─────────────────────────────────────────
export async function saveGoogleSheetsConfig(config: any) {
  return withActionGuard(
    { 
      actionName: 'saveGoogleSheetsConfig',
      roles: ['owner', 'admin']
    },
    async (ctx) => {
      if (isV2IntegrationsEnabled()) {
        // V2: Write to ingestion_pipelines (config) + tenant_integrations (credentials)
        const pipelineConfig = {
          spreadsheetId: config.spreadsheetId || '',
          activeSheets: config.activeSheets || []
        };

        // Upsert ingestion_pipelines (no unique constraint, use conditional)
        const existing = await ctx.db.executeSafe({
          text: `SELECT id FROM ingestion_pipelines WHERE tenant_id = $1 AND provider = 'google_sheets' LIMIT 1`,
          values: [ctx.tenantId]
        });

        if (existing.length > 0) {
          await ctx.db.executeSafe({
            text: `UPDATE ingestion_pipelines SET config = $1, updated_at = NOW() WHERE id = $2`,
            values: [JSON.stringify(pipelineConfig), existing[0].id]
          });
          // Update routing if provided
          if (config.outbound_channel_id !== undefined || config.greeting_group_id !== undefined) {
            const updates: string[] = ['updated_at = NOW()'];
            const vals: any[] = [];
            let idx = 1;
            if (config.outbound_channel_id !== undefined) {
              updates.push(`outbound_channel_id = $${idx}`);
              vals.push(config.outbound_channel_id || null);
              idx++;
            }
            if (config.greeting_group_id !== undefined) {
              updates.push(`greeting_group_id = $${idx}`);
              vals.push(config.greeting_group_id || null);
              idx++;
            }
            vals.push(existing[0].id);
            await ctx.db.executeSafe({
              text: `UPDATE ingestion_pipelines SET ${updates.join(', ')} WHERE id = $${idx}`,
              values: vals
            });
          }
        } else {
          await ctx.db.executeSafe({
            text: `INSERT INTO ingestion_pipelines (tenant_id, name, provider, config, outbound_channel_id, greeting_group_id) 
                   VALUES ($1, 'Google Sheets Lead Ingestion', 'google_sheets', $2, $3, $4)`,
            values: [ctx.tenantId, JSON.stringify(pipelineConfig), config.outbound_channel_id || null, config.greeting_group_id || null]
          });
        }

        // Upsert tenant_integrations (encrypt credentials)
        if (config.apiKey) {
          const encryptedCreds = encryptPayload('google_sheets', {
            apiKey: config.apiKey,
            spreadsheetId: config.spreadsheetId || '',
            activeSheets: config.activeSheets || []
          });

          await ctx.db.executeSafe({
            text: `UPDATE tenant_integrations 
                   SET credentials = $1, updated_at = NOW()
                   WHERE tenant_id = $2 AND provider = 'google_sheets'`,
            values: [JSON.stringify(encryptedCreds), ctx.tenantId]
          });
        }

        return { success: true };
      }

      // V1 FALLBACK: Write to settings table
      const value = JSON.stringify(config);
      await ctx.db.executeSafe({
        text: `INSERT INTO settings (key, value, tenant_id, updated_at) 
               VALUES ('google_sheets_config', $1, $2, NOW())
               ON CONFLICT (tenant_id, key) 
               DO UPDATE SET value = EXCLUDED.value, updated_at = EXCLUDED.updated_at`,
        values: [value, ctx.tenantId]
      });
      return { success: true };
    }
  ).then(res => {
    if (!res.success) return { success: false, error: res.error };
    return { success: true };
  });
}

// ── FETCH TABS ──────────────────────────────────────────
export async function fetchGoogleSheetsTabs(spreadsheetId: string) {
  return withActionGuard(
    { actionName: 'fetchGoogleSheetsTabs' },
    async () => {
      const SHEETS_API_KEY = process.env.GOOGLE_SHEETS_API_KEY;
      if (!SHEETS_API_KEY) {
        throw new Error("Google Sheets API Key is missing in ENV.");
      }

      const BASE_URL = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}`;
      const metaResp = await fetch(`${BASE_URL}?key=${SHEETS_API_KEY}&fields=sheets.properties`);
      const metaData = await metaResp.json();
      
      if (metaData.error) {
        throw new Error(metaData.error.message);
      }

      const tabs = metaData.sheets
        .filter((s: any) => !s.properties.hidden)
        .map((s: any) => ({
          id: s.properties.sheetId,
          title: s.properties.title
        }));

      return { tabs };
    }
  ).then(res => {
    if (!res.success) return { success: false, error: res.error };
    return { success: true, tabs: res.data?.tabs };
  });
}

// ── INTEGRATION HEALTH ──────────────────────────────────
export async function getIntegrationHealth() {
  return withActionGuard(
    { actionName: 'getIntegrationHealth' },
    async (ctx) => {
      console.log('[V2_INTEGRATIONS_TRACE] getIntegrationHealth START | tenantId:', ctx.tenantId, '| v2Enabled:', isV2IntegrationsEnabled());
      // V2: Channel health from channels + channel_integrations (always V2)
      const dbChannels = await ctx.db.executeSafe({
        text: `SELECT 
                 c.id, c.provider, c.identifier, c.name, c.status as channel_status,
                 ci.health_status, ci.credentials_encrypted, ci.last_sync_at,
                 cg.name as group_name,
                 COALESCE(cg.display_name, cg.name) as bot_name,
                 cg.id as bot_id, cg.color as bot_color
               FROM channels c
               JOIN channel_groups cg ON c.group_id = cg.id
               LEFT JOIN channel_integrations ci ON ci.channel_id = c.id
               WHERE cg.tenant_id = $1 AND c.provider != 'meta_legacy'
               AND COALESCE(c.status, 'active') != 'archived'
               AND cg.status = 'active'`,
        values: [ctx.tenantId]
      });

      const channels: {
        id: string;
        name: string;
        provider: string;
        group: string;
        status: 'connected' | 'disconnected' | 'warning' | 'error';
        detail: string;
        lastMessage?: any;
        lastSyncAt?: any;
      }[] = [];

      for (const row of dbChannels) {
        let status: 'connected' | 'disconnected' | 'warning' | 'error' = 'warning';
        let detail = 'Bağlantı bekleniyor...';
        const displayProvider = canonicalProvider(row.provider);

        // ── Real Health Evaluation ──
        const hasCreds = !!row.credentials_encrypted;
        const hasLastSync = !!row.last_sync_at;

        // 1. No credentials → disconnected
        if (!hasCreds) {
          status = 'disconnected';
          detail = 'Kimlik bilgisi eksik';
        }
        // 2. Messenger with non-numeric identifier → needs PAGE_ID
        else if (displayProvider === 'messenger' && !isValidMessengerIdentifier(row.identifier || '')) {
          status = 'warning';
          detail = 'PAGE_ID gerekli — Meta Business Suite\'den alın';
        }
        // 3. Has error health_status
        else if (row.health_status === 'error') {
          status = 'error';
          detail = 'Token veya bağlantı hatası';
        }
        // 4. Pending (newly connected, no webhook yet)
        else if (row.health_status === 'pending') {
          status = 'warning';
          detail = `Bağlandı — test/webhook bekleniyor (${row.identifier})`;
        }
        // 5. Healthy but no last_sync_at
        else if (row.health_status === 'healthy' && !hasLastSync) {
          status = 'warning';
          detail = `Bağlı ama test edilmedi (${row.identifier})`;
        }
        // 6. Healthy but last_sync_at > 7 days ago
        else if (row.health_status === 'healthy' && hasLastSync) {
          const daysSinceSync = (Date.now() - new Date(row.last_sync_at).getTime()) / (1000 * 60 * 60 * 24);
          if (daysSinceSync > 7) {
            status = 'warning';
            detail = `İnaktif — son webhook ${Math.floor(daysSinceSync)} gün önce`;
          } else {
            status = 'connected';
            detail = `✓ Aktif (${row.identifier})`;
          }
        }
        // 7. Healthy + recent sync → active
        else if (row.health_status === 'healthy') {
          status = 'connected';
          detail = `✓ Aktif (${row.identifier})`;
        }

        // Check for missing prompt binding
        const bindingCheck = await ctx.db.executeSafe({
          text: `SELECT 1 FROM channel_prompt_bindings WHERE channel_id = $1 LIMIT 1`,
          values: [row.id]
        });
        const hasBinding = bindingCheck.length > 0;
        if (!hasBinding && status !== 'disconnected') {
          detail += ' • Prompt bağlı değil';
        }

        const lastMsg = await ctx.db.executeSafe({
          text: `SELECT created_at FROM messages WHERE channel_id = $1 AND tenant_id = $2 ORDER BY created_at DESC LIMIT 1`,
          values: [row.id, ctx.tenantId]
        });

        channels.push({
          id: row.id,
          name: row.name || displayProvider,
          provider: displayProvider,
          group: row.group_name,
          botName: row.bot_name || row.group_name,
          botId: row.bot_id,
          botColor: row.bot_color || '#6366f1',
          status,
          detail,
          hasBinding,
          lastMessage: lastMsg[0]?.created_at || null,
          lastSyncAt: row.last_sync_at || null,
        });
      }

      // Google Sheets integration card — V2 or V1
      if (isV2IntegrationsEnabled()) {
        // V2: Read from tenant_integrations + ingestion_pipelines
        try {
        const sheetsIntegration = await ctx.db.executeSafe({
          text: `SELECT health_status, last_sync_at, updated_at FROM tenant_integrations 
                 WHERE tenant_id = $1 AND provider = 'google_sheets' LIMIT 1`,
          values: [ctx.tenantId]
        });
        const sheetsPipeline = await ctx.db.executeSafe({
          text: `SELECT config FROM ingestion_pipelines 
                 WHERE tenant_id = $1 AND provider = 'google_sheets' LIMIT 1`,
          values: [ctx.tenantId]
        });

        if (sheetsIntegration.length > 0) {
          const pipeConfig = sheetsPipeline.length > 0 
            ? (typeof sheetsPipeline[0].config === 'string' ? JSON.parse(sheetsPipeline[0].config) : sheetsPipeline[0].config)
            : {};
          const hasSpreadsheet = !!pipeConfig?.spreadsheetId;
          const isHealthy = sheetsIntegration[0].health_status === 'healthy';

          channels.push({
            id: 'google-sheets-synthetic',
            name: 'Google Sheets Integration',
            provider: 'google_sheets',
            group: 'Automation',
            status: isHealthy && hasSpreadsheet ? 'connected' : hasSpreadsheet ? 'warning' : 'warning',
            detail: isHealthy && hasSpreadsheet 
              ? `✓ Aktif (${pipeConfig.spreadsheetId.slice(0, 12)}...)`
              : hasSpreadsheet ? `⚠ ${sheetsIntegration[0].health_status}` : 'Kurulum tamamlanmadı',
            lastMessage: null,
            lastSyncAt: sheetsIntegration[0].last_sync_at || null,
          });
        }
        } catch (sheetsErr: any) {
          console.error('[V2_INTEGRATIONS_ERROR] Sheets health check failed:', sheetsErr?.message || sheetsErr);
          // Non-fatal: continue without Google Sheets card
        }
      } else {
        // V1 FALLBACK: Read from settings
        const sheetsConfig = await ctx.db.executeSafe({
          text: `SELECT value, updated_at FROM settings WHERE key = 'google_sheets_config' AND tenant_id = $1 LIMIT 1`,
          values: [ctx.tenantId]
        });

        if (sheetsConfig.length > 0) {
          try {
            const cfg = JSON.parse(sheetsConfig[0].value);
            const isConnected = !!cfg?.spreadsheetId;
            channels.push({
              id: 'google-sheets-synthetic',
              name: 'Google Sheets Integration',
              provider: 'google_sheets',
              group: 'Automation',
              status: isConnected ? 'connected' : 'warning',
              detail: isConnected ? `✓ Aktif (${cfg.spreadsheetId.slice(0, 12)}...)` : 'Kurulum tamamlanmadı',
              lastMessage: null,
              lastSyncAt: sheetsConfig[0].updated_at || null,
            });
          } catch (e) {
            // ignore parsing error
          }
        }
      }

      const connectedCount = channels.filter(c => c.status === 'connected').length;
      const errorCount = channels.filter(c => c.status === 'error').length;

      return {
        channels,
        summary: errorCount > 0 
          ? `⚠️ ${errorCount} entegrasyon hatası var` 
          : `${connectedCount}/${channels.length} kanal aktif`,
      };
    }
  ).then(res => {
    if (!res.success) return { success: false, error: res.error };
    return { success: true, channels: res.data?.channels, summary: res.data?.summary };
  });
}

// ── CHANNEL CONNECT ACTIONS ─────────────────────────────

/**
 * Connect a new WhatsApp channel
 */
export async function connectWhatsAppChannel(input: {
  name: string;
  phoneNumberId: string;
  wabaId?: string;
  accessToken: string;
  botGroupId: string;
}): Promise<{ success: boolean; channelId?: string; error?: string }> {
  return withActionGuard(
    { actionName: 'connectWhatsAppChannel', roles: ['owner', 'admin'] },
    async (ctx) => {
      const { name, phoneNumberId, wabaId, accessToken, botGroupId } = input;

      // Verify bot ownership
      const bot = await ctx.db.executeSafe({
        text: `SELECT id FROM channel_groups WHERE id = $1 AND tenant_id = $2 AND status = 'active'`,
        values: [botGroupId, ctx.tenantId]
      });
      if (bot.length === 0) throw new Error('Bot not found');

      // Check duplicate
      const existing = await ctx.db.executeSafe({
        text: `SELECT c.id FROM channels c JOIN channel_groups cg ON c.group_id = cg.id 
               WHERE cg.tenant_id = $1 AND c.provider = 'whatsapp' AND c.identifier = $2`,
        values: [ctx.tenantId, phoneNumberId]
      });
      if (existing.length > 0) throw new Error('Bu WhatsApp numarası zaten ekli');

      // Insert channel
      const ch = await ctx.db.executeSafe({
        text: `INSERT INTO channels (group_id, provider, identifier, name, status) 
               VALUES ($1, 'whatsapp', $2, $3, 'active') RETURNING id`,
        values: [botGroupId, phoneNumberId, name]
      });
      const channelId = ch[0].id;

      // Insert credentials (encrypted)
      const encrypted = encryptPayload({ accessToken, wabaId: wabaId || '', phoneNumberId }, 'whatsapp');
      await ctx.db.executeSafe({
        text: `INSERT INTO channel_integrations (channel_id, provider, credentials_encrypted, health_status)
               VALUES ($1, 'whatsapp', $2, 'pending')`,
        values: [channelId, JSON.stringify(encrypted)]
      });

      // Create prompt binding to bot's active prompt
      const prompt = await ctx.db.executeSafe({
        text: `SELECT id FROM channel_prompts WHERE group_id = $1 AND tenant_id = $2 AND is_active = true AND prompt_type = 'system' LIMIT 1`,
        values: [botGroupId, ctx.tenantId]
      });
      if (prompt.length > 0) {
        await ctx.db.executeSafe({
          text: `INSERT INTO channel_prompt_bindings (channel_id, prompt_id, is_active, priority) VALUES ($1, $2, true, 100)`,
          values: [channelId, prompt[0].id]
        });
      }

      return { channelId };
    }
  ).then(res => {
    if (!res.success) return { success: false, error: res.error };
    return { success: true, channelId: (res.data as any)?.channelId };
  });
}

/**
 * Connect a new Instagram channel
 */
export async function connectInstagramChannel(input: {
  name: string;
  instagramBusinessAccountId: string;
  accessToken: string;
  botGroupId: string;
}): Promise<{ success: boolean; channelId?: string; error?: string }> {
  return withActionGuard(
    { actionName: 'connectInstagramChannel', roles: ['owner', 'admin'] },
    async (ctx) => {
      const { name, instagramBusinessAccountId, accessToken, botGroupId } = input;

      const bot = await ctx.db.executeSafe({
        text: `SELECT id FROM channel_groups WHERE id = $1 AND tenant_id = $2 AND status = 'active'`,
        values: [botGroupId, ctx.tenantId]
      });
      if (bot.length === 0) throw new Error('Bot not found');

      // Use meta_instagram as DB provider (alias system handles runtime)
      const ch = await ctx.db.executeSafe({
        text: `INSERT INTO channels (group_id, provider, identifier, name, status)
               VALUES ($1, 'meta_instagram', $2, $3, 'active') RETURNING id`,
        values: [botGroupId, instagramBusinessAccountId, name]
      });
      const channelId = ch[0].id;

      const encrypted = encryptPayload({ accessToken, instagramBusinessAccountId }, 'instagram');
      await ctx.db.executeSafe({
        text: `INSERT INTO channel_integrations (channel_id, provider, credentials_encrypted, health_status)
               VALUES ($1, 'meta_instagram', $2, 'pending')`,
        values: [channelId, JSON.stringify(encrypted)]
      });

      const prompt = await ctx.db.executeSafe({
        text: `SELECT id FROM channel_prompts WHERE group_id = $1 AND tenant_id = $2 AND is_active = true AND prompt_type = 'system' LIMIT 1`,
        values: [botGroupId, ctx.tenantId]
      });
      if (prompt.length > 0) {
        await ctx.db.executeSafe({
          text: `INSERT INTO channel_prompt_bindings (channel_id, prompt_id, is_active, priority) VALUES ($1, $2, true, 100)`,
          values: [channelId, prompt[0].id]
        });
      }

      return { channelId };
    }
  ).then(res => {
    if (!res.success) return { success: false, error: res.error };
    return { success: true, channelId: (res.data as any)?.channelId };
  });
}

/**
 * Connect a new Facebook/Messenger page
 */
export async function connectMessengerPage(input: {
  name: string;
  pageId: string;
  pageAccessToken: string;
  botGroupId: string;
}): Promise<{ success: boolean; channelId?: string; error?: string }> {
  return withActionGuard(
    { actionName: 'connectMessengerPage', roles: ['owner', 'admin'] },
    async (ctx) => {
      const { name, pageId, pageAccessToken, botGroupId } = input;

      if (!isValidMessengerIdentifier(pageId)) {
        throw new Error('PAGE_ID numerik olmalıdır. Meta Business Suite → Pages → About → Page ID');
      }

      const bot = await ctx.db.executeSafe({
        text: `SELECT id FROM channel_groups WHERE id = $1 AND tenant_id = $2 AND status = 'active'`,
        values: [botGroupId, ctx.tenantId]
      });
      if (bot.length === 0) throw new Error('Bot not found');

      const ch = await ctx.db.executeSafe({
        text: `INSERT INTO channels (group_id, provider, identifier, name, status)
               VALUES ($1, 'messenger', $2, $3, 'active') RETURNING id`,
        values: [botGroupId, pageId, name]
      });
      const channelId = ch[0].id;

      const encrypted = encryptPayload({ pageAccessToken, pageId }, 'messenger');
      await ctx.db.executeSafe({
        text: `INSERT INTO channel_integrations (channel_id, provider, credentials_encrypted, health_status)
               VALUES ($1, 'messenger', $2, 'pending')`,
        values: [channelId, JSON.stringify(encrypted)]
      });

      const prompt = await ctx.db.executeSafe({
        text: `SELECT id FROM channel_prompts WHERE group_id = $1 AND tenant_id = $2 AND is_active = true AND prompt_type = 'system' LIMIT 1`,
        values: [botGroupId, ctx.tenantId]
      });
      if (prompt.length > 0) {
        await ctx.db.executeSafe({
          text: `INSERT INTO channel_prompt_bindings (channel_id, prompt_id, is_active, priority) VALUES ($1, $2, true, 100)`,
          values: [channelId, prompt[0].id]
        });
      }

      return { channelId };
    }
  ).then(res => {
    if (!res.success) return { success: false, error: res.error };
    return { success: true, channelId: (res.data as any)?.channelId };
  });
}

/**
 * Soft-archive a channel (credentials preserved, channel inactive)
 */
export async function archiveChannel(channelId: string): Promise<{ success: boolean; error?: string }> {
  return withActionGuard(
    { actionName: 'archiveChannel', roles: ['owner', 'admin'] },
    async (ctx) => {
      const ch = await ctx.db.executeSafe({
        text: `SELECT c.id FROM channels c JOIN channel_groups cg ON c.group_id = cg.id
               WHERE c.id = $1 AND cg.tenant_id = $2`,
        values: [channelId, ctx.tenantId]
      });
      if (ch.length === 0) throw new Error('Channel not found');

      await ctx.db.executeSafe({
        text: `UPDATE channels SET status = 'archived', updated_at = NOW() WHERE id = $1`,
        values: [channelId]
      });
      await ctx.db.executeSafe({
        text: `UPDATE channel_prompt_bindings SET is_active = false WHERE channel_id = $1`,
        values: [channelId]
      });
      return true;
    }
  ).then(res => {
    if (!res.success) return { success: false, error: res.error };
    return { success: true };
  });
}

/**
 * Returns active bots for bot assignment dropdown
 */
export async function getBotListForDropdown(): Promise<{ success: boolean; bots?: { id: string; displayName: string; color: string }[]; error?: string }> {
  return withActionGuard(
    { actionName: 'getBotListForDropdown' },
    async (ctx) => {
      const bots = await ctx.db.executeSafe({
        text: `SELECT id, COALESCE(display_name, name) as display_name, color
               FROM channel_groups WHERE tenant_id = $1 AND status = 'active'
               ORDER BY sort_order ASC`,
        values: [ctx.tenantId]
      });
      return bots.map((b: any) => ({ id: b.id, displayName: b.display_name, color: b.color || '#6366f1' }));
    }
  ).then(res => {
    if (!res.success) return { success: false, error: res.error };
    return { success: true, bots: res.data as any[] };
  });
}

