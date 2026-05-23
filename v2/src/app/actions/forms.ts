"use server";

// sql import removed — all queries use parameterized {text, values} format for proper RLS enforcement
import { withActionGuard } from "@/lib/core/action-guard";
import { logAudit } from "@/lib/audit";

// ==========================================
// QUBA AI — Forms & Leads Actions (Zero-Trust)
// ==========================================

export async function getForms(page: number = 1, search: string = "", source: string = "all") {
  return withActionGuard(
    { actionName: 'getForms' },
    async (ctx) => {
      const limit = 50;
      const offset = (page - 1) * limit;
      const searchFilter = search.trim() ? `%${search.trim()}%` : null;
      const sourceFilter = source !== "all" ? `%${source}%` : null;

      let rows;
      
      if (searchFilter && sourceFilter) {
        rows = await ctx.db.executeSafe({
          text: `SELECT l.*, c.status as conversation_status, mem.summary_text as ai_summary
                 FROM leads l
                 LEFT JOIN conversations c ON c.phone_number = l.phone_number AND c.tenant_id = l.tenant_id
                 LEFT JOIN conversation_memory mem ON mem.conversation_id::text = c.id::text
                 WHERE l.tenant_id = $1
                   AND (l.patient_name ILIKE $2 OR l.phone_number ILIKE $2 OR l.email ILIKE $2)
                   AND l.form_name ILIKE $3
                 ORDER BY l.created_at DESC LIMIT $4 OFFSET $5`,
          values: [ctx.tenantId, searchFilter, sourceFilter, limit, offset]
        });
      } else if (searchFilter) {
        rows = await ctx.db.executeSafe({
          text: `SELECT l.*, c.status as conversation_status, mem.summary_text as ai_summary
                 FROM leads l
                 LEFT JOIN conversations c ON c.phone_number = l.phone_number AND c.tenant_id = l.tenant_id
                 LEFT JOIN conversation_memory mem ON mem.conversation_id::text = c.id::text
                 WHERE l.tenant_id = $1
                   AND (l.patient_name ILIKE $2 OR l.phone_number ILIKE $2 OR l.email ILIKE $2)
                 ORDER BY l.created_at DESC LIMIT $3 OFFSET $4`,
          values: [ctx.tenantId, searchFilter, limit, offset]
        });
      } else if (sourceFilter) {
        rows = await ctx.db.executeSafe({
          text: `SELECT l.*, c.status as conversation_status, mem.summary_text as ai_summary
                 FROM leads l
                 LEFT JOIN conversations c ON c.phone_number = l.phone_number AND c.tenant_id = l.tenant_id
                 LEFT JOIN conversation_memory mem ON mem.conversation_id::text = c.id::text
                 WHERE l.tenant_id = $1
                   AND l.form_name ILIKE $2
                 ORDER BY l.created_at DESC LIMIT $3 OFFSET $4`,
          values: [ctx.tenantId, sourceFilter, limit, offset]
        });
      } else {
        rows = await ctx.db.executeSafe({
          text: `SELECT l.*, c.status as conversation_status, mem.summary_text as ai_summary
                 FROM leads l
                 LEFT JOIN conversations c ON c.phone_number = l.phone_number AND c.tenant_id = l.tenant_id
                 LEFT JOIN conversation_memory mem ON mem.conversation_id::text = c.id::text
                 WHERE l.tenant_id = $1
                 ORDER BY l.created_at DESC LIMIT $2 OFFSET $3`,
          values: [ctx.tenantId, limit, offset]
        });
      }

      return rows.map((r: any) => ({
        id: r.id,
        phone_number: r.phone_number,
        patient_name: r.patient_name || "İsimsiz Form",
        email: r.email,
        city: r.city,
        form_name: r.form_name || "Bilinmeyen Form",
        stage: r.stage || "new",
        created_at: r.created_at,
        raw_data: r.raw_data ? JSON.parse(r.raw_data) : {},
        country: r.country,
        notes: r.notes || "",
        ai_summary: r.ai_summary || "",
        isBotActive: r.conversation_status === 'bot'
      }));
    }
  ).then(res => res.data || []);
}

export async function updateLeadNotes(id: number, notes: string) {
  return withActionGuard(
    { actionName: 'updateLeadNotes' },
    async (ctx) => {
      const lead = await ctx.db.executeSafe({
        text: `SELECT phone_number FROM leads WHERE id = $1 AND tenant_id = $2`,
        values: [id, ctx.tenantId]
      });
      if (lead.length === 0) throw new Error("Kayıt bulunamadı.");

      await ctx.db.executeSafe({
        text: `UPDATE leads SET notes = $1 WHERE id = $2 AND tenant_id = $3`,
        values: [notes, id, ctx.tenantId]
      });

      const SHEET_URL = process.env.GOOGLE_SHEET_UPDATE_URL || process.env.GOOGLE_SHEET_URL;
      if (SHEET_URL && lead.length > 0) {
        try {
          await fetch(SHEET_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              action: 'updateNoteByPhone',
              phone: lead[0].phone_number,
              note: notes
            })
          });
        } catch (sheetErr) {
          const { logger: formsLogger } = await import("@/lib/core/logger");
          formsLogger.withContext({ module: 'Forms' }).warn("Google Sheets note sync failed", { error: String(sheetErr) });
        }
      }

      return { success: true };
    }
  ).then(res => {
    if (!res.success) return { success: false, error: res.error };
    return { success: true };
  });
}

