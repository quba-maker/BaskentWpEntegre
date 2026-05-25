// ========================================================
// Shared Country Detection — Phone prefix based
// Used by: Forms page, Inbox contact-list, Chat area
// ========================================================

export interface CountryInfo {
  flag: string;
  name: string;
  code: string;
}

const PHONE_PREFIX_MAP: [string, CountryInfo][] = [
  ['994', { flag: '🇦🇿', name: 'Azerbaycan', code: 'AZ' }],
  ['998', { flag: '🇺🇿', name: 'Özbekistan', code: 'UZ' }],
  ['996', { flag: '🇰🇬', name: 'Kırgızistan', code: 'KG' }],
  ['993', { flag: '🇹🇲', name: 'Türkmenistan', code: 'TM' }],
  ['992', { flag: '🇹🇯', name: 'Tacikistan', code: 'TJ' }],
  ['971', { flag: '🇦🇪', name: 'BAE', code: 'AE' }],
  ['966', { flag: '🇸🇦', name: 'Suudi Arabistan', code: 'SA' }],
  ['964', { flag: '🇮🇶', name: 'Irak', code: 'IQ' }],
  ['962', { flag: '🇯🇴', name: 'Ürdün', code: 'JO' }],
  ['961', { flag: '🇱🇧', name: 'Lübnan', code: 'LB' }],
  ['374', { flag: '🇦🇲', name: 'Ermenistan', code: 'AM' }],
  ['995', { flag: '🇬🇪', name: 'Gürcistan', code: 'GE' }],
  ['90',  { flag: '🇹🇷', name: 'Türkiye', code: 'TR' }],
  ['49',  { flag: '🇩🇪', name: 'Almanya', code: 'DE' }],
  ['44',  { flag: '🇬🇧', name: 'İngiltere', code: 'GB' }],
  ['43',  { flag: '🇦🇹', name: 'Avusturya', code: 'AT' }],
  ['41',  { flag: '🇨🇭', name: 'İsviçre', code: 'CH' }],
  ['33',  { flag: '🇫🇷', name: 'Fransa', code: 'FR' }],
  ['31',  { flag: '🇳🇱', name: 'Hollanda', code: 'NL' }],
  ['32',  { flag: '🇧🇪', name: 'Belçika', code: 'BE' }],
  ['39',  { flag: '🇮🇹', name: 'İtalya', code: 'IT' }],
  ['34',  { flag: '🇪🇸', name: 'İspanya', code: 'ES' }],
  ['46',  { flag: '🇸🇪', name: 'İsveç', code: 'SE' }],
  ['45',  { flag: '🇩🇰', name: 'Danimarka', code: 'DK' }],
  ['47',  { flag: '🇳🇴', name: 'Norveç', code: 'NO' }],
  ['48',  { flag: '🇵🇱', name: 'Polonya', code: 'PL' }],
  ['30',  { flag: '🇬🇷', name: 'Yunanistan', code: 'GR' }],
  ['36',  { flag: '🇭🇺', name: 'Macaristan', code: 'HU' }],
  ['40',  { flag: '🇷🇴', name: 'Romanya', code: 'RO' }],
  ['359', { flag: '🇧🇬', name: 'Bulgaristan', code: 'BG' }],
  ['380', { flag: '🇺🇦', name: 'Ukrayna', code: 'UA' }],
  ['77',  { flag: '🇰🇿', name: 'Kazakistan', code: 'KZ' }],
  ['7',   { flag: '🇷🇺', name: 'Rusya', code: 'RU' }],
  ['1',   { flag: '🇺🇸', name: 'ABD', code: 'US' }],
  ['61',  { flag: '🇦🇺', name: 'Avustralya', code: 'AU' }],
  ['81',  { flag: '🇯🇵', name: 'Japonya', code: 'JP' }],
  ['86',  { flag: '🇨🇳', name: 'Çin', code: 'CN' }],
  ['82',  { flag: '🇰🇷', name: 'Güney Kore', code: 'KR' }],
  ['91',  { flag: '🇮🇳', name: 'Hindistan', code: 'IN' }],
  ['55',  { flag: '🇧🇷', name: 'Brezilya', code: 'BR' }],
  ['52',  { flag: '🇲🇽', name: 'Meksika', code: 'MX' }],
];

/**
 * Detect country from phone number prefix.
 * Accepts raw phone like "4915906179788", "+4915906179788", "p:+4915906179788"
 */
export function getCountryFromPhone(phone: string | null | undefined): CountryInfo | null {
  if (!phone) return null;
  const clean = phone.replace(/[^0-9]/g, '');
  if (clean.length < 8) return null;

  // Skip social platform IDs (Instagram IGSID, Messenger PSID — typically 15+ digits with no country prefix match)
  if (clean.length > 14) return null;

  // Try longest prefix first (3-digit → 2-digit → 1-digit)
  for (const [prefix, info] of PHONE_PREFIX_MAP) {
    if (clean.startsWith(prefix)) return info;
  }

  return null;
}

