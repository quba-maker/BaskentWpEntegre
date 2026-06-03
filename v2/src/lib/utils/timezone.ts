/**
 * PHASE 2J: Central Timezone Utility
 * 
 * All date/time display and resolution goes through this module.
 * DB stores UTC (timestamptz). Display converts to tenant/patient local time.
 * 
 * Design decisions:
 * - Tenant default: Europe/Istanbul (configurable per tenant in DB)
 * - Patient timezone: resolved from country field on opportunity
 * - Ambiguous countries (US, Russia, etc.): flagged for manual confirmation
 * - DST handled natively by Intl.DateTimeFormat
 */

// ═══════════════════════════════════════════════════════════
// CONSTANTS
// ═══════════════════════════════════════════════════════════

export const TENANT_DEFAULT_TZ = 'Europe/Istanbul';

// ═══════════════════════════════════════════════════════════
// COUNTRY → TIMEZONE MAP
// Medical tourism top countries — Turkish + English keys
// ═══════════════════════════════════════════════════════════

export const COUNTRY_TZ_MAP: Record<string, string> = {
  // Turkey
  'Türkiye': 'Europe/Istanbul', 'Turkey': 'Europe/Istanbul', 'TR': 'Europe/Istanbul',

  // Central Europe
  'Almanya': 'Europe/Berlin', 'Germany': 'Europe/Berlin', 'DE': 'Europe/Berlin',
  'Hollanda': 'Europe/Amsterdam', 'Netherlands': 'Europe/Amsterdam', 'NL': 'Europe/Amsterdam',
  'Fransa': 'Europe/Paris', 'France': 'Europe/Paris', 'FR': 'Europe/Paris',
  'Belçika': 'Europe/Brussels', 'Belgium': 'Europe/Brussels', 'BE': 'Europe/Brussels',
  'Avusturya': 'Europe/Vienna', 'Austria': 'Europe/Vienna', 'AT': 'Europe/Vienna',
  'İsviçre': 'Europe/Zurich', 'Switzerland': 'Europe/Zurich', 'CH': 'Europe/Zurich',

  // Northern Europe
  'İngiltere': 'Europe/London', 'UK': 'Europe/London', 'England': 'Europe/London',
  'United Kingdom': 'Europe/London', 'GB': 'Europe/London',
  'Danimarka': 'Europe/Copenhagen', 'Denmark': 'Europe/Copenhagen', 'DK': 'Europe/Copenhagen',
  'İsveç': 'Europe/Stockholm', 'Sweden': 'Europe/Stockholm', 'SE': 'Europe/Stockholm',
  'Norveç': 'Europe/Oslo', 'Norway': 'Europe/Oslo', 'NO': 'Europe/Oslo',
  'Finlandiya': 'Europe/Helsinki', 'Finland': 'Europe/Helsinki', 'FI': 'Europe/Helsinki',

  // Southern/Eastern Europe
  'İtalya': 'Europe/Rome', 'Italy': 'Europe/Rome', 'IT': 'Europe/Rome',
  'İspanya': 'Europe/Madrid', 'Spain': 'Europe/Madrid', 'ES': 'Europe/Madrid',
  'Yunanistan': 'Europe/Athens', 'Greece': 'Europe/Athens', 'GR': 'Europe/Athens',
  'Bulgaristan': 'Europe/Sofia', 'Bulgaria': 'Europe/Sofia', 'BG': 'Europe/Sofia',
  'Romanya': 'Europe/Bucharest', 'Romania': 'Europe/Bucharest', 'RO': 'Europe/Bucharest',
  'Polonya': 'Europe/Warsaw', 'Poland': 'Europe/Warsaw', 'PL': 'Europe/Warsaw',

  // Middle East
  'Irak': 'Asia/Baghdad', 'Iraq': 'Asia/Baghdad', 'IQ': 'Asia/Baghdad',
  'Suriye': 'Asia/Damascus', 'Syria': 'Asia/Damascus', 'SY': 'Asia/Damascus',
  'Libya': 'Africa/Tripoli', 'LY': 'Africa/Tripoli',
  'Suudi Arabistan': 'Asia/Riyadh', 'Saudi Arabia': 'Asia/Riyadh', 'SA': 'Asia/Riyadh',
  'BAE': 'Asia/Dubai', 'UAE': 'Asia/Dubai', 'AE': 'Asia/Dubai',
  'Katar': 'Asia/Qatar', 'Qatar': 'Asia/Qatar', 'QA': 'Asia/Qatar',
  'Kuveyt': 'Asia/Kuwait', 'Kuwait': 'Asia/Kuwait', 'KW': 'Asia/Kuwait',
  'Bahreyn': 'Asia/Bahrain', 'Bahrain': 'Asia/Bahrain', 'BH': 'Asia/Bahrain',
  'Ürdün': 'Asia/Amman', 'Jordan': 'Asia/Amman', 'JO': 'Asia/Amman',
  'Lübnan': 'Asia/Beirut', 'Lebanon': 'Asia/Beirut', 'LB': 'Asia/Beirut',
  'Filistin': 'Asia/Hebron', 'Palestine': 'Asia/Hebron', 'PS': 'Asia/Hebron',

  // Caucasus / Central Asia
  'Azerbaycan': 'Asia/Baku', 'Azerbaijan': 'Asia/Baku', 'AZ': 'Asia/Baku',
  'Gürcistan': 'Asia/Tbilisi', 'Georgia': 'Asia/Tbilisi', 'GE': 'Asia/Tbilisi',
  'Kazakistan': 'Asia/Almaty', 'Kazakhstan': 'Asia/Almaty', 'KZ': 'Asia/Almaty',
  'Özbekistan': 'Asia/Tashkent', 'Uzbekistan': 'Asia/Tashkent', 'UZ': 'Asia/Tashkent',
  'Türkmenistan': 'Asia/Ashgabat', 'Turkmenistan': 'Asia/Ashgabat', 'TM': 'Asia/Ashgabat',

  // Africa
  'Mısır': 'Africa/Cairo', 'Egypt': 'Africa/Cairo', 'EG': 'Africa/Cairo',
  'Tunus': 'Africa/Tunis', 'Tunisia': 'Africa/Tunis', 'TN': 'Africa/Tunis',
  'Cezayir': 'Africa/Algiers', 'Algeria': 'Africa/Algiers', 'DZ': 'Africa/Algiers',
  'Fas': 'Africa/Casablanca', 'Morocco': 'Africa/Casablanca', 'MA': 'Africa/Casablanca',
  'Somali': 'Africa/Mogadishu', 'Somalia': 'Africa/Mogadishu', 'SO': 'Africa/Mogadishu',
  'Sudan': 'Africa/Khartoum', 'SD': 'Africa/Khartoum',
  'Nijerya': 'Africa/Lagos', 'Nigeria': 'Africa/Lagos', 'NG': 'Africa/Lagos',

  // Multi-timezone countries — use capital/most-common timezone as default
  // These are flagged by isAmbiguousTimezoneCountry() for confirmation
  'ABD': 'America/New_York', 'USA': 'America/New_York', 'US': 'America/New_York',
  'Kanada': 'America/Toronto', 'Canada': 'America/Toronto', 'CA': 'America/Toronto',
  'Rusya': 'Europe/Moscow', 'Russia': 'Europe/Moscow', 'RU': 'Europe/Moscow',
  'Avustralya': 'Australia/Sydney', 'Australia': 'Australia/Sydney', 'AU': 'Australia/Sydney',
  'Brezilya': 'America/Sao_Paulo', 'Brazil': 'America/Sao_Paulo', 'BR': 'America/Sao_Paulo',
  'Hindistan': 'Asia/Kolkata', 'India': 'Asia/Kolkata', 'IN': 'Asia/Kolkata',
  'Çin': 'Asia/Shanghai', 'China': 'Asia/Shanghai', 'CN': 'Asia/Shanghai',
  'Endonezya': 'Asia/Jakarta', 'Indonesia': 'Asia/Jakarta', 'ID': 'Asia/Jakarta',
};

