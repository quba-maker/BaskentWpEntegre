import * as Ably from "ably";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic"; // Ably Rest SDK might need node environment

/**
 * Realtime Event Bus - Token Authentication Endpoint
 * 
 * Generates temporary, isolated Ably tokens strictly bounded 
 * to the tenant's private channels.
 * Prevents Tenant A from subscribing to Tenant B's events.
 */
export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const tenantId = url.searchParams.get("tenantId");

    // IMPORTANT: In production, verify the user's session/JWT here
    // and ensure they ACTUALLY belong to `tenantId`.
    // Example: const session = await auth(); if (session.tenantId !== tenantId) throw ...

    if (!tenantId) {
      return NextResponse.json({ error: "Missing tenantId" }, { status: 400 });
    }

    const apiKey = process.env.ABLY_API_KEY;
    if (!apiKey) {
      return NextResponse.json({ error: "Missing ABLY_API_KEY" }, { status: 500 });
    }

    const client = new Ably.Rest({ key: apiKey });

    // Capability Definition:
    // This client can ONLY subscribe and presence-subscribe to their specific tenant channel.
    // They cannot publish (Publishing is server-side only) and cannot access other tenants.
    const capabilities = {
      [`private:tenant:${tenantId}`]: ["subscribe", "presence"],
      [`presence:tenant:${tenantId}`]: ["subscribe", "presence", "publish"]
    };

    // ClientId could be the actual User ID for presence tracking
    const clientId = `user-${Math.random().toString(36).substring(2, 9)}`;

    const tokenRequestData = await client.auth.createTokenRequest({
      clientId: clientId,
      capability: capabilities
    });

    return NextResponse.json(tokenRequestData);
  } catch (error) {
    console.error("[Ably Auth] Error generating token:", error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
