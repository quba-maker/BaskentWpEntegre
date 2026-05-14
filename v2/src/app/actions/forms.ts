"use server";

import { sql } from "@/lib/db";
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
        rows = await ctx.db.executeSafe(sql`
          SELECT l.*, c.status as conversation_status
          FROM leads l
          LEFT JOIN conversations c ON c.phone_number = l.phone_number AND c.tenant_id = l.tenant_id
          WHERE l.tenant_id = ${ctx.tenantId}
            AND (l.patient_name ILIKE ${searchFilter} OR l.phone_number ILIKE ${searchFilter} OR l.email ILIKE ${searchFilter})
            AND l.form_name ILIKE ${sourceFilter}
          ORDER BY l.created_at DESC
          LIMIT ${limit} OFFSET ${offset}
        `);
      } else if (searchFilter) {
        rows = await ctx.db.executeSafe(sql`
          SELECT l.*, c.status as conversation_status
          FROM leads l
          LEFT JOIN conversations c ON c.phone_number = l.phone_number AND c.tenant_id = l.tenant_id
          WHERE l.tenant_id = ${ctx.tenantId}
            AND (l.patient_name ILIKE ${searchFilter} OR l.phone_number ILIKE ${searchFilter} OR l.email ILIKE ${searchFilter})
          ORDER BY l.created_at DESC
          LIMIT ${limit} OFFSET ${offset}
        `);
      } else if (sourceFilter) {
        rows = await ctx.db.executeSafe(sql`
          SELECT l.*, c.status as conversation_status
          FROM leads l
          LEFT JOIN conversations c ON c.phone_number = l.phone_number AND c.tenant_id = l.tenant_id
          WHERE l.tenant_id = ${ctx.tenantId}
            AND l.form_name ILIKE ${sourceFilter}
          ORDER BY l.created_at DESC
          LIMIT ${limit} OFFSET ${offset}
        `);
      } else {
        rows = await ctx.db.executeSafe(sql`
          SELECT l.*, c.status as conversation_status
          FROM leads l
          LEFT JOIN conversations c ON c.phone_number = l.phone_number AND c.tenant_id = l.tenant_id
          WHERE l.tenant_id = ${ctx.tenantId}
          ORDER BY l.created_at DESC
          LIMIT ${limit} OFFSET ${offset}
        `);
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
        isBotActive: r.conversation_status === 'bot'
      }));
    }
  ).then(res => res.data || []);
}

export async function updateLeadNotes(id: number, notes: string) {
  return withActionGuard(
    { actionName: 'updateLeadNotes' },
    async (ctx) => {
      const lead = await ctx.db.executeSafe(sql`
        SELECT phone_number FROM leads WHERE id = ${id} AND tenant_id = ${ctx.tenantId}
      `);
      if (lead.length === 0) throw new Error("Kayıt bulunamadı.");

      await ctx.db.executeSafe(sql`
        UPDATE leads 
        SET notes = ${notes} 
        WHERE id = ${id} AND tenant_id = ${ctx.tenantId}
      `);

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
          console.warn("Google Sheets note sync failed:", sheetErr);
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
      await ctx.db.executeSafe(sql`DELETE FROM leads WHERE tenant_id = ${ctx.tenantId}`);
      
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
      const campaigns = await ctx.db.executeSafe(sql`
        SELECT DISTINCT form_name 
        FROM leads 
        WHERE tenant_id = ${ctx.tenantId}
          AND form_name IS NOT NULL AND form_name != ''
        ORDER BY form_name ASC
      `);
      return campaigns.map((c: any) => c.form_name);
    }
  ).then(res => res.data || []);
}

