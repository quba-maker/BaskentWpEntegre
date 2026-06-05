/**
 * HOTFIX: p1.4-hf2-remove-gendered-name-based-honorifics-and-enforce-formal-sizli-tone
 * 
 * Centralized sanitizer utility for cleaning patient-facing messages.
 * - Removes patient names and honorifics (Bey, Hanım, Bay, Bayan, Sayın, Mr., Ms., Mrs., Dear).
 * - Enforces formal "sizli" tone in Turkish patient-facing communication.
 * - Uses custom lookaround assertions instead of standard JS \b to support Turkish characters.
 */

// Custom boundary assertions for Turkish characters
const LEFT_B = '(?<=^|[^a-zA-Z0-9_ğüşöçİĞÜŞÖÇ])';
const RIGHT_B = '(?=$|[^a-zA-Z0-9_ğüşöçİĞÜŞÖÇ])';

// Pre-approved safe phrase-based replacements in Turkish
const TurkishPhrases = [
  {
    regex: new RegExp(`${LEFT_B}sana\\s+nasıl\\s+yardımcı\\s+olab[iİ]l[iİ]r[iİ]m(?=$|[^a-zA-Z0-9_ğüşöçİĞÜŞÖÇ])`, 'iu'),
    replacement: 'size nasıl yardımcı olabiliriz'
  },
  {
    regex: new RegExp(`${LEFT_B}sen[iİ]n\\s+[iİ]ç[iİ]n\\s+uygun\\s+mu(?=$|[^a-zA-Z0-9_ğüşöçİĞÜŞÖÇ])`, 'iu'),
    replacement: 'sizin için uygun mu'
  },
  {
    regex: new RegExp(`${LEFT_B}raporunu\\s+paylaşır\\s+m[ıI]sın(?=$|[^a-zA-Z0-9_ğüşöçİĞÜŞÖÇ])`, 'iu'),
    replacement: 'raporunuzu paylaşabilir misiniz'
  },
  {
    regex: new RegExp(`${LEFT_B}dönüş\\s+yapar\\s+m[ıI]sın(?=$|[^a-zA-Z0-9_ğüşöçİĞÜŞÖÇ])`, 'iu'),
    replacement: 'dönüş yapabilir misiniz'
  },
  {
    regex: new RegExp(`${LEFT_B}sen[iİ]\\s+arayalım\\s+m[ıI](?=$|[^a-zA-Z0-9_ğüşöçİĞÜŞÖÇ])`, 'iu'),
    replacement: 'sizi arayabilir miyiz'
  },
  {
    regex: new RegExp(`${LEFT_B}gelmek\\s+[iİ]st[iİ]yor\\s+musun(?=$|[^a-zA-Z0-9_ğüşöçİĞÜŞÖÇ])`, 'iu'),
    replacement: 'gelmeyi düşünüyor musunuz'
  },
  {
    regex: new RegExp(`${LEFT_B}[iİ]stersen\\s+yardımcı\\s+olalım(?=$|[^a-zA-Z0-9_ğüşöçİĞÜŞÖÇ])`, 'iu'),
    replacement: 'isterseniz yardımcı olabiliriz'
  },
  {
    regex: new RegExp(`${LEFT_B}yardımcı\\s+olalım(?=$|[^a-zA-Z0-9_ğüşöçİĞÜŞÖÇ])`, 'iu'),
    replacement: 'yardımcı olabiliriz'
  }
];

