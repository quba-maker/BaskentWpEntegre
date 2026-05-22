import { NextResponse } from 'next/server';

/**
 * TEMPORARY diagnostic endpoint to verify environment variables at runtime.
 * DELETE after Phase 2C verification.
 */
export async function GET() {
  return NextResponse.json({
    USE_V2_BRAIN_RESOLUTION: process.env.USE_V2_BRAIN_RESOLUTION || 'NOT_SET',
    USE_V2_BRAIN_RESOLUTION_type: typeof process.env.USE_V2_BRAIN_RESOLUTION,
    USE_V2_BRAIN_RESOLUTION_exact: JSON.stringify(process.env.USE_V2_BRAIN_RESOLUTION),
    isTrue: process.env.USE_V2_BRAIN_RESOLUTION === 'true',
    VERCEL_ENV: process.env.VERCEL_ENV || 'NOT_SET',
    NODE_ENV: process.env.NODE_ENV || 'NOT_SET',
    timestamp: new Date().toISOString()
  });
}
