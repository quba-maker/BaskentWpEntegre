import { NextResponse } from "next/server";
import { withTenantDB } from "@/lib/core/tenant-db";

/**
 * Health Check Endpoint
 * 
 * Returns service health for uptime monitoring (UptimeRobot, Vercel, etc.)
 * Checks: database connectivity, basic Ably config, environment integrity.
 * 
 * GET /api/health
 */
export async function GET() {
  const checks: Record<string, { status: "ok" | "degraded" | "down"; latencyMs?: number; detail?: string }> = {};
  const startAll = Date.now();

  // 1. Database connectivity
  try {
    const dbStart = Date.now();
    const systemDb = withTenantDB('admin-system', true);
    await systemDb.executeSafe("SELECT 1 AS ping");
    checks.database = { status: "ok", latencyMs: Date.now() - dbStart };
  } catch (err: any) {
    checks.database = { status: "down", detail: err?.message?.substring(0, 100) };
  }

  // 2. Ably configuration check (not connectivity — just env presence)
  const ablyKeyExists = !!process.env.ABLY_API_KEY;
  checks.ably = {
    status: ablyKeyExists ? "ok" : "degraded",
    detail: !ablyKeyExists ? "ABLY_API_KEY missing" : undefined,
  };

  // 3. Meta integration check (env presence)
  const metaToken = !!process.env.META_ACCESS_TOKEN;
  const phoneId = !!process.env.PHONE_NUMBER_ID;
  checks.meta = {
    status: metaToken && phoneId ? "ok" : "degraded",
    detail: !metaToken ? "META_ACCESS_TOKEN missing" : !phoneId ? "PHONE_NUMBER_ID missing" : undefined,
  };

  // 4. QStash / Queue config
  const qstashToken = !!process.env.QSTASH_TOKEN;
  checks.queue = {
    status: qstashToken ? "ok" : "degraded",
    detail: !qstashToken ? "QSTASH_TOKEN missing" : undefined,
  };

  // 5. Auth config
  const authSecretExists = !!process.env.AUTH_SECRET;
  checks.auth = {
    status: authSecretExists ? "ok" : "degraded",
    detail: !authSecretExists ? "AUTH_SECRET missing" : undefined,
  };

  // Compute overall status
  const allStatuses = Object.values(checks).map(c => c.status);
  const overallStatus = allStatuses.includes("down") ? "down" : allStatuses.includes("degraded") ? "degraded" : "ok";

  const response = {
    status: overallStatus,
    version: "2.0",
    timestamp: new Date().toISOString(),
    uptimeMs: Date.now() - startAll,
    checks,
  };

  const httpStatus = overallStatus === "down" ? 503 : 200;

  return NextResponse.json(response, { 
    status: httpStatus,
    headers: {
      "Cache-Control": "no-store, no-cache, must-revalidate",
    }
  });
}