// Pre-approved pronoun replacements in Turkish
const TurkishPronouns = [
  { regex: new RegExp(`${LEFT_B}Sana${RIGHT_B}`, 'gu'), replacement: 'Size' },
  { regex: new RegExp(`${LEFT_B}sana${RIGHT_B}`, 'gu'), replacement: 'size' },
  { regex: new RegExp(`${LEFT_B}Sen[iİ]n${RIGHT_B}`, 'gu'), replacement: 'Sizin' },
  { regex: new RegExp(`${LEFT_B}sen[iİ]n${RIGHT_B}`, 'gu'), replacement: 'sizin' },
  { regex: new RegExp(`${LEFT_B}Sen[iİ]${RIGHT_B}`, 'gu'), replacement: 'Sizi' },
  { regex: new RegExp(`${LEFT_B}sen[iİ]${RIGHT_B}`, 'gu'), replacement: 'sizi' },
  { regex: new RegExp(`${LEFT_B}Sen${RIGHT_B}`, 'gu'), replacement: 'Siz' },
  { regex: new RegExp(`${LEFT_B}sen${RIGHT_B}`, 'gu'), replacement: 'siz' },
  { regex: new RegExp(`${LEFT_B}Sende${RIGHT_B}`, 'gu'), replacement: 'Sizde' },
  { regex: new RegExp(`${LEFT_B}sende${RIGHT_B}`, 'gu'), replacement: 'sizde' },
  { regex: new RegExp(`${LEFT_B}Senden${RIGHT_B}`, 'gu'), replacement: 'Sizden' },
  { regex: new RegExp(`${LEFT_B}senden${RIGHT_B}`, 'gu'), replacement: 'sizden' },
  { regex: new RegExp(`${LEFT_B}Senle${RIGHT_B}`, 'gu'), replacement: 'Sizinle' },
  { regex: new RegExp(`${LEFT_B}senle${RIGHT_B}`, 'gu'), replacement: 'sizinle' },
  { regex: new RegExp(`${LEFT_B}[iİ]stersen${RIGHT_B}`, 'giu'), replacement: 'isterseniz' }
];

// Noun suffix replacements in Turkish with blacklist to prevent false positives
const TurkishNounSuffixes = [
  {
    // -nı -> -nızı (e.g. dosyanı -> dosyanızı, planını -> planınızı)
    regex: new RegExp(`${LEFT_B}([a-zA-ZğüşöçİĞÜŞÖÇ]+)n[ıI]${RIGHT_B}`, 'gu'),
    replacement: '$1nızı',
    blacklist: ['aynı', 'ayni', 'tanı', 'tani', 'anı', 'ani', 'kanı', 'kani', 'yanı', 'yani', 'bazı', 'bazi', 'kazı', 'kazi']
  },
  {
    // -ni -> -nizi (e.g. biletini -> biletinizi, bilgilerini -> bilgilerinizi)
    regex: new RegExp(`${LEFT_B}([a-zA-ZğüşöçİĞÜŞÖÇ]+)n[iİ]${RIGHT_B}`, 'gu'),
    replacement: '$1nizi',
    blacklist: ['yeni', 'beni', 'seni', 'huni', 'çini', 'cini', 'kini', 'sini', 'tini', 'mini', 'yani', 'sizin', 'bizim', 'için', 'icin', 'kendi']
  },
  {
    // -nu -> -nuzu (e.g. raporunu -> raporunuzu, telefonunu -> telefonunuzu)
    regex: new RegExp(`${LEFT_B}([a-zA-ZğüşöçİĞÜŞÖÇ]+)nu${RIGHT_B}`, 'gu'),
    replacement: '$1nuzu',
    blacklist: ['konu', 'bunu', 'şunu', 'sunu', 'onu', 'sonu', 'doğru', 'dogru', 'uygun']
  },
  {
    // -nü -> -nüzü (e.g. gününü -> gününüzü)
    regex: new RegExp(`${LEFT_B}([a-zA-ZğüşöçİĞÜŞÖÇ]+)nü${RIGHT_B}`, 'gu'),
    replacement: '$1nüzü',
    blacklist: ['menü', 'menu', 'günü', 'gunu', 'bugünü', 'bugunu', 'dünü', 'dunu', 'önü', 'onu', 'yönü', 'yonu', 'tümü', 'tumu', 'görü', 'goru']
  },
  {
    // -ın -> -ınız (e.g. planın -> planınız, raporun -> raporunuz)
    regex: new RegExp(`${LEFT_B}([a-zA-ZğüşöçİĞÜŞÖÇ]+)[ıI]n${RIGHT_B}`, 'gu'),
    replacement: '$1ınız',
    blacklist: [
      'senin', 'onun', 'bunun', 'şunun', 'plan', 'alan', 'yan', 'kan', 'şan', 'han', 'yalan', 'yılan', 
      'insan', 'haziran', 'altın', 'kadın', 'yakın', 'kalın', 'yarın', 'basın', 'yayın', 'yığın', 
      'tavan', 'taban', 'aksın', 'baksın', 'yapsnsın', 'yapsın', 'kazan', 'bayan'
    ]
  },
  {
    // -in -> -iniz (e.g. biletin -> biletiniz, bilgin -> bilginiz)
    regex: new RegExp(`${LEFT_B}([a-zA-ZğüşöçİĞÜŞÖÇ]+)[iİ]n${RIGHT_B}`, 'gu'),
    replacement: '$1iniz',
    blacklist: [
      'senin', 'sizin', 'benin', 'lütfen', 'tayin', 'emin', 'zemin', 'serin', 'derin', 'terin', 'darin', 
      'gelin', 'eksin', 'bilsin', 'versin', 'gitsin', 'için', 'lakin', 'belki', 'tekin', 'sakin', 'kesin',
      'seçkin', 'zengin', 'belgin', 'ilkin', 'etkin'
    ]
  },
  {
    // -un -> -unuz (e.g. durumun -> durumunuz)
    regex: new RegExp(`${LEFT_B}([a-zA-ZğüşöçİĞÜŞÖÇ]+)un${RIGHT_B}`, 'gu'),
    replacement: '$1unuz',
    blacklist: ['onun', 'bunun', 'şunun', 'torun', 'sorun', 'sütun', 'kanun', 'yosun', 'olsun', 'dursun', 'bulsun', 'uygun', 'yoğun', 'dolgun', 'olgun', 'solgun']
  },
  {
    // -ün -> -ünüz (e.g. günün -> gününüz)
    regex: new RegExp(`${LEFT_B}([a-zA-ZğüşöçİĞÜŞÖÇ]+)ün${RIGHT_B}`, 'gu'),
    replacement: '$1ünüz',
    blacklist: ['gün', 'yön', 'dün', 'ürün', 'bütün', 'düğün', 'görsün', 'ölsün', 'dönsün', 'düzgün', 'üzgün', 'sürgün']
  }
];

