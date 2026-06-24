function trLowerCase(str: string): string {
  return str.toLocaleLowerCase('tr-TR').replace(/\u0307/g, "").toLowerCase();
}

/**
 * Validates whether a given string is a plausible patient name.
 * Programmatically filters out AI hallucinations, usernames, and nicknames.
 */
export function checkNameValidity(name?: string | null): {
  isValid: boolean;
  reason?: string;
  confidence: 'high' | 'medium' | 'low';
} {
  if (!name || !name.trim()) {
    return { isValid: false, reason: "Boş değer", confidence: 'low' };
  }
  
  const cleaned = name.trim();
  const lower = trLowerCase(cleaned);

  // 1. Reject username/nickname formats containing underscores
  if (/_/.test(cleaned)) {
    return { isValid: false, reason: "Kullanıcı adı biçimi (alt çizgi)", confidence: 'low' };
  }

  // 2. Reject strings containing numbers/digits
  if (/[0-9]/.test(cleaned)) {
    return { isValid: false, reason: "Sayı içeriyor", confidence: 'low' };
  }

  // Reject phone number formats (only numbers, spaces, +, -, parentheses)
  const phonePattern = /^[\+\d\s\-\(\)]+$/;
  if (phonePattern.test(cleaned)) {
    return { isValid: false, reason: "Telefon numarası biçimi", confidence: 'low' };
  }

  // 3. Length checks
  if (cleaned.length < 2) {
    return { isValid: false, reason: "Çok kısa", confidence: 'low' };
  }
  if (cleaned.length > 50) {
    return { isValid: false, reason: "Çok uzun", confidence: 'low' };
  }

  // 4. Blacklist of known system words, prepositions, Turkish city names, and test aliases
  const blacklist = [
    "konya", "konyaya", "konya'ya", "istanbul", "ankara", "izmir", "antalya", 
    "adana", "bursa", "samsun", "trabzon", "merhaba", "selam", "selamlar", 
    "hayırlı", "isler", "gunler", "aksamlar", "sabahlar", "telefon", "telefonla", "telefonda", "arama", "aranacak", "randevu",
    "hastane", "doktor", "hemsire", "tedavi", "klinik", "baskent", "evet", "hayır", 
    "tabiki", "tamam", "ok", "yes", "no", "hello", "hi", "annem", "babam", 
    "kardesim", "esim", "kendisi", "turkiye", "türkiye", "almanya", "ingiltere", 
    "fransa", "belçika", "hollanda", "isimsiz", "none", "no name", "noname",
    "boş", "bos", "yok", "bilinmeyen", "adsız", "adsiz", "ad soyad", "adı soyadı",
    "user", "test", "admin", "deneme", "guest", "unknown", "undefined", "null", "bot", "sistem", "lead", "yeni lead", "nitelikli", "manuel",
    "ülke", "sehir", "şehir", "departman", "country", "city", "department", "telefon numarası",
    "kiminle", "kimle", "kim", "ne", "neden", "niye", "nasil", "nasıl", "hangi", "kac", "kaç", "nerede", "nerde", "suan", "şuan", "simdi", "şimdi",
    "ben", "bana", "beni", "biz", "bize", "yardim", "yardım", "yardimci", "yardımcı", "yardimci olun", "yardımcı olun"
  ];

  if (blacklist.includes(lower)) {
    return { isValid: false, reason: "Geçersiz/Sistem kelimesi", confidence: 'low' };
  }

  const words = cleaned.split(/\s+/);
  for (const w of words) {
    const wLower = trLowerCase(w);
    if (blacklist.includes(wLower)) {
      return { isValid: false, reason: `Geçersiz kelime içeriyor: ${w}`, confidence: 'low' };
    }
  }

  // 5. Repeated character sequence heuristic (e.g. "aaaa", "asdasdasd")
  if (/(.)\1\1/.test(cleaned)) {
    return { isValid: false, reason: "Tekrarlanan karakter içeriyor", confidence: 'low' };
  }

  // 6. Gibberish check: if a single word has length >= 4 and has no vowels at all
  // Only apply to Latin-based words, or check Cyrillic vowels if it is Cyrillic.
  const vowels = /[aeiouyâêîôûıöü]/i;
  const cyrillicVowels = /[аеёиоуыэюя]/i;
  for (const w of words) {
    if (w.length >= 4) {
      const isCyrillic = /[\u0400-\u04FF]/.test(w);
      if (isCyrillic) {
        if (!cyrillicVowels.test(w)) {
          return { isValid: false, reason: "Sesli harf barındırmayan kelime (rastgele)", confidence: 'low' };
        }
      } else {
        const hasLatin = /[a-z]/i.test(w);
        if (hasLatin && !vowels.test(w)) {
          return { isValid: false, reason: "Sesli harf barındırmayan kelime (rastgele)", confidence: 'low' };
        }
      }
    }
  }

  // Heuristic confidence: Single word is medium confidence, multiple words is high
  const confidence = words.length > 1 ? 'high' : 'medium';

  return { isValid: true, confidence };
}

export function isValidPatientName(name?: string | null): boolean {
  return checkNameValidity(name).isValid;
}

export interface PatientNameContext {
  manualPatientName?: string | null;
  oppRequesterName?: string | null;
  oppPatientName?: string | null;
  convPatientName?: string | null;
  customerDisplayName?: string | null;
  whatsappProfileName?: string | null;
  formPatientName?: string | null;
  formRawDataName?: string | null;
  phoneFallback?: string | null;
  patientConfirmedName?: string | null;
  aiExtractedName?: string | null;
  metadata?: any;
}

