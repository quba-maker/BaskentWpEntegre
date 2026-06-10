/**
 * 🛡️ P0 Abuse & Profanity Detector (Hotfix)
 * 
 * Scans incoming patient messages for explicit curses, profanity,
 * slurs, and derogatory attacks against Rüya (the bot), the hospital,
 * doctors, or personnel.
 * 
 * Separates core insults/abuse from general patient frustration.
 * 
 * Pure function — no DB, no env dependencies.
 */

export interface AbuseDetection {
  abuse_detected: boolean;
  matched_phrases: string[];
  decisionCode: 'NO_REPLY_ABUSE_DETECTED' | 'PROCEED';
}

// Turkish character mapping helper
function normalizeTurkishChars(text: string): string {
  return text
    .replace(/ı/g, 'i')
    .replace(/İ/g, 'i')
    .replace(/ş/g, 's')
    .replace(/ğ/g, 'g')
    .replace(/ç/g, 'c')
    .replace(/ö/g, 'o')
    .replace(/ü/g, 'u')
    .replace(/Ş/g, 's')
    .replace(/Ğ/g, 'g')
    .replace(/Ç/g, 'c')
    .replace(/Ö/g, 'o')
    .replace(/Ü/g, 'u');
}

// Collapses repeated consecutive characters (e.g., "saalaak" -> "salak", "aptalll" -> "aptal")
// Special precaution: Do not collapse to less than a single character
function collapseRepeatedChars(text: string): string {
  // Replace consecutive identical characters (length >= 2) with a single instance of that character
  return text.replace(/(.)\1+/gi, '$1');
}

