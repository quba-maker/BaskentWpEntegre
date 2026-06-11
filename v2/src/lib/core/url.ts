/**
 * Resolves the public base URL for this application.
 * Used by QStash, webhook destinations, and any server-side URL construction.
 * 
 * Priority:
 * 1. NEXT_PUBLIC_APP_URL (explicitly set by admin)
 * 2. VERCEL_PROJECT_PRODUCTION_URL (auto-set by Vercel for production)
 * 3. VERCEL_URL (auto-set by Vercel for all deployments including preview)
 * 4. Hardcoded fallback (last resort)
 */
export function getPublicBaseUrl(): string {
  if (process.env.NEXT_PUBLIC_APP_URL) {
    return process.env.NEXT_PUBLIC_APP_URL.replace(/\/$/, '');
  }
  if (process.env.VERCEL_PROJECT_PRODUCTION_URL) {
    return `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`;
  }
  if (process.env.VERCEL_URL) {
    return `https://${process.env.VERCEL_URL}`;
  }
  // Absolute last resort — should never reach here in production
  return 'https://ai.qubamedya.com';
}
