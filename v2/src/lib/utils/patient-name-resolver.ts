
/**
 * Validates whether a given string is a plausible patient name.
 * Programmatically filters out AI hallucinations (Turkish city names, prepositions, hitaps, etc.)
 */
export function isValidPatientName(name?: string | null): boolean {
  if (!name || !name.trim()) return false;
  const cleaned = name.trim();
  const lower = cleaned.toLowerCase();

  const blacklist = [
    "konya", "konyaya", "konya'ya", "istanbul", "ankara", "izmir", "antalya", 
    "adana", "bursa", "samsun", "trabzon", "merhaba", "selam", "selamlar", 
    "hayırlı", "isler", "gunler", "aksamlar", "sabahlar", "telefon", "randevu", 
    "hastane", "doktor", "hemsire", "tedavi", "klinik", "baskent", "evet", "hayır", 
    "tabiki", "tamam", "ok", "yes", "no", "hello", "hi", "annem", "babam", 
    "kardesim", "esim", "kendisi", "turkiye", "türkiye", "almanya", "ingiltere", 
    "fransa", "belçika", "hollanda", "isimsiz"
  ];

  if (blacklist.includes(lower)) return false;
  if (cleaned.length < 2 || cleaned.length > 50) return false;
  if (/[0-9]/.test(cleaned)) return false;

  const words = lower.split(/\s+/);
  for (const word of words) {
    if (blacklist.includes(word)) return false;
  }
  return true;
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
}

/**
 * Resolves a unified patient display name based on a strict priority chain.
 * Null-safe and robust.
 */

/**
 * Resolves a unified patient display name based on a strict priority chain.
 * Null-safe and robust.
 */
export function resolvePatientDisplayName(ctx?: PatientNameContext | null): string {
  if (!ctx) return 'İsimsiz';

  if (ctx.manualPatientName && isValidPatientName(ctx.manualPatientName)) return ctx.manualPatientName.trim();
  if (ctx.oppRequesterName && isValidPatientName(ctx.oppRequesterName)) return ctx.oppRequesterName.trim();
  if (ctx.oppPatientName && isValidPatientName(ctx.oppPatientName)) return ctx.oppPatientName.trim();
  if (ctx.convPatientName && isValidPatientName(ctx.convPatientName)) return ctx.convPatientName.trim();
  if (ctx.customerDisplayName && isValidPatientName(ctx.customerDisplayName)) return ctx.customerDisplayName.trim();
  if (ctx.formRawDataName && isValidPatientName(ctx.formRawDataName)) return ctx.formRawDataName.trim();
  if (ctx.formPatientName && isValidPatientName(ctx.formPatientName)) return ctx.formPatientName.trim();
  if (ctx.whatsappProfileName && isValidPatientName(ctx.whatsappProfileName)) return ctx.whatsappProfileName.trim();

  return 'İsimsiz';
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
