export type SupportLanguage = 'tr' | 'en' | 'ru' | 'ar' | 'de' | 'fr' | 'nl' | 'unknown';

export interface LanguageDecision {
  language: SupportLanguage;
  confidence: 'high' | 'medium' | 'low';
}

/**
 * Guesses the patient's preferred language using form data, campaign/form name, and phone number.
 */
export function resolveLeadLanguage(
  rawData: any,
  formName: string | null | undefined,
  phone: string | null | undefined,
  defaultLang: SupportLanguage = 'tr'
): LanguageDecision {
  const normPhone = (phone || '').replace(/[^0-9+]/g, '');
  const normFormName = (formName || '').toLowerCase();
  
  // Convert rawData to string for keyword searching
  let rawDataStr = '';
  if (rawData) {
    if (typeof rawData === 'string') {
      rawDataStr = rawData.toLowerCase();
    } else {
      try {
        rawDataStr = JSON.stringify(rawData).toLowerCase();
      } catch {
        rawDataStr = '';
      }
    }
  }

  // Country code mappings
  const countryCodes: { prefix: string; lang: SupportLanguage }[] = [
    { prefix: '+90', lang: 'tr' },
    { prefix: '90', lang: 'tr' },
    { prefix: '+7', lang: 'ru' },
    { prefix: '7', lang: 'ru' },
    { prefix: '+49', lang: 'de' },
    { prefix: '49', lang: 'de' },
    { prefix: '+33', lang: 'fr' },
    { prefix: '33', lang: 'fr' },
    { prefix: '+31', lang: 'nl' },
    { prefix: '31', lang: 'nl' },
    { prefix: '+44', lang: 'en' },
    { prefix: '44', lang: 'en' },
    { prefix: '+1', lang: 'en' },
    { prefix: '1', lang: 'en' },
    // Arabic countries
    { prefix: '+971', lang: 'ar' },
    { prefix: '971', lang: 'ar' },
    { prefix: '+966', lang: 'ar' },
    { prefix: '966', lang: 'ar' },
    { prefix: '+965', lang: 'ar' },
    { prefix: '965', lang: 'ar' },
    { prefix: '+973', lang: 'ar' },
    { prefix: '973', lang: 'ar' },
    { prefix: '+974', lang: 'ar' },
    { prefix: '974', lang: 'ar' },
    { prefix: '+968', lang: 'ar' },
    { prefix: '968', lang: 'ar' },
    { prefix: '+962', lang: 'ar' },
    { prefix: '962', lang: 'ar' },
    { prefix: '+961', lang: 'ar' },
    { prefix: '961', lang: 'ar' },
    { prefix: '+964', lang: 'ar' },
    { prefix: '964', lang: 'ar' }
  ];

  let phoneLang: SupportLanguage | null = null;
  // Match prefix
  for (const c of countryCodes) {
    if (normPhone.startsWith(c.prefix)) {
      phoneLang = c.lang;
      break;
    }
  }

  // Keyword mappings
  const keywordMappings: { keywords: string[]; lang: SupportLanguage }[] = [
    { keywords: ['ru', 'russia', 'russian', 'pycc', 'rusya'], lang: 'ru' },
    { keywords: ['de', 'deutsch', 'germany', 'deutschland', 'almanya'], lang: 'de' },
    { keywords: ['en', 'english', 'uk', 'us', 'london', 'ireland', 'ingilizce'], lang: 'en' },
    { keywords: ['ar', 'arabic', 'dubai', 'uae', 'saudi', 'kuwait', 'qatar', 'bahrain', 'oman', 'arapca', 'arabistan'], lang: 'ar' },
    { keywords: ['nl', 'dutch', 'netherlands', 'holland', 'amsterdam', 'hollanda'], lang: 'nl' },
    { keywords: ['fr', 'french', 'france', 'paris', 'fransizca'], lang: 'fr' },
    { keywords: ['tr', 'turk', 'turkish', 'turkiye', 'turkce'], lang: 'tr' }
  ];

  let keywordLang: SupportLanguage | null = null;
  // Check formName first
  for (const item of keywordMappings) {
    if (item.keywords.some(k => normFormName.includes(k))) {
      keywordLang = item.lang;
      break;
    }
  }

  // If not found in formName, check rawData
  if (!keywordLang && rawDataStr) {
    for (const item of keywordMappings) {
      if (item.keywords.some(k => rawDataStr.includes(k))) {
        keywordLang = item.lang;
        break;
      }
    }
  }

  // Determine final language and confidence
  if (phoneLang && keywordLang) {
    if (phoneLang === keywordLang) {
      return { language: phoneLang, confidence: 'high' };
    } else {
      // Conflicting signals, prioritize phone but lower confidence
      return { language: phoneLang, confidence: 'medium' };
    }
  }

  if (phoneLang) {
    return { language: phoneLang, confidence: 'medium' };
  }

  if (keywordLang) {
    return { language: keywordLang, confidence: 'medium' };
  }

  return { language: defaultLang, confidence: 'low' };
}
