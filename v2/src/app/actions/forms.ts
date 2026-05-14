"use server";

import { sql } from "@/lib/db";
import { getSession } from "@/lib/auth/session";

export async function getForms(page: number = 1, search: string = "", source: string = "all") {
  try {
    const session = await getSession();
    if (!session?.tenantId) return [];
    const tenantId = session.tenantId;

    const limit = 50;
    const offset = (page - 1) * limit;
    const searchFilter = search.trim() ? `%${search.trim()}%` : null;
    const sourceFilter = source !== "all" ? `%${source}%` : null;

    let rows;
    
    if (searchFilter && sourceFilter) {
      rows = await sql`
        SELECT l.*, c.status as conversation_status
        FROM leads l
        LEFT JOIN conversations c ON c.phone_number = l.phone_number AND c.tenant_id = l.tenant_id
        WHERE l.tenant_id = ${tenantId}
          AND (l.patient_name ILIKE ${searchFilter} OR l.phone_number ILIKE ${searchFilter} OR l.email ILIKE ${searchFilter})
          AND l.form_name ILIKE ${sourceFilter}
        ORDER BY l.created_at DESC
        LIMIT ${limit} OFFSET ${offset}
      `;
    } else if (searchFilter) {
      rows = await sql`
        SELECT l.*, c.status as conversation_status
        FROM leads l
        LEFT JOIN conversations c ON c.phone_number = l.phone_number AND c.tenant_id = l.tenant_id
        WHERE l.tenant_id = ${tenantId}
          AND (l.patient_name ILIKE ${searchFilter} OR l.phone_number ILIKE ${searchFilter} OR l.email ILIKE ${searchFilter})
        ORDER BY l.created_at DESC
        LIMIT ${limit} OFFSET ${offset}
      `;
    } else if (sourceFilter) {
      rows = await sql`
        SELECT l.*, c.status as conversation_status
        FROM leads l
        LEFT JOIN conversations c ON c.phone_number = l.phone_number AND c.tenant_id = l.tenant_id
        WHERE l.tenant_id = ${tenantId}
          AND l.form_name ILIKE ${sourceFilter}
        ORDER BY l.created_at DESC
        LIMIT ${limit} OFFSET ${offset}
      `;
    } else {
      rows = await sql`
        SELECT l.*, c.status as conversation_status
        FROM leads l
        LEFT JOIN conversations c ON c.phone_number = l.phone_number AND c.tenant_id = l.tenant_id
        WHERE l.tenant_id = ${tenantId}
        ORDER BY l.created_at DESC
        LIMIT ${limit} OFFSET ${offset}
      `;
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
  } catch (error) {
    console.error("getForms Error:", error);
    return [];
  }
}

export async function updateLeadNotes(id: number, notes: string) {
  try {
    // 1. Update DB
    const lead = await sql`SELECT phone_number FROM leads WHERE id = ${id}`;
    await sql`
      UPDATE leads 
      SET notes = ${notes} 
      WHERE id = ${id}
    `;

    // 2. Push to Google Sheets (fire-and-forget)
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
        console.warn("Google Sheets note sync failed (non-critical):", sheetErr);
      }
    }

    return { success: true };
  } catch (error: any) {
    console.error("updateLeadNotes Error:", error);
    return { success: false, error: error.message };
  }
}

export async function deleteAllLeads() {
  try {
    await sql`TRUNCATE TABLE leads RESTART IDENTITY CASCADE`;
    return { success: true, message: "Tüm form ve hasta kayıtları başarıyla silindi." };
  } catch (error: any) {
    console.error("deleteAllLeads Error:", error);
    return { success: false, error: error.message };
  }
}

export async function getCampaignNames() {
  try {
    const campaigns = await sql`
      SELECT DISTINCT form_name 
      FROM leads 
      WHERE form_name IS NOT NULL AND form_name != ''
      ORDER BY form_name ASC
    `;
    return campaigns.map((c: any) => c.form_name);
  } catch (error) {
    console.error("getCampaignNames Error:", error);
    return [];
  }
}

