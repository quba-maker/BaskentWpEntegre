import { withTenantDB } from '@/lib/core/tenant-db';
import { logger } from '@/lib/core/logger';
import { CredentialsService } from '@/lib/services/credentials.service';
import { logAudit } from '@/lib/audit';
import { normalizePhoneForIdentity } from '@/lib/utils/phone-identity';
import * as crypto from 'crypto';

const log = logger.withContext({ module: 'SheetsIngestion' });

// ═══════════════════════════════════════════════════════════
// FIELD DETECTION PRIORITY TABLES
// Single source of truth — used by both single-row (webhook)
// and batch (manual sync / cron) ingestion paths
// ═══════════════════════════════════════════════════════════

// ── Single-row field detection (webhook ingestSheetRow) ──
const PHONE_PRIMARY_PATTERNS = [
  'whatsapp_number', 'whatsapp', 'wp', 'iletişim', 'wp numarası', 'whatsapp numarası'
];
const PHONE_SECONDARY_PATTERNS = [
  'telefon', 'phone', 'phone_number', 'numara', 'cep', 'cep telefonu', 'mobile', 'gsm'
];
const NAME_PATTERNS = [
  'full_name', 'full name', 'name', 'isim', 'ad_soyad', 'ad soyad', 'adı', 'adınız',
  'ad', 'soyad', 'hasta adı', 'patient_name', 'first_name', 'ad ve soyad'
];
const EMAIL_PATTERNS = ['email', 'e-posta', 'mail', 'e_posta', 'eposta'];
const COUNTRY_PATTERNS = ['ülke', 'country', 'nationality', 'uyruk'];
const DATE_PATTERNS = ['created_time', 'timestamp', 'tarih', 'date', 'created_at', 'zaman', 'time', 'kayıt tarihi'];
const NOTE_PATTERNS = ['not', 'notlar', 'notes', 'note', 'geri dönüş', 'açıklama', 'feedback', 'açıklamalar'];
const FORM_NAME_PATTERNS = [
  'form adı', 'form name', 'form_name', 'kampanya adı', 'campaign_name',
  'campaign name', 'kampanya', 'campaign', 'form'
];

// ── Batch field detection (advanced — ported from forms.ts) ──
const BATCH_WHATSAPP_PATTERNS = ['whatsapp_number', 'whatsapp numarası', 'whatsapp', 'wp numarası', 'wp'];
const BATCH_PHONE_PATTERNS = ['phone_number', 'telefon', 'phone', 'numara', 'cep', 'cep telefonu', 'mobile', 'gsm', 'iletişim'];
const BATCH_NAME_EXACT = ['full_name', 'full name', 'ad_soyad', 'ad soyad', 'hasta adı', 'patient_name'];
const BATCH_NAME_FALLBACK = ['isim', 'adı', 'adınız', 'first_name'];
const BATCH_EMAIL_PATTERNS = ['email', 'e-posta', 'mail', 'e_posta'];
const BATCH_DATE_PATTERNS = ['created_time', 'timestamp', 'tarih', 'date', 'created_at'];
const BATCH_NOTE_PATTERNS = ['geri dönüş', 'geri_dönüş', 'geri dönüs', 'geri_donus', 'notlar', 'notes', 'açıklama', 'feedback'];
const BATCH_CAMPAIGN_PATTERNS = ['campaign_name', 'kampanya adı', 'kampanya'];

// ═══════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════

export interface IngestRowParams {
  tenantId: string;
  tenantName?: string;
  sheetName: string;
  data: Record<string, any>;
  /** Pipeline routing */
  outboundChannelId?: string | null;
  greetingGroupId?: string | null;
  /** If true, skip WhatsApp auto-greeting (batch sync mode) */
  skipAutoMessage?: boolean;
  /** "webhook" | "manual_sync" */
  source?: string;
}

export interface IngestRowResult {
  status: 'created' | 'duplicate' | 'updated' | 'error';
  leadId?: string;
  conversationId?: string;
  messageSent?: boolean;
  activePhone?: string;
  error?: string;
}

// ── Batch Ingestion Types ──

export interface IngestBatchParams {
  tenantId: string;
  tenantName?: string;
  /** Google Sheets API key (decrypted) */
  apiKey: string;
  /** Spreadsheet ID */
  spreadsheetId: string;
  /** Tab names to sync (empty = all visible) */
  activeSheets: string[];
  /** Pipeline routing */
  outboundChannelId?: string | null;
  greetingGroupId?: string | null;
  /** Always true for batch (cron/manual). Only false for webhook single-row */
  skipAutoMessage: boolean;
  /** Origin identifier */
  source: 'manual_sync' | 'cron_sync' | 'qstash_sync';
  /** Safety: max rows to process in this run (default: 2000) */
  maxRowsPerRun?: number;
  /** Safety: abort processing if elapsed > this ms (default: 45000) */
  timeBudgetMs?: number;
}

export interface IngestBatchResult {
  success: boolean;
  totalRows: number;
  created: number;
  updated: number;
  duplicates: number;
  unchanged?: number;
  errors: number;
  skippedUnknownTab?: number;
  controlRequired?: number;
  /** true if processing stopped early due to time/row limit */
  partial: boolean;
  /** Human-readable message */
  message: string;
  errorDetails?: string;
  telemetry?: {
    authDurationMs: number;
    readDurationMs: number;
    parseDurationMs: number;
    dupDetectionDurationMs: number;
    dbDurationMs: number;
    totalDurationMs: number;
  };
}

export interface PhoneColumn {
  idx: number;
  isWhatsapp: boolean;
}

export interface HealthStats {
  created: number;
  duplicates: number;
  errors: number;
  errorMessage?: string;
}

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
  stage: string;
}

// ═══════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════

function findKey(keys: string[], patterns: string[]): string | undefined {
  for (const p of patterns) {
    const found = keys.find(k => k === p || k.includes(p));
    if (found) return found;
  }
  return undefined;
}

function findKeyExcludeId(keys: string[], patterns: string[]): string | undefined {
  for (const p of patterns) {
    const found = keys.find(k =>
      !k.endsWith('id') && !k.endsWith('_id') && !k.includes(' id') &&
      (k === p || k.includes(p))
    );
    if (found) return found;
  }
  return undefined;
}

function normalizePhone(raw: string): string {
  let phone = String(raw || '').replace(/[^0-9]/g, '');
  if (phone.startsWith('0')) phone = '90' + phone.substring(1);
  return phone.substring(0, 20);
}