export function detectAbuse(messageText: string): AbuseDetection {
  if (!messageText || messageText.length < 2) {
    return {
      abuse_detected: false,
      matched_phrases: [],
      decisionCode: 'PROCEED'
    };
  }

  // 1. Convert to lowercase
  let cleaned = messageText.toLowerCase();

  // 2. Normalize punctuation to spaces
  cleaned = cleaned.replace(/[\.,\?!\/\\#$%\^&\*;:{}=\-_`~()"'`’“”]/g, ' ');

  // 3. Normalize Turkish characters (creates a normalized copy for secondary pattern matches)
  const turkishNormalized = normalizeTurkishChars(cleaned);

  // 4. Collapse repeated characters on both copies
  const collapsedCleaned = collapseRepeatedChars(cleaned).replace(/\s+/g, ' ').trim();
  const collapsedNormalized = collapseRepeatedChars(turkishNormalized).replace(/\s+/g, ' ').trim();

  // Whitespace-trimmed copies for strict sub-phrase searches
  const rawTrimmed = cleaned.replace(/\s+/g, ' ').trim();
  const normalizedTrimmed = turkishNormalized.replace(/\s+/g, ' ').trim();

  const matched: string[] = [];

  // ==========================================
  // ABUSE & PROFANITY PATTERNS
  // ==========================================

  // 1. Vulgar slurs & swear words (Turkish + English)
  const VULGAR_PATTERNS = [
    /\b(siktir|orospu|pi[cç]|g[oö]t|amk|aq|kahpe|yav[sş]ak|ibne|pu[sş]t)\b/i,
    /\b(sikeyim|sikerler|sikis|sik[ei]r|sik[it]er|sik\s+git)\b/i,
    /\b(fuck|shit|asshole|bitch|bastard)\b/i
  ];

  // 2. Core insults (e.g., salak, aptal, gerizekalı, mal mısın)
  // Must support collapsed repeats (e.g. "saalaak") via checked collapsed versions
  const INSULT_KEYWORDS = [
    'salak',
    'aptal',
    'gerizekali',
    'gerizekali',
    'gerizekaval'
  ];

  // 3. Dynamic "mal" checks
  // Note: "mal" can mean goods in other contexts, but is treated as insult here
  // Checks "mal mısın", "malmisiniz", "malmısınız", "mal", "mal misiniz", etc.
  const MAL_PATTERNS = [
    /\bmal\s+m[iı]s[iı]n\b/i,
    /\bmal\s+m[iı]s[iı]n[iı]z\b/i,
    /\bmalm[iı]s[iı]n\b/i,
    /\bmalm[iı]s[iı]n[iı]z\b/i,
    /\bmal\s+mi\b/i,
    /\bmal\s+m[iı]\b/i
  ];

  // 4. Slang/offensive exclamations
  // Precaution: Must use strict boundaries to not match "plan", "falan", "alan"
  const SLANG_PATTERNS = [
    /\b(ulan)\b/i,
    /\b(lan)\b/i
  ];

  // 5. Attacks directed at doctors, staff, hospital, or system
  const ATTACK_PATTERNS = [
    // "doktorlarınız da sizin gibi mi", "hekimleriniz de sizin gibi"
    /\b(doktor|hekim|personel|hastane|asistan|dan[iı][sş]man|sistem|hizmet|tedavi)(ler)?(iniz)?\s+(da|de)?\s*(sizin|senin)\s+gibi\b/i,
    // "ne biçim danışmansın", "ne biçim hastane"
    /\bne\s+bi[cç]im\s+(dan[iı][sş]man|hastane|doktor|hekim|asistan|personel|hizmet|tedavi)/i,
    // Direct insult targeting the bot name or role
    /\b(ruya|rüya|asistan|bot|sistem)\s+(salak|aptal|mal|gerizekali|gerizekalı|kopek|köpek)\b/i
  ];

  // ==========================================
  // EXCLUSIONS (FRUSTRATION NOT ABUSE)
  // ==========================================
  // Frustrated but valid patient messages: kriz/anger mode
  const FRUSTRATION_PHRASES = [
    'bot gibi konusuyorsun',
    'bot gibi konuşuyorsun',
    'bu cevap olmadi',
    'bu cevap olmadı',
    'cevap vermiyorsunuz',
    'yeter artik randevu deme',
    'yeter artık randevu deme',
    'anlamadiniz',
    'anlamadınız'
  ];

  // If the input matches a frustration phrase EXACTLY (after cleanup), it's not abuse
  const isFrustratedOnly = FRUSTRATION_PHRASES.some(phrase => {
    const normPhrase = normalizeTurkishChars(phrase);
    return collapsedCleaned === phrase || 
           collapsedNormalized === normPhrase || 
           rawTrimmed === phrase || 
           normalizedTrimmed === normPhrase;
  });

  if (isFrustratedOnly) {
    return {
      abuse_detected: false,
      matched_phrases: [],
      decisionCode: 'PROCEED'
    };
  }

  // ==========================================
  // SCANS & ASSERTS
  // ==========================================

  // A. Vulgar slurs (checked on original, normalized, collapsed)
  for (const pattern of VULGAR_PATTERNS) {
    if (pattern.test(rawTrimmed) || pattern.test(normalizedTrimmed) || pattern.test(collapsedCleaned) || pattern.test(collapsedNormalized)) {
      matched.push(`vulgar_slur:${pattern.source}`);
    }
  }

  // B. Attack patterns (checked on original, normalized, collapsed)
  for (const pattern of ATTACK_PATTERNS) {
    if (pattern.test(rawTrimmed) || pattern.test(normalizedTrimmed) || pattern.test(collapsedCleaned) || pattern.test(collapsedNormalized)) {
      matched.push(`attack_pattern:${pattern.source}`);
    }
  }

  // C. Mal patterns (checked on original, normalized, collapsed)
  for (const pattern of MAL_PATTERNS) {
    if (pattern.test(rawTrimmed) || pattern.test(normalizedTrimmed) || pattern.test(collapsedCleaned) || pattern.test(collapsedNormalized)) {
      matched.push(`mal_insult:${pattern.source}`);
    }
  }

  // D. Core insult keywords (checked on collapsed versions to handle repeated characters)
  for (const keyword of INSULT_KEYWORDS) {
    const normKeyword = normalizeTurkishChars(keyword);
    const regex = new RegExp(`\\b${keyword}\\b`, 'i');
    const normRegex = new RegExp(`\\b${normKeyword}\\b`, 'i');

    if (regex.test(collapsedCleaned) || normRegex.test(collapsedNormalized)) {
      matched.push(`core_insult:${keyword}`);
    }
  }

  // E. Slang exclamations (ulan, lan)
  for (const pattern of SLANG_PATTERNS) {
    if (pattern.test(rawTrimmed) || pattern.test(normalizedTrimmed) || pattern.test(collapsedCleaned) || pattern.test(collapsedNormalized)) {
      matched.push(`slang_exclamation:${pattern.source}`);
    }
  }

  // Special exact checks for short word insults (e.g. exactly "mal" or "aptal")
  if (collapsedCleaned === 'mal' || collapsedNormalized === 'mal') {
    matched.push('exact_mal');
  }

  const isAbusive = matched.length > 0;

  return {
    abuse_detected: isAbusive,
    matched_phrases: matched,
    decisionCode: isAbusive ? 'NO_REPLY_ABUSE_DETECTED' : 'PROCEED'
  };
}