// ═══════════════════════════════════════════════════════════
// AMBIGUOUS TIMEZONE COUNTRIES
// Countries with multiple timezones — exact time cannot be
// determined from country alone. Bot should ask for city.
// ═══════════════════════════════════════════════════════════

const AMBIGUOUS_TZ_COUNTRIES = new Set([
  'ABD', 'USA', 'US', 'United States',
  'Kanada', 'Canada', 'CA',
  'Rusya', 'Russia', 'RU',
  'Avustralya', 'Australia', 'AU',
  'Brezilya', 'Brazil', 'BR',
  'Endonezya', 'Indonesia', 'ID',
  'Meksika', 'Mexico', 'MX',
]);

/**
 * Check if a country has multiple timezones, making exact
 * time resolution impossible without city/region info.
 */
export function isAmbiguousTimezoneCountry(country?: string | null): boolean {
  if (!country) return false;
  return AMBIGUOUS_TZ_COUNTRIES.has(country);
}

// ═══════════════════════════════════════════════════════════
// TIMEZONE RESOLUTION
// ═══════════════════════════════════════════════════════════

export interface TimezoneResolution {
  timezone: string;
  needs_confirmation: boolean;
  source: 'country_map' | 'tenant_default';
}

/**
 * Resolve patient timezone from country.
 * Returns timezone string + whether confirmation is needed.
 */
export function resolvePatientTimezone(country?: string | null): TimezoneResolution {
  if (!country) {
    return { timezone: TENANT_DEFAULT_TZ, needs_confirmation: false, source: 'tenant_default' };
  }

  const tz = COUNTRY_TZ_MAP[country];
  if (!tz) {
    return { timezone: TENANT_DEFAULT_TZ, needs_confirmation: false, source: 'tenant_default' };
  }

  return {
    timezone: tz,
    needs_confirmation: isAmbiguousTimezoneCountry(country),
    source: 'country_map',
  };
}

// ═══════════════════════════════════════════════════════════
// FORMATTING UTILITIES
// ═══════════════════════════════════════════════════════════

/**
 * Format a UTC date for display in a specific timezone.
 * Example: "26 May 2026, 14:30"
 */