export function parseDateSafe(dateStr: string | null | undefined): Date | null {
  if (!dateStr) return null;
  const str = String(dateStr).trim();
  
  // 1. Match Turkish/European format: DD.MM.YYYY HH:mm:ss or DD/MM/YYYY HH:mm:ss (or with spaces/hyphens)
  const matchDMY = str.match(/^(\d{1,2})[\.\/-](\d{1,2})[\.\/-](\d{4})(?:\s+(\d{1,2}):(\d{1,2})(?::(\d{1,2}))?)?$/);
  if (matchDMY) {
    const day = parseInt(matchDMY[1], 10);
    const month = parseInt(matchDMY[2], 10) - 1; // 0-indexed month
    const year = parseInt(matchDMY[3], 10);
    const hour = matchDMY[4] ? parseInt(matchDMY[4], 10) : 0;
    const minute = matchDMY[5] ? parseInt(matchDMY[5], 10) : 0;
    const second = matchDMY[6] ? parseInt(matchDMY[6], 10) : 0;
    
    // Europe/Istanbul (UTC+3) -> UTC
    const utcMs = Date.UTC(year, month, day, hour, minute, second) - (3 * 60 * 60 * 1000);
    const parsed = new Date(utcMs);
    if (!isNaN(parsed.getTime())) {
      return parsed;
    }
  }

  // 2. Match standard ISO date format without offset (e.g. YYYY-MM-DD HH:mm:ss or YYYY/MM/DD HH:mm:ss)
  const hasOffset = /([Z+-]\d{2}(?::?\d{2})?)$/.test(str);
  if (!hasOffset) {
    const matchYMD = str.match(/^(\d{4})[\.\/-](\d{1,2})[\.\/-](\d{1,2})(?:\s+(\d{1,2}):(\d{1,2})(?::(\d{1,2}))?)?$/);
    if (matchYMD) {
      const year = parseInt(matchYMD[1], 10);
      const month = parseInt(matchYMD[2], 10) - 1;
      const day = parseInt(matchYMD[3], 10);
      const hour = matchYMD[4] ? parseInt(matchYMD[4], 10) : 0;
      const minute = matchYMD[5] ? parseInt(matchYMD[5], 10) : 0;
      const second = matchYMD[6] ? parseInt(matchYMD[6], 10) : 0;
      
      // Treat as Europe/Istanbul (UTC+3)
      const utcMs = Date.UTC(year, month, day, hour, minute, second) - (3 * 60 * 60 * 1000);
      const parsed = new Date(utcMs);
      if (!isNaN(parsed.getTime())) {
        return parsed;
      }
    }
  }

  // 3. Fallback to standard Date parsing (handles ISO with offset, etc.)
  const standard = new Date(str);
  if (!isNaN(standard.getTime())) {
    return standard;
  }
  
  return null;
}

function parseDate(dateStr: string | null | undefined): Date {
  return parseDateSafe(dateStr) || new Date();
}

// ═══════════════════════════════════════════════════════════
// INCREMENTAL SYNC & FINGERPRINTING HELPERS
// ═══════════════════════════════════════════════════════════

function normalizeString(val: string | null | undefined): string {
  if (!val) return '';
  return String(val).trim().toLowerCase().replace(/\s+/g, ' ');
}

function normalizePhoneForHash(phone: string): string {
  let digits = String(phone || '').replace(/[^0-9]/g, '');
  if (digits.startsWith('0')) {
    const inferred = inferCountryFromLocal(digits);
    if (inferred) {
      digits = inferred + digits.substring(1);
    } else {
      digits = '90' + digits.substring(1);
    }
  }
  return digits;
}

function normalizeTimeForHash(time: string | null | undefined): string {
  if (!time) return '';
  const d = parseDateSafe(time);
  if (d) return d.toISOString();
  return String(time).trim().toLowerCase();
}

export function computeRowFingerprint(tenantId: string, fields: {
  phone: string;
  name: string | null;
  email: string | null;
  formName: string;
  notes: string | null;
  createdTime: string | null;
}): string {
  const normPhone = normalizePhoneForHash(fields.phone);
  const normName = normalizeString(fields.name);
  const normEmail = normalizeString(fields.email);
  const normForm = normalizeString(fields.formName);
  const normNotes = normalizeString(fields.notes);
  const normTime = normalizeTimeForHash(fields.createdTime);

  const payload = [
    tenantId,
    normPhone,
    normName,
    normEmail,
    normForm,
    normNotes,
    normTime
  ].join('|');

  return crypto.createHash('sha256').update(payload).digest('hex');
}

export function getCanonicalKey(phone: string, formName: string, createdTime: string | null, rawDataVal?: any): string {
  const normPhone = normalizePhoneForHash(phone);
  const normForm = normalizeString(formName);
  let normTime = normalizeTimeForHash(createdTime);
  
  if (!normTime) {
    if (rawDataVal) {
      try {
        const obj = typeof rawDataVal === 'string' ? JSON.parse(rawDataVal) : rawDataVal;
        if (obj) {
          const cleaned = { ...obj };
          delete cleaned._google_sheets_fingerprint;
          delete cleaned._imported_at;
          delete cleaned._updated_at;
          delete cleaned._all_phones;
          delete cleaned._sheet_name;
          delete cleaned._source;
          const str = JSON.stringify(cleaned);
          normTime = 'fp_' + crypto.createHash('sha256').update(str).digest('hex').substring(0, 16);
        }
      } catch (_) {}
    }
  }

  if (!normTime) {
    normTime = 'fp_empty';
  }

  return `${normPhone}_${normForm}_${normTime}`;
}

export function isUnknownCampaign(name: string | null | undefined): boolean {
  if (!name) return true;
  const lower = name.trim().toLowerCase();
  return (
    lower === 'bilinmeyen kampanya' ||
    lower === 'unknown' ||
    lower === 'unknown campaign' ||
    lower === 'empty/null formname' ||
    lower === 'unknownformrows' ||
    lower === 'controlrequired' ||
    lower === 'reviewrequired' ||
    lower === 'tüm leadler' ||
    lower === '_webhook_errors' ||
    lower === ''
  );
}

export function extractSheetDateFromRaw(rawDataVal: any): string {
  if (!rawDataVal) return '';
  try {
    const obj = typeof rawDataVal === 'string' ? JSON.parse(rawDataVal) : rawDataVal;
    if (!obj) return '';
    const keys = Object.keys(obj);
    const dateKey = keys.find(k => {
      const l = k.toLowerCase().trim();
      return l === 'created_time' || l === 'timestamp' || l === 'tarih' || l === 'date' || l === 'created_at' || l === 'zaman' || l === 'time' || l === 'kayıt tarihi';
    });
    if (dateKey && obj[dateKey]) {
      const val = obj[dateKey];
      const d = parseDateSafe(val);
      if (d) return d.toISOString();
    }
  } catch (_) {}
  return '';
}

function getExistingFingerprint(rawDataVal: any): string | null {
  if (!rawDataVal) return null;
  try {
    const obj = typeof rawDataVal === 'string' ? JSON.parse(rawDataVal) : rawDataVal;
    return obj?._google_sheets_fingerprint || null;
  } catch (_) {
    return null;
  }
}

function mergeRawData(existingRaw: any, incomingRawString: string, fingerprint: string): string {
  let existingObj: Record<string, any> = {};
  if (existingRaw) {
    try {
      existingObj = typeof existingRaw === 'string' ? JSON.parse(existingRaw) : existingRaw;
    } catch (_) {
      existingObj = { _corrupted_raw_data_fallback: String(existingRaw) };
    }
  }

  let incomingObj: Record<string, any> = {};
  if (incomingRawString) {
    try {
      incomingObj = JSON.parse(incomingRawString);
    } catch (_) {}
  }

  const merged = {
    ...existingObj,
    ...incomingObj,
    _google_sheets_fingerprint: fingerprint,
    _updated_at: new Date().toISOString()
  };

  return JSON.stringify(merged);
}

// ═══════════════════════════════════════════════════════════
// CORE INGESTION FUNCTION
// ═══════════════════════════════════════════════════════════

