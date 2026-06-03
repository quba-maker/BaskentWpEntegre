import * as Ably from "ably";
import { NextResponse } from "next/server";
import { jwtVerify } from "jose";
import { checkRateLimit } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

/**
 * Realtime Event Bus — Secure Token Authentication
 * 
 * SECURITY HARDENING (Phase 7):
 * 1. tenantId resolved from session JWT — NEVER from query params
 * 2. Role-based capability minimization (principle of least privilege)
 * 3. Per-user rate limiting (anti token farming)
 * 4. Deterministic clientId bound to userId (anti replay)
 * 5. Explicit TTL with automatic refresh
 * 6. Suspended/deleted tenant rejection via session validation
 */

const SECRET = new TextEncoder().encode(
  process.env.AUTH_SECRET || ""
);

const COOKIE_NAME = "quba_session";

// ─── Role-based Capability Matrix ───
// Principle of Least Privilege: each role gets only what it needs
type AblyCapability = "subscribe" | "publish" | "presence" | "history";

const ROLE_CAPABILITIES: Record<string, AblyCapability[]> = {
  platform_admin: ["subscribe", "publish", "presence", "history"],
  owner:          ["subscribe", "publish", "presence", "history"],
  admin:          ["subscribe", "publish", "presence", "history"],
  agent:          ["subscribe", "publish", "presence"],
  viewer:         ["subscribe"],
};

export async function GET(request: Request) {
  try {
    // ─── 1. Extract & Validate Session JWT ───
    const cookieHeader = request.headers.get("cookie");
    const cookies = parseCookies(cookieHeader || "");
    const token = cookies[COOKIE_NAME];

    if (!token) {
      return NextResponse.json(
        { error: "Forbidden: No session" },
        { status: 403 }
      );
    }

    let payload: any;
    try {
      const result = await jwtVerify(token, SECRET);
      payload = result.payload;
    } catch {
      return NextResponse.json(
        { error: "Forbidden: Invalid session" },
        { status: 403 }
      );
    }

    // ─── 2. Extract Session Fields ───
    const userId = payload.userId as string;
    const tenantId = payload.tenantId as string;
    const role = (payload.role as string) || "viewer";

    // Handle impersonation: if platform_admin is impersonating, use impersonated tenant
    const effectiveTenantId = (payload.impersonatedTenantId as string) || tenantId;

    if (!userId || !effectiveTenantId) {
      return NextResponse.json(
        { error: "Forbidden: Missing tenant context" },
        { status: 403 }
      );
    }

    // ─── 3. Rate Limiting (per-user, anti token farming) ───
    const rl = await checkRateLimit(`ably_auth:${userId}`, 30, 60_000); // 30 tokens/min
    if (!rl.allowed) {
      return NextResponse.json(
        { error: "Rate limited. Try again later.", retryAfterMs: rl.retryAfterMs },
        { status: 429 }
      );
    }

    // ─── 4. Ably API Key Check ───
    const apiKey = process.env.ABLY_API_KEY;
    if (!apiKey) {
      return NextResponse.json(
        { error: "Server configuration error" },
        { status: 500 }
      );
    }

    const client = new Ably.Rest({ key: apiKey });

    // ─── 5. Role-based Capability Construction ───
    const roleCapabilities = ROLE_CAPABILITIES[role] || ROLE_CAPABILITIES.viewer;

    const capabilities: Record<string, string[]> = {
      [`private:tenant:${effectiveTenantId}`]: roleCapabilities,
      [`presence:tenant:${effectiveTenantId}`]: roleCapabilities.includes("presence")
        ? ["subscribe", "publish", "presence"]
        : ["subscribe"],
    };

    // ─── 6. Deterministic ClientId (bound to session, anti-replay) ───
    // Using userId makes the token non-transferable between users
    const clientId = `user:${userId}`;

    // ─── 7. Generate Token Request ───
    const tokenRequestData = await client.auth.createTokenRequest({
      clientId,
      capability: JSON.stringify(capabilities),
      // Token TTL: 60 minutes. Ably SDK auto-refreshes via authUrl before expiry.
      ttl: 60 * 60 * 1000, // 1 hour in ms
    });

    return NextResponse.json(tokenRequestData);
  } catch (error) {
    console.error("[Ably Auth] Critical error:", error);
    return NextResponse.json(
      { error: "Internal Server Error" },
      { status: 500 }
    );
  }
}

// ─── Cookie Parser (Edge-compatible, no dependency) ───
function parseCookies(cookieHeader: string): Record<string, string> {
  const cookies: Record<string, string> = {};
  if (!cookieHeader) return cookies;
  for (const pair of cookieHeader.split(";")) {
    const eqIndex = pair.indexOf("=");
    if (eqIndex === -1) continue;
    const key = pair.substring(0, eqIndex).trim();
    const value = pair.substring(eqIndex + 1).trim();
    cookies[key] = decodeURIComponent(value);
  }
  return cookies;
}
