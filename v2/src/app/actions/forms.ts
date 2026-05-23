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

      // ── 1. Load Google Sheets credentials ──
      const integrations = await ctx.db.executeSafe({
        text: `SELECT credentials FROM tenant_integrations WHERE tenant_id = $1 AND provider = 'google_sheets' LIMIT 1`,
        values: [ctx.tenantId]
      });

      if (integrations.length === 0) {
        return { success: false, error: "Google Sheets entegrasyonu bulunamadı. Lütfen Ayarlar → Entegrasyonlar'dan kurulum yapın." };
      }

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
      const configActiveSheets: string[] = payload.activeSheets || [];

      if (!SHEETS_API_KEY || !SPREADSHEET_ID) {
        return { success: false, error: "Google Sheets API Key veya Spreadsheet ID eksik." };
      }

      console.log('[SYNC_CONFIG_OK] spreadsheetId:', SPREADSHEET_ID);

      // ── 2. Load pipeline routing config ──
      let outboundChannelId: string | null = null;
      let greetingGroupId: string | null = null;
      let tenantName: string | null = null;

      try {
        const pipeRes = await ctx.db.executeSafe({
          text: `SELECT greeting_group_id, outbound_channel_id FROM ingestion_pipelines WHERE tenant_id = $1 AND provider = 'google_sheets' LIMIT 1`,
          values: [ctx.tenantId]
        });
        if (pipeRes.length > 0) {
          greetingGroupId = pipeRes[0].greeting_group_id || null;
          outboundChannelId = pipeRes[0].outbound_channel_id || null;
        }
      } catch (_) {}

      try {
        const { withTenantDB } = await import('@/lib/core/tenant-db');
        const sysDb = withTenantDB('admin-system', true);
        const tenantRes = await sysDb.executeSafe({
          text: `SELECT name FROM tenants WHERE id = $1 LIMIT 1`,
          values: [ctx.tenantId]
        });
        if (tenantRes.length > 0) tenantName = tenantRes[0].name;
      } catch (_) {}

      // ── 3. Fetch spreadsheet metadata ──
      const BASE_URL = `https://sheets.googleapis.com/v4/spreadsheets/${SPREADSHEET_ID}`;
      
      const metaResp = await fetch(`${BASE_URL}?key=${SHEETS_API_KEY}&fields=sheets.properties`);
      if (!metaResp.ok) {
        const errorText = await metaResp.text();
        console.error('[SYNC_META_ERROR]', metaResp.status, errorText.slice(0, 300));
        return { success: false, error: `Google Sheets API hatası (${metaResp.status}): Metadata alınamadı.` };
      }

      const metaData = await metaResp.json();
      const allTabs = metaData.sheets
        .filter((s: any) => !s.properties.hidden)
        .map((s: any) => s.properties.title);

      console.log('[SYNC_SHEET_TABS]', JSON.stringify(allTabs));
      console.log('[SYNC_ACTIVE_SHEETS_CONFIG]', JSON.stringify(configActiveSheets));

      // ── 4. Tab selection (strict mode) ──
      let tabs: string[];
      if (configActiveSheets.length > 0) {
        tabs = allTabs.filter((t: string) => configActiveSheets.includes(t));
        if (tabs.length === 0) {
          console.log('[SYNC_TAB_MISMATCH]', { config: configActiveSheets, real: allTabs });
          // Fallback: sync ALL visible tabs when config doesn't match
          // This prevents blocking sync due to stale tab names
          tabs = allTabs;
          console.log('[SYNC_FALLBACK] Config tabs dont match. Syncing all visible tabs.');
        }
      } else {
        tabs = allTabs;
      }

      if (tabs.length === 0) {
        return { success: true, message: "Spreadsheet'te görünür sekme bulunamadı.", stats: { totalRows: 0, created: 0, duplicates: 0 } };
      }

      console.log('[SYNC_TABS]', tabs);

      // ── 5. Fetch all rows (batch) ──
      const rangeParams = tabs.map((t: string) => `ranges=${encodeURIComponent(t)}`).join('&');
      const batchUrl = `${BASE_URL}/values:batchGet?key=${SHEETS_API_KEY}&${rangeParams}&valueRenderOption=FORMATTED_VALUE`;
      
      const batchResp = await fetch(batchUrl);
      if (!batchResp.ok) {
        const errorText = await batchResp.text();
        console.error('[SYNC_BATCH_ERROR]', batchResp.status, errorText.slice(0, 300));
        return { success: false, error: `Satır verileri alınamadı (${batchResp.status}).` };
      }

      const batchData = await batchResp.json();
      
      // ── 6. BATCH PROCESSING (fast — no per-row DB queries) ──
      
      // 6a. Field detection patterns — ORDER MATTERS (exact first)
      const WHATSAPP_PATTERNS = ['whatsapp_number', 'whatsapp numarası', 'whatsapp', 'wp numarası', 'wp'];
      const PHONE_PATTERNS = ['phone_number', 'telefon', 'phone', 'numara', 'cep', 'cep telefonu', 'mobile', 'gsm', 'iletişim'];
      const NAME_EXACT = ['full_name', 'full name', 'ad_soyad', 'ad soyad', 'hasta adı', 'patient_name'];
      const NAME_FALLBACK = ['isim', 'adı', 'adınız', 'first_name'];
      const EMAIL_PATTERNS = ['email', 'e-posta', 'mail', 'e_posta'];
      const DATE_PATTERNS = ['created_time', 'timestamp', 'tarih', 'date', 'created_at'];
      const NOTE_PATTERNS = ['geri dönüş', 'geri_dönüş', 'notlar', 'notes', 'not', 'açıklama', 'feedback'];
      const CAMPAIGN_PATTERNS = ['campaign_name', 'kampanya adı', 'kampanya'];

      // Safe column finder — excludes ad_id, ad_name etc for name detection
      const findCol = (headers: string[], patterns: string[], excludePrefixes: string[] = []) => {
        for (const p of patterns) {
          const idx = headers.findIndex((h: string) => {
            if (excludePrefixes.some(ex => h.startsWith(ex))) return false;
            if (h.endsWith('_id') || h.endsWith(' id')) return false;
            return h === p;
          });
          if (idx !== -1) return idx;
        }
        // Fallback: includes match
        for (const p of patterns) {
          const idx = headers.findIndex((h: string) => {
            if (excludePrefixes.some(ex => h.startsWith(ex))) return false;
            if (h.endsWith('_id') || h.endsWith(' id')) return false;
            return h.includes(p);
          });
          if (idx !== -1) return idx;
        }
        return -1;
      };

      // Find ALL phone columns (for multi-phone support)
      const findAllPhoneCols = (headers: string[]) => {
        const allPatterns = [...WHATSAPP_PATTERNS, ...PHONE_PATTERNS];
        const found: { idx: number; isWhatsapp: boolean }[] = [];
        const usedIdx = new Set<number>();

        // WhatsApp columns first (primary)
        for (const p of WHATSAPP_PATTERNS) {
          headers.forEach((h, idx) => {
            if (!usedIdx.has(idx) && (h === p || h.includes(p)) && !h.endsWith('_id')) {
              found.push({ idx, isWhatsapp: true });
              usedIdx.add(idx);
            }
          });
        }
        // Then phone columns
        for (const p of PHONE_PATTERNS) {
          headers.forEach((h, idx) => {
            if (!usedIdx.has(idx) && (h === p || h.includes(p)) && !h.endsWith('_id')) {
              found.push({ idx, isWhatsapp: false });
              usedIdx.add(idx);
            }
          });
        }
        return found;
      };

      const normalizePhone = (raw: string): string => {
        let phone = String(raw || '').replace(/[^0-9]/g, '');
        if (phone.startsWith('0')) phone = '90' + phone.substring(1);
        return phone.substring(0, 20);
      };

      interface ParsedRow {
        phone: string;
        allPhones: string[];
        name: string | null;
        email: string | null;
        formName: string;
        notes: string | null;
        createdTime: string | null;
        rawData: string;
        tabName: string;
      }

      const allRows: ParsedRow[] = [];

      for (let i = 0; i < batchData.valueRanges.length; i++) {
        const vr = batchData.valueRanges[i];
        const tabName = tabs[i];
        const values = vr.values || [];
        if (values.length <= 1) continue;

        const headers = values[0].map((h: string) => String(h).toLowerCase().trim());

        // Phone detection (all columns)
        const phoneCols = findAllPhoneCols(headers);
        if (phoneCols.length === 0) {
          console.log(`[SYNC_SKIP_TAB] ${tabName}: No phone column`);
          continue;
        }

        // Name: exact match first (full_name), then fallback — EXCLUDE ad_name, adset_name
        let nameIdx = findCol(headers, NAME_EXACT, ['ad_', 'adset_']);
        if (nameIdx === -1) nameIdx = findCol(headers, NAME_FALLBACK, ['ad_', 'adset_']);

        const emailIdx = findCol(headers, EMAIL_PATTERNS);
        const dateIdx = findCol(headers, DATE_PATTERNS);
        const noteIdx = findCol(headers, NOTE_PATTERNS);
        const campaignIdx = findCol(headers, CAMPAIGN_PATTERNS, ['campaign_id']);

        console.log(`[SYNC_TAB] ${tabName}: ${values.length - 1} rows | name=${nameIdx >= 0 ? headers[nameIdx] : 'NONE'} phoneCols=${phoneCols.length}`);

        for (let r = 1; r < values.length; r++) {
          const row = values[r];

          // Extract ALL phone numbers from all phone columns
          const allPhones: string[] = [];
          let primaryPhone = '';

          for (const pc of phoneCols) {
            const raw = row[pc.idx];
            if (!raw) continue;
            const normalized = normalizePhone(raw);
            if (normalized.length >= 10 && !allPhones.includes(normalized)) {
              allPhones.push(normalized);
              if (!primaryPhone || pc.isWhatsapp) primaryPhone = normalized;
            }
          }

          if (!primaryPhone && allPhones.length > 0) primaryPhone = allPhones[0];
          if (!primaryPhone) continue;

          const name = nameIdx !== -1 && row[nameIdx] ? String(row[nameIdx]).substring(0, 100) : null;
          const email = emailIdx !== -1 && row[emailIdx] ? String(row[emailIdx]).substring(0, 200) : null;
          const createdTime = dateIdx !== -1 && row[dateIdx] ? String(row[dateIdx]) : null;
          const noteVal = noteIdx !== -1 && row[noteIdx] ? String(row[noteIdx]).substring(0, 5000) : null;
          const campaignName = campaignIdx !== -1 && row[campaignIdx] ? String(row[campaignIdx]).substring(0, 200) : tabName;

          // Build raw_data preserving original header names
          const rawData: Record<string, string> = {};
          const origHeaders = values[0];
          origHeaders.forEach((h: string, idx: number) => { rawData[String(h).trim()] = row[idx] || ''; });
          rawData['_sheet_name'] = tabName;
          rawData['_source'] = 'manual_sync';
          rawData['_all_phones'] = JSON.stringify(allPhones);

          allRows.push({
            phone: primaryPhone,
            allPhones,
            name,
            email,
            formName: campaignName,
            notes: noteVal,
            createdTime,
            rawData: JSON.stringify(rawData),
            tabName
          });
        }
      }

      const totalRows = allRows.length;
      console.log(`[SYNC_TOTAL_PARSED] ${totalRows} valid rows from ${tabs.length} tabs`);

      if (totalRows === 0) {
        return { success: true, message: "Geçerli telefon numarası olan satır bulunamadı.", stats: { totalRows: 0, created: 0, duplicates: 0 } };
      }

      // 6b. Batch duplicate check — single query
      const existingPhones = await ctx.db.executeSafe({
        text: `SELECT DISTINCT RIGHT(phone_number, 10) as phone_suffix FROM leads WHERE tenant_id = $1`,
        values: [ctx.tenantId]
      }) as any[];

      const existingSet = new Set(existingPhones.map((r: any) => r.phone_suffix));
      console.log(`[SYNC_EXISTING] ${existingSet.size} existing phone suffixes in DB`);

      // 6c. Filter new rows (in-memory dedup)
      const seenPhones = new Set<string>();
      const newRows: ParsedRow[] = [];

      for (const row of allRows) {
        const suffix = row.phone.slice(-10);
        if (existingSet.has(suffix) || seenPhones.has(suffix)) {
          continue; // duplicate
        }
        seenPhones.add(suffix);
        newRows.push(row);
      }

      const duplicates = totalRows - newRows.length;
      console.log(`[SYNC_DEDUP] ${newRows.length} new, ${duplicates} duplicates`);

      // 6d. Batch INSERT in chunks of 50
      let created = 0;
      const CHUNK_SIZE = 50;

      const parseCreatedTime = (raw: string | null): string => {
        if (!raw) return new Date().toISOString();
        try {
          const d = new Date(raw);
          if (!isNaN(d.getTime())) return d.toISOString();
        } catch (_) {}
        return new Date().toISOString();
      };
      
      for (let c = 0; c < newRows.length; c += CHUNK_SIZE) {
        const chunk = newRows.slice(c, c + CHUNK_SIZE);
        
        // Build multi-row INSERT
        const valueParts: string[] = [];
        const params: any[] = [];
        let paramIdx = 1;

        for (const row of chunk) {
          valueParts.push(`($${paramIdx}, $${paramIdx+1}, $${paramIdx+2}, $${paramIdx+3}, $${paramIdx+4}, $${paramIdx+5}, 'new', $${paramIdx+6}, $${paramIdx+7})`);
          params.push(
            ctx.tenantId, row.phone, row.name, row.email, row.formName, row.rawData,
            parseCreatedTime(row.createdTime),
            row.notes || null
          );
          paramIdx += 8;
        }

        try {
          await ctx.db.executeSafe({
            text: `INSERT INTO leads (tenant_id, phone_number, patient_name, email, form_name, raw_data, stage, created_at, notes)
                   VALUES ${valueParts.join(', ')}
                   ON CONFLICT DO NOTHING`,
            values: params
          });
          created += chunk.length;
        } catch (insertErr: any) {
          console.error('[SYNC_INSERT_ERROR]', insertErr?.message?.slice(0, 200));
        }
      }

      // ── 7. Update health status ──
      await ctx.db.executeSafe({
        text: `UPDATE tenant_integrations SET health_status = 'healthy', last_sync_at = NOW(), updated_at = NOW() WHERE tenant_id = $1 AND provider = 'google_sheets'`,
        values: [ctx.tenantId]
      });

      const stats = { totalRows, created, duplicates, errors: 0 };
      console.log('[SYNC_COMPLETED]', stats);

      logAudit({
        tenantId: ctx.tenantId,
        userId: ctx.userId,
        userEmail: ctx.email,
        action: 'google_sheets_sync_completed',
        entityType: 'integration',
        entityId: 'google_sheets',
        details: stats
      });

      return { 
        success: true, 
        message: `${created} yeni kayıt eklendi. ${duplicates} tekrar eden atlandı. Toplam ${totalRows} satır.`,
        stats
      };
    }
  ).then(res => {
    console.log('[SYNC_ACTION_RETURN]', JSON.stringify(res).slice(0, 300));
    if (!res.success) return { success: false, error: res.error || res.data?.error };
    return { success: true, message: res.data?.message, stats: res.data?.stats };
  });
}

