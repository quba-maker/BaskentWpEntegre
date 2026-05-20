import { Ratelimit } from '@upstash/ratelimit';
import { redis } from './redis';

// ==========================================
// QUBA AI — Enterprise Rate Limiter
// ==========================================

/**
 * Enterprise Rate Limiter using Upstash Redis for distributed state across Vercel edge nodes.
 * Falls back to in-memory map if Redis is not configured (e.g. local dev).
 */

const fallbackAttempts = new Map<string, { count: number; resetAt: number }>();

let upstashRatelimit: Ratelimit | null = null;

if (redis) {
  upstashRatelimit = new Ratelimit({
    redis,
    limiter: Ratelimit.slidingWindow(10, '1 m'),
    analytics: true,
    prefix: '@quba-ai/ratelimit',
  });
}

export async function checkRateLimit(
  key: string,
  maxAttempts: number = 10,
  windowMs: number = 60_000 // 1 minute (used by fallback only)
): Promise<{ allowed: boolean; remaining: number; retryAfterMs: number }> {
  
  if (upstashRatelimit) {
    // Distributed Rate Limiting
    const result = await upstashRatelimit.limit(key);
    return {
      allowed: result.success,
      remaining: result.remaining,
      retryAfterMs: result.success ? 0 : result.reset - Date.now(),
    };
  }

  // Fallback to In-Memory for local dev
  const now = Date.now();
  const entry = fallbackAttempts.get(key);

  if (!entry || now > entry.resetAt) {
    fallbackAttempts.set(key, { count: 1, resetAt: now + windowMs });
    return { allowed: true, remaining: maxAttempts - 1, retryAfterMs: 0 };
  }

  entry.count++;
  if (entry.count > maxAttempts) {
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

// Memory cleanup for fallback
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of fallbackAttempts) {
    if (now > entry.resetAt) fallbackAttempts.delete(key);
  }
}, 300_000);