export async function syncGoogleSheets() {
  try {
    const SHEETS_API_KEY = process.env.GOOGLE_SHEETS_API_KEY;
    const SPREADSHEET_ID = process.env.GOOGLE_SPREADSHEET_ID;
    
    if (!SHEETS_API_KEY || !SPREADSHEET_ID) {
      return { success: false, error: "Google Sheets API key or Spreadsheet ID is missing in ENV." };
    }

    const BASE_URL = `https://sheets.googleapis.com/v4/spreadsheets/${SPREADSHEET_ID}`;

    // Get config to filter active sheets
    const configRes = await sql`SELECT value FROM settings WHERE key = 'google_sheets_config' LIMIT 1`;
    let activeSheets: string[] = [];
    if (configRes.length > 0) {
      const config = JSON.parse(configRes[0].value);
      activeSheets = config.activeSheets || [];
    }

    // 1. Get all tabs
    const metaResp = await fetch(`${BASE_URL}?key=${SHEETS_API_KEY}&fields=sheets.properties`);
    const metaData = await metaResp.json();
    
    if (!metaData.sheets) {
      return { success: false, error: "Failed to fetch sheets metadata." };
    }

    let tabs = metaData.sheets
      .filter((s: any) => !s.properties.hidden)
      .map((s: any) => s.properties.title);
      
    // Filter tabs if activeSheets is configured
    if (activeSheets.length > 0) {
      tabs = tabs.filter((t: string) => activeSheets.includes(t));
    }

    if (tabs.length === 0) {
      return { success: true, message: "Senkronize edilecek görünür veya seçili sekme bulunamadı." };
    }

    // 2. Batch get all data
    const rangeParams = tabs.map((t: string) => `ranges=${encodeURIComponent(t)}`).join('&');
    const batchUrl = `${BASE_URL}/values:batchGet?key=${SHEETS_API_KEY}&${rangeParams}&valueRenderOption=FORMATTED_VALUE`;
    
    const batchResp = await fetch(batchUrl);
    const batchData = await batchResp.json();

    let newLeadsCount = 0;

    // 3. Parse and Insert into Neon
    for (let i = 0; i < batchData.valueRanges.length; i++) {
      const vr = batchData.valueRanges[i];
      const tabName = tabs[i];
      const values = vr.values || [];
      
      if (values.length <= 1) continue; // No data, just headers or empty

      const headers = values[0].map((h: string) => String(h).toLowerCase().trim());
      
      // Find critical columns with smarter exact or safe partial matching
      const phoneIdx = headers.findIndex((h: string) => h.includes('telefon') || h.includes('phone') || h === 'numara' || h.includes('cep'));
      
      const nameIdx = headers.findIndex((h: string) => 
        !h.endsWith('id') && !h.endsWith('_id') && !h.includes(' id') &&
        (h.includes('isim') || h.includes('soyad') || h === 'ad' || h === 'adı' || h === 'adınız' || h === 'name' || h === 'full name' || h === 'full_name')
      );
      
      const emailIdx = headers.findIndex((h: string) => h.includes('mail') || h.includes('e-posta'));
      const countryIdx = headers.findIndex((h: string) => h.includes('ülke') || h.includes('country'));
      
      const dateIdx = headers.findIndex((h: string) => 
        h.includes('tarih') || h.includes('date') || h.includes('created') || h.includes('zaman') || h.includes('time')
      );
      
      const noteIdx = headers.findIndex((h: string) => 
        h === 'not' || h === 'notlar' || h === 'notes' || h === 'note' || h.includes('geri dönüş') || h.includes('açıklama') || h.includes('feedback') || h === 'açıklamalar'
      );

      const formNameIdx = headers.findIndex((h: string) => 
        !h.endsWith('id') && !h.endsWith('_id') && !h.includes(' id') &&
        (h.includes('form adı') || h.includes('form name') || h.includes('form_name') || 
         h.includes('kampanya adı') || h.includes('campaign_name') || h.includes('campaign name') || 
         h === 'kampanya' || h === 'campaign' || h === 'form')
      );

      if (phoneIdx === -1) continue; // Phone is required to insert into leads table safely

      // Process rows
      for (let r = 1; r < values.length; r++) {
        const row = values[r];
        let phone = row[phoneIdx];
        if (!phone) continue;
        
        // Clean phone and truncate
        phone = String(phone).replace(/[^0-9]/g, '');
        if (phone.length < 10) continue;
        phone = phone.substring(0, 20);

        let name = nameIdx !== -1 && row[nameIdx] ? String(row[nameIdx]).substring(0, 100) : null;
        let email = emailIdx !== -1 && row[emailIdx] ? String(row[emailIdx]).substring(0, 200) : null;
        const country = countryIdx !== -1 && row[countryIdx] ? String(row[countryIdx]) : null;
        let formName = formNameIdx !== -1 && row[formNameIdx] ? String(row[formNameIdx]).substring(0, 200) : tabName; // fallback to tabName
        let dateStr = dateIdx !== -1 && row[dateIdx] ? String(row[dateIdx]) : null;
        let noteStr = noteIdx !== -1 && row[noteIdx] ? String(row[noteIdx]).substring(0, 5000) : null;
        
        // Build raw_data JSON
        const raw_data: any = {};
        headers.forEach((h: string, idx: number) => {
          raw_data[h] = row[idx] || "";
        });

        // Upsert into leads table safely using phone_number
        const existing = await sql`SELECT id FROM leads WHERE phone_number LIKE '%' || RIGHT(${phone}, 10) || '%' LIMIT 1`;
        
        if (existing.length === 0) {
          let createdAt = new Date();
          if (dateStr) {
            // Attempt to parse DD.MM.YYYY HH:mm:ss or similar
            const parts = dateStr.match(/(\d+)/g);
            if (parts && parts.length >= 3) {
              const p0 = parseInt(parts[0]);
              const p1 = parseInt(parts[1]) - 1; // month is 0-indexed
              const p2 = parseInt(parts[2]);
              
              let y = p2, m = p1, d = p0;
              if (p0 > 31) { y = p0; d = p2; } // YYYY-MM-DD
              
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

          await sql`
            INSERT INTO leads (phone_number, patient_name, email, form_name, raw_data, stage, created_at, notes)
            VALUES (${phone}, ${name}, ${email}, ${formName}, ${JSON.stringify(raw_data)}, 'new', ${createdAt.toISOString()}, ${noteStr})
          `;
          newLeadsCount++;
        }
      }
    }

    return { success: true, message: `${newLeadsCount} yeni kayıt eklendi.` };
  } catch (error: any) {
    console.error("syncGoogleSheets Error:", error);
    return { success: false, error: error.message };
  }
}