export async function ingestSheetRow(params: IngestRowParams): Promise<IngestRowResult> {
  const {
    tenantId, tenantName, sheetName, data,
    outboundChannelId, greetingGroupId,
    skipAutoMessage = false, source = 'manual_sync'
  } = params;

  const db = withTenantDB(tenantId);

  try {
    // ── 1. Normalize keys to lowercase ──
    const lowercaseData: Record<string, any> = {};
    Object.keys(data).forEach(k => {
      lowercaseData[k.toLowerCase().trim()] = data[k];
    });
    const keys = Object.keys(lowercaseData);

    // ── 2. Field detection ──
    let primaryPhoneKey = findKey(keys, PHONE_PRIMARY_PATTERNS);
    let secondaryPhoneKey = findKey(keys, PHONE_SECONDARY_PATTERNS);

    // If no whatsapp-specific field, use phone as primary
    if (!primaryPhoneKey && secondaryPhoneKey) {
      primaryPhoneKey = secondaryPhoneKey;
      secondaryPhoneKey = undefined;
    }
    // If primary and secondary resolve to the same key, drop secondary
    if (primaryPhoneKey && secondaryPhoneKey && primaryPhoneKey === secondaryPhoneKey) {
      secondaryPhoneKey = undefined;
    }

    const nameKey = findKeyExcludeId(keys, NAME_PATTERNS);
    const emailKey = findKey(keys, EMAIL_PATTERNS);
    const countryKey = findKey(keys, COUNTRY_PATTERNS);
    const dateKey = findKey(keys, DATE_PATTERNS);
    const noteKey = findKey(keys, NOTE_PATTERNS);
    const formNameKey = findKeyExcludeId(keys, FORM_NAME_PATTERNS);

    if (!primaryPhoneKey) {
      return { status: 'error', error: 'No phone/WhatsApp column found' };
    }

    // ── 3. Extract & normalize values ──
    const country = countryKey ? String(lowercaseData[countryKey]) : null;

    const idObj1 = normalizePhoneForIdentity(lowercaseData[primaryPhoneKey], country || undefined);
    let phone1 = idObj1.e164 || idObj1.digits;

    let phone2 = '';
    if (secondaryPhoneKey && lowercaseData[secondaryPhoneKey]) {
      const idObj2 = normalizePhoneForIdentity(lowercaseData[secondaryPhoneKey], country || undefined);
      phone2 = idObj2.e164 || idObj2.digits;
    }

    // If phone1 is too short but phone2 is valid, swap
    if (phone1.length < 10 && phone2.length >= 10) {
      phone1 = phone2;
      phone2 = '';
    }
    if (phone1.length < 10) {
      return { status: 'error', error: `Invalid phone: ${phone1}` };
    }
    // Deduplicate same numbers
    if (phone2 === phone1) phone2 = '';

    const name = nameKey && lowercaseData[nameKey] ? String(lowercaseData[nameKey]).substring(0, 100) : null;
    const email = emailKey && lowercaseData[emailKey] ? String(lowercaseData[emailKey]).substring(0, 200) : null;
    const formName = formNameKey && lowercaseData[formNameKey] ? String(lowercaseData[formNameKey]).substring(0, 200) : sheetName;
    const dateStr = dateKey ? lowercaseData[dateKey] : null;
    const noteStr = noteKey && lowercaseData[noteKey] ? String(lowercaseData[noteKey]).substring(0, 5000) : null;
    const createdAt = parseDate(dateStr);

    // Build raw_data with full context
    const raw_data: Record<string, any> = { ...data };
    if (country) raw_data['country'] = country;
    raw_data['_sheet_name'] = sheetName;
    raw_data['_source'] = source;
    raw_data['_imported_at'] = new Date().toISOString();
    raw_data['_detected_fields'] = {
      primaryPhoneKey, secondaryPhoneKey, nameKey, emailKey, dateKey, formNameKey
    };
    const allPhones = [phone1, phone2].filter(Boolean);
    raw_data['_all_phones'] = JSON.stringify(allPhones);

    // ── 4. Duplicate check ──
    const existing = await db.executeSafe({
      text: `SELECT id FROM leads WHERE phone_number LIKE '%' || RIGHT($1, 10) || '%' AND tenant_id = $2 LIMIT 1`,
      values: [phone1, tenantId]
    }) as any[];

    if (existing && existing.length > 0) {
      // Duplicate — skip heavy processing in batch mode
      return { status: 'duplicate', leadId: existing[0].id };
    }

    // ── 5. Create lead ──
    const leadResult = await db.executeSafe({
      text: `INSERT INTO leads (tenant_id, phone_number, patient_name, email, form_name, raw_data, stage, created_at, notes)
             VALUES ($1, $2, $3, $4, $5, $6, 'new', $7, $8)
             RETURNING id`,
      values: [tenantId, phone1, name, email, formName, JSON.stringify(raw_data), createdAt.toISOString(), noteStr]
    }) as any[];

    const leadId = leadResult?.[0]?.id;

    // ── 6. Identity Engine: Link lead to customer profile ──
    if (leadId) {
      try {
        const { IdentityEngine } = await import('@/lib/services/ai/engines/identity');
        const customerId = await IdentityEngine.resolveIdentity({
          tenantId,
          phoneNumber: phone1,
          email: email || undefined,
          firstName: name || undefined,
          allPhones: allPhones.length > 0 ? allPhones : undefined,
          source: 'form'
        });
        await IdentityEngine.linkLead(tenantId, leadId, customerId);
      } catch (idErr) {
        log.error('[INGEST_IDENTITY] Non-fatal identity link error', idErr instanceof Error ? idErr : new Error(String(idErr)));
      }
    }

    // ── 6.5. PHASE 2L-P0: Activate lead in operational pipeline ──
    // Creates: conversation → opportunity → task → notification → Telegram
    // Idempotent: skips if lead already has linked_opportunity_id
    if (leadId) {
      try {
        const { FormLeadActivationService } = await import('./form-lead-activation.service');
        await FormLeadActivationService.activate({
          tenantId, tenantName, leadId, phoneNumber: phone1,
          patientName: name || undefined, formName, email: email || undefined,
          source: source || 'webhook'
        });
      } catch (activationErr) {
        log.error('[INGEST_ACTIVATION] Non-fatal activation error',
          activationErr instanceof Error ? activationErr : new Error(String(activationErr)));
      }
    }

    // ── 7. Auto WhatsApp greeting (only if not skipAutoMessage) ──
    let messageSent = false;
    let activePhone = phone1;
    let conversationId: string | undefined;

    if (!skipAutoMessage) {
      // Resolve WhatsApp credentials
      let META_ACCESS_TOKEN: string | null = null;
      let PHONE_NUMBER_ID: string | null = null;

      const creds = await CredentialsService.resolveCredentials(tenantId, 'whatsapp');
      META_ACCESS_TOKEN = creds.accessToken;
      PHONE_NUMBER_ID = creds.whatsappPhoneNumberId;

      // Greeting config from channel_ai_profiles
      let autoGreetingEnabled = true;
      let greetingLang = 'auto';

      const greetingQuery = greetingGroupId
        ? {
            text: `SELECT cap.auto_greeting, cap.greeting_language FROM channel_ai_profiles cap WHERE cap.group_id = $1`,
            values: [greetingGroupId]
          }
        : {
            text: `SELECT cap.auto_greeting, cap.greeting_language FROM channel_ai_profiles cap
                   JOIN channel_groups cg ON cap.group_id = cg.id
                   WHERE cg.tenant_id = $1 AND cg.status = 'active'
                   ORDER BY cg.sort_order ASC LIMIT 1`,
            values: [tenantId]
          };

      const profileRes = await db.executeSafe(greetingQuery) as any[];
      if (profileRes.length > 0) {
        autoGreetingEnabled = profileRes[0].auto_greeting !== false;
        greetingLang = profileRes[0].greeting_language || 'auto';
      }

      if (META_ACCESS_TOKEN && PHONE_NUMBER_ID && autoGreetingEnabled) {
        const isTurkish = greetingLang === 'tr' ? true : greetingLang === 'en' ? false : phone1.startsWith('90');
                const displayName = tenantName || 'Ekibimiz';
        const greeting = isTurkish ? 'Merhaba!' : 'Hello!';
        const welcomeMsg = isTurkish
          ? `${greeting} ${displayName} olarak size yazıyoruz 🙏\n\nDoldurduğunuz form bize ulaştı. Talebiniz hakkında detaylı bilgi alabilir miyiz?`
          : `${greeting} We are reaching out from ${displayName} 🙏\n\nWe received your form. Could you provide more details about your request?`;

        // Send WhatsApp function
        const sendWhatsApp = async (phoneToTry: string) => {
          const response = await fetch(`https://graph.facebook.com/v25.0/${PHONE_NUMBER_ID}/messages`, {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${META_ACCESS_TOKEN}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              messaging_product: 'whatsapp',
              to: phoneToTry,
              type: 'text',
              text: { body: welcomeMsg },
            }),
          });
          return response.ok;
        };

        // Try phone1, fallback to phone2
        messageSent = await sendWhatsApp(phone1);
        if (!messageSent && phone2 && phone2 !== phone1) {
          log.info('[INGEST_PHONE_FALLBACK] Trying secondary phone', { phone2 });
          messageSent = await sendWhatsApp(phone2);
          if (messageSent) activePhone = phone2;
        }

        // Create conversation & message record
        if (messageSent) {
          const tags = [sheetName, formName].filter(Boolean);

          // Resolve WhatsApp channel_id for conversation
          let whatsappChannelId: string | null = outboundChannelId || null;
          if (!whatsappChannelId) {
            try {
              const chs = await db.executeSafe({
                text: `SELECT c.id FROM channels c JOIN channel_groups cg ON c.group_id = cg.id
                       WHERE cg.tenant_id = $1 AND c.provider = 'whatsapp' AND cg.status = 'active' LIMIT 1`,
                values: [tenantId]
              }) as any[];
              if (chs.length > 0) whatsappChannelId = chs[0].id;
            } catch (_) {}
          }

          const existingConv = await db.executeSafe({
            text: `SELECT id FROM conversations WHERE phone_number = $1 AND tenant_id = $2`,
            values: [activePhone, tenantId]
          }) as any[];

          let convId = existingConv?.[0]?.id;
          if (!convId) {
            const newConv = await db.executeSafe({
              text: `INSERT INTO conversations (tenant_id, phone_number, patient_name, tags, status, department, channel, channel_id)
                     VALUES ($1, $2, $3, $4, 'bot', 'Genel', 'whatsapp', $5) RETURNING id`,
              values: [tenantId, activePhone, name, JSON.stringify(tags), whatsappChannelId]
            }) as any[];
            convId = newConv?.[0]?.id;
          } else {
            await db.executeSafe({
              text: `UPDATE conversations SET channel_id = COALESCE(channel_id, $1), channel = COALESCE(channel, 'whatsapp') WHERE id = $2 AND tenant_id = $3`,
              values: [whatsappChannelId, convId, tenantId]
            });
          }

          conversationId = convId;

          // Link conversation to customer profile
          if (convId) {
            try {
              const { IdentityEngine } = await import('@/lib/services/ai/engines/identity');
              const cid = await IdentityEngine.resolveIdentity({ tenantId, phoneNumber: activePhone });
              await IdentityEngine.linkConversation(tenantId, String(convId), cid);
            } catch (_) {}
          }

          // Insert message record
          await db.executeSafe({
            text: `INSERT INTO messages (tenant_id, conversation_id, phone_number, direction, content, channel, channel_id)
                   VALUES ($1, $2, $3, 'out', $4, 'whatsapp', $5)`,
            values: [tenantId, convId, activePhone, welcomeMsg, whatsappChannelId]
          });

          // Update lead stage
          await db.executeSafe({
            text: `UPDATE leads SET stage = 'contacted', contacted_at = NOW(), phone_number = $1 WHERE phone_number = $2 AND tenant_id = $3`,
            values: [activePhone, phone1, tenantId]
          });
        }
      }
    }

    return {
      status: 'created',
      leadId,
      conversationId,
      messageSent,
      activePhone
    };

  } catch (err: any) {
    log.error('[INGEST_ROW_ERROR]', err instanceof Error ? err : new Error(String(err)));
    return { status: 'error', error: err?.message || 'Unknown error' };
  }
}