export function formatForDisplay(
  utcDate: string | Date | null | undefined,
  tz: string = TENANT_DEFAULT_TZ
): string {
  if (!utcDate) return '';
  const d = typeof utcDate === 'string' ? new Date(utcDate) : utcDate;
  if (!(d instanceof Date) || isNaN(d.getTime())) return '';
  return d.toLocaleString('tr-TR', {
    timeZone: tz,
    day: 'numeric', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

/**
 * Format just the time portion. Example: "14:30"
 */
export function formatTimeTR(
  utcDate: string | Date | null | undefined,
  tz: string = TENANT_DEFAULT_TZ
): string {
  if (!utcDate) return '';
  const d = typeof utcDate === 'string' ? new Date(utcDate) : utcDate;
  if (!(d instanceof Date) || isNaN(d.getTime())) return '';
  return d.toLocaleTimeString('tr-TR', {
    timeZone: tz,
    hour: '2-digit', minute: '2-digit',
  });
}

/**
 * Format a relative time string in Turkish.
 * Example: "5 dk önce", "2 saat sonra", "Yarın 14:00"
 */
export function formatRelativeTR(
  utcDate: string | Date | null | undefined,
  tz: string = TENANT_DEFAULT_TZ
): string {
  if (!utcDate) return '';
  const d = typeof utcDate === 'string' ? new Date(utcDate) : utcDate;
  if (!(d instanceof Date) || isNaN(d.getTime())) return '';

  const diff = Math.round((Date.now() - d.getTime()) / 1000);

  // Future dates
  if (diff < 0) {
    const abs = Math.abs(diff);
    if (abs < 60) return 'Birkaç saniye sonra';
    if (abs < 3600) return `${Math.floor(abs / 60)} dk sonra`;
    if (abs < 86400) return `${Math.floor(abs / 3600)} saat sonra`;
    if (abs < 172800) {
      const time = formatTimeTR(d, tz);
      return `Yarın ${time}`;
    }
    return formatForDisplay(d, tz);
  }

  // Past dates
  if (diff < 60) return 'Az önce';
  if (diff < 3600) return `${Math.floor(diff / 60)} dk önce`;
  if (diff < 86400) return `${Math.floor(diff / 3600)} saat önce`;
  return `${Math.floor(diff / 86400)} gün önce`;
}

// ═══════════════════════════════════════════════════════════
// DUAL-CLOCK DISPLAY
// For coordinator call scheduling — shows both clocks
// ═══════════════════════════════════════════════════════════

const COUNTRY_SHORT_LABELS: Record<string, string> = {
  'Almanya': 'DE', 'Germany': 'DE', 'DE': 'DE',
  'Hollanda': 'NL', 'Netherlands': 'NL', 'NL': 'NL',
  'İngiltere': 'UK', 'UK': 'UK', 'GB': 'UK',
  'Fransa': 'FR', 'France': 'FR', 'FR': 'FR',
  'Irak': 'IQ', 'Iraq': 'IQ', 'IQ': 'IQ',
  'Suudi Arabistan': 'SA', 'Saudi Arabia': 'SA', 'SA': 'SA',
  'BAE': 'AE', 'UAE': 'AE', 'AE': 'AE',
  'ABD': 'US', 'USA': 'US', 'US': 'US',
  'Rusya': 'RU', 'Russia': 'RU', 'RU': 'RU',
  'Avustralya': 'AU', 'Australia': 'AU', 'AU': 'AU',
  'Kanada': 'CA', 'Canada': 'CA', 'CA': 'CA',
  'Azerbaycan': 'AZ', 'Azerbaijan': 'AZ', 'AZ': 'AZ',
  'Gürcistan': 'GE', 'Georgia': 'GE', 'GE': 'GE',
  'Suriye': 'SY', 'Syria': 'SY', 'SY': 'SY',
  'Mısır': 'EG', 'Egypt': 'EG', 'EG': 'EG',
  'Libya': 'LY', 'LY': 'LY',
};

function getShortTzLabel(country?: string | null): string {
  if (!country) return '';
  return COUNTRY_SHORT_LABELS[country] || country.substring(0, 2).toUpperCase();
}

export interface DualClockResult {
  tenantTime: string;       // "14:00"
  patientTime: string | null; // "12:00" or null if same tz
  combined: string;         // "14:00 TR / 12:00 DE" or "14:00"
  needsConfirmation: boolean; // true for ambiguous tz countries
}

/**
 * Dual-clock display for coordinator scheduling.
 * Shows tenant time and patient local time side by side.
 * 
 * Example:
 *   formatDualClock('2026-05-27T11:00:00Z', 'Almanya')
 *   → { tenantTime: '14:00', patientTime: '13:00', combined: '14:00 TR / 13:00 DE' }
 */
export function formatDualClock(
  utcDate: string | Date | null | undefined,
  patientCountry?: string | null,
  tenantTz: string = TENANT_DEFAULT_TZ
): DualClockResult {
  if (!utcDate) {
    return { tenantTime: '', patientTime: null, combined: '', needsConfirmation: false };
  }
  const d = typeof utcDate === 'string' ? new Date(utcDate) : utcDate;
  if (!(d instanceof Date) || isNaN(d.getTime())) {
    return { tenantTime: '', patientTime: null, combined: '', needsConfirmation: false };
  }

  const tenantTime = formatTimeTR(d, tenantTz);
  const resolution = resolvePatientTimezone(patientCountry);

  // Same timezone — no dual display needed
  if (resolution.timezone === tenantTz) {
    return {
      tenantTime,
      patientTime: null,
      combined: tenantTime,
      needsConfirmation: false,
    };
  }

  const patientTime = formatTimeTR(d, resolution.timezone);
  const tzLabel = getShortTzLabel(patientCountry);

  return {
    tenantTime,
    patientTime,
    combined: `${tenantTime} TR / ${patientTime} ${tzLabel}`,
    needsConfirmation: resolution.needs_confirmation,
  };
}

// ═══════════════════════════════════════════════════════════
// TIME CHECKS
// ═══════════════════════════════════════════════════════════

/**
 * Check if a date is in the past (overdue).
 */
export function isOverdue(utcDate: string | Date | null | undefined): boolean {
  if (!utcDate) return false;
  const d = typeof utcDate === 'string' ? new Date(utcDate) : utcDate;
  return d instanceof Date && !isNaN(d.getTime()) && d.getTime() < Date.now();
}

/**
 * Check if a date is within N hours from now (upcoming).
 */
export function isWithinHours(utcDate: string | Date | null | undefined, hours: number): boolean {
  if (!utcDate) return false;
  const d = typeof utcDate === 'string' ? new Date(utcDate) : utcDate;
  if (!(d instanceof Date) || isNaN(d.getTime())) return false;
  const diff = d.getTime() - Date.now();
  return diff > 0 && diff <= hours * 3600 * 1000;
}

/**
 * Check if a date is today in the given timezone.
 */
export function isToday(utcDate: string | Date | null | undefined, tz: string = TENANT_DEFAULT_TZ): boolean {
  if (!utcDate) return false;
  const d = typeof utcDate === 'string' ? new Date(utcDate) : utcDate;
  if (!(d instanceof Date) || isNaN(d.getTime())) return false;
  const now = new Date();
  const dateStr = d.toLocaleDateString('en-CA', { timeZone: tz }); // YYYY-MM-DD
  const todayStr = now.toLocaleDateString('en-CA', { timeZone: tz });
  return dateStr === todayStr;
}

// ═══════════════════════════════════════════════════════════
// BOT PROMPT TIME CONTEXT
// Injected into system prompt so bot knows current time
// ═══════════════════════════════════════════════════════════

/**
 * Build time context string for bot prompt injection.
 * 
 * Rules for the bot:
 * - If patient country/timezone is known → interpret times in patient's local time
 * - Convert to Turkey time internally for scheduling
 * - If timezone is ambiguous (US, Russia etc.) → ask patient for city
 * - Never say just "yarın" or "Salı" — always give full date
 */
export function buildTimeContext(
  tenantTz: string = TENANT_DEFAULT_TZ,
  patientCountry?: string | null,
  isHealthcare: boolean = false,
  operatingHours: { start: string; end: string } | null = null
): string {
  const now = new Date();
  const formatted = now.toLocaleString('tr-TR', {
    timeZone: tenantTz,
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });

  const opStart = operatingHours?.start || '09:00';
  const opEnd = operatingHours?.end || '21:00';

  const subject = isHealthcare ? 'hasta' : 'müşteri';
  const subjectGen = isHealthcare ? 'hastanın' : 'müşterinin';
  const subjectDat = isHealthcare ? 'hastaya' : 'müşteriye';
  const subjectCapital = isHealthcare ? 'Hasta' : 'Müşteri';
  const subjectGenCapital = isHealthcare ? 'Hastanın' : 'Müşterinin';

  let tzRules = '';
  let opRules = '';
  let comfortRules = '';

  if (isHealthcare || operatingHours) {
    opRules = `
OPERASYON SAATİ SINIRI (Türkiye Saati):
- Koordinatörlerin çalışma saatleri Türkiye saatiyle ${opStart} - ${opEnd} arasındadır.
- KURAL: Bu aralık dışındaki saatler için (örn: Türkiye saatiyle 23:00) arama/görüşme randevusu ONAYLAMA VEYA ÖNERME.
- Eğer ${subject} operasyon saati dışında bir zaman önerirse: "Bu saat Türkiye saatiyle çalışma saatlerimizin (${opStart}-${opEnd}) dışında kalıyor. Size uygun Türkiye saatiyle ${opStart} ile ${opEnd} arasında başka bir saat belirleyebilir miyiz?" şeklinde alternatif iste.`;
  }

  if (patientCountry) {
    const resolution = resolvePatientTimezone(patientCountry);

    comfortRules = `
${subjectCapital.toUpperCase()} YEREL SAATİ UYGUNLUK SINIRI:
- ${subjectGenCapital} yerel saatinde çok geç gece veya çok erken saatlerden (yerel saatle 22:00 sonrasından 08:00 öncesine kadar) kaçın.
- Mümkünse ${subjectGen} yerel saatine göre 08:00 - 22:00 aralığında kalın.
- Türkiye operasyon saati (${opStart} - ${opEnd}) ile ${subjectGen} yerel makul saati (08:00 - 22:00) arasındaki ortak kesişen saat dilimlerini tercih edin ve önerin.`;

    if (resolution.needs_confirmation) {
      // Ambiguous timezone country — bot must ask for city ONLY IF SCHEDULING
      tzRules = `
${subjectCapital} ülkesi: ${patientCountry} (birden fazla saat dilimi olan ülke).
KURAL: EĞER ${subject} aranmak için belirli bir saat söylerse VEYA telefon görüşmesi randevusu planlanıyorsa, önce saat dilimini/şehrini sor: "${patientCountry === 'ABD' || patientCountry === 'USA' || patientCountry === 'US' || patientCountry.includes('Amerika') ? 'Amerika’da' : patientCountry + '’da'} bulunduğunuz şehir veya eyaleti paylaşabilir misiniz? Saat farkını doğru hesaplayıp size uygun arama saatini netleştirelim."
DİKKAT: ${subjectCapital} sadece fiyat, tedavi bilgisi veya genel bilgi soruyorsa, arama saati konusu geçmiyorsa DURDUK YERE şehir/eyalet sorma, muhabbeti bölme. Şehir bilgisi sadece arama planlanırken gereklidir.`;
    } else if (resolution.timezone !== tenantTz) {
      // Known timezone, different from tenant
      const patientNow = now.toLocaleString('tr-TR', {
        timeZone: resolution.timezone,
        hour: '2-digit',
        minute: '2-digit',
      });
      tzRules = `
${subjectCapital} ülkesi: ${patientCountry} (saat dilimi: ${resolution.timezone}).
${subjectCapital} şu an yerel saat: ${patientNow}.
KURAL: ${subjectCapital} bir saat söylediğinde bunu ${subjectCapital.toUpperCase()} YEREL SAATİ olarak yorumla.
İç sistemde Türkiye saatine çevirip kaydet. ${subjectDat.charAt(0).toUpperCase() + subjectDat.slice(1)} her zaman kendi yerel saatini söyle.`;
    }
  }

  const hostOrCompanyTimeLabel = isHealthcare ? 'TÜRKİYE / HASTANE SAATİ' : 'TÜRKİYE / FİRMA SAATİ';
  const hostOrCompanyTimePhrases = isHealthcare 
    ? '"sizin saate göre", "Türkiye saatiyle", "hastane saatine göre", "Konya saatine göre", "sizin oranın saatine göre"'
    : '"sizin saate göre", "Türkiye saatiyle", "firma saatine göre", "sizin oranın saatine göre"';

  const interpretationRules = `
SAAT İFADELERİNİN YORUMLANMASI:
1. ${subjectCapital.toUpperCase()} YEREL SAATİ ("bana/bize göre"): ${subjectCapital} "bize göre olsun", "bizim saate göre", "buradaki saate göre", "benim saatime göre", "buradaki saatle", "local time" veya benzeri bir ifade kullanırsa bunu ${subjectGenCapital.toUpperCase()} KENDİ YEREL SAATİ olarak yorumla.
   - Eğer ${subjectGen} ülkesi/şehri biliniyorsa, bu saati ${subjectGen} yerel saati olarak kabul edip Türkiye saatine çevirerek iç sistem için belirt.
   - Eğer ${subject} timezone-belirsiz bir ülkede (ABD, Kanada, Rusya vb.) ise ve şehir belirtmediyse, SADECE aranma/görüşme saati planlanıyorsa şehir/eyalet sor.
2. ${hostOrCompanyTimeLabel} ("sizin saate göre"): ${subjectCapital} ${hostOrCompanyTimePhrases} derse bunu TÜRKİYE SAATİ olarak yorumla. Kesin saati doğrudan Türkiye saatiyle teyit et.`;

  return `\n\n=== ZAMAN BAĞLAMI ===
Şu anki tarih ve saat (Türkiye): ${formatted}
${tzRules}
${opRules}
${comfortRules}
${interpretationRules}
GENEL KURALLAR:
- "Yarın", "bugün", "pazartesi" gibi göreceli ifadeleri doğru yorumla.
- ${subjectDat.charAt(0).toUpperCase() + subjectDat.slice(1)} cevap verirken TAM TARİH kullan: "27 Mayıs 2026 Çarşamba, saat 14:00" gibi.
- Sadece "yarın" veya "Salı" deme, her zaman tarihi de belirt.
- Saat söylerken 24 saat formatı kullan.
- Emin değilsen kesin tarih/saat söylemekten kaçın, onay iste.
====================`;
}

export interface TimeMetadata {
  callback_time_tr: string;
  patient_local_time: string | null;
  patient_timezone: string | null;
  timezone_source: 'patient_city' | 'country' | 'manual_confirmed' | 'unknown';
  time_confirmed_by_patient: boolean;
  needs_timezone_clarification: boolean;
  operation_window_valid: boolean;
  scheduled_for_utc: string;
}

/**
 * Computes all callback timezone/operating hours metadata for task/opportunity persistence.
 */
export function computeTimeMetadata(
  requestedCallbackDatetime?: string | null,
  patientCountry?: string | null,
  patientCity?: string | null,
  llmExtracted?: {
    needs_timezone_clarification?: boolean;
    timezone_source?: 'patient_city' | 'country' | 'manual_confirmed' | 'unknown';
    time_confirmed_by_patient?: boolean;
    patient_timezone?: string;
  },
  operatingHours?: { start: string; end: string } | null
): TimeMetadata | null {
  if (!requestedCallbackDatetime) return null;

  const date = new Date(requestedCallbackDatetime);
  if (isNaN(date.getTime())) return null;

  const scheduled_for_utc = date.toISOString();

  // callback_time_tr: e.g., "17:00" Turkey time (Europe/Istanbul)
  const callback_time_tr = date.toLocaleTimeString('tr-TR', {
    timeZone: 'Europe/Istanbul',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  });

  // Default operating hours: 09:00 - 21:00 (TR time)
  const opStart = operatingHours?.start || '09:00';
  const opEnd = operatingHours?.end || '21:00';

  const trHour = parseInt(callback_time_tr.split(':')[0], 10);
  const trMinute = parseInt(callback_time_tr.split(':')[1], 10);
  const trMinutesTotal = trHour * 60 + trMinute;

  const [startHour, startMin] = opStart.split(':').map(Number);
  const startMinutesTotal = startHour * 60 + (startMin || 0);

  const [endHour, endMin] = opEnd.split(':').map(Number);
  const endMinutesTotal = endHour * 60 + (endMin || 0);

  const operation_window_valid = trMinutesTotal >= startMinutesTotal && trMinutesTotal <= endMinutesTotal;

  // Resolve timezone
  let timezone: string | null = null;
  let source: 'patient_city' | 'country' | 'manual_confirmed' | 'unknown' = 'unknown';
  let needs_timezone_clarification = false;

  // 1. If IANA timezone was manually confirmed or extracted by LLM
  if (llmExtracted?.patient_timezone) {
    try {
      Intl.DateTimeFormat(undefined, { timeZone: llmExtracted.patient_timezone });
      timezone = llmExtracted.patient_timezone;
      source = llmExtracted.timezone_source || 'manual_confirmed';
      
      // PREVENT POLLUTION: Reject timezone if it explicitly mismatches the resolved country
      if (patientCountry && !isTimezoneValidForCountry(timezone, patientCountry)) {
        timezone = null;
        source = 'unknown';
        needs_timezone_clarification = true;
      }
    } catch {
      // invalid timezone name from LLM, fallback
    }
  }

  // 2. From country resolution (fallback/check if ambiguous)
  const countryRes = resolvePatientTimezone(patientCountry);

  if (!timezone) {
    timezone = countryRes.timezone;
    source = 'country';
  }

  if (countryRes.needs_confirmation) {
    // Ambiguous country (e.g. USA, Canada, Russia)
    if (patientCity && patientCity.trim()) {
      source = 'patient_city';
    } else {
      needs_timezone_clarification = true;
      source = 'unknown';
    }
  }

  if (llmExtracted?.needs_timezone_clarification !== undefined) {
    needs_timezone_clarification = llmExtracted.needs_timezone_clarification;
    if (needs_timezone_clarification) {
      source = 'unknown';
    }
  }

  // Calculate patient local time if timezone is resolved and not unknown
  let patient_local_time: string | null = null;
  if (timezone && source !== 'unknown' && !needs_timezone_clarification) {
    patient_local_time = date.toLocaleTimeString('tr-TR', {
      timeZone: timezone,
      hour: '2-digit',
      minute: '2-digit',
      hour12: false
    });
  }

  return {
    callback_time_tr,
    patient_local_time,
    patient_timezone: timezone,
    timezone_source: source,
    time_confirmed_by_patient: llmExtracted?.time_confirmed_by_patient ?? false,
    needs_timezone_clarification,
    operation_window_valid,
    scheduled_for_utc,
  };
}

/**
 * Parse a date and time string in Turkey local time (+03:00) to a UTC ISO string.
 * This is browser-timezone independent.
 * 
 * @param dateStr Format: "YYYY-MM-DD"
 * @param timeStr Format: "HH:MM" or "HH:MM:SS"
 */
export function parseTurkeyLocalToUtc(dateStr: string, timeStr: string): string {
  if (!dateStr || !timeStr) {
    throw new Error('Date and time strings are required');
  }
  const cleanDate = dateStr.trim();
  let cleanTime = timeStr.trim();
  if (cleanTime.length === 5) {
    cleanTime = `${cleanTime}:00`;
  }
  const isoWithOffset = `${cleanDate}T${cleanTime}+03:00`;
  const date = new Date(isoWithOffset);
  if (isNaN(date.getTime())) {
    throw new Error(`Invalid date/time combination: ${isoWithOffset}`);
  }
  return date.toISOString();
}

export interface AdjustToOperatingHoursResult {
  adjustedUtc: string;
  adjusted: boolean;
  originalUtc: string;
}

/**
 * Automatically shift UTC dates falling outside the 09:00 - 21:00 Turkey time window
 * to the nearest valid operational window (09:00 TRT).
 */
export function adjustToOperatingHours(utcDateString: string): AdjustToOperatingHoursResult {
  const d = new Date(utcDateString);
  if (isNaN(d.getTime())) {
    throw new Error(`Invalid UTC date: ${utcDateString}`);
  }

  const originalUtc = d.toISOString();
  // Get Turkey local date by shifting by +3 hours
  const trTime = d.getTime() + 3 * 60 * 60 * 1000;
  const trDate = new Date(trTime);

  const trHour = trDate.getUTCHours();
  const trMinute = trDate.getUTCMinutes();
  const trTotalMinutes = trHour * 60 + trMinute;

  const startMinutes = 9 * 60; // 09:00
  const endMinutes = 21 * 60;  // 21:00

  if (trTotalMinutes >= startMinutes && trTotalMinutes <= endMinutes) {
    return {
      adjustedUtc: originalUtc,
      adjusted: false,
      originalUtc,
    };
  }

  // Outside operating hours. Need to adjust.
  // If TR hour is < 9 (or total minutes < 09:00) -> shift to 09:00 on the same TR day
  if (trTotalMinutes < startMinutes) {
    trDate.setUTCHours(9, 0, 0, 0);
  } else {
    // If TR hour is > 21 (or total minutes > 21:00) -> shift to 09:00 on the next TR day
    trDate.setUTCDate(trDate.getUTCDate() + 1);
    trDate.setUTCHours(9, 0, 0, 0);
  }

  // Convert back to UTC by shifting by -3 hours
  const adjustedUtc = new Date(trDate.getTime() - 3 * 60 * 60 * 1000).toISOString();

  return {
    adjustedUtc,
    adjusted: true,
    originalUtc,
  };
}

// ═══════════════════════════════════════════════════════════
// UNIVERSAL TIMEZONE DISPLAY RESOLVER
// ═══════════════════════════════════════════════════════════

export interface PatientTimeDisplayInput {
  country?: string | null;
  city?: string | null;
  timezone?: string | null;
  timezoneSource?: string | null;
  phoneNumber?: string | null;
  metadata?: any | null;
  oppMetadata?: any | null;
  convMetadata?: any | null;
  referenceDate?: Date | string | null;
}

export interface PatientTimeDisplayResult {
  residenceCountryLabel: string;
  residenceCountrySource: 'manual_confirmed' | 'form' | 'crm' | 'metadata' | 'unknown';
  phoneCountryLabel: string | null;
  phoneCountrySource: 'phone_prefix' | null;
  patientTimezone: string | null;
  timezoneSource: 'patient_city' | 'patient_country' | 'manual_confirmed' | 'patient_state' | 'unknown';
  isCountryFromPhone: boolean;
  isTimezoneTrusted: boolean;
  sourceMismatch: boolean;
  patientLocalTime: string | null;
  turkeyTime: string;
  displayLabel: string;
  shortBadge: string;
  offsetLabel: string | null;
  needsTimezoneClarification: boolean;
  isFallback: boolean;
  warning?: 'timezone_ambiguous' | 'country_has_multiple_timezones' | 'fallback_turkey_time' | 'country_timezone_source_mismatch';
}

const NORMALIZE_COUNTRY_MAP: Record<string, { label: string; emoji: string }> = {
  'türkiye': { label: 'Türkiye', emoji: '🇹🇷' },
  'turkey': { label: 'Türkiye', emoji: '🇹🇷' },
  'tr': { label: 'Türkiye', emoji: '🇹🇷' },
  'almanya': { label: 'Almanya', emoji: '🇩🇪' },
  'germany': { label: 'Almanya', emoji: '🇩🇪' },
  'de': { label: 'Almanya', emoji: '🇩🇪' },
  'hollanda': { label: 'Hollanda', emoji: '🇳🇱' },
  'netherlands': { label: 'Hollanda', emoji: '🇳🇱' },
  'nl': { label: 'Hollanda', emoji: '🇳🇱' },
  'fransa': { label: 'Fransa', emoji: '🇫🇷' },
  'france': { label: 'Fransa', emoji: '🇫🇷' },
  'fr': { label: 'Fransa', emoji: '🇫🇷' },
  'belçika': { label: 'Belçika', emoji: '🇧🇪' },
  'belgium': { label: 'Belçika', emoji: '🇧🇪' },
  'be': { label: 'Belçika', emoji: '🇧🇪' },
  'avusturya': { label: 'Avusturya', emoji: '🇦🇹' },
  'austria': { label: 'Avusturya', emoji: '🇦🇹' },
  'at': { label: 'Avusturya', emoji: '🇦🇹' },
  'isviçre': { label: 'İsviçre', emoji: '🇨🇭' },
  'switzerland': { label: 'İsviçre', emoji: '🇨🇭' },
  'ch': { label: 'İsviçre', emoji: '🇨🇭' },
  'ingiltere': { label: 'İngiltere', emoji: '🇬🇧' },
  'uk': { label: 'İngiltere', emoji: '🇬🇧' },
  'england': { label: 'İngiltere', emoji: '🇬🇧' },
  'united kingdom': { label: 'İngiltere', emoji: '🇬🇧' },
  'gb': { label: 'İngiltere', emoji: '🇬🇧' },
  'danimarka': { label: 'Danimarka', emoji: '🇩🇰' },
  'denmark': { label: 'Danimarka', emoji: '🇩🇰' },
  'dk': { label: 'Danimarka', emoji: '🇩🇰' },
  'isveç': { label: 'İsveç', emoji: '🇸🇪' },
  'sweden': { label: 'İsveç', emoji: '🇸🇪' },
  'se': { label: 'İsveç', emoji: '🇸🇪' },
  'norveç': { label: 'Norveç', emoji: '🇳🇴' },
  'norway': { label: 'Norveç', emoji: '🇳🇴' },
  'no': { label: 'Norveç', emoji: '🇳🇴' },
  'finlandiya': { label: 'Finlandiya', emoji: '🇫🇮' },
  'finland': { label: 'Finlandiya', emoji: '🇫🇮' },
  'fi': { label: 'Finlandiya', emoji: '🇫🇮' },
  'italya': { label: 'İtalya', emoji: '🇮🇹' },
  'italy': { label: 'İtalya', emoji: '🇮🇹' },
  'it': { label: 'İtalya', emoji: '🇮🇹' },
  'ispanya': { label: 'İspanya', emoji: '🇪🇸' },
  'spain': { label: 'İspanya', emoji: '🇪🇸' },
  'es': { label: 'İspanya', emoji: '🇪🇸' },
  'yunanistan': { label: 'Yunanistan', emoji: '🇬🇷' },
  'greece': { label: 'Yunanistan', emoji: '🇬🇷' },
  'gr': { label: 'Yunanistan', emoji: '🇬🇷' },
  'bulgaristan': { label: 'Bulgaristan', emoji: '🇧🇬' },
  'bulgaria': { label: 'Bulgaristan', emoji: '🇧🇬' },
  'bg': { label: 'Bulgaristan', emoji: '🇧🇬' },
  'romanya': { label: 'Romanya', emoji: '🇷🇴' },
  'romania': { label: 'Romanya', emoji: '🇷🇴' },
  'ro': { label: 'Romanya', emoji: '🇷🇴' },
  'polonya': { label: 'Polonya', emoji: '🇵🇱' },
  'poland': { label: 'Polonya', emoji: '🇵🇱' },
  'pl': { label: 'Polonya', emoji: '🇵🇱' },
  'irak': { label: 'Irak', emoji: '🇮🇶' },
  'iraq': { label: 'Irak', emoji: '🇮🇶' },
  'iq': { label: 'Irak', emoji: '🇮🇶' },
  'suriye': { label: 'Suriye', emoji: '🇸🇾' },
  'syria': { label: 'Suriye', emoji: '🇸🇾' },
  'sy': { label: 'Suriye', emoji: '🇸🇾' },
  'libya': { label: 'Libya', emoji: '🇱🇾' },
  'ly': { label: 'Libya', emoji: '🇱🇾' },
  'suudi arabistan': { label: 'Suudi Arabistan', emoji: '🇸🇦' },
  'saudi arabia': { label: 'Suudi Arabistan', emoji: '🇸🇦' },
  'sa': { label: 'Suudi Arabistan', emoji: '🇸🇦' },
  'bae': { label: 'BAE', emoji: '🇦🇪' },
  'uae': { label: 'BAE', emoji: '🇦🇪' },
  'ae': { label: 'BAE', emoji: '🇦🇪' },
  'katar': { label: 'Katar', emoji: '🇶🇦' },
  'qatar': { label: 'Katar', emoji: '🇶🇦' },
  'qa': { label: 'Katar', emoji: '🇶🇦' },
  'kuveyt': { label: 'Kuveyt', emoji: '🇰🇼' },
  'kuwait': { label: 'Kuveyt', emoji: '🇰🇼' },
  'kw': { label: 'Kuveyt', emoji: '🇰🇼' },
  'bahreyn': { label: 'Bahreyn', emoji: '🇧🇭' },
  'bahrain': { label: 'Bahreyn', emoji: '🇧🇭' },
  'bh': { label: 'Bahreyn', emoji: '🇧🇭' },
  'ürdün': { label: 'Ürdün', emoji: '🇯🇴' },
  'jordan': { label: 'Ürdün', emoji: '🇯🇴' },
  'jo': { label: 'Ürdün', emoji: '🇯🇴' },
  'lübnan': { label: 'Lübnan', emoji: '🇱🇧' },
  'lebanon': { label: 'Lübnan', emoji: '🇱🇧' },
  'lb': { label: 'Lübnan', emoji: '🇱🇧' },
  'filistin': { label: 'Filistin', emoji: '🇵🇸' },
  'palestine': { label: 'Filistin', emoji: '🇵🇸' },
  'ps': { label: 'Filistin', emoji: '🇵🇸' },
  'azerbaycan': { label: 'Azerbaycan', emoji: '🇦🇿' },
  'azerbaijan': { label: 'Azerbaycan', emoji: '🇦🇿' },
  'az': { label: 'Azerbaycan', emoji: '🇦🇿' },
  'gürcistan': { label: 'Gürcistan', emoji: '🇬🇪' },
  'georgia': { label: 'Gürcistan', emoji: '🇬🇪' },
  'ge': { label: 'Gürcistan', emoji: '🇬🇪' },
  'kazakistan': { label: 'Kazakistan', emoji: '🇰🇿' },
  'kazakhstan': { label: 'Kazakistan', emoji: '🇰🇿' },
  'kz': { label: 'Kazakistan', emoji: '🇰🇿' },
  'özbekistan': { label: 'Özbekistan', emoji: '🇺🇿' },
  'uzbekistan': { label: 'Özbekistan', emoji: '🇺🇿' },
  'uz': { label: 'Özbekistan', emoji: '🇺🇿' },
  'türkmenistan': { label: 'Türkmenistan', emoji: '🇹🇲' },
  'turkmenistan': { label: 'Türkmenistan', emoji: '🇹🇲' },
  'tm': { label: 'Türkmenistan', emoji: '🇹🇲' },
  'mısır': { label: 'Mısır', emoji: '🇪🇬' },
  'egypt': { label: 'Mısır', emoji: '🇪🇬' },
  'eg': { label: 'Mısır', emoji: '🇪🇬' },
  'tunus': { label: 'Tunus', emoji: '🇹🇳' },
  'tunisia': { label: 'Tunus', emoji: '🇹🇳' },
  'tn': { label: 'Tunus', emoji: '🇹🇳' },
  'cezayir': { label: 'Cezayir', emoji: '🇩🇿' },
  'algeria': { label: 'Cezayir', emoji: '🇩🇿' },
  'dz': { label: 'Cezayir', emoji: '🇩🇿' },
  'fas': { label: 'Fas', emoji: '🇲🇦' },
  'morocco': { label: 'Fas', emoji: '🇲🇦' },
  'ma': { label: 'Fas', emoji: '🇲🇦' },
  'somali': { label: 'Somali', emoji: '🇸🇴' },
  'somalia': { label: 'Somali', emoji: '🇸🇴' },
  'so': { label: 'Somali', emoji: '🇸🇴' },
  'sudan': { label: 'Sudan', emoji: '🇸🇩' },
  'sd': { label: 'Sudan', emoji: '🇸🇩' },
  'nijerya': { label: 'Nijerya', emoji: '🇳🇬' },
  'nigeria': { label: 'Nijerya', emoji: '🇳🇬' },
  'ng': { label: 'Nijerya', emoji: '🇳🇬' },
  
  // USA normalizations
  'abd': { label: 'ABD', emoji: '🌎' },
  'usa': { label: 'ABD', emoji: '🌎' },
  'us': { label: 'ABD', emoji: '🌎' },
  'america': { label: 'ABD', emoji: '🌎' },
  'amerika': { label: 'ABD', emoji: '🌎' },
  'united states': { label: 'ABD', emoji: '🌎' },
  'amerika birleşik devletleri': { label: 'ABD', emoji: '🌎' },

  // Canada normalizations
  'kanada': { label: 'Kanada', emoji: '🇨🇦' },
  'canada': { label: 'Kanada', emoji: '🇨🇦' },
  'ca': { label: 'Kanada', emoji: '🇨🇦' },

  // Russia normalizations
  'rusya': { label: 'Rusya', emoji: '🇷🇺' },
  'russia': { label: 'Rusya', emoji: '🇷🇺' },
  'ru': { label: 'Rusya', emoji: '🇷🇺' },

  // Australia normalizations
  'avustralya': { label: 'Avustralya', emoji: '🇦🇺' },
  'australia': { label: 'Avustralya', emoji: '🇦🇺' },
  'au': { label: 'Avustralya', emoji: '🇦🇺' },

  // Brazil normalizations
  'brezilya': { label: 'Brezilya', emoji: '🇧🇷' },
  'brazil': { label: 'Brezilya', emoji: '🇧🇷' },
  'br': { label: 'Brezilya', emoji: '🇧🇷' },

  // Mexico normalizations
  'meksika': { label: 'Meksika', emoji: '🇲🇽' },
  'mexico': { label: 'Meksika', emoji: '🇲🇽' },
  'mx': { label: 'Meksika', emoji: '🇲🇽' },

  // Indonesia normalizations
  'endonezya': { label: 'Endonezya', emoji: '🇮🇩' },
  'indonesia': { label: 'Endonezya', emoji: '🇮🇩' },
  'id': { label: 'Endonezya', emoji: '🇮🇩' },
};

const MULTI_TZ_COUNTRIES = new Set([
  'abd', 'usa', 'us', 'united states', 'america', 'amerika', 'amerika birleşik devletleri',
  'kanada', 'canada', 'ca',
  'rusya', 'russia', 'ru',
  'avustralya', 'australia', 'au',
  'brezilya', 'brazil', 'br',
  'endonezya', 'indonesia', 'id',
  'meksika', 'mexico', 'mx',
  'kazakistan', 'kazakhstan', 'kz'
]);

function cleanTzCityLabel(tzString?: string | null): string {
  if (!tzString) return '';
  const parts = tzString.split('/');
  return parts[parts.length - 1].replace(/_/g, ' ');
}


export function getPhoneCountryPrefix(phoneNumber?: string | null): string | null {
  if (!phoneNumber) return null;
  let cleaned = phoneNumber.replace(/\D/g, '');
  if (cleaned.startsWith('0')) cleaned = cleaned.substring(1);
  if (cleaned.startsWith('90')) return 'Türkiye';
  if (cleaned.startsWith('49')) return 'Almanya';
  if (cleaned.startsWith('44')) return 'İngiltere';
  if (cleaned.startsWith('33')) return 'Fransa';
  if (cleaned.startsWith('31')) return 'Hollanda';
  if (cleaned.startsWith('32')) return 'Belçika';
  if (cleaned.startsWith('998')) return 'Özbekistan';
  if (cleaned.startsWith('994')) return 'Azerbaycan';
  if (cleaned.startsWith('7')) return 'Rusya';
  if (cleaned.startsWith('1')) return 'ABD';
  return null;
}

function isTimezoneValidForCountry(tz: string | null, countryKey: string | null): boolean {
  if (!tz || !countryKey) return true;
  const key = countryKey.toLowerCase().trim();
  let normalizedKey = key;
  // Fallback map definition locally for validation check just in case
  if (key === 'abd' || key === 'amerika' || key === 'usa') normalizedKey = 'abd';
  if (key === 'türkiye' || key === 'turkey' || key === 'tr') normalizedKey = 'türkiye';
  if (key === 'ingiltere' || key === 'uk' || key === 'england') normalizedKey = 'ingiltere';
  
  if (normalizedKey === 'türkiye' && tz !== 'Europe/Istanbul') return false;
  if (normalizedKey === 'abd' && !tz.startsWith('America/') && !tz.startsWith('Pacific/') && tz !== 'Pacific/Honolulu') return false;
  if (normalizedKey === 'ingiltere' && tz !== 'Europe/London') return false;
  
  return true;
}

export function resolvePatientTimeDisplay(input: PatientTimeDisplayInput): PatientTimeDisplayResult {
  const refDate = input.referenceDate 
    ? (typeof input.referenceDate === 'string' ? new Date(input.referenceDate) : input.referenceDate) 
    : new Date();
  
  const now = isNaN(refDate.getTime()) ? new Date() : refDate;

  const metadata = input.metadata || {};
  const oppMetadata = input.oppMetadata || {};
  const convMetadata = input.convMetadata || {};

  // 1. Resolve Country
  // NOTE: deterministicCountry (phone_country) is NO LONGER used as a fallback for residence.
  let rawCountry = input.country || metadata.patient_country || oppMetadata.patient_country || convMetadata.patient_country || null;
  let rawCity = input.city || metadata.patient_city || oppMetadata.patient_city || convMetadata.patient_city || null;
  let resolvedTz = input.timezone || metadata.patient_timezone || oppMetadata.patient_timezone || convMetadata.patient_timezone || null;
  let tzSource = input.timezoneSource || metadata.timezone_source || oppMetadata.timezone_source || convMetadata.timezone_source || null;

  // Derive phone country separate from residence country
  const phoneCountryLabel = getPhoneCountryPrefix(input.phoneNumber);

  let residenceCountryLabel = 'Bilinmeyen Ülke';
  let countryEmoji = '🌎';
  let isMultiTz = false;
  let residenceCountrySource: PatientTimeDisplayResult['residenceCountrySource'] = 'unknown';

  if (rawCountry) {
    residenceCountrySource = input.country ? 'crm' : 'metadata';
    const cleanCountry = rawCountry.trim();
    const key = cleanCountry.toLowerCase();
    
    const norm = NORMALIZE_COUNTRY_MAP[key];
    if (norm) {
      residenceCountryLabel = norm.label;
      countryEmoji = norm.emoji;
    } else {
      residenceCountryLabel = cleanCountry;
      countryEmoji = '🌎';
    }

    if (MULTI_TZ_COUNTRIES.has(key)) {
      isMultiTz = true;
    }
  }

  const cityLabel = rawCity && rawCity.trim() ? rawCity.trim() : null;

  // 2. Resolve Timezone
  if (!resolvedTz && rawCountry) {
    const tzRes = resolvePatientTimezone(rawCountry);
    if (tzRes.source === 'country_map') {
      resolvedTz = tzRes.timezone;
      if (!tzSource || tzSource === 'unknown') {
        tzSource = 'patient_country';
      }
    }
  }

  let finalSource: PatientTimeDisplayResult['timezoneSource'] = 'unknown';
  if (tzSource) {
    if (['patient_city', 'city'].includes(tzSource)) finalSource = 'patient_city';
    else if (['patient_state', 'state'].includes(tzSource)) finalSource = 'patient_state';
    else if (['patient_country', 'country', 'inferred_country'].includes(tzSource)) finalSource = 'patient_country';
    else if (['manual_confirmed', 'manual'].includes(tzSource)) finalSource = 'manual_confirmed';
  } else if (cityLabel) {
    finalSource = 'patient_city';
  } else if (resolvedTz) {
    finalSource = 'patient_country';
  }

  let needsTimezoneClarification = false;
  let warning: PatientTimeDisplayResult['warning'] = undefined;
  let sourceMismatch = false;

  const metadataClarification = metadata.needs_timezone_clarification ?? oppMetadata.needs_timezone_clarification ?? convMetadata.needs_timezone_clarification;
  const isConfidenceHigh = metadata.timezone_confidence === 'high' || oppMetadata.timezone_confidence === 'high' || convMetadata.timezone_confidence === 'high';
  const isTrustedTzSource = finalSource === 'patient_city' || finalSource === 'patient_state' || finalSource === 'manual_confirmed' || isConfidenceHigh;

  // Detect Country/Timezone Source Mismatch (The Murtaza Bug)
  if (resolvedTz && residenceCountryLabel !== 'Bilinmeyen Ülke') {
    if (!isTimezoneValidForCountry(resolvedTz, residenceCountryLabel)) {
      sourceMismatch = true;
      needsTimezoneClarification = true;
      warning = 'country_timezone_source_mismatch';
    }
  }

  if (!sourceMismatch) {
    if (metadataClarification === true) {
      needsTimezoneClarification = true;
      warning = 'timezone_ambiguous';
    } else if (isMultiTz) {
      if (!resolvedTz || !isTrustedTzSource) {
        needsTimezoneClarification = true;
        warning = 'country_has_multiple_timezones';
      }
    }
  }

  let isFallback = false;
  if (!resolvedTz && !needsTimezoneClarification) {
    resolvedTz = 'Europe/Istanbul';
    finalSource = 'unknown';
    isFallback = true;
    warning = 'fallback_turkey_time';
  }

  const turkeyTime = now.toLocaleTimeString('tr-TR', {
    timeZone: 'Europe/Istanbul',
    hour: '2-digit', minute: '2-digit', hour12: false
  });

  let patientLocalTime: string | null = null;
  let offsetLabel: string | null = null;

  if (resolvedTz && !needsTimezoneClarification) {
    try {
      patientLocalTime = now.toLocaleTimeString('tr-TR', {
        timeZone: resolvedTz,
        hour: '2-digit', minute: '2-digit', hour12: false
      });
      const formatObj = new Intl.DateTimeFormat('en-US', { timeZone: resolvedTz, timeZoneName: 'shortOffset' });
      const parts = formatObj.formatToParts(now);
      const tzPart = parts.find(p => p.type === 'timeZoneName')?.value || '';
      offsetLabel = tzPart === 'GMT' ? 'GMT+0' : tzPart;
    } catch {
      needsTimezoneClarification = true;
      warning = 'timezone_ambiguous';
    }
  }

  let displayLabel = '';
  let shortBadge = '';

  if (needsTimezoneClarification) {
    if (sourceMismatch || residenceCountryLabel === 'Bilinmeyen Ülke' || residenceCountryLabel === 'Türkiye') {
      displayLabel = 'Konum/saat net değil';
      shortBadge = 'Konum/saat net değil';
    } else {
      displayLabel = `${countryEmoji} ${residenceCountryLabel} • Şehir gerekli`;
      shortBadge = 'Şehir gerekli';
    }
  } else if (isFallback) {
    displayLabel = `TR: ${turkeyTime} / Hasta saati net değil`;
    shortBadge = 'Saat net değil';
  } else {
    if (resolvedTz === 'Europe/Istanbul') {
      displayLabel = `🇹🇷 Türkiye • ${turkeyTime} (GMT+3)`;
      shortBadge = turkeyTime;
      offsetLabel = 'GMT+3';
    } else {
      const location = cityLabel || cleanTzCityLabel(resolvedTz) || residenceCountryLabel;
      displayLabel = `${patientLocalTime} ${location} / ${turkeyTime} TR`;
      shortBadge = patientLocalTime || '';
    }
  }

  return {
    residenceCountryLabel,
    residenceCountrySource,
    phoneCountryLabel,
    phoneCountrySource: phoneCountryLabel ? 'phone_prefix' : null,
    patientTimezone: (needsTimezoneClarification || isFallback) ? null : resolvedTz,
    timezoneSource: finalSource,
    isCountryFromPhone: false,
    isTimezoneTrusted: isTrustedTzSource,
    sourceMismatch,
    patientLocalTime: (needsTimezoneClarification || isFallback) ? null : patientLocalTime,
    turkeyTime,
    displayLabel,
    shortBadge,
    offsetLabel: (needsTimezoneClarification || isFallback) ? null : offsetLabel,
    needsTimezoneClarification,
    isFallback,
    warning
  };
}

/**
 * Extract Turkey local time parts (year, month, day, hour, minute) from any Date or UTC string.
 * Helps initialize edit forms without browser timezone offset pollution.
 */
export function getTurkeyParts(dateInput: Date | string | null | undefined) {
  if (!dateInput) {
    return { year: '', month: '', day: '', hour: '', minute: '' };
  }
  const d = typeof dateInput === 'string' ? new Date(dateInput) : dateInput;
  if (isNaN(d.getTime())) {
    return { year: '', month: '', day: '', hour: '', minute: '' };
  }
  
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Europe/Istanbul',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  });
  
  const parts = formatter.formatToParts(d);
  const year = parts.find(p => p.type === 'year')?.value || '';
  const month = parts.find(p => p.type === 'month')?.value || '';
  const day = parts.find(p => p.type === 'day')?.value || '';
  const hour = parts.find(p => p.type === 'hour')?.value || '';
  const minute = parts.find(p => p.type === 'minute')?.value || '';
  
  return { year, month, day, hour, minute };
}

