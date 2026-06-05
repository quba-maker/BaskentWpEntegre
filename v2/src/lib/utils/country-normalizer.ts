import { getCountryFromPhone } from './country';

export interface CountryNormalization {
  country: string | null;
  countrySource: 'form' | 'patient_statement' | 'phone_prefix' | 'ai_extracted' | 'unknown';
  countryConfidence: 'high' | 'medium' | 'low';
  countryConfirmationNeeded: boolean;
}

const COUNTRY_MAPPINGS: Record<string, { country: string; confidence: 'high' | 'medium'; confirmationNeeded: boolean }> = {
  'tc': { country: 'Türkiye', confidence: 'high', confirmationNeeded: false },
  'tr': { country: 'Türkiye', confidence: 'high', confirmationNeeded: false },
  'turkey': { country: 'Türkiye', confidence: 'high', confirmationNeeded: false },
  'türkiye': { country: 'Türkiye', confidence: 'high', confirmationNeeded: false },
  'turkiye': { country: 'Türkiye', confidence: 'high', confirmationNeeded: false },
  'tc d': { country: 'Türkiye', confidence: 'medium', confirmationNeeded: true },
  'tcd': { country: 'Türkiye', confidence: 'medium', confirmationNeeded: true },
  'fransa': { country: 'Fransa', confidence: 'high', confirmationNeeded: false },
  'france': { country: 'Fransa', confidence: 'high', confirmationNeeded: false },
  'almanya': { country: 'Almanya', confidence: 'high', confirmationNeeded: false },
  'deutschland': { country: 'Almanya', confidence: 'high', confirmationNeeded: false },
  'germany': { country: 'Almanya', confidence: 'high', confirmationNeeded: false },
  'kazakistan': { country: 'Kazakistan', confidence: 'high', confirmationNeeded: false },
  'kazakhstan': { country: 'Kazakistan', confidence: 'high', confirmationNeeded: false },
  'kırgızistan': { country: 'Kırgızistan', confidence: 'high', confirmationNeeded: false },
  'kirgizistan': { country: 'Kırgızistan', confidence: 'high', confirmationNeeded: false },
  'kyrgyzstan': { country: 'Kırgızistan', confidence: 'high', confirmationNeeded: false },
  'ingiltere': { country: 'İngiltere', confidence: 'high', confirmationNeeded: false },
  'england': { country: 'İngiltere', confidence: 'high', confirmationNeeded: false },
  'united kingdom': { country: 'İngiltere', confidence: 'high', confirmationNeeded: false },
  'uk': { country: 'İngiltere', confidence: 'high', confirmationNeeded: false },
  'hollanda': { country: 'Hollanda', confidence: 'high', confirmationNeeded: false },
  'netherlands': { country: 'Hollanda', confidence: 'high', confirmationNeeded: false },
  'belçika': { country: 'Belçika', confidence: 'high', confirmationNeeded: false },
  'belgium': { country: 'Belçika', confidence: 'high', confirmationNeeded: false },
  'isviçre': { country: 'İsviçre', confidence: 'high', confirmationNeeded: false },
  'switzerland': { country: 'İsviçre', confidence: 'high', confirmationNeeded: false },
  'avusturya': { country: 'Avusturya', confidence: 'high', confirmationNeeded: false },
  'austria': { country: 'Avusturya', confidence: 'high', confirmationNeeded: false }
};

