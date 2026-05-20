"use server";

import { sql } from "@/lib/db";
import { withActionGuard } from "@/lib/core/action-guard";

// ==========================================
// QUBA AI — Integrations Actions (Zero-Trust)
// ==========================================

export async function getGoogleSheetsConfig() {
  return withActionGuard(
    { actionName: 'getGoogleSheetsConfig' },
    async (ctx) => {
      const res = await ctx.db.executeSafe(sql`
        SELECT value FROM settings 
        WHERE key = 'google_sheets_config' AND tenant_id = ${ctx.tenantId} 
        LIMIT 1
      `);
      
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
      
      await ctx.db.executeSafe(sql`
        INSERT INTO settings (key, value, tenant_id, updated_at) 
        VALUES ('google_sheets_config', ${value}, ${ctx.tenantId}, NOW())
        ON CONFLICT (tenant_id, key) 
        DO UPDATE SET value = EXCLUDED.value, updated_at = EXCLUDED.updated_at
      `);
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
      const dbChannels = await ctx.db.executeSafe(sql`
        SELECT 
          c.id, c.provider, c.identifier, c.name,
          ci.health_status, ci.credentials_encrypted, ci.last_sync_at,
          cg.name as group_name
        FROM channels c
        JOIN channel_groups cg ON c.group_id = cg.id
        LEFT JOIN channel_integrations ci ON ci.channel_id = c.id
        WHERE cg.tenant_id = ${ctx.tenantId}
      `);

      const channels: {
        id: string;
        name: string;
        provider: string;
        group: string;
        status: 'connected' | 'disconnected' | 'warning' | 'error';
        detail: string;
        lastMessage?: string;
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

        const lastMsg = await ctx.db.executeSafe(sql`
          SELECT created_at FROM messages 
          WHERE channel_id = ${row.id}
          ORDER BY created_at DESC LIMIT 1
        `);

        channels.push({
          id: row.id,
          name: row.name || row.provider,
          provider: row.provider,
          group: row.group_name,
          status,
          detail,
          lastMessage: lastMsg[0]?.created_at || null,
        });
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
      const groups = await ctx.db.executeSafe(sql`SELECT id FROM channel_groups WHERE tenant_id = ${ctx.tenantId} AND name = 'Varsayılan Grup'`);
      if (groups.length > 0) groupId = groups[0].id;
      else {
        const newGroup = await ctx.db.executeSafe(sql`INSERT INTO channel_groups (tenant_id, name) VALUES (${ctx.tenantId}, 'Varsayılan Grup') RETURNING id`);
        groupId = newGroup[0].id;
      }
      
      const newCh = await ctx.db.executeSafe(sql`INSERT INTO channels (group_id, provider, identifier, name) VALUES (${groupId}, ${provider}, ${identifier}, ${name}) RETURNING id`);
      
      await ctx.db.executeSafe(sql`INSERT INTO channel_integrations (channel_id, provider, credentials_encrypted) VALUES (${newCh[0].id}, ${provider}, ${JSON.stringify({ accessToken: token })})`);

      return { success: true };
    }
  ).then(res => {
    if (!res.success) return { success: false, error: res.error };
    return { success: true };
  });
}