// English → Turkish country name normalization (for AI-detected country fields)
const COUNTRY_NAME_TR_MAP: Record<string, string> = {
  'turkey': 'Türkiye',
  'türkei': 'Türkiye',
  'germany': 'Almanya',
  'deutschland': 'Almanya',
  'united kingdom': 'İngiltere',
  'uk': 'İngiltere',
  'england': 'İngiltere',
  'france': 'Fransa',
  'italy': 'İtalya',
  'spain': 'İspanya',
  'netherlands': 'Hollanda',
  'belgium': 'Belçika',
  'austria': 'Avusturya',
  'switzerland': 'İsviçre',
  'sweden': 'İsveç',
  'norway': 'Norveç',
  'denmark': 'Danimarka',
  'poland': 'Polonya',
  'greece': 'Yunanistan',
  'hungary': 'Macaristan',
  'romania': 'Romanya',
  'bulgaria': 'Bulgaristan',
  'ukraine': 'Ukrayna',
  'russia': 'Rusya',
  'usa': 'ABD',
  'united states': 'ABD',
  'australia': 'Avustralya',
  'japan': 'Japonya',
  'china': 'Çin',
  'south korea': 'Güney Kore',
  'india': 'Hindistan',
  'brazil': 'Brezilya',
  'mexico': 'Meksika',
  'iraq': 'Irak',
  'jordan': 'Ürdün',
  'lebanon': 'Lübnan',
  'saudi arabia': 'Suudi Arabistan',
  'uae': 'BAE',
  'united arab emirates': 'BAE',
  'azerbaijan': 'Azerbaycan',
  'uzbekistan': 'Özbekistan',
  'kyrgyzstan': 'Kırgızistan',
  'turkmenistan': 'Türkmenistan',
  'tajikistan': 'Tacikistan',
  'georgia': 'Gürcistan',
  'armenia': 'Ermenistan',
  'kazakhstan': 'Kazakistan',
};

/**
 * Normalize country name to Turkish (handles AI-detected English names)
 */
export function normalizeCountryName(name: string): string {
  const lower = name.trim().toLowerCase();
  return COUNTRY_NAME_TR_MAP[lower] || name;
}

// Turkish country name → flag emoji map (built from PHONE_PREFIX_MAP for consistency)
const COUNTRY_FLAG_MAP: Record<string, string> = Object.fromEntries(
  PHONE_PREFIX_MAP.map(([, info]) => [info.name.toLowerCase(), info.flag])
);

/**
 * Resolve flag emoji from a country name (Turkish).
 * Falls back to 🌍 if no match found.
 */
export function getCountryFlag(countryName: string | null | undefined): string {
  if (!countryName) return '🌍';
  const lower = countryName.trim().toLowerCase();
  return COUNTRY_FLAG_MAP[lower] || '🌍';
}

/**
 * Resolve country: first from phone prefix, then from raw_data country fields.
 */
export function resolveCountry(phone: string | null | undefined, rawData?: Record<string, any>): CountryInfo | null {
  // 1. Phone prefix detection (most reliable)
  const fromPhone = getCountryFromPhone(phone);
  if (fromPhone) return fromPhone;

  // 2. Fallback: raw_data country fields
  if (rawData) {
    const country = rawData['nerede_yaşıyorsunuz?'] || rawData['ülke'] || rawData['country'] || rawData['nerede yaşıyorsunuz'];
    if (country) {
      const c = String(country).toLowerCase();
      for (const [, info] of PHONE_PREFIX_MAP) {
        if (c.includes(info.name.toLowerCase())) return info;
      }
    }
  }

  return null;
}

/**
 * Deduplicate phone numbers with smart matching.
 * - Sorts by length desc (keeps longer = more complete numbers)
 * - Uses last-9-digit matching AND suffix containment check
 * - Handles: "+4915906179788" vs "p:+4915906179788" vs "15906179788"
 */
export function deduplicatePhones(phones: string[]): string[] {
  const cleaned = phones.map(p => p.replace(/[^0-9]/g, '')).filter(p => p.length >= 7);
  // Sort by length desc — longer = more complete
  const sorted = [...cleaned].sort((a, b) => b.length - a.length);
  const result: string[] = [];
  
  for (const phone of sorted) {
    const isDuplicate = result.some(existing => {
      // Last 9 digits match
      if (existing.slice(-9) === phone.slice(-9)) return true;
      // One is suffix of the other
      if (existing.endsWith(phone) || phone.endsWith(existing)) return true;
      return false;
    });
    
    if (!isDuplicate) result.push(phone);
  }
  
  return result;
}
