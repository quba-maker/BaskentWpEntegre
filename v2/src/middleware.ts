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

// Hangi yollar hangi rollere açık?
const ROLE_PERMISSIONS: Record<string, string[]> = {
  '/admin': ['platform_admin'], // Sadece Quba Medya Süper Admin'i
  '/users': ['platform_admin', 'admin'],
  '/settings': ['platform_admin', 'admin'],
  '/integrations': ['platform_admin', 'admin'],
  '/bot': ['platform_admin', 'admin', 'agent'],
  '/inbox': ['platform_admin', 'admin', 'agent', 'viewer'],
  '/forms': ['platform_admin', 'admin', 'agent', 'viewer'],
  '/calendar': ['platform_admin', 'admin', 'agent', 'viewer'],
  '/': ['platform_admin', 'admin', 'agent', 'viewer'],
};

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // Login rotasına auth'lu gidilirse Dashboard'a yönlendir
  if (pathname === '/login') {
    const token = req.cookies.get("quba_session")?.value;
    if (token) {
      try {
        await jwtVerify(token, SECRET);
        return NextResponse.redirect(new URL("/", req.url));
      } catch (err) {}
    }
    return NextResponse.next();
  }

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
    const { payload } = await jwtVerify(token, SECRET);
    const userRole = payload.role as string;
    
    // RBAC: Korumalı rota kontrolü
    const baseRoute = `/${pathname.split('/')[1]}`; // Örn: /admin/users -> /admin
    
    // 1. platform_admin dışındaki herkesi /admin'den engelle
    if (baseRoute === '/admin' && userRole !== 'platform_admin' && userRole !== 'owner') {
      return NextResponse.redirect(new URL("/", req.url));
    }

    // 2. Platform Admin anasayfaya girmek isterse /admin'e yönlendir
    if (pathname === '/' && userRole === 'platform_admin') {
      return NextResponse.redirect(new URL("/admin", req.url));
    }

    // 3. Diğer sayfalar için yetki matrisi kontrolü
    const allowedRoles = ROLE_PERMISSIONS[baseRoute] || ROLE_PERMISSIONS[pathname];
    
    // Geçici 'owner' rolü desteği (veritabanı güncellenene kadar)
    const isTempOwner = userRole === 'owner';
    
    if (allowedRoles && !allowedRoles.includes(userRole) && !isTempOwner) {
      // Eğer zaten / sayfasındaysa ve yetkisi yoksa sonsuz döngüyü engelle
      if (pathname === '/') {
        const response = NextResponse.redirect(new URL("/login", req.url));
        response.cookies.delete("quba_session");
        return response;
      }
      return NextResponse.redirect(new URL("/", req.url));
    }

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
    "/",
    "/inbox/:path*",
    "/bot/:path*",
    "/forms/:path*",
    "/calendar/:path*",
    "/integrations/:path*",
    "/settings/:path*",
    "/admin/:path*",
    "/users/:path*",
    "/analytics/:path*",
    "/login"
  ],
};