export async function deleteAllLeads() {
  return withActionGuard(
    { 
      actionName: 'deleteAllLeads',
      roles: ['owner', 'admin', 'platform_admin']
    },
    async (ctx) => {
      await ctx.db.executeSafe({ text: `DELETE FROM leads WHERE tenant_id = $1`, values: [ctx.tenantId] });
      
      logAudit({
        tenantId: ctx.tenantId,
        userId: ctx.userId,
        userEmail: ctx.email,
        action: "leads_bulk_delete",
        entityType: "lead",
        entityId: "bulk",
      });

      return { success: true, message: "Firma lead kayıtları başarıyla silindi." };
    }
  ).then(res => {
    if (!res.success) return { success: false, error: res.error };
    return { success: true, message: res.data?.message };
  });
}

export async function getCampaignNames() {
  return withActionGuard(
    { actionName: 'getCampaignNames' },
    async (ctx) => {
      const campaigns = await ctx.db.executeSafe({
        text: `SELECT DISTINCT form_name FROM leads WHERE tenant_id = $1 AND form_name IS NOT NULL AND form_name != '' ORDER BY form_name ASC`,
        values: [ctx.tenantId]
      });
      return campaigns.map((c: any) => c.form_name);
    }
  ).then(res => res.data || []);
}

export async function syncGoogleSheets() {
  console.log('[SYNC_ACTION_ENTRY] syncGoogleSheets called');
  
  return withActionGuard(
    { actionName: 'syncGoogleSheets', roles: ['owner', 'admin'] },
    async (ctx) => {
      console.log('[SYNC_START] tenantId:', ctx.tenantId);
      
      const integrations = await ctx.db.executeSafe({
        text: `SELECT credentials FROM tenant_integrations WHERE tenant_id = $1 AND provider = 'google_sheets' LIMIT 1`,
        values: [ctx.tenantId]
      });

      if (integrations.length === 0) {
        console.log('[SYNC_NO_INTEGRATION]');
        return { success: false, error: "Google Sheets entegrasyonu bulunamadı. Lütfen ayarlardan kurulum yapın." };
      }

      console.log('[SYNC_INTEGRATION_FOUND]');

      let payload;
      try {
        const { decryptPayload } = await import('@/lib/core/encryption');
        payload = decryptPayload(integrations[0].credentials);
      } catch (e: any) {
        console.error('[SYNC_DECRYPT_ERROR]', e?.message);
        return { success: false, error: `Kimlik bilgileri çözülemedi: ${e?.message}` };
      }

      const SHEETS_API_KEY = payload.apiKey;
      const SPREADSHEET_ID = payload.spreadsheetId;
      const activeSheets = payload.activeSheets || [];

      if (!SHEETS_API_KEY || !SPREADSHEET_ID) {
        console.log('[SYNC_MISSING_CONFIG]', { hasApiKey: !!SHEETS_API_KEY, hasSpreadsheetId: !!SPREADSHEET_ID });
        return { success: false, error: "Google Sheets API Key veya Spreadsheet ID eksik." };
      }

      console.log('[SYNC_CONFIG_OK] spreadsheetId:', SPREADSHEET_ID, 'activeSheets:', activeSheets.length);

      // Fetch spreadsheet metadata
      const BASE_URL = `https://sheets.googleapis.com/v4/spreadsheets/${SPREADSHEET_ID}`;
      
      console.log('[SYNC_FETCHING_META]');
      const metaResp = await fetch(`${BASE_URL}?key=${SHEETS_API_KEY}&fields=sheets.properties`);
      if (!metaResp.ok) {
        const errorText = await metaResp.text();
        console.error('[SYNC_META_ERROR]', metaResp.status, errorText.slice(0, 300));
        return { success: false, error: `Google Sheets API hatası (${metaResp.status}): Metadata alınamadı.` };
      }

      const metaData = await metaResp.json();
      let tabs = metaData.sheets
        .filter((s: any) => !s.properties.hidden)
        .map((s: any) => s.properties.title);
        
      if (activeSheets.length > 0) {
        tabs = tabs.filter((t: string) => activeSheets.includes(t));
      }

      if (tabs.length === 0) {
        console.log('[SYNC_NO_TABS]');
        return { success: true, message: "Senkronize edilecek sekme bulunamadı.", newLeads: 0 };
      }

      console.log('[SYNC_TABS]', tabs);

      // Fetch all rows
      const rangeParams = tabs.map((t: string) => `ranges=${encodeURIComponent(t)}`).join('&');
      const batchUrl = `${BASE_URL}/values:batchGet?key=${SHEETS_API_KEY}&${rangeParams}&valueRenderOption=FORMATTED_VALUE`;
      
      console.log('[SYNC_FETCHING_ROWS]');
      const batchResp = await fetch(batchUrl);
      if (!batchResp.ok) {
        const errorText = await batchResp.text();
        console.error('[SYNC_BATCH_ERROR]', batchResp.status, errorText.slice(0, 300));
        return { success: false, error: `Satır verileri alınamadı (${batchResp.status}).` };
      }

      const batchData = await batchResp.json();
      let newLeadsCount = 0;
      let duplicatesSkipped = 0;
      let totalRows = 0;

      console.log('[SYNC_PROCESSING] valueRanges:', batchData.valueRanges?.length);
      
      for (let i = 0; i < batchData.valueRanges.length; i++) {
        const vr = batchData.valueRanges[i];
        const tabName = tabs[i];
        const values = vr.values || [];
        if (values.length <= 1) continue;

        totalRows += values.length - 1;
        const headers = values[0].map((h: string) => String(h).toLowerCase().trim());
        
        const phoneIdx = headers.findIndex((h: string) => h.includes('telefon') || h.includes('phone') || h === 'numara' || h.includes('cep'));
        const nameIdx = headers.findIndex((h: string) => !h.endsWith('id') && !h.endsWith('_id') && !h.includes(' id') && (h.includes('isim') || h.includes('soyad') || h === 'ad' || h === 'adı' || h === 'adınız' || h === 'name' || h === 'full name' || h === 'full_name'));
        const emailIdx = headers.findIndex((h: string) => h.includes('mail') || h.includes('e-posta'));
        const formNameIdx = headers.findIndex((h: string) => !h.endsWith('id') && !h.endsWith('_id') && !h.includes(' id') && (h.includes('form adı') || h.includes('form name') || h.includes('form_name') || h.includes('kampanya adı') || h.includes('campaign_name') || h.includes('campaign name') || h === 'kampanya' || h === 'campaign' || h === 'form'));

        if (phoneIdx === -1) {
          console.log(`[SYNC_SKIP_TAB] ${tabName}: No phone column. headers:`, headers.join(', '));
          continue;
        }

        console.log(`[SYNC_TAB] ${tabName}: ${values.length - 1} rows, phoneIdx=${phoneIdx}`);

        for (let r = 1; r < values.length; r++) {
          const row = values[r];
          let phone = row[phoneIdx];
          if (!phone) continue;
          
          phone = String(phone).replace(/[^0-9]/g, '');
          if (phone.length < 10) continue;
          phone = phone.substring(0, 20);

          const name = nameIdx !== -1 && row[nameIdx] ? String(row[nameIdx]).substring(0, 100) : null;
          const email = emailIdx !== -1 && row[emailIdx] ? String(row[emailIdx]).substring(0, 200) : null;
          const formName = formNameIdx !== -1 && row[formNameIdx] ? String(row[formNameIdx]).substring(0, 200) : tabName;

          const raw_data: any = {};
          headers.forEach((h: string, idx: number) => { raw_data[h] = row[idx] || ""; });

          const existing = await ctx.db.executeSafe({
            text: `SELECT id FROM leads WHERE phone_number LIKE '%' || RIGHT($1, 10) || '%' AND tenant_id = $2 LIMIT 1`,
            values: [phone, ctx.tenantId]
          });
          
          if (existing.length === 0) {
            await ctx.db.executeSafe({
              text: `INSERT INTO leads (tenant_id, phone_number, patient_name, email, form_name, raw_data, stage, created_at) VALUES ($1, $2, $3, $4, $5, $6, 'new', NOW())`,
              values: [ctx.tenantId, phone, name, email, formName, JSON.stringify(raw_data)]
            });
            newLeadsCount++;
          } else {
            duplicatesSkipped++;
          }
        }
      }

      // Update health status
      await ctx.db.executeSafe({
        text: `UPDATE tenant_integrations SET health_status = 'healthy', last_sync_at = NOW(), updated_at = NOW() WHERE tenant_id = $1 AND provider = 'google_sheets'`,
        values: [ctx.tenantId]
      });

      console.log('[SYNC_COMPLETED]', { totalRows, newLeadsCount, duplicatesSkipped });

      logAudit({
        tenantId: ctx.tenantId,
        userId: ctx.userId,
        userEmail: ctx.email,
        action: "google_sheets_sync_completed",
        entityType: "integration",
        entityId: "google_sheets",
        details: { totalRows, newLeadsCount, duplicatesSkipped }
      });

      return { 
        success: true, 
        message: `${newLeadsCount} yeni kayıt eklendi. ${duplicatesSkipped} tekrar eden atlandı. Toplam ${totalRows} satır.`,
        newLeads: newLeadsCount,
        duplicates: duplicatesSkipped,
        totalRows
      };
    }
  ).then(res => {
    console.log('[SYNC_ACTION_RETURN]', JSON.stringify(res).slice(0, 300));
    if (!res.success) return { success: false, error: res.error || res.data?.error };
    return { success: true, message: res.data?.message, newLeads: res.data?.newLeads };
  });
}
