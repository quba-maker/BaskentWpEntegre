export interface PatientNameContext {
  manualPatientName?: string | null;
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
export function resolvePatientDisplayName(ctx?: PatientNameContext | null): string {
  if (!ctx) return 'İsimsiz';

  // 1. Manuel düzeltilmiş hasta adı
  if (ctx.manualPatientName && ctx.manualPatientName.trim()) {
    return ctx.manualPatientName.trim();
  }

  // 2. Aktif opportunity patient_name
  if (ctx.oppPatientName && ctx.oppPatientName.trim()) {
    return ctx.oppPatientName.trim();
  }

  // 3. Conversation/customer display name
  if (ctx.convPatientName && ctx.convPatientName.trim()) {
    return ctx.convPatientName.trim();
  }
  if (ctx.customerDisplayName && ctx.customerDisplayName.trim()) {
    return ctx.customerDisplayName.trim();
  }

  // 4. WhatsApp / kanal profil adı
  if (ctx.whatsappProfileName && ctx.whatsappProfileName.trim()) {
    return ctx.whatsappProfileName.trim();
  }

  // 5. Form adı / raw_data içindeki ad
  if (ctx.formPatientName && ctx.formPatientName.trim()) {
    return ctx.formPatientName.trim();
  }
  if (ctx.formRawDataName && ctx.formRawDataName.trim()) {
    return ctx.formRawDataName.trim();
  }

  // 6. Hiçbiri yoksa İsimsiz
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
