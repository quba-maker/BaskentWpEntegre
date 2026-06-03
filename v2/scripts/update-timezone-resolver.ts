import fs from 'fs';

const tzPath = '/Users/mustafa/Desktop/baskent-wp-entegre/v2/src/lib/utils/timezone.ts';
let tzCode = fs.readFileSync(tzPath, 'utf8');

// Replace PatientTimeDisplayInput and PatientTimeDisplayResult
const interfacesNew = `
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
`;

const interfaceRegex = /export interface PatientTimeDisplayInput \{[\s\S]*?warning\?: 'timezone_ambiguous' \| 'country_has_multiple_timezones' \| 'fallback_turkey_time';\n\}/;
tzCode = tzCode.replace(interfaceRegex, interfacesNew.trim());

// Insert getPhoneCountryPrefix before resolvePatientTimeDisplay
const getPhoneFn = `
export function getPhoneCountryPrefix(phoneNumber?: string | null): string | null {
  if (!phoneNumber) return null;
  let cleaned = phoneNumber.replace(/\\D/g, '');
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

export function resolvePatientTimeDisplay`;

tzCode = tzCode.replace('export function resolvePatientTimeDisplay', getPhoneFn);

const resolveFnOld = /export function resolvePatientTimeDisplay\(input: PatientTimeDisplayInput\): PatientTimeDisplayResult \{[\s\S]*?return \{\n[\s\S]*?warning\n  \};\n\}/;

const resolveFnNew = `export function resolvePatientTimeDisplay(input: PatientTimeDisplayInput): PatientTimeDisplayResult {
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
    const label = residenceCountryLabel !== 'Bilinmeyen Ülke' ? residenceCountryLabel : 'Bilinmeyen Ülke';
    displayLabel = \`\${countryEmoji} \${label} • Konum/saat net değil\`;
    shortBadge = sourceMismatch ? 'Konum net değil' : 'Şehir gerekli';
  } else if (isFallback) {
    displayLabel = \`TR: \${turkeyTime} / Hasta saati net değil\`;
    shortBadge = 'Saat net değil';
  } else {
    if (resolvedTz === 'Europe/Istanbul') {
      displayLabel = \`🇹🇷 Türkiye • \${turkeyTime} (GMT+3)\`;
      shortBadge = turkeyTime;
      offsetLabel = 'GMT+3';
    } else {
      const location = cityLabel || cleanTzCityLabel(resolvedTz) || residenceCountryLabel;
      displayLabel = \`\${patientLocalTime} \${location} / \${turkeyTime} TR\`;
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
}`;

tzCode = tzCode.replace(resolveFnOld, resolveFnNew);

fs.writeFileSync(tzPath, tzCode);
console.log('Updated timezone.ts');
