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
  patientCountry?: string | null
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

  let tzRules = '';

  if (patientCountry) {
    const resolution = resolvePatientTimezone(patientCountry);

    if (resolution.needs_confirmation) {
      // Ambiguous timezone country — bot must ask for city
      tzRules = `
Hasta ülkesi: ${patientCountry} (birden fazla saat dilimi olan ülke).
KURAL: Hasta belirli bir saat söylerse (örn: "Salı 15:00") ASLA kesin kabul etme.
Önce hastanın şehrini veya saat dilimini sor: "Hangi şehirdesiniz? Saati doğru kaydetmek istiyoruz."
Şehir bilgisi alınana kadar "tahmini saat" olarak not al, kesinleştirme.`;
    } else if (resolution.timezone !== tenantTz) {
      // Known timezone, different from tenant
      const patientNow = now.toLocaleString('tr-TR', {
        timeZone: resolution.timezone,
        hour: '2-digit',
        minute: '2-digit',
      });
      tzRules = `
Hasta ülkesi: ${patientCountry} (saat dilimi: ${resolution.timezone}).
Hasta şu an yerel saat: ${patientNow}.
KURAL: Hasta bir saat söylediğinde (örn: "15:00'te arayın") bunu HASTANIN YEREL SAATİ olarak yorumla.
İç sistemde Türkiye saatine çevirip kaydet. Hastaya her zaman kendi yerel saatini söyle.`;
    }
  }

  return `\n\n=== ZAMAN BAĞLAMI ===
Şu anki tarih ve saat (Türkiye): ${formatted}
${tzRules}
GENEL KURALLAR:
- "Yarın", "bugün", "pazartesi" gibi göreceli ifadeleri doğru yorumla.
- Hastaya cevap verirken TAM TARİH kullan: "27 Mayıs 2026 Çarşamba, saat 14:00" gibi.
- Sadece "yarın" veya "Salı" deme, her zaman tarihi de belirt.
- Saat söylerken 24 saat formatı kullan.
====================`;
}
