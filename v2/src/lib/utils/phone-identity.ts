export interface NormalizedPhoneIdentity {
  e164: string | null;
  digits: string;
  countryHint?: string;
  nationalSuffix?: string;
  confidence: 'high' | 'medium' | 'low';
  raw: string;
}

/**
 * Resolves Turkish/English country names or ISO codes to numeric prefixes.
 */
export function resolveCountryPrefix(hint?: string): string | null {
  if (!hint) return null;
  const lower = hint.toLowerCase().trim();

  const mapping: Record<string, string> = {
    'türkiye': '90', 'turkey': '90', 'tr': '90',
    'fransa': '33', 'france': '33', 'fr': '33',
    'almanya': '49', 'germany': '49', 'de': '49',
    'hollanda': '31', 'netherlands': '31', 'nl': '31',
    'belçika': '32', 'belgium': '32', 'be': '32',
    'ingiltere': '44', 'uk': '44', 'gb': '44', 'united kingdom': '44',
    'avusturya': '43', 'austria': '43', 'at': '43',
    'isviçre': '41', 'switzerland': '41', 'ch': '41',
    'kazakistan': '7', 'kazakhstan': '7', 'kz': '7',
    'rusya': '7', 'russia': '7', 'ru': '7',
    'özbekistan': '998', 'uzbekistan': '998', 'uz': '998',
    'kırgızistan': '996', 'kyrgyzstan': '996', 'kg': '996',
    'azerbaycan': '994', 'azerbaijan': '994', 'az': '994',
    'gürcistan': '995', 'georgia': '995', 'ge': '995',
    'türkmenistan': '993', 'turkmenistan': '993', 'tm': '993',
    'tacikistan': '992', 'tajikistan': '992', 'tj': '992',
    'bae': '971', 'uae': '971', 'united arab emirates': '971',
    'suudi arabistan': '966', 'saudi arabia': '966', 'sa': '966',
    'ırak': '964', 'iraq': '964', 'iq': '964',
    'ürdün': '962', 'jordan': '962', 'jo': '962',
    'lübnan': '961', 'lebanon': '961', 'lb': '961',
    'ukrayna': '380', 'ukraine': '380', 'ua': '380',
    'ermenistan': '374', 'armenia': '374', 'am': '374',
    'bulgaristan': '359', 'bulgaria': '359', 'bg': '359',
    'romanya': '40', 'romania': '40', 'ro': '40',
    'italya': '39', 'italy': '39', 'it': '39',
    'macaristan': '36', 'hungary': '36', 'hu': '36',
    'ispanya': '34', 'spain': '34', 'es': '34',
    'hindistan': '91', 'india': '91', 'in': '91',
    'avustralya': '61', 'australia': '61', 'au': '61',
    'abd': '1', 'usa': '1', 'us': '1', 'kanada': '1', 'canada': '1', 'ca': '1'
  };

  // Check if it's already a numeric string
  if (/^\d+$/.test(lower)) {
    return lower;
  }

  return mapping[lower] || null;
}

/**
 * Detect country code from local number pattern: 05XX→TR, 06XX→NL, 015X→DE, etc.
 */
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

/**
 * Extract leading country code from international number
 */
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

/**
 * Normalizes any phone number into E.164-like clean format with country inference.
 */
export function normalizePhoneForIdentity(rawPhone: string, countryHint?: string): NormalizedPhoneIdentity {
  const raw = String(rawPhone || '').trim();
  let digits = raw.replace(/\D/g, '');

  if (!digits || digits.length < 7) {
    return {
      e164: null,
      digits,
      confidence: 'low',
      raw
    };
  }

  const hintPrefix = resolveCountryPrefix(countryHint);

  // 1. Starts with 00 -> international format (strip 00)
  if (digits.startsWith('00') && digits.length >= 9) {
    digits = digits.substring(2);
  }

  let confidence: 'high' | 'medium' | 'low' = 'low';

  // 2. Starts with 0 -> local format
  if (digits.startsWith('0') && digits.length >= 9) {
    const inferredCode = inferCountryFromLocal(digits);
    if (inferredCode) {
      digits = inferredCode + digits.substring(1);
      confidence = 'medium';
    } else if (hintPrefix) {
      digits = hintPrefix + digits.substring(1);
      confidence = 'medium';
    } else {
      // Default to Turkey if local format and no hint
      digits = '90' + digits.substring(1);
      confidence = 'medium';
    }
  } 
  // 3. Short format (e.g. 7-9 digits)
  else if (digits.length >= 7 && digits.length <= 9) {
    if (hintPrefix) {
      digits = hintPrefix + digits;
      confidence = 'medium';
    } else {
      // Fallback: try Turkey prefix
      digits = '90' + digits;
      confidence = 'low';
    }
  }
  // 4. Starts with a valid country code directly
  else {
    const matchedCode = extractCountryCode(digits);
    if (matchedCode) {
      confidence = 'high';
    } else if (hintPrefix) {
      // If it doesn't match any known code, but hint is present, we trust hint if length is standard
      digits = hintPrefix + digits;
      confidence = 'medium';
    } else {
      // No match, fallback to TR
      digits = '90' + digits;
      confidence = 'low';
    }
  }

  // Ensure digits length is safe for E.164 (10 to 15 digits)
  const isValidLength = digits.length >= 10 && digits.length <= 15;
  const e164 = isValidLength ? digits : null;

  return {
    e164,
    digits,
    countryHint: hintPrefix || undefined,
    nationalSuffix: digits.slice(-10),
    confidence: e164 ? confidence : 'low',
    raw
  };
}

/**
 * Safely parses the _all_phones field from raw_data JSON.
 * Handles both real JSON array and stringified JSON array formats.
 */
export function parseAllPhones(allPhonesField: any): string[] {
  if (!allPhonesField) return [];
  if (Array.isArray(allPhonesField)) {
    return allPhonesField.map(String).filter(Boolean);
  }
  if (typeof allPhonesField === 'string') {
    try {
      const parsed = JSON.parse(allPhonesField);
      if (Array.isArray(parsed)) {
        return parsed.map(String).filter(Boolean);
      }
    } catch (_) {}
    // If it's a single string phone, return it as array
    return [allPhonesField].filter(Boolean);
  }
  return [];
}
