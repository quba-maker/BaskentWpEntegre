/**
 * 🛡️ P0 Abuse & Profanity Detector (Hotfix - Refined)
 * 
 * Scans incoming patient messages for explicit curses, profanity,
 * slurs, and derogatory attacks against Rüya (the bot), the hospital,
 * doctors, or personnel.
 * 
 * Separates core insults/abuse from general patient frustration.
 * General slang like "lan" or complaint structures like "ne biçim"
 * are treated as frustration (proceed with no-CTA reply) rather than
 * database level abuse block.
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
function collapseRepeatedChars(text: string): string {
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
  // REAL SWHEAR WORDS & VULGARITY PATTERNS
  // ==========================================
  const VULGAR_PATTERNS = [
    /\b(siktir|orospu|pi[cç]|g[oö]t|amk|aq|kahpe|yav[sş]ak|ibne|pu[sş]t)\b/i,
    /\b(sikeyim|sikerler|sikis|sik[ei]r|sik[it]er|sik\s+git)\b/i,
    /\b(fuck|shit|asshole|bitch|bastard)\b/i
  ];

  // ==========================================
  // REAL INSULT PATTERNS (salak, aptal, köpek, gerizekalı)
  // ==========================================
  const INSULT_KEYWORDS = [
    'salak',
    'aptal',
    'gerizekali',
    'gerizekaval',
    'kopek',
    'kopoglu',
    'kopekoglu'
  ];

  // ==========================================
  // MAL PATTERNS (mal mısın)
  // ==========================================
  const MAL_PATTERNS = [
    /\bmal\s+m[iı]s[iı]n\b/i,
    /\bmal\s+m[iı]s[iı]n[iı]z\b/i,
    /\bmalm[iı]s[iı]n\b/i,
    /\bmalm[iı]s[iı]n[iı]z\b/i,
    /\bmal\s+mi\b/i,
    /\bmal\s+m[iı]\b/i
  ];

  // ==========================================
  // DIRECT TARGET ATTACK INSULTS (e.g. ruya salak, bot köpek)
  // ==========================================
  const TARGET_ATTACK_PATTERNS = [
    /\b(ruya|rüya|asistan|bot|sistem)\s+(salak|aptal|mal|gerizekali|gerizekalı|kopek|köpek|siktir|orospu|ibne|pust)\b/i
  ];

  // A. Swear words check
  for (const pattern of VULGAR_PATTERNS) {
    if (pattern.test(rawTrimmed) || pattern.test(normalizedTrimmed) || pattern.test(collapsedCleaned) || pattern.test(collapsedNormalized)) {
      matched.push(`vulgar_slur:${pattern.source}`);
    }
  }

  // B. Insult keywords check
  for (const keyword of INSULT_KEYWORDS) {
    const normKeyword = normalizeTurkishChars(keyword);
    const regex = new RegExp(`\\b${keyword}\\b`, 'i');
    const normRegex = new RegExp(`\\b${normKeyword}\\b`, 'i');

    if (regex.test(collapsedCleaned) || normRegex.test(collapsedNormalized)) {
      matched.push(`core_insult:${keyword}`);
    }
  }

  // C. Mal patterns check
  for (const pattern of MAL_PATTERNS) {
    if (pattern.test(rawTrimmed) || pattern.test(normalizedTrimmed) || pattern.test(collapsedCleaned) || pattern.test(collapsedNormalized)) {
      matched.push(`mal_insult:${pattern.source}`);
    }
  }

  // D. Target attack patterns check
  for (const pattern of TARGET_ATTACK_PATTERNS) {
    if (pattern.test(rawTrimmed) || pattern.test(normalizedTrimmed) || pattern.test(collapsedCleaned) || pattern.test(collapsedNormalized)) {
      matched.push(`target_attack:${pattern.source}`);
    }
  }

  // E. Exact short insult words
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
