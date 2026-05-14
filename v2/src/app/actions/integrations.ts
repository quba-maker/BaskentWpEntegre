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

