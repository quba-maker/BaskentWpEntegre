import { withTenantDB } from '@/lib/core/tenant-db';
import { logger } from '@/lib/core/logger';
import { CredentialsService } from '@/lib/services/credentials.service';

const log = logger.withContext({ module: 'SheetsIngestion' });

// ═══════════════════════════════════════════════════════════
// FIELD DETECTION PRIORITY TABLES
// ═══════════════════════════════════════════════════════════

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

function parseDate(dateStr: string | null | undefined): Date {
  if (!dateStr) return new Date();
  const parts = dateStr.match(/(\d+)/g);
  if (parts && parts.length >= 3) {
    const p0 = parseInt(parts[0]);
    const p1 = parseInt(parts[1]) - 1;
    const p2 = parseInt(parts[2]);
    let y = p2, m = p1, d = p0;
    if (p0 > 31) { y = p0; d = p2; }
    if (y < 100) y += 2000;
    const hr = parts.length > 3 ? parseInt(parts[3]) : 0;
    const min = parts.length > 4 ? parseInt(parts[4]) : 0;
    const sec = parts.length > 5 ? parseInt(parts[5]) : 0;
    const parsed = new Date(y, m, d, hr, min, sec);
    if (!isNaN(parsed.getTime())) return parsed;
  }
  const standard = new Date(dateStr);
  if (!isNaN(standard.getTime())) return standard;
  return new Date();
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
    let phone1 = normalizePhone(lowercaseData[primaryPhoneKey]);
    let phone2 = secondaryPhoneKey ? normalizePhone(lowercaseData[secondaryPhoneKey]) : '';

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
    const country = countryKey ? String(lowercaseData[countryKey]) : null;
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
    // Skip in batch sync mode — identity linking happens via webhook/conversation events
    if (!skipAutoMessage) {
      try {
        const { IdentityEngine } = await import('@/lib/services/ai/engines/identity');
        const customerId = await IdentityEngine.resolveIdentity({
          tenantId, phoneNumber: phone1, email: email || undefined, firstName: name || undefined
        });
        if (leadId) {
          await IdentityEngine.linkLead(tenantId, leadId, customerId);
        }
      } catch (idErr) {
        log.error('[INGEST_IDENTITY] Non-fatal identity link error', idErr instanceof Error ? idErr : new Error(String(idErr)));
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
        const greeting = name ? (isTurkish ? `Merhaba ${name}!` : `Hello ${name}!`) : (isTurkish ? 'Merhaba!' : 'Hello!');
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
