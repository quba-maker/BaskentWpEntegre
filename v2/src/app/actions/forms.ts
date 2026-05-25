"use server";

// sql import removed — all queries use parameterized {text, values} format for proper RLS enforcement
import { withActionGuard } from "@/lib/core/action-guard";
import { logAudit } from "@/lib/audit";

// ==========================================
// QUBA AI — Forms & Leads Actions (Zero-Trust)
// ==========================================

export async function getForms(page: number = 1, search: string = "", source: string = "all", stageFilter: string = "all") {
  return withActionGuard(
    { actionName: 'getForms' },
    async (ctx) => {
      const limit = 50;
      const offset = (page - 1) * limit;
      const searchFilter = search.trim() ? `%${search.trim()}%` : null;
      const sourceFilter = source !== "all" ? `%${source}%` : null;
      const stageParam = stageFilter !== "all" ? stageFilter : null;

      // Dynamic WHERE builder
      const conditions: string[] = [`l.tenant_id = $1`];
      const params: any[] = [ctx.tenantId];
      let paramIdx = 2;

      if (searchFilter) {
        conditions.push(`(l.patient_name ILIKE $${paramIdx} OR l.phone_number ILIKE $${paramIdx} OR l.email ILIKE $${paramIdx})`);
        params.push(searchFilter);
        paramIdx++;
      }
      if (sourceFilter) {
        conditions.push(`l.form_name ILIKE $${paramIdx}`);
        params.push(sourceFilter);
        paramIdx++;
      }
      if (stageParam) {
        conditions.push(`l.stage = $${paramIdx}`);
        params.push(stageParam);
        paramIdx++;
      }

      params.push(limit, offset);
      const limitIdx = paramIdx;
      const offsetIdx = paramIdx + 1;

      // Safe AI summary + CRM linking strategy:
      // Layer 1: customer_id link (identity match)
      // Layer 2: phone match ONLY if exactly ONE conversation exists (no ambiguity)
      // Layer 3: no match → null summary (safe empty state)
      // Layer 4: LATERAL opportunity (most recent, no row duplication)
      const rows = await ctx.db.executeSafe({
        text: `SELECT l.*, 
               COALESCE(c_identity.status, c_phone.status) as conversation_status, 
               COALESCE(c_identity.lead_stage, c_phone.lead_stage) as conv_lead_stage, 
               COALESCE(mem_identity.summary_text, mem_phone.summary_text) as ai_summary,
               COALESCE(c_identity.id, c_phone.id) as linked_conv_id,
               COALESCE(c_identity.country, c_phone.conv_country) as conv_country,
               COALESCE(c_identity.department, c_phone.conv_department) as conv_department,
               opp.opp_id,
               opp.opp_country,
               opp.opp_department,
               opp.opp_stage,
               opp.opp_priority,
               opp.opp_intent_type,
               opp.opp_travel_date,
               opp.opp_next_follow_up_at,
               opp.opp_summary,
               CASE 
                 WHEN c_identity.id IS NOT NULL THEN 'customer_id'
                 WHEN c_phone.id IS NOT NULL THEN 'phone_unique'
                 ELSE 'none'
               END as summary_link_method
               FROM leads l
               -- Layer 1: Safe link via customer_id (identity-based, no ambiguity)
               LEFT JOIN conversations c_identity ON c_identity.tenant_id = l.tenant_id 
                 AND l.customer_id IS NOT NULL 
                 AND c_identity.customer_id = l.customer_id
               LEFT JOIN conversation_memory mem_identity ON mem_identity.conversation_id = c_identity.id
               -- Layer 2: Phone match only if EXACTLY ONE conversation matches (prevents cross-leak)
               LEFT JOIN LATERAL (
                 SELECT c2.id, c2.status, c2.lead_stage, c2.country as conv_country, c2.department as conv_department
                 FROM conversations c2 
                 WHERE c2.tenant_id = l.tenant_id 
                   AND RIGHT(c2.phone_number, 10) = RIGHT(l.phone_number, 10)
                   AND l.customer_id IS NULL  -- Only use phone fallback when customer_id link unavailable
                   AND (SELECT COUNT(*) FROM conversations cx 
                        WHERE cx.tenant_id = l.tenant_id 
                        AND RIGHT(cx.phone_number, 10) = RIGHT(l.phone_number, 10)) = 1
                 LIMIT 1
               ) c_phone ON c_identity.id IS NULL
               LEFT JOIN conversation_memory mem_phone ON mem_phone.conversation_id = c_phone.id AND c_identity.id IS NULL
               -- Layer 4: Most recent opportunity for linked conversation (LATERAL prevents duplication)
               LEFT JOIN LATERAL (
                 SELECT o.id as opp_id, 
                        o.country as opp_country, o.department as opp_department,
                        o.stage as opp_stage, o.priority as opp_priority,
                        o.intent_type as opp_intent_type, o.travel_date as opp_travel_date,
                        o.next_follow_up_at as opp_next_follow_up_at,
                        o.summary as opp_summary
                 FROM opportunities o
                 WHERE o.tenant_id = l.tenant_id
                   AND o.conversation_id = COALESCE(c_identity.id, c_phone.id)
                 ORDER BY o.updated_at DESC
                 LIMIT 1
               ) opp ON COALESCE(c_identity.id, c_phone.id) IS NOT NULL
               WHERE ${conditions.join(' AND ')}
               ORDER BY l.created_at DESC LIMIT $${limitIdx} OFFSET $${offsetIdx}`,
        values: params
      });

      return rows.map((r: any) => ({
        id: r.id,
        phone_number: r.phone_number,
        patient_name: r.patient_name || "İsimsiz Form",
        email: r.email,
        city: r.city,
        form_name: r.form_name || "Bilinmeyen Form",
        stage: r.conv_lead_stage || r.stage || "new",
        created_at: r.created_at,
        raw_data: r.raw_data ? JSON.parse(r.raw_data) : {},
        country: r.country,
        notes: r.notes || "",
        ai_summary: r.ai_summary || "",
        isBotActive: r.conversation_status === 'bot',
        summaryLinkMethod: r.summary_link_method || 'none',
        // ═══ P0C: Live CRM data from conversation/opportunity ═══
        linked_conversation_id: r.linked_conv_id || null,
        linked_opportunity_id: r.opp_id || null,
        current_country: r.opp_country || r.conv_country || r.country || null,
        current_department: r.opp_department || r.conv_department || null,
        current_stage: r.opp_stage || null,
        current_priority: r.opp_priority || null,
        current_intent_type: r.opp_intent_type || null,
        current_travel_date: r.opp_travel_date || null,
        current_next_follow_up_at: r.opp_next_follow_up_at || null,
        current_ai_summary: r.opp_summary || r.ai_summary || "",
        link_confidence: r.summary_link_method || 'none',
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

export async function updateLeadStage(id: number, stage: string) {
  return withActionGuard(
    { actionName: 'updateLeadStage' },
    async (ctx) => {
      const lead = await ctx.db.executeSafe({
        text: `SELECT phone_number, raw_data FROM leads WHERE id = $1 AND tenant_id = $2`,
        values: [id, ctx.tenantId]
      });
      if (lead.length === 0) throw new Error("Kayıt bulunamadı.");

      await ctx.db.executeSafe({
        text: `UPDATE leads SET stage = $1 WHERE id = $2 AND tenant_id = $3`,
        values: [stage, id, ctx.tenantId]
      });

      // Sync stage to conversations table (single source of truth)
      const phoneSuffix = lead[0].phone_number.replace(/\D/g, '').slice(-10);
      try {
        await ctx.db.executeSafe({
          text: `UPDATE conversations SET lead_stage = $1 WHERE RIGHT(phone_number, 10) = $2 AND tenant_id = $3`,
          values: [stage, phoneSuffix, ctx.tenantId]
        });
      } catch (_) {
        // Non-blocking
      }

      // Sync stage to Google Sheets lead_status column
      const SHEET_URL = process.env.GOOGLE_SHEET_UPDATE_URL || process.env.GOOGLE_SHEET_URL;
      if (SHEET_URL && lead.length > 0) {
        try {
          // Map internal stage to display label for Sheets
          const stageLabels: Record<string, string> = {
            'new': 'Yeni Lead',
            'contacted': 'İletişime Geçildi',
            'responded': 'Yanıt Alındı',
            'discovery': 'Keşif / Analiz',
            'qualified': 'Nitelikli',
            'appointed': 'Randevu Aldı',
            'lost': 'Kaybedildi',
          };
          
          await fetch(SHEET_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              action: 'updateStatusByPhone',
              phone: lead[0].phone_number,
              status: stageLabels[stage] || stage
            })
          });
        } catch (sheetErr) {
          const { logger: formsLogger } = await import("@/lib/core/logger");
          formsLogger.withContext({ module: 'Forms' }).warn("Google Sheets status sync failed", { error: String(sheetErr) });
        }
      }

      return { success: true };
    }
  ).then(res => {
    if (!res.success) return { success: false, error: res.error };
    return { success: true };
  });
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
      const NOTE_PATTERNS = ['geri dönüş', 'geri_dönüş', 'geri dönüs', 'geri_donus', 'notlar', 'notes', 'açıklama', 'feedback'];
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
        // Fallback: includes match (only for patterns >= 5 chars to avoid false positives)
        for (const p of patterns) {
          if (p.length < 5) continue; // skip short patterns in fuzzy mode
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

          // ── COLUMN SHIFT DETECTION ──
          // Some Google Sheets have data rows with fewer columns than headers
          // (e.g. 'id' column missing from end, or extra empty column in header)
          // This causes ALL field mappings to be off by 1+ columns
          const colShift = headers.length - row.length;
          
          // Helper to get correct cell value accounting for shift
          const getCell = (headerIdx: number): string | undefined => {
            if (headerIdx < 0) return undefined;
            // If row is shorter, check if this column's data is shifted
            // Try the direct index first
            let val = row[headerIdx];
            
            // If shift detected AND direct index seems wrong, try shifted index
            if (colShift > 0 && headerIdx >= colShift) {
              const shiftedVal = row[headerIdx - colShift];
              // Heuristic: if we expect a name but got a phone number, use shifted
              // We'll do final validation below
              if (!val && shiftedVal) val = shiftedVal;
            }
            
            return val;
          };

          // STEP 1: Extract reference country code from Meta's phone_number first
          let referenceCountryCode: string | null = null;
          for (const pc of phoneCols) {
            if (!pc.isWhatsapp) {
              const raw = getCell(pc.idx);
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
            const raw = getCell(pc.idx);
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

          // ── CONTENT-AWARE FIELD EXTRACTION ──
          // Instead of blindly using header index, validate the content
          let name = nameIdx !== -1 && getCell(nameIdx) ? String(getCell(nameIdx)).substring(0, 100) : null;
          
          // Validation: if "name" looks like a phone number, scan row for actual name
          const looksLikePhone = (s: string) => /^[p:+\s]*[\d\s+\-()]{8,}$/.test(s.trim());
          const looksLikeName = (s: string) => /^[a-zA-ZÀ-ÿçÇğĞıİöÖşŞüÜ\s.''-]{2,}$/u.test(s.trim()) && s.trim().length <= 60;
          
          if (name && looksLikePhone(name)) {
            // Name field contains a phone number → data is shifted
            // Scan entire row to find the actual name
            let foundName: string | null = null;
            for (let ci = 0; ci < row.length; ci++) {
              const cellVal = String(row[ci] || '');
              if (cellVal && looksLikeName(cellVal) && !looksLikePhone(cellVal)) {
                // Check it's not an ad_name or campaign value
                const header = headers[ci] || '';
                if (!header.startsWith('ad_') && !header.startsWith('adset_') && header !== 'campaign_name') {
                  foundName = cellVal;
                  break;
                }
              }
            }
            name = foundName;
          }

          // Campaign/Form name — validate content
          let campaignName = campaignIdx !== -1 && getCell(campaignIdx) ? String(getCell(campaignIdx)).substring(0, 200) : '';
          
          // If campaign looks like an ID (starts with c: or is just numbers), try to find the real name
          if (!campaignName || /^[cf]:\d+$/.test(campaignName) || /^\d{10,}$/.test(campaignName)) {
            // Scan raw_data for actual campaign/form name
            // Priority: form_name (human readable) > campaign_name > tab name
            const formNameVal = getCell(findCol(headers, ['form_name'], ['form_id']));
            const campNameVal = getCell(campaignIdx);
            
            if (formNameVal && !/^[f]:\d+$/.test(formNameVal)) {
              campaignName = formNameVal;
            } else {
              // Look through all cells for the campaign/form name
              // Known patterns: campaign names contain descriptive text, not IDs
              for (let ci = 0; ci < row.length; ci++) {
                const cellVal = String(row[ci] || '');
                const hdr = headers[ci] || '';
                if ((hdr === 'form_name' || hdr === 'campaign_name') && cellVal && !/^[cf]:\d+$/.test(cellVal)) {
                  campaignName = cellVal;
                  break;
                }
              }
              // Still no good name? Use is_organic field which sometimes has the form name
              if (!campaignName || /^[cf]:\d+$/.test(campaignName)) {
                const isOrganicIdx = headers.indexOf('is_organic');
                if (isOrganicIdx >= 0) {
                  const isOrganicVal = String(row[isOrganicIdx] || '');
                  if (isOrganicVal && isOrganicVal !== 'true' && isOrganicVal !== 'false' && isOrganicVal.length > 3) {
                    campaignName = isOrganicVal;
                  }
                }
              }
            }
            if (!campaignName || /^[cf]:\d+$/.test(campaignName)) campaignName = tabName;
          }

          const email = emailIdx !== -1 && getCell(emailIdx) ? String(getCell(emailIdx)).substring(0, 200) : null;
          const createdTime = dateIdx !== -1 && getCell(dateIdx) ? String(getCell(dateIdx)) : null;
          let noteVal = noteIdx !== -1 && getCell(noteIdx) ? String(getCell(noteIdx)).substring(0, 5000) : null;
          // Filter out garbage: status keywords, system values, dates (birth dates)
          if (noteVal) {
            const trimmed = noteVal.trim();
            const JUNK_VALUES = ['CREATED', 'ACTIVE', 'CLOSED', 'PENDING', 'true', 'false', 'fb', 'ig', 'null', 'undefined'];
            const isJunk = JUNK_VALUES.includes(trimmed)
              || /^[a-z]:[\d]+$/.test(trimmed)
              || /^[lf]:\d+$/.test(trimmed)
              // Date formats: MM/DD/YYYY, DD/MM/YYYY, YYYY-MM-DD, DD.MM.YYYY
              || /^\d{2}\/\d{2}\/\d{4}$/.test(trimmed)
              || /^\d{4}-\d{2}-\d{2}$/.test(trimmed)
              || /^\d{2}\.\d{2}\.\d{4}$/.test(trimmed)
              // Pure numbers (IDs, phone fragments)
              || /^\d+$/.test(trimmed);
            if (isJunk) {
              noteVal = null;
            }
          }

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

      // 6c. Filter new rows vs existing rows that need updates
      const seenPhones = new Set<string>();
      const newRows: ParsedRow[] = [];
      const updateRows: ParsedRow[] = []; // existing leads whose notes/raw_data should be updated

      for (const row of allRows) {
        const suffix = row.phone.slice(-10);
        if (seenPhones.has(suffix)) continue; // in-batch duplicate
        seenPhones.add(suffix);
        
        if (existingSet.has(suffix)) {
          // Existing lead — collect for update (notes, raw_data, form_name)
          updateRows.push(row);
        } else {
          newRows.push(row);
        }
      }

      const duplicates = updateRows.length;
      console.log(`[SYNC_DEDUP] ${newRows.length} new, ${updateRows.length} to update`);

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

      // 6e. Batch UPDATE existing leads (notes, raw_data, form_name, patient_name)
      let updated = 0;
      for (const row of updateRows) {
        try {
          const suffix = row.phone.slice(-10);
          // Only update fields that have actual values from Sheets
          const setClauses: string[] = [];
          const updateParams: any[] = [];
          let pIdx = 1;

          // Always update raw_data (latest sheet snapshot)
          setClauses.push(`raw_data = $${pIdx}`);
          updateParams.push(row.rawData);
          pIdx++;

          // Update notes only if Sheets has a non-empty value
          if (row.notes && row.notes.trim()) {
            setClauses.push(`notes = $${pIdx}`);
            updateParams.push(row.notes);
            pIdx++;
          }

          // Update patient_name if Sheets has a value and DB doesn't
          if (row.name && row.name.trim()) {
            setClauses.push(`patient_name = COALESCE(NULLIF(patient_name, ''), $${pIdx})`);
            updateParams.push(row.name);
            pIdx++;
          }

          // Update form_name
          if (row.formName) {
            setClauses.push(`form_name = $${pIdx}`);
            updateParams.push(row.formName);
            pIdx++;
          }

          updateParams.push(ctx.tenantId, suffix);

          await ctx.db.executeSafe({
            text: `UPDATE leads SET ${setClauses.join(', ')} 
                   WHERE tenant_id = $${pIdx} AND RIGHT(phone_number, 10) = $${pIdx + 1}`,
            values: updateParams
          });
          updated++;
        } catch (updateErr: any) {
          console.error('[SYNC_UPDATE_ERROR]', updateErr?.message?.slice(0, 200));
        }
      }
      console.log(`[SYNC_UPDATED] ${updated} existing leads updated`);

      // ── 7. Update health status ──
      await ctx.db.executeSafe({
        text: `UPDATE tenant_integrations SET health_status = 'healthy', last_sync_at = NOW(), updated_at = NOW() WHERE tenant_id = $1 AND provider = 'google_sheets'`,
        values: [ctx.tenantId]
      });

      const stats = { totalRows, created, updated, duplicates, errors: 0 };
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
        message: `${created} yeni kayıt eklendi. ${stats.updated} kayıt güncellendi. ${duplicates} tekrar eden. Toplam ${totalRows} satır.`,
        stats
      };
    }
  ).then(res => {
    console.log('[SYNC_ACTION_RETURN]', JSON.stringify(res).slice(0, 300));
    if (!res.success) return { success: false, error: res.error || res.data?.error };
    return { success: true, message: res.data?.message, stats: res.data?.stats };
  });
}

