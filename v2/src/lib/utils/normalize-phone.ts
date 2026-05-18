export function normalizePhone(phone: string): string {
  if (!phone) return '';

  let cleaned = phone.replace(/\D/g, '');

  if (cleaned.startsWith('0')) {
    cleaned = cleaned.substring(1);
  }

  if (cleaned.length === 10) {
    cleaned = '90' + cleaned;
  }

  return cleaned;
}
