// ==========================================
// QUBA AI — Rate Limiter
// ==========================================

/**
 * Enterprise Rate Limiter
 * Note: In a true Vercel Serverless environment with multiple concurrent edge nodes,
 * an in-memory map will only rate-limit per-instance. 
 * For global state, integrate @upstash/redis or a Neon DB `rate_limits` table.
 * 
 * This implementation adds strict boundaries, jitter, and tenant isolation 
 * to prevent API abuse before the global state provider is connected.
 */
const attempts = new Map<string, { count: number; resetAt: number }>();

export function checkRateLimit(
  key: string,
  maxAttempts: number = 10,
  windowMs: number = 60_000 // 1 minute
): { allowed: boolean; remaining: number; retryAfterMs: number } {
  const now = Date.now();
  const entry = attempts.get(key);

  if (!entry || now > entry.resetAt) {
    attempts.set(key, { count: 1, resetAt: now + windowMs });
    return { allowed: true, remaining: maxAttempts - 1, retryAfterMs: 0 };
  }

  entry.count++;
  if (entry.count > maxAttempts) {
    // Implement penalty backoff: if they keep hitting it, push the reset window further
    const penaltyJitter = Math.floor(Math.random() * 5000);
    entry.resetAt = now + windowMs + penaltyJitter;
    
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

// Memory cleanup (every 5 mins)
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of attempts) {
    if (now > entry.resetAt) attempts.delete(key);
  }
}, 300_000);
