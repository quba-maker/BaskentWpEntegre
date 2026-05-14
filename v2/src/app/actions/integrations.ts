"use server";

import { sql } from "@/lib/db";
import { getSession } from "@/lib/auth/session";

export async function getGoogleSheetsConfig() {
  try {
    const session = await getSession();
    if (!session?.tenantId) return { success: false, error: "Oturum yok" };

    const res = await sql`SELECT value FROM settings WHERE key = 'google_sheets_config' AND tenant_id = ${session.tenantId} LIMIT 1`;
    if (res.length > 0) {
      return { success: true, config: JSON.parse(res[0].value) };
    }
    return { success: true, config: null };
  } catch (error: any) {
    console.error("getGoogleSheetsConfig error:", error);
    return { success: false, error: error.message };
  }
}

export async function saveGoogleSheetsConfig(config: any) {
  try {
    const session = await getSession();
    if (!session?.tenantId) return { success: false, error: "Oturum yok" };

    const value = JSON.stringify(config);
    const existing = await sql`SELECT id FROM settings WHERE key = 'google_sheets_config' AND tenant_id = ${session.tenantId}`;
    
    if (existing.length > 0) {
      await sql`UPDATE settings SET value = ${value}, updated_at = NOW() WHERE key = 'google_sheets_config' AND tenant_id = ${session.tenantId}`;
    } else {
      await sql`INSERT INTO settings (key, value, tenant_id) VALUES ('google_sheets_config', ${value}, ${session.tenantId})`;
    }
    return { success: true };
  } catch (error: any) {
    console.error("saveGoogleSheetsConfig error:", error);
    return { success: false, error: error.message };
  }
}

export async function fetchGoogleSheetsTabs(spreadsheetId: string) {
  try {
    const SHEETS_API_KEY = process.env.GOOGLE_SHEETS_API_KEY;
    if (!SHEETS_API_KEY) {
      return { success: false, error: "Google Sheets API Key is missing in ENV." };
    }

    const BASE_URL = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}`;
    const metaResp = await fetch(`${BASE_URL}?key=${SHEETS_API_KEY}&fields=sheets.properties`);
    const metaData = await metaResp.json();
    
    if (metaData.error) {
      return { success: false, error: metaData.error.message };
    }

    const tabs = metaData.sheets
      .filter((s: any) => !s.properties.hidden)
      .map((s: any) => ({
        id: s.properties.sheetId,
        title: s.properties.title
      }));

    return { success: true, tabs };
  } catch (error: any) {
    return { success: false, error: error.message };
  }
}

// ==========================================
// ENTEGRASYON HEALTH-CHECK
// Her kanalın bağlantı durumunu kontrol eder
// ==========================================

export async function getIntegrationHealth() {
  try {
    const session = await getSession();
    if (!session?.tenantId) return { success: false, error: "Oturum yok" };

    const tenant = await sql`
      SELECT meta_page_token, whatsapp_phone_id, whatsapp_business_id, 
             meta_page_id, instagram_id, name
      FROM tenants WHERE id = ${session.tenantId}
    `;
    if (tenant.length === 0) return { success: false, error: "Tenant bulunamadı" };
    const t = tenant[0];

    const channels: {
      name: string;
      status: 'connected' | 'disconnected' | 'warning' | 'error';
      detail: string;
      lastMessage?: string;
    }[] = [];

    // WhatsApp Health
    if (t.whatsapp_phone_id && t.meta_page_token) {
      try {
        const waResp = await fetch(
          `https://graph.facebook.com/v25.0/${t.whatsapp_phone_id}?access_token=${t.meta_page_token}&fields=verified_name,quality_rating`
        );
        const waData = await waResp.json();
        if (waData.error) {
          channels.push({
            name: "WhatsApp",
            status: "error",
            detail: waData.error.message || "Token geçersiz veya expired",
          });
        } else {
          // Son mesaj zamanı
          const lastMsg = await sql`
            SELECT created_at FROM messages 
            WHERE tenant_id = ${session.tenantId} AND channel = 'whatsapp' 
            ORDER BY created_at DESC LIMIT 1
          `;
          channels.push({
            name: "WhatsApp",
            status: "connected",
            detail: `✓ ${waData.verified_name || 'Aktif'} — Kalite: ${waData.quality_rating || 'N/A'}`,
            lastMessage: lastMsg[0]?.created_at || null,
          });
        }
      } catch {
        channels.push({ name: "WhatsApp", status: "warning", detail: "API'ye ulaşılamadı — geçici hata olabilir" });
      }
    } else {
      channels.push({
        name: "WhatsApp",
        status: "disconnected",
        detail: t.whatsapp_phone_id ? "Token eksik" : "Phone ID eksik",
      });
    }

    // Instagram Health
    if (t.instagram_id && t.meta_page_token) {
      const lastMsg = await sql`
        SELECT created_at FROM messages 
        WHERE tenant_id = ${session.tenantId} AND channel = 'instagram' 
        ORDER BY created_at DESC LIMIT 1
      `;
      channels.push({
        name: "Instagram",
        status: "connected",
        detail: `✓ ID: ${t.instagram_id}`,
        lastMessage: lastMsg[0]?.created_at || null,
      });
    } else {
      channels.push({
        name: "Instagram",
        status: t.instagram_id ? "warning" : "disconnected",
        detail: t.instagram_id ? "Token eksik" : "Bağlı değil",
      });
    }

    // Messenger Health  
    if (t.meta_page_id && t.meta_page_token) {
      const lastMsg = await sql`
        SELECT created_at FROM messages 
        WHERE tenant_id = ${session.tenantId} AND channel = 'messenger' 
        ORDER BY created_at DESC LIMIT 1
      `;
      channels.push({
        name: "Messenger",
        status: "connected",
        detail: `✓ Page ID: ${t.meta_page_id}`,
        lastMessage: lastMsg[0]?.created_at || null,
      });
    } else {
      channels.push({
        name: "Messenger",
        status: t.meta_page_id ? "warning" : "disconnected",
        detail: t.meta_page_id ? "Token eksik" : "Bağlı değil",
      });
    }

    // Google Sheets Health
    const sheetsConfig = await sql`SELECT value FROM settings WHERE key = 'google_sheets_config' AND tenant_id = ${session.tenantId}`;
    if (sheetsConfig.length > 0) {
      channels.push({ name: "Google Sheets", status: "connected", detail: "✓ Yapılandırılmış" });
    } else {
      channels.push({ name: "Google Sheets", status: "disconnected", detail: "Yapılandırılmamış" });
    }

    // Genel durum özeti
    const connectedCount = channels.filter(c => c.status === 'connected').length;
    const errorCount = channels.filter(c => c.status === 'error').length;

    return {
      success: true,
      channels,
      summary: errorCount > 0 
        ? `⚠️ ${errorCount} entegrasyon hatası var` 
        : `${connectedCount}/${channels.length} entegrasyon aktif`,
    };
  } catch (error: any) {
    return { success: false, error: error.message };
  }
}