export function normalizeCountry(
  rawCountry: string | null | undefined,
  phone?: string | null,
  source: CountryNormalization['countrySource'] = 'unknown'
): CountryNormalization {
  const result: CountryNormalization = {
    country: null,
    countrySource: source,
    countryConfidence: 'low',
    countryConfirmationNeeded: false
  };

  const cleanRaw = String(rawCountry || '').trim().toLowerCase();

  // Try parsing raw string against explicit mappings
  if (cleanRaw && COUNTRY_MAPPINGS[cleanRaw]) {
    const match = COUNTRY_MAPPINGS[cleanRaw];
    result.country = match.country;
    result.countryConfidence = match.confidence;
    result.countryConfirmationNeeded = match.confirmationNeeded;
    return result;
  }

  // Look for substring matches
  if (cleanRaw) {
    for (const [key, mapping] of Object.entries(COUNTRY_MAPPINGS)) {
      if (cleanRaw.includes(key) && key.length > 2) {
        result.country = mapping.country;
        result.countryConfidence = mapping.confidence;
        result.countryConfirmationNeeded = mapping.confirmationNeeded;
        return result;
      }
    }
  }

  // Check phone prefix fallback if the country raw is still empty
  if (phone) {
    const phoneCountryInfo = getCountryFromPhone(phone);
    if (phoneCountryInfo) {
      result.country = phoneCountryInfo.name;
      result.countrySource = 'phone_prefix';
      result.countryConfidence = 'medium';
      result.countryConfirmationNeeded = true; // Suffix/Prefix matches deserve check
      return result;
    }
  }

  if (rawCountry) {
    // If not matching, but has a value, return low confidence
    result.country = rawCountry.trim();
    result.countryConfidence = 'low';
    result.countryConfirmationNeeded = true;
  } else {
    result.country = null;
    result.countryConfidence = 'low';
    result.countryConfirmationNeeded = false;
  }

  return result;
}

export interface PatientCountryContext {
  manualCountry?: string | null;
  oppCountry?: string | null;
  convCountry?: string | null;
  formCountry?: string | null;
  phoneFallback?: string | null;
  patientStatementCountry?: string | null;
  aiExtractedCountry?: string | null;
  metadata?: any;
}

export interface CountryResolution {
  country: string | null;
  displayCountry: string;
  countrySource: 'manual' | 'patient_confirmed' | 'form' | 'patient_statement' | 'phone_prefix' | 'ai_extracted' | 'unknown';
  countryConfidence: 'high' | 'medium' | 'low';
  countryConfirmationNeeded: boolean;
  conflict?: {
    sources: Array<{ source: string; value: string }>;
  };
}

/**
 * Resolves country using a structured priority chain and performs multi-source conflict checking
 */
