import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth/session';
import { checkRateLimit } from '@/lib/rate-limit';
import { redis } from '@/lib/redis';

export const runtime = 'edge';

/**
 * Generates a short-lived, single-use ticket for SSE connection.
 * This ensures the SSE endpoint can remain unauthenticated in middleware 
 * while maintaining strict enterprise tenant isolation and security.
 */
export async function POST(req: NextRequest) {
  try {
    // 1. Authenticate user
    const session = await getSession();
    if (!session || !session.tenantSlug || !session.userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // 2. Strict Rate Limiting (Prevent ticket flooding)
    const ip = req.headers.get('x-forwarded-for') || '127.0.0.1';
    const rateLimit = await checkRateLimit(`ticket_rate_limit_${ip}`);
    if (!rateLimit.allowed) {
      return NextResponse.json(
        { error: 'Too many requests' },
        { status: 429, headers: { 'Retry-After': Math.ceil(rateLimit.retryAfterMs / 1000).toString() } }
      );
    }

    // 3. Generate Secure Ticket
    const ticket = crypto.randomUUID();

    // 4. Store Ticket (Redis preferred, fallback to nothing if Redis isn't connected.
    // If Redis isn't connected, we just return the ticket and the SSE route will trust it 
    // for local development, or fail. For true security, Redis is required.)
    if (redis) {
      // Store ticket with 30-second expiry
      await redis.setex(`sse_ticket:${ticket}`, 30, JSON.stringify({
        tenantSlug: session.tenantSlug,
        userId: session.userId,
        timestamp: Date.now()
      }));
    } else {
      console.warn('[SECURITY] Upstash Redis not configured. Ticket-based auth is running in mock mode for local dev.');
    }

    return NextResponse.json({ ticket });
  } catch (error) {
    console.error('[SSE Ticket Error]', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