export interface NameResolution {
  displayName: string;
  nameSource: 'manual' | 'patient_confirmed' | 'whatsapp_profile' | 'form' | 'ai_extracted' | 'phone_fallback';
  nameConfidence: 'high' | 'medium' | 'low';
  nameConfirmationNeeded: boolean;
  invalidNameReason?: string;
}

/**
 * Resolves a unified patient name and returns the detailed resolution state
 */
export function resolvePatientNameDetailed(ctx?: PatientNameContext | null): NameResolution {
  const fallbackRes: NameResolution = {
    displayName: 'İsimsiz',
    nameSource: 'phone_fallback',
    nameConfidence: 'low',
    nameConfirmationNeeded: true
  };

  if (ctx?.phoneFallback) {
    const formatted = formatPhoneReadable(ctx.phoneFallback);
    if (formatted) {
      fallbackRes.displayName = formatted;
    }
  }

  if (!ctx) return fallbackRes;

  // 1. Manually locked customer_profile.name / manual name
  const isLocked = ctx.metadata?.name_locked === true || ctx.metadata?.name_locked === 'true';
  if (isLocked) {
    const candidates = [ctx.customerDisplayName, ctx.manualPatientName, ctx.patientConfirmedName];
    for (const cand of candidates) {
      if (cand) {
        const val = checkNameValidity(cand);
        if (val.isValid) {
          return {
            displayName: cand.trim(),
            nameSource: 'manual',
            nameConfidence: 'high',
            nameConfirmationNeeded: false
          };
        }
      }
    }
  }

  // 2. customer_profile.name, if not empty/placeholder
  if (ctx.customerDisplayName) {
    const val = checkNameValidity(ctx.customerDisplayName);
    if (val.isValid) {
      return {
        displayName: ctx.customerDisplayName.trim(),
        nameSource: 'manual',
        nameConfidence: val.confidence,
        nameConfirmationNeeded: false
      };
    }
  }

  // 3. conversation.display_name / whatsapp_profile_name / metadata profile name
  const step3Candidates = [
    ctx.convPatientName,
    ctx.whatsappProfileName,
    ctx.metadata?.profile_name,
    ctx.metadata?.whatsapp_profile_name
  ];
  for (const cand of step3Candidates) {
    if (cand) {
      const val = checkNameValidity(cand);
      if (val.isValid) {
        return {
          displayName: cand.trim(),
          nameSource: 'whatsapp_profile',
          nameConfidence: val.confidence,
          nameConfirmationNeeded: val.confidence !== 'high'
        };
      }
    }
  }

  // 4. latest lead/form name
  const step4Candidates = [
    ctx.formPatientName,
    ctx.formRawDataName
  ];
  for (const cand of step4Candidates) {
    if (cand) {
      const val = checkNameValidity(cand);
      if (val.isValid) {
        return {
          displayName: cand.trim(),
          nameSource: 'form',
          nameConfidence: val.confidence,
          nameConfirmationNeeded: val.confidence !== 'high'
        };
      }
    }
  }

  // AI extracted / Opportunity fields as fallback candidates
  const aiCandidates = [
    ctx.aiExtractedName,
    ctx.oppPatientName,
    ctx.oppRequesterName
  ];
  for (const cand of aiCandidates) {
    if (cand) {
      const val = checkNameValidity(cand);
      if (val.isValid) {
        return {
          displayName: cand.trim(),
          nameSource: 'ai_extracted',
          nameConfidence: val.confidence,
          nameConfirmationNeeded: true
        };
      }
    }
  }

  return fallbackRes;
}

export function resolvePatientDisplayName(ctx?: PatientNameContext | null): string {
  return resolvePatientNameDetailed(ctx).displayName;
}

/**
 * Clean phone numbers to digits only.
 */
function cleanPhoneDigits(phone: string): string {
  if (!phone) return '';
  return phone.replace(/\D/g, '');
}

/**
 * Formats a phone number in a readable, clean layout.
 * e.g., +90 (554) 683 33 06
 */
export function formatPhoneReadable(phone?: string | null): string {
  if (!phone) return '';
  let cleaned = cleanPhoneDigits(phone);

  if (cleaned.startsWith('0')) {
    cleaned = cleaned.substring(1);
  }
  if (cleaned.length === 10) {
    cleaned = '90' + cleaned;
  }

  // Special TR formatting
  if (cleaned.startsWith('90') && cleaned.length === 12) {
    const country = cleaned.substring(0, 2);
    const area = cleaned.substring(2, 5);
    const p1 = cleaned.substring(5, 8);
    const p2 = cleaned.substring(8, 10);
    const p3 = cleaned.substring(10, 12);
    return `+${country} (${area}) ${p1} ${p2} ${p3}`;
  }

  // Fallback / International clean formatting
  if (cleaned.length > 4) {
    return `+${cleaned}`;
  }
  return phone;
}

/**
 * Masks a phone number for sensitive views.
 * e.g., +90 (554) *** ** 06
 */
export function formatPhoneMasked(phone?: string | null): string {
  if (!phone) return '';
  let cleaned = cleanPhoneDigits(phone);

  if (cleaned.startsWith('0')) {
    cleaned = cleaned.substring(1);
  }
  if (cleaned.length === 10) {
    cleaned = '90' + cleaned;
  }

  // Special TR masked formatting
  if (cleaned.startsWith('90') && cleaned.length === 12) {
    const country = cleaned.substring(0, 2);
    const area = cleaned.substring(2, 5);
    const p3 = cleaned.substring(10, 12);
    return `+${country} (${area}) *** ** ${p3}`;
  }

  // International masking fallback
  if (cleaned.length > 6) {
    const len = cleaned.length;
    const start = cleaned.substring(0, 3);
    const end = cleaned.substring(len - 2);
    const stars = '*'.repeat(len - 5);
    return `+${start}${stars}${end}`;
  }

  return phone;
}
