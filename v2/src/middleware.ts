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

  // Public ve API route'larını pas geç
  if (PUBLIC_ROUTES.some((r) => pathname.startsWith(r)) || pathname.startsWith("/api/")) {
    // Sadece /login ise auth kontrolü yapıp içeri at
    if (pathname === '/login') {
      const token = req.cookies.get("quba_session")?.value;
      if (token) {
        try {
          const { payload } = await jwtVerify(token, SECRET);
          const tSlug = payload.tenantSlug as string;
          return NextResponse.redirect(new URL(`/${tSlug}`, req.url));
        } catch (err) {}
      }
    }
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
    const sessionTenantSlug = payload.tenantSlug as string;
    
    // URL Analizi (Path-based routing)
    // Örn: /baskent/forms -> parts = ['baskent', 'forms']
    const parts = pathname.split('/').filter(Boolean);
    const urlTenantSlug = parts[0];
    const baseRoute = parts.length > 1 ? `/${parts[1]}` : '/';

    // Kök dizin erişimi (Örn: Sadece ai.qubamedya.com girildiyse)
    if (!urlTenantSlug) {
       if (userRole === 'platform_admin') return NextResponse.redirect(new URL("/admin", req.url));
       return NextResponse.redirect(new URL(`/${sessionTenantSlug}`, req.url));
    }

    // TENANT ISOLATION KONTROLÜ (GÜMRÜK KAPISI)
    if (urlTenantSlug !== sessionTenantSlug && userRole !== 'platform_admin' && userRole !== 'owner') {
      return NextResponse.redirect(new URL(`/${sessionTenantSlug}`, req.url));
    }

    // Admin Rota Kontrolü
    if (urlTenantSlug === 'admin' || baseRoute === '/admin') {
      if (userRole !== 'platform_admin' && userRole !== 'owner') {
        return NextResponse.redirect(new URL(`/${sessionTenantSlug}`, req.url));
      }
    }

    // Diğer sayfalar için yetki matrisi kontrolü
    const allowedRoles = ROLE_PERMISSIONS[baseRoute];
    const isTempOwner = userRole === 'owner';
    
    if (allowedRoles && !allowedRoles.includes(userRole) && !isTempOwner) {
      return NextResponse.redirect(new URL(`/${sessionTenantSlug}`, req.url));
    }

    return NextResponse.next();
  } catch {
    const response = NextResponse.redirect(new URL("/login", req.url));
    response.cookies.delete("quba_session");
    return response;
  }
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
};
