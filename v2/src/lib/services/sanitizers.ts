/**
 * PHASE 2K-P1.1: Centralized Sanitizers
 * 
 * Null-safe string handling and human-readable date formatting.
 * Used by SignalAggregator, TaskService, TelegramService, and NotificationBell.
 */

// ═══════════════════════════════════════════════════════════
// STRING SANITIZERS
// ═══════════════════════════════════════════════════════════

/**
 * Cleans dirty string values from LLM output.
 * LLM sometimes returns literal "null", "undefined", or empty strings.
 */
export function cleanString(val: string | null | undefined): string | undefined {
  if (val === null || val === undefined) return undefined;
  if (typeof val !== 'string') return undefined;
  const trimmed = val.trim();
  if (trimmed === '' || trimmed === 'null' || trimmed === 'undefined' || trimmed === 'N/A') {
    return undefined;
  }
  return trimmed;
}

/**
 * Returns a safe patient name — never "null", never empty.
 */
export function safeName(name: string | null | undefined, fallbackPhone?: string): string {
  const clean = cleanString(name);
  if (clean) {
    try {
      const { isValidPatientName } = require('../utils/patient-name-resolver');
      if (isValidPatientName(clean)) return clean;
    } catch (_) {
      return clean;
    }
  }
  if (fallbackPhone) {
    // Mask phone for display: 905321234506 → +90 *** 45 06
    const digits = fallbackPhone.replace(/\D/g, '');
    if (digits.length >= 6) {
      const last4 = digits.slice(-4);
      return `+${digits.slice(0, 2)} ***${last4.slice(0, 2)} ${last4.slice(2)}`;
    }
    return fallbackPhone;
  }
  return 'Bilinmeyen Hasta';
}

// ═══════════════════════════════════════════════════════════
// DATE FORMATTERS
// ═══════════════════════════════════════════════════════════

const TR_MONTHS = [
  'Ocak', 'Şubat', 'Mart', 'Nisan', 'Mayıs', 'Haziran',
  'Temmuz', 'Ağustos', 'Eylül', 'Ekim', 'Kasım', 'Aralık'
];

const TR_DAYS = [
  'Pazar', 'Pazartesi', 'Salı', 'Çarşamba', 'Perşembe', 'Cuma', 'Cumartesi'
];

/**
 * Formats an ISO date string into a human-readable Turkish format.
 * "2026-05-27T13:00:00+03:00" → "27 Mayıs Çarşamba 13:00 — Türkiye saati"
 * 
 * Returns null-safe fallback if input is invalid.
 */
export function formatHumanDate(isoDate: string | null | undefined): string {
  const cleaned = cleanString(isoDate);
  if (!cleaned) return 'Zaman teyidi gerekiyor';

  const d = new Date(cleaned);
  if (isNaN(d.getTime())) return 'Geçersiz tarih';

  // Format in Turkey timezone
  const trOptions: Intl.DateTimeFormatOptions = {
    timeZone: 'Europe/Istanbul',
    day: 'numeric',
    month: 'numeric',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    weekday: 'long',
  };

  try {
    // Use Intl for reliable timezone conversion
    const parts = new Intl.DateTimeFormat('tr-TR', trOptions).formatToParts(d);
    const get = (type: string) => parts.find(p => p.type === type)?.value || '';
    
    const day = get('day');
    const monthNum = parseInt(get('month')) - 1;
    const month = TR_MONTHS[monthNum] || get('month');
    const weekday = get('weekday');
    const hour = get('hour');
    const minute = get('minute');

    // Capitalize weekday first letter
    const weekdayCapitalized = weekday.charAt(0).toUpperCase() + weekday.slice(1);

    return `${day} ${month} ${weekdayCapitalized} ${hour}:${minute} — Türkiye saati`;
  } catch {
    // Fallback
    return d.toLocaleString('tr-TR', { timeZone: 'Europe/Istanbul' });
  }
}

/**
 * Formats a dual-clock display for international patients.
 * Returns { patientTime, turkeyTime } or null if no valid date.
 */
export function formatDualClock(
  isoDate: string | null | undefined,
  patientCountry?: string | null
): { patientTime: string; turkeyTime: string } | null {
  const cleaned = cleanString(isoDate);
  if (!cleaned) return null;

  const d = new Date(cleaned);
  if (isNaN(d.getTime())) return null;

  const turkeyTime = formatHumanDate(cleaned);

  // Map country to timezone
  const tzMap: Record<string, { tz: string; label: string }> = {
    'Almanya': { tz: 'Europe/Berlin', label: 'Almanya saati' },
    'İngiltere': { tz: 'Europe/London', label: 'İngiltere saati' },
    'Fransa': { tz: 'Europe/Paris', label: 'Fransa saati' },
    'Hollanda': { tz: 'Europe/Amsterdam', label: 'Hollanda saati' },
    'Belçika': { tz: 'Europe/Brussels', label: 'Belçika saati' },
    'Rusya': { tz: 'Europe/Moscow', label: 'Rusya saati' },
    'ABD': { tz: 'America/New_York', label: 'ABD Doğu saati' },
    'Azerbaycan': { tz: 'Asia/Baku', label: 'Azerbaycan saati' },
    'Özbekistan': { tz: 'Asia/Tashkent', label: 'Özbekistan saati' },
  };

  const countryClean = cleanString(patientCountry);
  if (!countryClean || countryClean === 'Türkiye') {
    return { patientTime: turkeyTime, turkeyTime };
  }

  const tzInfo = tzMap[countryClean];
  if (!tzInfo) {
    return { patientTime: turkeyTime, turkeyTime };
  }

  try {
    const parts = new Intl.DateTimeFormat('tr-TR', {
      timeZone: tzInfo.tz,
      day: 'numeric', month: 'numeric', hour: '2-digit', minute: '2-digit',
    }).formatToParts(d);
    const get = (type: string) => parts.find(p => p.type === type)?.value || '';
    const day = get('day');
    const monthNum = parseInt(get('month')) - 1;
    const month = TR_MONTHS[monthNum] || get('month');
    const hour = get('hour');
    const minute = get('minute');

    const patientTime = `${day} ${month} ${hour}:${minute} — ${tzInfo.label}`;
    return { patientTime, turkeyTime };
  } catch {
    return { patientTime: turkeyTime, turkeyTime };
  }
}