export function resolvePatientCountryDetailed(ctx?: PatientCountryContext | null): CountryResolution {
  const fallbackRes: CountryResolution = {
    country: null,
    displayCountry: 'Ülke net değil',
    countrySource: 'unknown',
    countryConfidence: 'low',
    countryConfirmationNeeded: false
  };

  if (ctx?.phoneFallback) {
    const fromPhone = getCountryFromPhone(ctx.phoneFallback);
    if (fromPhone) {
      fallbackRes.country = fromPhone.name;
      fallbackRes.displayCountry = `${fromPhone.name}?`;
      fallbackRes.countrySource = 'phone_prefix';
      fallbackRes.countryConfirmationNeeded = true;
    }
  }

  if (!ctx) return fallbackRes;

  // 1. Collect all raw source inputs to detect conflicts
  const sourcesList: Array<{ source: string; value: string }> = [];
  if (ctx.formCountry) {
    const norm = normalizeCountry(ctx.formCountry, ctx.phoneFallback, 'form').country;
    if (norm) sourcesList.push({ source: 'Form', value: norm });
  }
  if (ctx.phoneFallback) {
    const fromPhone = getCountryFromPhone(ctx.phoneFallback)?.name;
    if (fromPhone) sourcesList.push({ source: 'Telefon Prefix', value: fromPhone });
  }
  if (ctx.patientStatementCountry) {
    const norm = normalizeCountry(ctx.patientStatementCountry, ctx.phoneFallback, 'patient_statement').country;
    if (norm) sourcesList.push({ source: 'Hasta Mesajı', value: norm });
  }
  
  // Scoped AI extraction fields
  const rawAiVal = ctx.aiExtractedCountry || ctx.oppCountry || ctx.convCountry;
  // If manual lock is active, ignore AI/Form conflict detection on manual values
  const isLocked = ctx.metadata?.country_locked === true;

  if (rawAiVal && !isLocked) {
    const norm = normalizeCountry(rawAiVal, ctx.phoneFallback, 'ai_extracted').country;
    if (norm) sourcesList.push({ source: 'AI / Sistem', value: norm });
  }

  // Conflict Checking Heuristic
  const activeNormalizedCountries = sourcesList.map(s => s.value);
  const uniqueCountries = Array.from(new Set(activeNormalizedCountries));
  const hasConflict = uniqueCountries.length > 1;

  // 2. Priority Resolution
  // 2-A. Manual locked country
  if (isLocked && ctx.manualCountry) {
    const norm = normalizeCountry(ctx.manualCountry, ctx.phoneFallback).country;
    if (norm) {
      return {
        country: norm,
        displayCountry: norm,
        countrySource: 'manual',
        countryConfidence: 'high',
        countryConfirmationNeeded: false
      };
    }
  }
  
  // If manualCountry is set even without explicit metadata lock, trust it
  if (ctx.manualCountry) {
    const norm = normalizeCountry(ctx.manualCountry, ctx.phoneFallback).country;
    if (norm) {
      return {
        country: norm,
        displayCountry: norm,
        countrySource: 'manual',
        countryConfidence: 'high',
        countryConfirmationNeeded: false
      };
    }
  }

  // 2-B. Form Country
  if (ctx.formCountry) {
    const norm = normalizeCountry(ctx.formCountry, ctx.phoneFallback, 'form');
    if (norm.country) {
      return {
        country: norm.country,
        displayCountry: norm.countryConfirmationNeeded ? `${norm.country} (Teyit Gerekli)` : norm.country,
        countrySource: 'form',
        countryConfidence: hasConflict ? 'low' : norm.countryConfidence,
        countryConfirmationNeeded: norm.countryConfirmationNeeded || hasConflict,
        conflict: hasConflict ? { sources: sourcesList } : undefined
      };
    }
  }

  // 2-C. Patient Statement
  if (ctx.patientStatementCountry) {
    const norm = normalizeCountry(ctx.patientStatementCountry, ctx.phoneFallback, 'patient_statement');
    if (norm.country) {
      return {
        country: norm.country,
        displayCountry: norm.countryConfirmationNeeded ? `${norm.country} (Teyit Gerekli)` : norm.country,
        countrySource: 'patient_statement',
        countryConfidence: hasConflict ? 'low' : norm.countryConfidence,
        countryConfirmationNeeded: norm.countryConfirmationNeeded || hasConflict,
        conflict: hasConflict ? { sources: sourcesList } : undefined
      };
    }
  }

  // 2-D. Phone prefix
  if (ctx.phoneFallback) {
    const fromPhone = getCountryFromPhone(ctx.phoneFallback);
    if (fromPhone) {
      return {
        country: fromPhone.name,
        displayCountry: `${fromPhone.name}?`,
        countrySource: 'phone_prefix',
        countryConfidence: hasConflict ? 'low' : 'medium',
        countryConfirmationNeeded: true,
        conflict: hasConflict ? { sources: sourcesList } : undefined
      };
    }
  }

  // 2-E. AI Extracted (not locked)
  if (rawAiVal) {
    const norm = normalizeCountry(rawAiVal, ctx.phoneFallback, 'ai_extracted');
    if (norm.country) {
      return {
        country: norm.country,
        displayCountry: norm.countryConfirmationNeeded ? `${norm.country} (Teyit Gerekli)` : norm.country,
        countrySource: 'ai_extracted',
        countryConfidence: hasConflict ? 'low' : norm.countryConfidence,
        countryConfirmationNeeded: norm.countryConfirmationNeeded || hasConflict,
        conflict: hasConflict ? { sources: sourcesList } : undefined
      };
    }
  }

  return fallbackRes;
}

/**
 * Normalizes country field for UI rendering safely.
 * Replaces messy database text values (like "tc d") with clean display strings.
 */
export function getCountryDisplayLabel(
  countryName: string | null | undefined,
  phone?: string | null
): { display: string; needsConfirmation: boolean } {
  const detailed = resolvePatientCountryDetailed({
    manualCountry: countryName,
    phoneFallback: phone
  });

  return {
    display: detailed.displayCountry,
    needsConfirmation: detailed.countryConfirmationNeeded
  };
}
