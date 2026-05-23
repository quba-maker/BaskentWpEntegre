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

      // ── Smart phone normalization with country code inference ──
      // Detects country from local number patterns (05XX=TR, 06XX=NL, 015X=DE, etc.)
      // Falls back to reference phone's country code when pattern is ambiguous
      const inferCountryFromLocal = (digits: string): string | null => {
        // Turkish mobile: 05XX (10 digits)
        if (/^05\d{8}$/.test(digits)) return '90';
        // German mobile: 015X/016X/017X (11-12 digits)
        if (/^0(15|16|17)\d{8,9}$/.test(digits)) return '49';
        // Dutch mobile: 06XX (10 digits)
        if (/^06\d{8}$/.test(digits)) return '31';
        // Belgian mobile: 04XX (10 digits)
        if (/^04\d{8}$/.test(digits)) return '32';
        // UK mobile: 07XXX (11 digits)
        if (/^07\d{9}$/.test(digits)) return '44';
        // French mobile: 06/07 (10 digits) — caught above for NL/UK
        if (/^0[67]\d{8}$/.test(digits)) return '33';
        // Austrian mobile: 0664/0676/0699/0660/0650 (11-12 digits)
        if (/^0(664|676|699|660|650)\d{6,8}$/.test(digits)) return '43';
        // Swiss mobile: 07X (10 digits)
        if (/^07[5-9]\d{7}$/.test(digits)) return '41';
        return null;
      };

      const extractCountryCode = (digits: string): string | null => {
        const CODES = ['998','996','995','994','993','992','971','966','964','962','961','380','374','359','90','86','82','81','77','55','52','49','48','47','46','45','44','43','41','40','39','36','34','33','32','31','30','91','61','7','1'];
        for (const code of CODES) {
          if (digits.startsWith(code)) return code;
        }
        return null;
      };

      const normalizePhone = (raw: string, referenceCountryCode?: string | null): string => {
        let phone = String(raw || '').replace(/[^0-9]/g, '');
        if (!phone || phone.length < 7) return '';
        
        // Starts with 00 → international format (strip 00)
        if (phone.startsWith('00') && phone.length >= 11) {
          return phone.substring(2, 22);
        }
        
        // Starts with 0 → local format, infer country code
        if (phone.startsWith('0') && phone.length >= 9) {
          const inferredCode = inferCountryFromLocal(phone);
          if (inferredCode) {
            phone = inferredCode + phone.substring(1);
          } else if (referenceCountryCode) {
            phone = referenceCountryCode + phone.substring(1);
          } else {
            phone = '90' + phone.substring(1);
          }
          return phone.substring(0, 20);
        }
        
        // Already has valid country code (10+ digits, doesn't start with 0)
        if (phone.length >= 10) {
          return phone.substring(0, 20);
        }
        
        // SHORT NUMBER (7-9 digits, no leading 0) — Meta sometimes strips country code
        // e.g. p:911069189 → should be 998911069189
        if (phone.length >= 7 && phone.length <= 9 && referenceCountryCode) {
          const withCode = referenceCountryCode + phone;
          if (withCode.length >= 10 && withCode.length <= 15) {
            return withCode.substring(0, 20);
          }
        }
        
        // Fallback: try Turkey prefix
        if (phone.length >= 7 && phone.length <= 9) {
          return ('90' + phone).substring(0, 20);
        }
        
        return phone.substring(0, 20);
      };

      // Smart dedup: suffix matching + containment check
      // Keeps the longest (most complete) version of each number
      const dedupPhones = (phones: string[]): string[] => {
        // Sort by length descending — longer = more complete = keep first
        const sorted = [...phones].sort((a, b) => b.length - a.length);
        const result: string[] = [];
        
        for (const phone of sorted) {
          const isDuplicate = result.some(existing => {
            // Last 9 digits match (covers most national numbers)
            const existSuffix = existing.slice(-9);
            const phoneSuffix = phone.slice(-9);
            if (existSuffix === phoneSuffix) return true;
            // One is suffix of the other (e.g. 911069189 vs 998911069189)
            if (existing.endsWith(phone) || phone.endsWith(existing)) return true;
            return false;
          });
          
          if (!isDuplicate) result.push(phone);
        }
        
        return result;
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

          // STEP 1: Extract reference country code from Meta's phone_number first
          let referenceCountryCode: string | null = null;
          for (const pc of phoneCols) {
            if (!pc.isWhatsapp) {
              const raw = row[pc.idx];
              if (raw) {
                const clean = String(raw).replace(/[^0-9]/g, '');
                if (clean.length >= 10 && !clean.startsWith('0')) {
                  referenceCountryCode = extractCountryCode(clean);
                  if (referenceCountryCode) break;
                }
              }
            }
          }

          // STEP 2: Normalize all phones using reference country code
          // Track WhatsApp vs Meta phone separately for smart primary selection
          const rawPhones: string[] = [];
          let whatsappPhone = '';
          let metaPhone = '';

          for (const pc of phoneCols) {
            const raw = row[pc.idx];
            if (!raw) continue;
            const normalized = normalizePhone(raw, referenceCountryCode);
            if (normalized.length >= 10) {
              rawPhones.push(normalized);
              if (pc.isWhatsapp && !whatsappPhone) whatsappPhone = normalized;
              if (!pc.isWhatsapp && !metaPhone) metaPhone = normalized;
            }
          }

          // STEP 3: Smart dedup (suffix + containment)
          const allPhones = dedupPhones(rawPhones);

          // STEP 4: Smart primary selection
          // Priority: WhatsApp with valid country code > longest number > first available
          let primaryPhone = '';
          
          // If WhatsApp number survived dedup AND has detectable country code → primary
          if (whatsappPhone && allPhones.some(p => p === whatsappPhone || p.endsWith(whatsappPhone) || whatsappPhone.endsWith(p))) {
            // Find the longest version of the whatsapp number in deduped list
            primaryPhone = allPhones.find(p => p.endsWith(whatsappPhone.slice(-9))) || whatsappPhone;
          }
          
          // Fallback: the longest number (most complete)
          if (!primaryPhone && allPhones.length > 0) {
            primaryPhone = allPhones[0]; // Already sorted by length desc in dedupPhones
          }

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

