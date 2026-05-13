import { NextRequest, NextResponse } from "next/server";
import { jwtVerify } from "jose";

// ==========================================
// QUBA AI — Route Protection Middleware
// ==========================================

const SECRET = new TextEncoder().encode(
  process.env.AUTH_SECRET || "quba-ai-secret-key-change-in-production"
);

// Giriş gerektirmeyen public route'lar
const PUBLIC_ROUTES = ["/login", "/privacy", "/terms", "/api/webhook", "/api/telegram"];

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // Public route'lar → geç
  if (PUBLIC_ROUTES.some((r) => pathname.startsWith(r))) {
    return NextResponse.next();
  }

  // API route'ları → geç (kendi auth'ları var)
  if (pathname.startsWith("/api/")) {
    return NextResponse.next();
  }

  // Session kontrolü
  const token = req.cookies.get("quba_session")?.value;
  if (!token) {
    return NextResponse.redirect(new URL("/login", req.url));
  }

  try {
    await jwtVerify(token, SECRET);
    return NextResponse.next();
  } catch {
    // Token geçersiz veya süresi dolmuş
    const response = NextResponse.redirect(new URL("/login", req.url));
    response.cookies.delete("quba_session");
    return response;
  }
}

export const config = {
  matcher: [
    // Root + tüm dashboard sayfaları
    "/",
    "/inbox/:path*",
    "/bot/:path*",
    "/forms/:path*",
    "/calendar/:path*",
    "/integrations/:path*",
    "/settings/:path*",
    "/admin/:path*",
    "/analytics/:path*",
  ],
};
