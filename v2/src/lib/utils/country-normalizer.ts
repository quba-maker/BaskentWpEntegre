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

/**
 * Normalizes country field for UI rendering safely.
 * Replaces messy database text values (like "tc d") with clean display strings.
 */
export function getCountryDisplayLabel(
  countryName: string | null | undefined,
  phone?: string | null
): { display: string; needsConfirmation: boolean } {
  if (!countryName || !countryName.trim()) {
    if (phone) {
      const fromPhone = getCountryFromPhone(phone);
      if (fromPhone) {
        return { display: `${fromPhone.name}?`, needsConfirmation: true };
      }
    }
    return { display: 'Ülke net değil', needsConfirmation: false };
  }

  const norm = normalizeCountry(countryName, phone);
  if (!norm.country) {
    return { display: 'Ülke net değil', needsConfirmation: false };
  }

  if (norm.countryConfirmationNeeded) {
    return { display: `${norm.country} (Teyit Gerekli)`, needsConfirmation: true };
  }

  return { display: norm.country, needsConfirmation: false };
}
