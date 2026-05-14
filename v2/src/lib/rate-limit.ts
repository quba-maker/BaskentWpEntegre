// ==========================================
// QUBA AI — In-Memory Rate Limiter
// Login brute-force ve API abuse koruması
// Vercel serverless-friendly (instance bazlı)
// ==========================================

const attempts = new Map<string, { count: number; resetAt: number }>();

export function checkRateLimit(
  key: string,
  maxAttempts: number = 5,
  windowMs: number = 60_000 // 1 dakika
): { allowed: boolean; remaining: number; retryAfterMs: number } {
  const now = Date.now();
  const entry = attempts.get(key);

  // Süre dolmuşsa sıfırla
  if (!entry || now > entry.resetAt) {
    attempts.set(key, { count: 1, resetAt: now + windowMs });
    return { allowed: true, remaining: maxAttempts - 1, retryAfterMs: 0 };
  }

  entry.count++;
  if (entry.count > maxAttempts) {
    return {
      allowed: false,
      remaining: 0,
      retryAfterMs: entry.resetAt - now,
    };
  }

  return {
    allowed: true,
    remaining: maxAttempts - entry.count,
    retryAfterMs: 0,
  };
}

// Bellek temizliği (her 5 dakikada eski kayıtları sil)
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of attempts) {
    if (now > entry.resetAt) attempts.delete(key);
  }
}, 300_000);
