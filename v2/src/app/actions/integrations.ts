"use server";

// sql import removed — all queries use parameterized {text, values} format for proper RLS enforcement
import { withActionGuard } from "@/lib/core/action-guard";

// ==========================================
// QUBA AI — Integrations Actions (Zero-Trust)
// ==========================================

export async function getGoogleSheetsConfig() {
  return withActionGuard(
    { actionName: 'getGoogleSheetsConfig' },
    async (ctx) => {
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

export async function saveGoogleSheetsConfig(config: any) {
  return withActionGuard(
    { 
      actionName: 'saveGoogleSheetsConfig',
      roles: ['owner', 'admin'] // Sadece yetkililer config değiştirebilir
    },
    async (ctx) => {
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


export async function getIntegrationHealth() {
  return withActionGuard(
    { actionName: 'getIntegrationHealth' },
    async (ctx) => {
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

      const sheetsConfig = await ctx.db.executeSafe({
        text: `SELECT value, updated_at FROM settings WHERE key = 'google_sheets_config' AND tenant_id = $1 LIMIT 1`,
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