// ═══════════════════════════════════════════════════════════
// ADVANCED PHONE NORMALIZATION
// Ported from forms.ts — supports 8+ country code patterns
// ═══════════════════════════════════════════════════════════

/** Detect country code from local number pattern: 05XX→TR, 06XX→NL, 015X→DE, etc. */
export function inferCountryFromLocal(digits: string): string | null {
  if (/^05\d{8}$/.test(digits)) return '90';          // Turkish mobile
  if (/^0(15|16|17)\d{8,9}$/.test(digits)) return '49'; // German mobile
  if (/^06\d{8}$/.test(digits)) return '31';           // Dutch mobile
  if (/^04\d{8}$/.test(digits)) return '32';           // Belgian mobile
  if (/^07\d{9}$/.test(digits)) return '44';           // UK mobile
  if (/^0[67]\d{8}$/.test(digits)) return '33';        // French mobile
  if (/^0(664|676|699|660|650)\d{6,8}$/.test(digits)) return '43'; // Austrian mobile
  if (/^07[5-9]\d{7}$/.test(digits)) return '41';     // Swiss mobile
  return null;
}

/** Extract leading country code from international number */
export function extractCountryCode(digits: string): string | null {
  const CODES = [
    '998','996','995','994','993','992','971','966','964','962','961',
    '380','374','359','90','86','82','81','77','55','52','49','48',
    '47','46','45','44','43','41','40','39','36','34','33','32','31',
    '30','91','61','7','1'
  ];
  for (const code of CODES) {
    if (digits.startsWith(code)) return code;
  }
  return null;
}

/** Full phone normalization with country inference + reference fallback */
export function normalizePhoneAdvanced(raw: string, referenceCountryCode?: string | null): string {
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
}

