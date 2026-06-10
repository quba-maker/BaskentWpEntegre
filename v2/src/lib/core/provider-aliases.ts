// ==========================================
// QUBA AI — Provider Alias Normalization
// ==========================================
// DB'de "meta_instagram" saklanırken runtime "instagram" kullanır.
// Bu helper merkezi alias çözümü sağlar.
// Tüm downstream servisler bunu kullanmalıdır.
// ==========================================

/**
 * Runtime provider adını DB alias dizisine çevirir.
 * SQL: WHERE c.provider = ANY($2::text[])
 */
export function getProviderAliases(provider: string): string[] {
  switch (provider) {
    case 'instagram':
    case 'meta_instagram':
      return ['instagram', 'meta_instagram'];
    case 'whatsapp':
    case '360dialog':
    case '360dialog_whatsapp':
      return ['whatsapp', '360dialog', '360dialog_whatsapp'];
    case 'messenger':
      return ['messenger'];
    default:
      return [provider];
  }
}

/**
 * Runtime'dan gelen provider adını canonical forma çevirir.
 * Canonical form: 'whatsapp' | 'instagram' | 'messenger'
 */
export function canonicalProvider(provider: string): string {
  if (provider === 'meta_instagram') return 'instagram';
  if (provider === '360dialog' || provider === '360dialog_whatsapp') return 'whatsapp';
  return provider;
}

/**
 * Messenger channel identifier'ının valid olup olmadığını kontrol eder.
 * Geçerli identifier: numeric Page ID
 */
export function isValidMessengerIdentifier(identifier: string): boolean {
  return /^\d{5,}$/.test(identifier);
}

export function normalizeProvider(provider?: string | null): string {
  return String(provider || '').trim().toLowerCase();
}

export function isThreeSixtyProvider(provider?: string | null): boolean {
  const p = normalizeProvider(provider);
  return p === '360dialog' || p === '360dialog_whatsapp' || p === 'threesixty' || p === 'three_sixty_dialog';
}

export function requiresWhatsAppPhoneNumberId(provider?: string | null): boolean {
  return !isThreeSixtyProvider(provider);
}