export async function syncGoogleSheets() {
  return withActionGuard(
    { actionName: 'syncGoogleSheets', roles: ['owner', 'admin'] },
    async (ctx) => {
      const SHEETS_API_KEY = process.env.GOOGLE_SHEETS_API_KEY;
      const SPREADSHEET_ID = process.env.GOOGLE_SPREADSHEET_ID;
      
      if (!SHEETS_API_KEY || !SPREADSHEET_ID) {
        throw new Error("Google Sheets API key or Spreadsheet ID is missing in ENV.");
      }

      const BASE_URL = `https://sheets.googleapis.com/v4/spreadsheets/${SPREADSHEET_ID}`;

      const configRes = await ctx.db.executeSafe(sql`
        SELECT value FROM settings 
        WHERE key = 'google_sheets_config' AND tenant_id = ${ctx.tenantId} LIMIT 1
      `);
      
      let activeSheets: string[] = [];
      if (configRes.length > 0) {
        const config = JSON.parse(configRes[0].value);
        activeSheets = config.activeSheets || [];
      }

      const metaResp = await fetch(`${BASE_URL}?key=${SHEETS_API_KEY}&fields=sheets.properties`);
      const metaData = await metaResp.json();
      
      if (!metaData.sheets) {
        throw new Error("Failed to fetch sheets metadata.");
      }

      let tabs = metaData.sheets
        .filter((s: any) => !s.properties.hidden)
        .map((s: any) => s.properties.title);
        
      if (activeSheets.length > 0) {
        tabs = tabs.filter((t: string) => activeSheets.includes(t));
      }

      if (tabs.length === 0) {
        return { success: true, message: "Senkronize edilecek sekme bulunamadı." };
      }

      const rangeParams = tabs.map((t: string) => `ranges=${encodeURIComponent(t)}`).join('&');
      const batchUrl = `${BASE_URL}/values:batchGet?key=${SHEETS_API_KEY}&${rangeParams}&valueRenderOption=FORMATTED_VALUE`;
      
      const batchResp = await fetch(batchUrl);
      const batchData = await batchResp.json();

      let newLeadsCount = 0;

      for (let i = 0; i < batchData.valueRanges.length; i++) {
        const vr = batchData.valueRanges[i];
        const tabName = tabs[i];
        const values = vr.values || [];
        
        if (values.length <= 1) continue;

        const headers = values[0].map((h: string) => String(h).toLowerCase().trim());
        
        const phoneIdx = headers.findIndex((h: string) => h.includes('telefon') || h.includes('phone') || h === 'numara' || h.includes('cep'));
        const nameIdx = headers.findIndex((h: string) => !h.endsWith('id') && !h.endsWith('_id') && !h.includes(' id') && (h.includes('isim') || h.includes('soyad') || h === 'ad' || h === 'adı' || h === 'adınız' || h === 'name' || h === 'full name' || h === 'full_name'));
        const emailIdx = headers.findIndex((h: string) => h.includes('mail') || h.includes('e-posta'));
        const countryIdx = headers.findIndex((h: string) => h.includes('ülke') || h.includes('country'));
        const dateIdx = headers.findIndex((h: string) => h.includes('tarih') || h.includes('date') || h.includes('created') || h.includes('zaman') || h.includes('time'));
        const noteIdx = headers.findIndex((h: string) => h === 'not' || h === 'notlar' || h === 'notes' || h === 'note' || h.includes('geri dönüş') || h.includes('açıklama') || h.includes('feedback') || h === 'açıklamalar');
        const formNameIdx = headers.findIndex((h: string) => !h.endsWith('id') && !h.endsWith('_id') && !h.includes(' id') && (h.includes('form adı') || h.includes('form name') || h.includes('form_name') || h.includes('kampanya adı') || h.includes('campaign_name') || h.includes('campaign name') || h === 'kampanya' || h === 'campaign' || h === 'form'));

        if (phoneIdx === -1) continue;

        for (let r = 1; r < values.length; r++) {
          const row = values[r];
          let phone = row[phoneIdx];
          if (!phone) continue;
          
          phone = String(phone).replace(/[^0-9]/g, '');
          if (phone.length < 10) continue;
          phone = phone.substring(0, 20);

          let name = nameIdx !== -1 && row[nameIdx] ? String(row[nameIdx]).substring(0, 100) : null;
          let email = emailIdx !== -1 && row[emailIdx] ? String(row[emailIdx]).substring(0, 200) : null;
          let formName = formNameIdx !== -1 && row[formNameIdx] ? String(row[formNameIdx]).substring(0, 200) : tabName;
          let dateStr = dateIdx !== -1 && row[dateIdx] ? String(row[dateIdx]) : null;
          let noteStr = noteIdx !== -1 && row[noteIdx] ? String(row[noteIdx]).substring(0, 5000) : null;
          
          const raw_data: any = {};
          headers.forEach((h: string, idx: number) => {
            raw_data[h] = row[idx] || "";
          });

          // Idempotency: Mükerrer kayıt engeli (Sağdan 10 hane ile arama)
          const existing = await ctx.db.executeSafe(sql`
            SELECT id FROM leads 
            WHERE phone_number LIKE '%' || RIGHT(${phone}, 10) || '%' 
              AND tenant_id = ${ctx.tenantId} LIMIT 1
          `);
          
          if (existing.length === 0) {
            let createdAt = new Date();
            if (dateStr) {
              const parts = dateStr.match(/(\d+)/g);
              if (parts && parts.length >= 3) {
                const p0 = parseInt(parts[0]);
                const p1 = parseInt(parts[1]) - 1;
                const p2 = parseInt(parts[2]);
                let y = p2, m = p1, d = p0;
                if (p0 > 31) { y = p0; d = p2; }
                const hr = parts.length > 3 ? parseInt(parts[3]) : 0;
                const min = parts.length > 4 ? parseInt(parts[4]) : 0;
                const sec = parts.length > 5 ? parseInt(parts[5]) : 0;
                const parsedDate = new Date(y, m, d, hr, min, sec);
                if (!isNaN(parsedDate.getTime())) createdAt = parsedDate;
              } else {
                const standardParsed = new Date(dateStr);
                if (!isNaN(standardParsed.getTime())) createdAt = standardParsed;
              }
            }

            await ctx.db.executeSafe(sql`
              INSERT INTO leads (tenant_id, phone_number, patient_name, email, form_name, raw_data, stage, created_at, notes)
              VALUES (${ctx.tenantId}, ${phone}, ${name}, ${email}, ${formName}, ${JSON.stringify(raw_data)}, 'new', ${createdAt.toISOString()}, ${noteStr})
            `);
            newLeadsCount++;
          }
        }
      }

      return { success: true, message: `${newLeadsCount} yeni kayıt eklendi.` };
    }
  ).then(res => {
    if (!res.success) return { success: false, error: res.error };
    return { success: true, message: res.data?.message };
  });
}