/**
 * Helper to capitalize Turkish characters correctly.
 */
function turkishUpperCase(char: string): string {
  if (char === 'i') return 'İ';
  if (char === 'ı') return 'I';
  return char.toUpperCase();
}

/**
 * Preserves the casing of the original string (Turkish-aware).
 */
function preserveCase(original: string, replacement: string): string {
  if (!original || !replacement) return replacement;
  // If the first letter of original is uppercase, capitalize first letter of replacement
  const firstOrig = original[0];
  if (firstOrig === 'İ' || (firstOrig === firstOrig.toUpperCase() && firstOrig !== 'i')) {
    const firstRep = replacement[0];
    const capitalizedFirst = firstRep === 'i' ? 'İ' : (firstRep === 'ı' ? 'I' : firstRep.toUpperCase());
    return capitalizedFirst + replacement.slice(1);
  }
  return replacement;
}

/**
 * Dynamically converts verb roots to their formal counterparts based on vowel harmony.
 * E.g. paylaş -> paylaşabilir misiniz, gönder -> gönderebilir misiniz.
 */
function convertVerbToFormal(root: string, suffix: string): string {
  const lastVowelMatch = root.match(/[aeıioöuüAEIİOÖUÜ]/g);
  if (!lastVowelMatch) {
    return root + 'abilir misiniz';
  }
  const lastVowel = lastVowelMatch[lastVowelMatch.length - 1].toLowerCase();
  const endsWithVowel = /[aeıioöuüAEIİOÖUÜ]$/.test(root);
  const buffer = endsWithVowel ? 'y' : '';

  let adjustedRoot = root;
  const lowerRoot = root.toLowerCase();
  if (lowerRoot === 'et') {
    adjustedRoot = root.substring(0, root.length - 1) + (root.endsWith('T') ? 'D' : 'd');
  } else if (lowerRoot === 'git') {
    adjustedRoot = root.substring(0, root.length - 1) + (root.endsWith('T') ? 'D' : 'd');
  }

  if (['a', 'ı', 'o', 'u'].includes(lastVowel)) {
    return adjustedRoot + buffer + 'abilir misiniz';
  } else {
    return adjustedRoot + buffer + 'ebilir misiniz';
  }
}

/**
 * Dynamically converts imperative/optative verb roots ("yapalım", "edelim") to formal question.
 */
