/**
 * Normalizes a phone number to digits only, optionally keeping the plus sign.
 * Used for database matching and API calls.
 */
export function normalizePhoneForMatch(phone: string | null | undefined): string {
  if (!phone) return '';
  
  // Sadece rakamları ve '+' işaretini bırak
  let cleaned = phone.replace(/[^\d+]/g, '');
  
  // Eğer birden fazla + varsa, sadece en baştakini tut (çok nadir, ama veri kirliyse)
  if (cleaned.includes('+')) {
    const parts = cleaned.split('+');
    cleaned = '+' + parts.join('');
  }
  
  // Match işlemleri için baştaki +, 0 veya 90 prefix'lerinden arındırılmış son 10 haneyi çıkarabiliriz,
  // ancak WhatsApp genelde ülke kodlu gönderir. 
  // Güvenli bir match için (özellikle LIKE veya RIGHT(x, 10) yerine) 
  // hem full E.164 (varsa) hem de digits-only formunu döndürmek en iyisidir.
  // Burada string olarak digits-only'nin son 10 hanesi değil, direkt digits halini dönüyoruz.
  // SQL içinde match ederken bu pure digits hali üzerinden '%1234567890' gibi de kullanılabilir.
  
  return cleaned.replace(/\+/g, '');
}

/**
 * Returns the last 10 digits for strict matching (useful for local TR numbers without country code).
 * Returns empty if length < 10.
 */
export function getPhoneLast10(phone: string | null | undefined): string {
  const digits = normalizePhoneForMatch(phone);
  return digits.length >= 10 ? digits.slice(-10) : digits;
}
