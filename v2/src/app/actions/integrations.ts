"use server";

import { withActionGuard } from "@/lib/core/action-guard";
import { decryptPayload, encryptPayload, EncryptedPayload } from "@/lib/core/encryption";

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
            text: `UPDATE ingestion_pipelines SET config = $1 WHERE id = $2`,
            values: [JSON.stringify(pipelineConfig), existing[0].id]
          });
        } else {
          await ctx.db.executeSafe({
            text: `INSERT INTO ingestion_pipelines (tenant_id, name, provider, config) 
                   VALUES ($1, 'Google Sheets Lead Ingestion', 'google_sheets', $2)`,
            values: [ctx.tenantId, JSON.stringify(pipelineConfig)]
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
                 c.id, c.provider, c.identifier, c.name,
                 ci.health_status, ci.credentials_encrypted, ci.last_sync_at,
                 cg.name as group_name
               FROM channels c
               JOIN channel_groups cg ON c.group_id = cg.id
               LEFT JOIN channel_integrations ci ON ci.channel_id = c.id
               WHERE cg.tenant_id = $1 AND c.provider != 'meta_legacy'`,
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
        let status: 'connected' | 'warning' | 'error' = 'warning';
        let detail = 'Bağlantı bekleniyor...';

        if (row.health_status === 'healthy') {
          status = 'connected';
          detail = `✓ Aktif (${row.identifier})`;
        } else if (row.health_status === 'error') {
          status = 'error';
          detail = 'Token veya bağlantı hatası';
        }

        const lastMsg = await ctx.db.executeSafe({
          text: `SELECT created_at FROM messages WHERE channel_id = $1 ORDER BY created_at DESC LIMIT 1`,
          values: [row.id]
        });

        channels.push({
          id: row.id,
          name: row.name || row.provider,
          provider: row.provider,
          group: row.group_name,
          status,
          detail,
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

// ── SETUP CHANNEL ───────────────────────────────────────
export async function setupIntegrationChannel(provider: string, identifier: string, name: string, token: string) {
  return withActionGuard(
    { actionName: 'setupIntegrationChannel', roles: ['owner', 'admin'] },
    async (ctx) => {
      let groupId;
      const groups = await ctx.db.executeSafe({ text: `SELECT id FROM channel_groups WHERE tenant_id = $1 AND name = 'Varsayılan Grup'`, values: [ctx.tenantId] });
      if (groups.length > 0) groupId = groups[0].id;
      else {
        const newGroup = await ctx.db.executeSafe({ text: `INSERT INTO channel_groups (tenant_id, name) VALUES ($1, 'Varsayılan Grup') RETURNING id`, values: [ctx.tenantId] });
        groupId = newGroup[0].id;
      }
      const newCh = await ctx.db.executeSafe({ text: `INSERT INTO channels (group_id, provider, identifier, name) VALUES ($1, $2, $3, $4) RETURNING id`, values: [groupId, provider, identifier, name] });
      
      await ctx.db.executeSafe({ text: `INSERT INTO channel_integrations (channel_id, provider, credentials_encrypted) VALUES ($1, $2, $3)`, values: [newCh[0].id, provider, JSON.stringify({ accessToken: token })] });

      return { success: true };
    }
  ).then(res => {
    if (!res.success) return { success: false, error: res.error };
    return { success: true };
  });
}