function convertLetUsToFormal(root: string): string {
  const lastVowelMatch = root.match(/[aeıioöuüAEIİOÖUÜ]/g);
  if (!lastVowelMatch) {
    return root + 'abilir miyiz';
  }
  const lastVowel = lastVowelMatch[lastVowelMatch.length - 1].toLowerCase();
  const endsWithVowel = /[aeıioöuüAEIİOÖUÜ]$/.test(root);
  const buffer = endsWithVowel ? 'y' : '';

  let adjustedRoot = root;
  const lowerRoot = root.toLowerCase();
  if (lowerRoot === 'et') {
    adjustedRoot = root.substring(0, root.length - 1) + (root.endsWith('T') ? 'D' : 'd');
  } else if (lowerRoot === 'git') {
    adjustedRoot = root.substring(0, root.length - 1) + (root.endsWith('T') ? 'D' : 'd');
  }

  if (['a', 'ı', 'o', 'u'].includes(lastVowel)) {
    return adjustedRoot + buffer + 'abilir miyiz';
  } else {
    return adjustedRoot + buffer + 'ebilir miyiz';
  }
}

/**
 * Cleans up double spaces and spaces before punctuation.
 */
function cleanPunctuationAndSpaces(text: string): string {
  return text
    .replace(/\s+/g, ' ')
    .replace(/\s+([.,!?])/g, '$1')
    .replace(/,\s*,/g, ',')
    .replace(/\s*,\s*\./g, '.')
    .trim();
}

/**
 * Sanitizes greetings at the beginning of the message to be nameless and neutral.
 */
function sanitizeGreeting(text: string): string {
  const trimmed = text.trim();

  // Turkish Starting Greetings
  // Pattern 1: Merhaba/Sayın/Bay/Bayan [Name] Bey/Hanım
  const trPattern1 = /^(merhaba|sayın|sayin|bay|bayan)[,\s]+([a-z0-9_ğüşöçıi̇ıi̇\-\s]{2,30}?)\s+(bey|hanım|hanim|bay|bayan)\b(?:[.,!?:\-\s]+|$)/iu;
  if (trPattern1.test(trimmed)) {
    return trimmed.replace(trPattern1, 'Merhaba, ');
  }

  // Pattern 2: Merhaba/Sayın/Bay/Bayan + Single Word (Name) + punctuation/end-of-string (NO whitespace in trailing group)
  const trPattern2 = /^(merhaba|sayın|sayin|bay|bayan)[,\s]+([a-z0-9_ğüşöçıi̇]{2,30})(?:[.,!?:\-]+|$)/iu;
  const trMatch2 = trimmed.match(trPattern2);
  if (trMatch2) {
    const potentialName = trMatch2[2].toLowerCase();
    const trBlacklist = ['nasılsınız', 'nasilsiniz', 'nasılsın', 'nasilsin', 'nasılsınızz', 'nasıl', 'nasil', 'iyi', 'günler', 'gunler', 'akşamlar', 'aksamlar', 'sabahlar', 'merhaba', 'size', 'sizin', 'sana', 'senin', 'bize', 'bizim', 'biz', 'sen', 'siz'];
    if (!trBlacklist.includes(potentialName)) {
      return trimmed.replace(trPattern2, 'Merhaba, ');
    }
  }

  // English Starting Greetings
  // Pattern 1: Dear/Hello/Hi [Mr/Ms/Mrs] Name
  const enPattern1 = /^(dear|hello|hi)[,\s]+(mr\.|ms\.|mrs\.|mr|ms|mrs)\s+([a-z0-9_\-\s]{2,30}?)\b(?:[.,!?:\-]+|$)/iu;
  if (enPattern1.test(trimmed)) {
    return trimmed.replace(enPattern1, 'Hello, ');
  }
  // Pattern 2: Dear/Hello/Hi + Single Word (Name) + punctuation/end-of-string (NO whitespace in trailing group)
  const enPattern2 = /^(dear|hello|hi)[,\s]+([a-z0-9_]{2,30})(?:[.,!?:\-]+|$)/iu;
  const enMatch2 = trimmed.match(enPattern2);
  if (enMatch2) {
    const potentialName = enMatch2[2].toLowerCase();
    const enBlacklist = ['how', 'are', 'you', 'good', 'morning', 'afternoon', 'evening', 'there', 'all', 'everyone', 'we', 'us', 'our', 'you', 'your'];
    if (!enBlacklist.includes(potentialName)) {
      return trimmed.replace(enPattern2, 'Hello, ');
    }
  }

  // Russian Starting Greetings
  // Pattern 2: Russian Prefix + Single Word (Name) + punctuation/end-of-string (NO whitespace in trailing group)
  const ruPattern2 = /^(здравствуйте|привет|уважаемый|уважаемая)[,\s]+([a-zа-яё0-9_\-]{2,30})(?:[.,!?:\-]+|$)/iu;
  const ruMatch2 = trimmed.match(ruPattern2);
  if (ruMatch2) {
    const potentialName = ruMatch2[2].toLowerCase();
    const ruBlacklist = ['как', 'дела', 'добрый', 'день', 'утро', 'вечер', 'мы', 'вы', 'нам', 'вам'];
    if (!ruBlacklist.includes(potentialName)) {
      return trimmed.replace(ruPattern2, 'Здравствуйте, ');
    }
  }

  // Arabic Starting Greetings
  // Pattern 2: Arabic Prefix + Single Word (Name) + punctuation/end-of-string (NO whitespace in trailing group)
  const arPattern2 = /^(مرحباً|مرحبا|عزيزي|عزيزتي|السيد|السيدة)[,\s]+([\u0600-\u06FFa-zA-Z0-9_\-]{2,30})(?:[.,!?:\-]+|$)/u;
  const arMatch2 = trimmed.match(arPattern2);
  if (arMatch2) {
    const potentialName = arMatch2[2].toLowerCase();
    const arBlacklist = ['كيف', 'حالك', 'صباح', 'الخير', 'مساء', 'نحن', 'أنتم', 'انتم', 'لكم', 'لنا'];
    if (!arBlacklist.includes(potentialName)) {
      return trimmed.replace(arPattern2, 'مرحباً، ');
    }
  }

  return text;
}

