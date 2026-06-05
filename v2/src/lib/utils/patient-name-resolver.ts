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
  const lower = cleaned.toLowerCase();

  // 1. Reject username/nickname formats containing underscores
  if (/_/.test(cleaned)) {
    return { isValid: false, reason: "Kullanıcı adı biçimi (alt çizgi)", confidence: 'low' };
  }

  // 2. Reject strings containing numbers/digits
  if (/[0-9]/.test(cleaned)) {
    return { isValid: false, reason: "Sayı içeriyor", confidence: 'low' };
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
    "hayırlı", "isler", "gunler", "aksamlar", "sabahlar", "telefon", "randevu", 
    "hastane", "doktor", "hemsire", "tedavi", "klinik", "baskent", "evet", "hayır", 
    "tabiki", "tamam", "ok", "yes", "no", "hello", "hi", "annem", "babam", 
    "kardesim", "esim", "kendisi", "turkiye", "türkiye", "almanya", "ingiltere", 
    "fransa", "belçika", "hollanda", "isimsiz",
    "user", "test", "admin", "deneme", "guest", "unknown", "undefined", "null", "bot", "sistem",
    "ülke", "sehir", "şehir", "departman", "country", "city", "department", "telefon numarası"
  ];

  if (blacklist.includes(lower)) {
    return { isValid: false, reason: "Geçersiz/Sistem kelimesi", confidence: 'low' };
  }

  const words = cleaned.split(/\s+/);
  for (const w of words) {
    const wLower = w.toLowerCase();
    if (blacklist.includes(wLower)) {
      return { isValid: false, reason: `Geçersiz kelime içeriyor: ${w}`, confidence: 'low' };
    }
  }

  // 5. Repeated character sequence heuristic (e.g. "aaaa", "asdasdasd")
  if (/(.)\1\1/.test(cleaned)) {
    return { isValid: false, reason: "Tekrarlanan karakter içeriyor", confidence: 'low' };
  }

  // 6. Gibberish check: if a single word has length >= 4 and has no vowels at all
  const vowels = /[aeiouyâêîôûıöü]/i;
  for (const w of words) {
    if (w.length >= 4 && !vowels.test(w)) {
      return { isValid: false, reason: "Sesli harf barındırmayan kelime (rastgele)", confidence: 'low' };
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

  // 1. Manual locked name
  if (ctx.metadata?.name_locked === true && ctx.manualPatientName) {
    const val = checkNameValidity(ctx.manualPatientName);
    if (val.isValid) {
      return {
        displayName: ctx.manualPatientName.trim(),
        nameSource: 'manual',
        nameConfidence: 'high',
        nameConfirmationNeeded: false
      };
    }
  }
  // Even if not locked in metadata, if we have manual name, validate it
  if (ctx.manualPatientName) {
    const val = checkNameValidity(ctx.manualPatientName);
    if (val.isValid) {
      return {
        displayName: ctx.manualPatientName.trim(),
        nameSource: 'manual',
        nameConfidence: val.confidence,
        nameConfirmationNeeded: false
      };
    }
  }

  // 2. Patient confirmed name
  if (ctx.patientConfirmedName) {
    const val = checkNameValidity(ctx.patientConfirmedName);
    if (val.isValid) {
      return {
        displayName: ctx.patientConfirmedName.trim(),
        nameSource: 'patient_confirmed',
        nameConfidence: 'high',
        nameConfirmationNeeded: false
      };
    }
  }

  // 3. WhatsApp Profile Name
  if (ctx.whatsappProfileName) {
    const val = checkNameValidity(ctx.whatsappProfileName);
    if (val.isValid) {
      return {
        displayName: ctx.whatsappProfileName.trim(),
        nameSource: 'whatsapp_profile',
        nameConfidence: val.confidence,
        nameConfirmationNeeded: val.confidence !== 'high' // need confirmation if medium/low (single word)
      };
    }
  }

  // 4. Form Full Name
  if (ctx.formPatientName) {
    const val = checkNameValidity(ctx.formPatientName);
    if (val.isValid) {
      return {
        displayName: ctx.formPatientName.trim(),
        nameSource: 'form',
        nameConfidence: val.confidence,
        nameConfirmationNeeded: val.confidence !== 'high'
      };
    }
  }
  if (ctx.formRawDataName) {
    const val = checkNameValidity(ctx.formRawDataName);
    if (val.isValid) {
      return {
        displayName: ctx.formRawDataName.trim(),
        nameSource: 'form',
        nameConfidence: val.confidence,
        nameConfirmationNeeded: val.confidence !== 'high'
      };
    }
  }

  // 5. Patient Statement / AI Extracted / Database Mirror fields
  const aiCandidates = [
    { name: ctx.aiExtractedName, source: 'ai_extracted' as const },
    { name: ctx.oppPatientName, source: 'ai_extracted' as const },
    { name: ctx.oppRequesterName, source: 'ai_extracted' as const },
    { name: ctx.convPatientName, source: 'ai_extracted' as const },
    { name: ctx.customerDisplayName, source: 'ai_extracted' as const }
  ];

  for (const candidate of aiCandidates) {
    if (candidate.name) {
      const val = checkNameValidity(candidate.name);
      if (val.isValid) {
        return {
          displayName: candidate.name.trim(),
          nameSource: candidate.source,
          nameConfidence: val.confidence,
          nameConfirmationNeeded: true // AI extracted names always deserve confirmation
        };
      }
    }
  }

  // 6. Fallback
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
