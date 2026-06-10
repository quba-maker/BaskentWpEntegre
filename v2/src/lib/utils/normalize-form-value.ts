/**
 * Form value normalization helper for cleaning up raw form inputs.
 * Normalizes snake_case values, capitalized Turkish characters, and country typos.
 */
export function normalizeFormValue(val: string | null | undefined): string {
  if (!val) return "";
  let clean = val.trim();
  if (!clean) return "";

  // 1. If it contains underscores, replace them with spaces
  if (clean.includes('_')) {
    clean = clean.replace(/_/g, ' ');
  }

  // 2. Typos & Country Normalizations (Case-insensitive replacement)
  const typoMap: Record<string, string> = {
    'özbeksitan': 'Özbekistan',
    'ozbeksitan': 'Özbekistan',
    'özbekistan': 'Özbekistan',
    'ozbekistan': 'Özbekistan',
    'almanya': 'Almanya',
    'azerbaycan': 'Azerbaycan',
    'belcika': 'Belçika',
    'belçika': 'Belçika',
    'hollanda': 'Hollanda',
    'ingiltere': 'İngiltere',
    'fransa': 'Fransa',
    'avusturya': 'Avusturya',
    'isvicre': 'İsviçre',
    'isviçre': 'İsviçre',
    'kirgizistan': 'Kırgızistan',
    'kırgızistan': 'Kırgızistan',
    'kazakistan': 'Kazakistan',
    'rusya': 'Rusya',
    'ukrayna': 'Ukrayna',
    'türkiye': 'Türkiye',
    'turkiye': 'Türkiye',
    'turkmenistan': 'Türkmenistan',
    'türkmenistan': 'Türkmenistan'
  };

  const lowerTrimmed = clean.toLowerCase().trim();
  if (typoMap[lowerTrimmed]) {
    return typoMap[lowerTrimmed];
  }

  // Otherwise, handle general replacements in sentence/phrase
  let replaced = clean;
  for (const [typo, correction] of Object.entries(typoMap)) {
    const regex = new RegExp(`\\b${typo}\\b`, 'gi');
    replaced = replaced.replace(regex, correction);
  }

  // 3. Clean up multiple spaces
  replaced = replaced.replace(/\s+/g, ' ').trim();

  // 4. Capitalize first letter of the sentence / words with Turkish character awareness
  if (replaced.length > 0) {
    if (replaced.startsWith('(') && replaced.length > 1) {
      const firstChar = replaced.charAt(1);
      const rest = replaced.slice(2);
      let upperFirst = firstChar.toUpperCase();
      if (firstChar === 'i') upperFirst = 'İ';
      if (firstChar === 'ı') upperFirst = 'I';
      return '(' + upperFirst + rest;
    }
    const firstChar = replaced.charAt(0);
    const rest = replaced.slice(1);
    let upperFirst = firstChar.toUpperCase();
    if (firstChar === 'i') upperFirst = 'İ';
    if (firstChar === 'ı') upperFirst = 'I';
    return upperFirst + rest;
  }

  return replaced;
}