/**
 * Detects if a text contains patient name variables or gendered/formal honorifics.
 */
export function isNonCompliant(text: string): boolean {
  if (!text) return false;

  // 1. Check if it contains {{patient_name}} placeholder or direct variable references
  if (text.includes('{{patient_name}}')) return true;

  // 2. Check for honorifics (with custom boundary assertions for Turkish support)
  const honorifics = [
    'bey', 'hanım', 'hanim', 'bay', 'bayan', 'sayın', 'sayin', 
    'mr\\.', 'ms\\.', 'mrs\\.', 'mr', 'ms', 'mrs', 'dear',
    'уважаемый', 'уважаемая'
  ];
  for (const hon of honorifics) {
    const regex = new RegExp(`${LEFT_B}${hon}${RIGHT_B}`, 'iu');
    if (regex.test(text)) return true;
  }

  // 3. Check if greeting matches greeting prefixes with names
  const cleanedGreeting = sanitizeGreeting(text);
  if (cleanedGreeting !== text) {
    return true;
  }

  return false;
}


/**
 * Sanitizes name-based honorifics and senli expressions.
 */
export function sanitizePatientFacingMessage(text: string, options?: { locale?: string }): string {
  if (!text || typeof text !== 'string') return '';

  // 1. Sanitize beginning greeting
  let sanitized = sanitizeGreeting(text);

  // 2. Remove mid-sentence honorifics (e.g. ", Mustafa Bey" or " Mustafa Bey")
  // Turkish mid-sentence: [Name] Bey/Hanım/Bayan/Bay
  const trMidHonorific = new RegExp(`,?\\s*\\b[a-zA-Z0-9_ğüşöçİĞÜŞÖÇ]{2,30}\\s+(Bey|Hanım|Bay|Bayan)\\b`, 'giu');
  sanitized = sanitized.replace(trMidHonorific, '');

  // English mid-sentence: Mr/Ms/Mrs/Dear [Name]
  const enMidHonorific = new RegExp(`,?\\s*\\b(Mr\\.|Ms\\.|Mrs\\.|Mr|Ms|Mrs|Dear)\\s+[a-zA-Z0-9_]{2,30}\\b`, 'giu');
  sanitized = sanitized.replace(enMidHonorific, '');

  // Russian mid-sentence: Уважаемый/Уважаемая [Name]
  const ruMidHonorific = new RegExp(`,?\\s*\\b(Уважаемый|Уважаемая)\\s+[a-zA-Z0-9_а-яА-ЯёЁ]{2,30}\\b`, 'giu');
  sanitized = sanitized.replace(ruMidHonorific, '');

  // 3. Pre-approved phrase-based replacements (to prevent breaking verbs)
  for (const phrase of TurkishPhrases) {
    sanitized = sanitized.replace(phrase.regex, (match) => {
      return preserveCase(match, phrase.replacement);
    });
  }

  // 4. Dynamic verb replacements:
  // E.g. paylaşır mısın -> paylaşabilir misiniz
  // Matches: [Word](ar/er/ır/ir/ur/ür/r) mısın(ız)?
  const verbPattern = new RegExp(`${LEFT_B}([a-zA-ZğüşöçİĞÜŞÖÇ]+?)(ar|er|[ıI]r|[iİ]r|ur|ür|r)\\s+m([ıI]|[iİ]|u|ü)s[ıI]n([ıI]z)?${RIGHT_B}`, 'giu');
  sanitized = sanitized.replace(verbPattern, (match, root, aorist) => {
    const lowerRoot = root.toLowerCase();
    // Do not replace if it is already possibility form to prevent "paylaşabilebilir" recursion
    if (lowerRoot.endsWith('abil') || lowerRoot.endsWith('ebil') || lowerRoot.endsWith('abıl') || lowerRoot.endsWith('ebıl')) {
      return match;
    }
    return preserveCase(match, convertVerbToFormal(root, aorist));
  });

  // E.g. paylaşabilir misin -> paylaşabilir misiniz
  const possibilityVerbPattern = new RegExp(`${LEFT_B}([a-zA-ZğüşöçİĞÜŞÖÇ]+?)(ab[iİ]l[iİ]r|eb[iİ]l[iİ]r)\\s+m[iİ]s[iİ]n${RIGHT_B}`, 'giu');
  sanitized = sanitized.replace(possibilityVerbPattern, (match, root, possibility) => {
    return preserveCase(match, `${root}${possibility} misiniz`);
  });

  // E.g. arayalım mı -> arayabilir miyiz, edelim mi -> edebilir miyiz
  const letUsVerbPattern = new RegExp(`${LEFT_B}([a-zA-ZğüşöçİĞÜŞÖÇ]+?)(?:y)?(al[ıI]m\\s+m[ıI]|el[iİ]m\\s+m[iİ])${RIGHT_B}`, 'giu');
  sanitized = sanitized.replace(letUsVerbPattern, (match, root) => {
    return preserveCase(match, convertLetUsToFormal(root));
  });

  // E.g. uygun musun -> uygun musunuz, hazır mısın -> hazır mısınız
  const adjQuestionPattern = new RegExp(`${LEFT_B}([a-zA-ZğüşöçİĞÜŞÖÇ]+)\\s+(m[ıI]s[ıI]n|m[iİ]s[iİ]n|musun|müsün)${RIGHT_B}`, 'giu');
  sanitized = sanitized.replace(adjQuestionPattern, (match, root, question) => {
    const qLower = question.toLowerCase();
    let replacement = '';
    if (qLower.includes('ı')) replacement = `${root} mısınız`;
    else if (qLower.includes('i')) replacement = `${root} misiniz`;
    else if (qLower.includes('u')) replacement = `${root} musunuz`;
    else if (qLower.includes('ü')) replacement = `${root} müsünüz`;
    
    return preserveCase(match, replacement);
  });

  // 5. Noun suffixes
  for (const suffix of TurkishNounSuffixes) {
    sanitized = sanitized.replace(suffix.regex, (match, root) => {
      const lowerMatch = match.toLowerCase();
      if (suffix.blacklist.includes(lowerMatch)) {
        return match; // do not replace blacklisted words
      }
      // Apply replacement and preserve case
      const replacementText = suffix.replacement.replace('$1', root);
      return preserveCase(match, replacementText);
    });
  }

  // 6. Turkish pronoun replacements
  for (const pronoun of TurkishPronouns) {
    sanitized = sanitized.replace(pronoun.regex, (match) => {
      return preserveCase(match, pronoun.replacement);
    });
  }

  // 7. Cleanup spacing and punctuation
  return cleanPunctuationAndSpaces(sanitized);
}