/** Smart dedup: suffix matching + containment check. Keeps longest (most complete) version. */
export function dedupPhones(phones: string[]): string[] {
  const sorted = [...phones].sort((a, b) => b.length - a.length);
  const result: string[] = [];

  for (const phone of sorted) {
    const isDuplicate = result.some(existing => {
      const existSuffix = existing.slice(-9);
      const phoneSuffix = phone.slice(-9);
      if (existSuffix === phoneSuffix) return true;
      if (existing.endsWith(phone) || phone.endsWith(existing)) return true;
      return false;
    });
    if (!isDuplicate) result.push(phone);
  }

  return result;
}

// ═══════════════════════════════════════════════════════════
// ADVANCED FIELD DETECTION (Batch mode)
// Ported from forms.ts — content-aware with exclude prefixes
// ═══════════════════════════════════════════════════════════

/** Safe column finder — excludes ad_id, ad_name for name detection. Exact match first, then fuzzy (>=5 char). */
export function findCol(headers: string[], patterns: string[], excludePrefixes: string[] = []): number {
  // Exact match first
  for (const p of patterns) {
    const idx = headers.findIndex((h: string) => {
      if (excludePrefixes.some(ex => h.startsWith(ex))) return false;
      if (h.endsWith('_id') || h.endsWith(' id')) return false;
      return h === p;
    });
    if (idx !== -1) return idx;
  }
  // Fuzzy fallback (>=5 char patterns only to avoid false positives)
  for (const p of patterns) {
    if (p.length < 5) continue;
    const idx = headers.findIndex((h: string) => {
      if (excludePrefixes.some(ex => h.startsWith(ex))) return false;
      if (h.endsWith('_id') || h.endsWith(' id')) return false;
      return h.includes(p);
    });
    if (idx !== -1) return idx;
  }
  return -1;
}

/** Find ALL phone columns (WhatsApp priority first, then general phone) */
export function findAllPhoneCols(headers: string[]): PhoneColumn[] {
  const found: PhoneColumn[] = [];
  const usedIdx = new Set<number>();

  // WhatsApp columns first (primary)
  for (const p of BATCH_WHATSAPP_PATTERNS) {
    headers.forEach((h, idx) => {
      if (!usedIdx.has(idx) && (h === p || h.includes(p)) && !h.endsWith('_id')) {
        found.push({ idx, isWhatsapp: true });
        usedIdx.add(idx);
      }
    });
  }
  // Then phone columns
  for (const p of BATCH_PHONE_PATTERNS) {
    headers.forEach((h, idx) => {
      if (!usedIdx.has(idx) && (h === p || h.includes(p)) && !h.endsWith('_id')) {
        found.push({ idx, isWhatsapp: false });
        usedIdx.add(idx);
      }
    });
  }
  return found;
}

/** Filter junk notes: status keywords, pure IDs, dates */
export function filterJunkNote(note: string | null): string | null {
  if (!note) return null;
  const trimmed = note.trim();
  if (!trimmed) return null;

  // Status values that should never be stored as notes
  const JUNK_VALUES = [
    'CREATED', 'ACTIVE', 'CLOSED', 'PENDING', 'true', 'false', 'fb', 'ig', 'null', 'undefined',
    // Lead status labels (TR)
    'Yeni Lead', 'İletişime Geçildi', 'Yanıt Alındı', 'Keşif / Analiz', 'Nitelikli', 'Randevu Aldı', 'Kaybedildi',
    // Opportunity status labels (TR)
    'Yeni', 'İlk İletişim', 'Cevap Verdi', 'Keşif', 'Rapor Bekleniyor', 'Rapor Geldi',
    'Doktor İncelemesi', 'Teklif Gönderildi', 'Randevu Planlanıyor', 'Randevu Alındı', 'Geldi', 'Kayıp', 'Uygun Değil',
    // System stage values (EN)
    'new', 'contacted', 'responded', 'discovery', 'qualified', 'appointed', 'lost',
    'new_lead', 'first_contact', 'engaged', 'report_waiting', 'report_received',
    'doctor_review', 'offer_sent', 'appointment_planning', 'appointment_booked', 'arrived', 'not_qualified',
  ];
  const isJunk = JUNK_VALUES.some(j => j.toLowerCase() === trimmed.toLowerCase())
    || /^[a-z]:[\d]+$/.test(trimmed)
    || /^[lf]:\d+$/.test(trimmed)
    || /^\d{2}\/\d{2}\/\d{4}$/.test(trimmed)
    || /^\d{4}-\d{2}-\d{2}$/.test(trimmed)
    || /^\d{2}\.\d{2}\.\d{4}$/.test(trimmed)
    || /^\d+$/.test(trimmed);

  return isJunk ? null : trimmed;
}

// ═══════════════════════════════════════════════════════════
// BATCH INGESTION ENGINE
// Unified processor for manual sync, cron sync, and qstash.
// Key features:
//   - Newest-first row processing (last rows → first processed)
//   - Time budget guard (default 45s)
//   - Max rows per run (default 2000)
//   - Batch duplicate detection (single query + Set)
//   - Content-aware field extraction with column shift detection
//   - Smart multi-phone normalization with country code inference
//   - P1B SAFE: never touches opportunities or conversations
// ═══════════════════════════════════════════════════════════

export async function ingestSheetBatch(params: IngestBatchParams): Promise<IngestBatchResult> {
  const {
    tenantId, tenantName, apiKey, spreadsheetId, activeSheets,
    outboundChannelId, greetingGroupId,
    skipAutoMessage, source,
    maxRowsPerRun = 2000,
    timeBudgetMs = 45_000,
  } = params;

  const startTime = Date.now();
  const db = withTenantDB(tenantId);

  let totalRows = 0;
  let created = 0;
  let updated = 0;
  let unchanged = 0;
  let duplicates = 0;
  let errors = 0;
  let skippedUnknownTab = 0;
  let controlRequired = 0;
  let partial = false;

  let authDurationMs = 0;
  let readDurationMs = 0;
  let parseDurationMs = 0;
  let dupDetectionDurationMs = 0;
  let dbDurationMs = 0;

  try {
    // ── 1. Fetch spreadsheet metadata ──
    const authStart = Date.now();
    const BASE_URL = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}`;
    const metaResp = await fetch(`${BASE_URL}?key=${apiKey}&fields=sheets.properties`);
    authDurationMs = Date.now() - authStart;

    if (!metaResp.ok) {
      const errorText = await metaResp.text();
      log.error('[BATCH_META_ERROR]', new Error(errorText.slice(0, 300)));
      return {
        success: false, totalRows: 0, created: 0, updated: 0, unchanged: 0, duplicates: 0, errors: 1,
        partial: false, message: `Google Sheets API hatası (${metaResp.status})`, errorDetails: errorText.slice(0, 500),
        telemetry: { authDurationMs, readDurationMs: 0, parseDurationMs: 0, dupDetectionDurationMs: 0, dbDurationMs: 0, totalDurationMs: Date.now() - startTime }
      };
    }

    const metaData = await metaResp.json();
    const allTabs = metaData.sheets
      .filter((s: any) => !s.properties.hidden)
      .map((s: any) => s.properties.title);

    // ── 2. Tab selection ──
    let tabs: string[];
    if (activeSheets.length > 0) {
      tabs = allTabs.filter((t: string) => activeSheets.includes(t));
      if (tabs.length === 0) {
        log.warn('[BATCH_TAB_MISMATCH] No matching activeSheets found', { config: activeSheets, real: allTabs });
        return {
          success: true, totalRows: 0, created: 0, updated: 0, unchanged: 0, duplicates: 0, errors: 0,
          skippedUnknownTab: 0, controlRequired: 0,
          partial: false, message: 'controlRequired',
          telemetry: { authDurationMs, readDurationMs: 0, parseDurationMs: 0, dupDetectionDurationMs: 0, dbDurationMs: 0, totalDurationMs: Date.now() - startTime }
        };
      }
    } else {
      log.warn('[BATCH_NO_ACTIVE_SHEETS] activeSheets config is empty, skipping sync');
      return {
        success: true, totalRows: 0, created: 0, updated: 0, unchanged: 0, duplicates: 0, errors: 0,
        skippedUnknownTab: 0, controlRequired: 0,
        partial: false, message: 'skippedMissingActiveSheets',
        telemetry: { authDurationMs, readDurationMs: 0, parseDurationMs: 0, dupDetectionDurationMs: 0, dbDurationMs: 0, totalDurationMs: Date.now() - startTime }
      };
    }

    log.info('[BATCH_TABS]', { 
      tabs, 
      source,
      conversationId: source === 'manual_sync' ? 'manual_sync_no_conversation' : 'cron_sync_no_conversation'
    });

    // ── 3. Fetch all rows (batch API) ──
    const readStart = Date.now();
    const rangeParams = tabs.map((t: string) => `ranges=${encodeURIComponent(t)}`).join('&');
    const batchUrl = `${BASE_URL}/values:batchGet?key=${apiKey}&${rangeParams}&valueRenderOption=FORMATTED_VALUE`;
    const batchResp = await fetch(batchUrl);
    readDurationMs = Date.now() - readStart;

    if (!batchResp.ok) {
      const errorText = await batchResp.text();
      log.error('[BATCH_FETCH_ERROR]', new Error(errorText.slice(0, 300)));
      return {
        success: false, totalRows: 0, created: 0, updated: 0, unchanged: 0, duplicates: 0, errors: 1,
        partial: false, message: `Satır verileri alınamadı (${batchResp.status})`, errorDetails: errorText.slice(0, 500),
        telemetry: { authDurationMs, readDurationMs, parseDurationMs: 0, dupDetectionDurationMs: 0, dbDurationMs: 0, totalDurationMs: Date.now() - startTime }
      };
    }

    const batchData = await batchResp.json();

    // ── 4. Parse all rows from all tabs ──
    const parseStart = Date.now();
    const allRows: ParsedRow[] = [];

    for (let i = 0; i < batchData.valueRanges.length; i++) {
      const vr = batchData.valueRanges[i];
      const tabName = tabs[i];
      const values = vr.values || [];
      
      // Strict tab enforcer: skip if tabName is not in activeSheets
      if (!activeSheets.includes(tabName)) {
        skippedUnknownTab += Math.max(0, values.length - 1);
        log.warn('[BATCH_SKIP_DISALLOWED_TAB] Tab ignored', { tabName });
        continue;
      }

      if (values.length <= 1) continue; // header only or empty

      const headers = values[0].map((h: string) => String(h).toLowerCase().trim());

      // Phone detection
      const phoneCols = findAllPhoneCols(headers);
      if (phoneCols.length === 0) {
        log.info('[BATCH_SKIP_TAB] No phone column', { tabName });
        continue;
      }

      // Name detection
      let nameIdx = findCol(headers, BATCH_NAME_EXACT, ['ad_', 'adset_']);
      if (nameIdx === -1) nameIdx = findCol(headers, BATCH_NAME_FALLBACK, ['ad_', 'adset_']);

      const emailIdx = findCol(headers, BATCH_EMAIL_PATTERNS);
      const dateIdx = findCol(headers, BATCH_DATE_PATTERNS);
      const noteIdx = findCol(headers, BATCH_NOTE_PATTERNS, ['lead_status', 'status', 'durum', 'stage', 'aşama']);
      const campaignIdx = findCol(headers, BATCH_CAMPAIGN_PATTERNS, ['campaign_id']);

      log.info('[BATCH_TAB]', {
        tabName, rows: values.length - 1,
        nameCol: nameIdx >= 0 ? headers[nameIdx] : 'NONE',
        phoneCols: phoneCols.length
      });

      for (let r = values.length - 1; r >= 1; r--) {
        const row = values[r];
        const colShift = headers.length - row.length;
        const getCell = (headerIdx: number): string | undefined => {
          if (headerIdx < 0) return undefined;
          let val = row[headerIdx];
          if (colShift > 0 && headerIdx >= colShift) {
            const shiftedVal = row[headerIdx - colShift];
            if (!val && shiftedVal) val = shiftedVal;
          }
          return val;
        };

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

        const rawPhones: string[] = [];
        let whatsappPhone = '';
        let metaPhone = '';
        for (const pc of phoneCols) {
          const raw = getCell(pc.idx);
          if (!raw) continue;
          const idResult = normalizePhoneForIdentity(raw, referenceCountryCode || undefined);
          const normalized = idResult.e164 || idResult.digits;
          if (normalized && normalized.length >= 10) {
            rawPhones.push(normalized);
            if (pc.isWhatsapp && !whatsappPhone) whatsappPhone = normalized;
            if (!pc.isWhatsapp && !metaPhone) metaPhone = normalized;
          }
        }

        const allPhones = dedupPhones(rawPhones);

        let primaryPhone = '';
        if (whatsappPhone && allPhones.some(p => p === whatsappPhone || p.endsWith(whatsappPhone) || whatsappPhone.endsWith(p))) {
          primaryPhone = allPhones.find(p => p.endsWith(whatsappPhone.slice(-9))) || whatsappPhone;
        }
        if (!primaryPhone && allPhones.length > 0) {
          primaryPhone = allPhones[0];
        }
        if (!primaryPhone) continue;

        let name = nameIdx !== -1 && getCell(nameIdx) ? String(getCell(nameIdx)).substring(0, 100) : null;
        const looksLikePhone = (s: string) => /^[p:+\s]*[\d\s+\-()]{8,}$/.test(s.trim());
        const looksLikeName = (s: string) => /^[a-zA-ZÀ-ÿçÇğĞıİöÖşŞüÜ\s.''-]{2,}$/u.test(s.trim()) && s.trim().length <= 60;

        if (name && looksLikePhone(name)) {
          let foundName: string | null = null;
          for (let ci = 0; ci < row.length; ci++) {
            const cellVal = String(row[ci] || '');
            if (cellVal && looksLikeName(cellVal) && !looksLikePhone(cellVal)) {
              const header = headers[ci] || '';
              if (!header.startsWith('ad_') && !header.startsWith('adset_') && header !== 'campaign_name') {
                foundName = cellVal;
                break;
              }
            }
          }
          name = foundName;
        }

        let campaignName = campaignIdx !== -1 && getCell(campaignIdx) ? String(getCell(campaignIdx)).substring(0, 200) : '';
        if (!campaignName || /^[cf]:\d+$/.test(campaignName) || /^\d{10,}$/.test(campaignName)) {
          const formNameVal = getCell(findCol(headers, ['form_name'], ['form_id']));
          if (formNameVal && !/^[f]:\d+$/.test(formNameVal)) {
            campaignName = formNameVal;
          } else {
            for (let ci = 0; ci < row.length; ci++) {
              const cellVal = String(row[ci] || '');
              const hdr = headers[ci] || '';
              if ((hdr === 'form_name' || hdr === 'campaign_name') && cellVal && !/^[cf]:\d+$/.test(cellVal)) {
                campaignName = cellVal;
                break;
              }
            }
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
        noteVal = filterJunkNote(noteVal);

        const rawData: Record<string, string> = {};
        const origHeaders = values[0];
        origHeaders.forEach((h: string, idx: number) => { rawData[String(h).trim()] = row[idx] || ''; });
        rawData['_sheet_name'] = tabName;
        rawData['_source'] = source;
        rawData['_all_phones'] = JSON.stringify(allPhones);

        const isQuarantined = isUnknownCampaign(campaignName) || isUnknownCampaign(tabName) || !createdTime;

        allRows.push({
          phone: primaryPhone,
          allPhones,
          name,
          email,
          formName: campaignName,
          notes: noteVal,
          createdTime,
          rawData: JSON.stringify(rawData),
          tabName,
          stage: isQuarantined ? 'quarantine' : 'new'
        });
      }
    }

    totalRows = allRows.length;
    parseDurationMs = Date.now() - parseStart;
    log.info('[BATCH_PARSED]', { totalRows, tabs: tabs.length, source, parseDurationMs });

    if (totalRows === 0) {
      return {
        success: true, totalRows: 0, created: 0, updated: 0, unchanged: 0, duplicates: 0, errors: 0,
        partial: false, message: 'Geçerli telefon numarası olan satır bulunamadı.',
        telemetry: { authDurationMs, readDurationMs, parseDurationMs, dupDetectionDurationMs: 0, dbDurationMs: 0, totalDurationMs: Date.now() - startTime }
      };
    }

    // ── 5. Batch duplicate detection & fingerprinted comparisons ──
    const dupStart = Date.now();
    const existingLeads = await db.executeSafe({
      text: `SELECT id, phone_number, form_name, created_at, raw_data FROM leads WHERE tenant_id = $1`,
      values: [tenantId]
    }) as any[];

    // Map existing leads by composite canonical key: normalized_phone + formName + createdTime
    const existingLeadsMap = new Map<string, any>();
    for (const lead of existingLeads) {
      const dbTime = extractSheetDateFromRaw(lead.raw_data);
      const key = getCanonicalKey(lead.phone_number, lead.form_name, dbTime, lead.raw_data);
      existingLeadsMap.set(key, lead);
    }

    const seenKeys = new Set<string>();
    const newRows: ParsedRow[] = [];
    const changedRows: { row: ParsedRow; leadId: string; existingRawData: any }[] = [];

    const parseCreatedTime = (raw: string | null | undefined): string => {
      if (!raw) return '';
      const d = parseDateSafe(raw);
      if (d) return d.toISOString();
      return '';
    };

    for (const row of allRows) {
      if (Date.now() - startTime > timeBudgetMs) {
        log.warn('[BATCH_TIME_BUDGET] Stopping early during partitioning', { elapsed: Date.now() - startTime });
        partial = true;
        break;
      }
      if (newRows.length + changedRows.length >= maxRowsPerRun) {
        log.warn('[BATCH_ROW_LIMIT] Max rows reached during partitioning', { maxRowsPerRun });
        partial = true;
        break;
      }

      const sheetTime = parseCreatedTime(row.createdTime);
      const rowKey = getCanonicalKey(row.phone, row.formName, sheetTime, row.rawData);

      if (seenKeys.has(rowKey)) {
        duplicates++;
        continue;
      }
      seenKeys.add(rowKey);

      const fingerprint = computeRowFingerprint(tenantId, {
        phone: row.phone,
        name: row.name,
        email: row.email,
        formName: row.formName,
        notes: row.notes,
        createdTime: row.createdTime
      });

      const matchedLead = existingLeadsMap.get(rowKey);
      const isRowQuarantined = row.stage === 'quarantine';

      if (!matchedLead) {
        if (isRowQuarantined) {
          controlRequired++;
        }
        // Prepare rawData with fingerprint for insertion
        const parsed = JSON.parse(row.rawData);
        parsed['_google_sheets_fingerprint'] = fingerprint;
        newRows.push({
          ...row,
          rawData: JSON.stringify(parsed)
        });
      } else {
        const existingFingerprint = getExistingFingerprint(matchedLead.raw_data);
        if (existingFingerprint === fingerprint) {
          unchanged++;
        } else {
          if (isRowQuarantined) {
            controlRequired++;
          }
          changedRows.push({
            row,
            leadId: matchedLead.id,
            existingRawData: matchedLead.raw_data
          });
        }
      }
    }

    dupDetectionDurationMs = Date.now() - dupStart;
    log.info('[BATCH_DEDUP]', { new: newRows.length, changed: changedRows.length, unchanged, duplicates, partial, dupDetectionDurationMs });

    // ── 6. DB operations: inserts and chunked updates ──
    const dbStart = Date.now();
    const CHUNK_SIZE = 50;

    // Batch INSERT in chunks of 50
    for (let c = 0; c < newRows.length; c += CHUNK_SIZE) {
      if (Date.now() - startTime > timeBudgetMs) {
        log.warn('[BATCH_INSERT_TIME_BUDGET] Stopping inserts early');
        partial = true;
        break;
      }

      const chunk = newRows.slice(c, c + CHUNK_SIZE);
      const valueParts: string[] = [];
      const insertParams: any[] = [];
      let paramIdx = 1;

      for (const row of chunk) {
        valueParts.push(`($${paramIdx}, $${paramIdx+1}, $${paramIdx+2}, $${paramIdx+3}, $${paramIdx+4}, $${paramIdx+5}, $${paramIdx+6}, $${paramIdx+7}, $${paramIdx+8})`);
        insertParams.push(
          tenantId, row.phone, row.name, row.email, row.formName, row.rawData,
          row.stage || 'new',
          parseCreatedTime(row.createdTime) || null,
          row.notes || null
        );
        paramIdx += 9;
      }

      try {
        const insertedLeads = await db.executeSafe({
          text: `INSERT INTO leads (tenant_id, phone_number, patient_name, email, form_name, raw_data, stage, created_at, notes)
                 VALUES ${valueParts.join(', ')}
                 ON CONFLICT DO NOTHING
                 RETURNING id, phone_number, patient_name, email, raw_data, stage`,
          values: insertParams
        }) as any[];

        created += (insertedLeads || []).length;

        if (insertedLeads && insertedLeads.length > 0) {
          const { IdentityEngine } = await import('@/lib/services/ai/engines/identity');
          for (const lead of insertedLeads) {
            if (Date.now() - startTime > timeBudgetMs) {
              log.warn('[BATCH_INSERT_IDENTITY_BUDGET] Skipping identity resolution due to time budget limits');
              break;
            }
            if (lead.stage === 'quarantine') {
              log.info('[BATCH_INSERT_SKIP_QUARANTINE] Skip identity resolution for quarantined lead', { leadId: lead.id });
              continue;
            }
            try {
              let allPhones: string[] = [];
              if (lead.raw_data) {
                try {
                  const parsedRaw = typeof lead.raw_data === 'string' ? JSON.parse(lead.raw_data) : lead.raw_data;
                  if (parsedRaw && parsedRaw._all_phones) {
                    const parsedPhones = typeof parsedRaw._all_phones === 'string' ? JSON.parse(parsedRaw._all_phones) : parsedRaw._all_phones;
                    if (Array.isArray(parsedPhones)) {
                      allPhones = parsedPhones.map(String);
                    }
                  }
                } catch (_) {}
              }
              const customerId = await IdentityEngine.resolveIdentity({
                tenantId,
                phoneNumber: lead.phone_number,
                email: lead.email || undefined,
                firstName: lead.patient_name || undefined,
                allPhones: allPhones.length > 0 ? allPhones : undefined,
                source: 'form'
              });
              if (customerId) {
                await IdentityEngine.linkLead(tenantId, lead.id, customerId);
              }
            } catch (idErr) {
              log.error('[BATCH_INGESTION_IDENTITY_ERROR] Non-fatal link error for lead ' + lead.id, idErr instanceof Error ? idErr : new Error(String(idErr)));
            }
          }
        }
      } catch (insertErr: any) {
        log.error('[BATCH_INSERT_ERROR]', insertErr instanceof Error ? insertErr : new Error(String(insertErr)));
        errors += chunk.length;
      }
    }

    // Parallel UPDATE chunks of 10
    const UPDATE_CHUNK_SIZE = 10;
    for (let u = 0; u < changedRows.length; u += UPDATE_CHUNK_SIZE) {
      if (Date.now() - startTime > timeBudgetMs) {
        log.warn('[BATCH_UPDATE_TIME_BUDGET] Stopping updates early');
        partial = true;
        break;
      }

      const chunk = changedRows.slice(u, u + UPDATE_CHUNK_SIZE);

      await Promise.all(chunk.map(async ({ row, leadId, existingRawData }) => {
        try {
          const fingerprint = computeRowFingerprint(tenantId, {
            phone: row.phone,
            name: row.name,
            email: row.email,
            formName: row.formName,
            notes: row.notes,
            createdTime: row.createdTime
          });

          // Merge raw_data safely preserving existing properties
          const mergedRaw = mergeRawData(existingRawData, row.rawData, fingerprint);

          const setClauses: string[] = [];
          const updateParams: any[] = [];
          let pIdx = 1;

          setClauses.push(`raw_data = $${pIdx}`);
          updateParams.push(mergedRaw);
          pIdx++;

          if (row.notes && row.notes.trim()) {
            setClauses.push(`notes = COALESCE(NULLIF(notes, ''), $${pIdx})`);
            updateParams.push(row.notes);
            pIdx++;
          }

          if (row.name && row.name.trim()) {
            setClauses.push(`patient_name = COALESCE(NULLIF(patient_name, ''), $${pIdx})`);
            updateParams.push(row.name);
            pIdx++;
          }

          if (row.formName) {
            setClauses.push(`form_name = $${pIdx}`);
            updateParams.push(row.formName);
            pIdx++;
          }

          if (row.stage === 'quarantine') {
            setClauses.push(`stage = $${pIdx}`);
            updateParams.push('quarantine');
            pIdx++;
          }

          updateParams.push(tenantId, leadId);

          await db.executeSafe({
            text: `UPDATE leads SET ${setClauses.join(', ')}
                   WHERE tenant_id = $${pIdx} AND id = $${pIdx + 1}`,
            values: updateParams
          });

          updated++;
        } catch (updateErr: any) {
          log.error('[BATCH_UPDATE_ERROR] Chunk update failure', updateErr instanceof Error ? updateErr : new Error(String(updateErr)));
          errors++;
        }
      }));
    }

    dbDurationMs = Date.now() - dbStart;

    const totalDurationMs = Date.now() - startTime;
    log.info('[BATCH_COMPLETED]', { created, updated, unchanged, duplicates, errors, partial, totalDurationMs, source });

    const message = partial
      ? `Kısmi sync: ${created} yeni, ${updated} güncellendi, ${unchanged} değişmeyen, ${duplicates} kopya (zaman/satır limiti)`
      : `${created} yeni kayıt eklendi. ${updated} güncellendi. ${unchanged} değişmeyen. ${duplicates} tekrar eden. Toplam ${totalRows} satır.`;

    return {
      success: true, totalRows, created, updated, unchanged, duplicates, errors,
      skippedUnknownTab,
      controlRequired,
      partial, message,
      telemetry: { authDurationMs, readDurationMs, parseDurationMs, dupDetectionDurationMs, dbDurationMs, totalDurationMs }
    };

  } catch (err: any) {
    log.error('[BATCH_FATAL_ERROR]', err instanceof Error ? err : new Error(String(err)));
    const totalDurationMs = Date.now() - startTime;
    return {
      success: false, totalRows, created, updated, unchanged, duplicates, errors: errors + 1,
      partial: false, message: 'Sync hatası: ' + (err?.message || 'Unknown'),
      errorDetails: err?.message,
      telemetry: { authDurationMs, readDurationMs, parseDurationMs, dupDetectionDurationMs, dbDurationMs, totalDurationMs }
    };
  }
}

// ═══════════════════════════════════════════════════════════
// HEALTH STATUS TRACKING
// Updates tenant_integrations with sync results.
// Called by webhook, manual sync, and cron sync paths.
// ═══════════════════════════════════════════════════════════

export async function updateSheetsHealthStatus(
  tenantId: string,
  status: 'healthy' | 'warning' | 'error',
  source: 'webhook' | 'cron_sync' | 'manual_sync',
  stats?: HealthStats
): Promise<void> {
  try {
    const db = withTenantDB(tenantId);

    const setClauses: string[] = [
      'health_status = $1',
      'last_sync_at = NOW()',
      'updated_at = NOW()',
    ];
    const values: any[] = [status];
    let idx = 2;

    if (status !== 'error') {
      setClauses.push('last_success_at = NOW()');
    }

    if (stats) {
      setClauses.push(`last_import_count = $${idx}`); values.push(stats.created); idx++;
      setClauses.push(`last_duplicate_count = $${idx}`); values.push(stats.duplicates); idx++;
    }

    if (status === 'error' && stats?.errorMessage) {
      setClauses.push('last_error_at = NOW()');
      setClauses.push(`last_error_message = $${idx}`); values.push(stats.errorMessage); idx++;
    }

    if (source === 'webhook') {
      setClauses.push('webhook_last_received_at = NOW()');
    } else if (source === 'cron_sync') {
      setClauses.push('cron_last_run_at = NOW()');
    }

    values.push(tenantId);

    await db.executeSafe({
      text: `UPDATE tenant_integrations SET ${setClauses.join(', ')}
             WHERE tenant_id = $${idx} AND provider = 'google_sheets'`,
      values
    });

    // Pipeline event logging
    await db.executeSafe({
      text: `INSERT INTO pipeline_events (tenant_id, event_type, payload, created_at)
             VALUES ($1, $2, $3, NOW())`,
      values: [
        tenantId,
        status === 'error' ? `${source}_failed` : `${source}_completed`,
        JSON.stringify({ source, status, ...stats })
      ]
    });
  } catch (e) {
    // Non-blocking — health tracking should never break the main flow
    log.error('[HEALTH_UPDATE_ERROR]', e instanceof Error ? e : new Error(String(e)));
  }
}
