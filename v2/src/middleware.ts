import { NextRequest, NextResponse } from "next/server";
import { jwtVerify } from "jose";

// ==========================================
// QUBA AI — Route Protection Middleware
// ==========================================

const SECRET = new TextEncoder().encode(
  process.env.AUTH_SECRET || ""
);

// Giriş gerektirmeyen public route'lar
const PUBLIC_ROUTES = ["/login", "/privacy", "/terms", "/data-deletion", "/legal", "/support"];

// Hangi yollar hangi rollere açık?
const ROLE_PERMISSIONS: Record<string, string[]> = {
  '/admin': ['platform_admin'], // Sadece Quba Medya Süper Admin'i
  '/users': ['platform_admin', 'admin'],
  '/settings': ['platform_admin', 'admin'],
  '/integrations': ['platform_admin', 'admin'],
  '/bot': ['platform_admin', 'admin', 'agent'],
  '/inbox': ['platform_admin', 'admin', 'agent', 'viewer'],
  '/forms': ['platform_admin', 'admin', 'agent', 'viewer'],
  '/': ['platform_admin', 'admin', 'agent', 'viewer'],
};

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // 1. Trailing slash normalizasyonu (Kök dizin "/" hariç)
  let cleanPath = pathname;
  if (cleanPath !== "/" && cleanPath.endsWith("/")) {
    cleanPath = cleanPath.slice(0, -1);
  }

  // 2. Sayfa düzeyinde tam eşleşme kontrolü (Exact match)
  const isPublicPage = PUBLIC_ROUTES.includes(cleanPath) || cleanPath === "/";

  // 3. API düzeyinde güvenli önek kontrolü (API routes are NOT public by default)
  const allowedPublicApiPrefixes = [
    "/api/webhooks/",
    "/api/sheets-webhook",
    "/api/telegram",
    "/api/health",
    "/api/cron/",
    "/api/cron-",
    "/api/follow-up"
  ];

  const isPublicApi = allowedPublicApiPrefixes.some(prefix => {
    if (prefix.endsWith("/")) {
      const base = prefix.slice(0, -1);
      return cleanPath === base || cleanPath.startsWith(prefix);
    }
    if (prefix.endsWith("-")) {
      return cleanPath.startsWith(prefix);
    }
    return cleanPath === prefix || cleanPath.startsWith(prefix + "/");
  });

  const isPublicRoute = isPublicPage || isPublicApi;

  if (isPublicRoute) {
    const token = req.cookies.get("quba_session")?.value;
    
    // Giriş yapmış kullanıcı / veya /login sayfasına gelirse dashboard'a yönlendir
    if (token && (cleanPath === '/login' || cleanPath === '/')) {
      try {
        const { payload } = await jwtVerify(token, SECRET);
        const tSlug = payload.tenantSlug as string;
        const userRole = payload.role as string;
        
        if (cleanPath === '/login') {
          if (process.env.NODE_ENV !== 'production') console.log(`[AUTH AUDIT] User already logged in, redirecting /login -> /${tSlug}`);
          return NextResponse.redirect(new URL(`/${tSlug}`, req.url));
        } else {
          // cleanPath === '/'
          if (userRole === 'platform_admin') {
            return NextResponse.redirect(new URL("/admin", req.url));
          }
          if (tSlug) {
            return NextResponse.redirect(new URL(`/${tSlug}`, req.url));
          }
        }
      } catch (err) {}
    }
    return NextResponse.next();
  }

  // ── API Route Bypass (BEFORE session check) ──
  // /api/* paths are NOT UI pages — they must NOT require session cookies.
  // Each API route manages its own auth guard internally:
  //   /api/ably/auth       → JWT session + rate limit
  //   /api/panel/upload    → getSession() JWT
  //   /api/sse/*           → JWT token verify
  //   /api/admin/*         → CRON_SECRET / platform_admin check
  //   /api/cron*           → CRON_SECRET Bearer
  //   /api/webhooks/*      → Meta signature / QStash Receiver
  //   /api/follow-up       → CRON_SECRET Bearer
  //   /api/setup           → ADMIN_SETUP_KEY
  //   /api/health          → public read-only
  //   /api/queue-worker    → QStash signature verify
  if (cleanPath.startsWith("/api/")) {
    return NextResponse.next();
  }

  // Session kontrolü (UI pages only)
  const token = req.cookies.get("quba_session")?.value;
  if (!token) {
    if (process.env.NODE_ENV !== 'production') console.log(`[AUTH AUDIT] Request missing session token for ${pathname}, redirecting to /login`);
    return NextResponse.redirect(new URL("/login", req.url));
  }

  try {
    const { payload } = await jwtVerify(token, SECRET);
    const userRole = payload.role as string;
    const sessionTenantSlug = payload.tenantSlug as string;

    // URL Analizi (Path-based routing) — UI pages only
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
    // Hiç kimse kendi tenant slug'ı dışında bir yere giremez! Platform Admin bile `/baskent` yazamaz.
    // Platform admin'in yeri `/admin` rotasıdır.
    // Ancak platform_admin başka bir tenant slug'ına (örn: /baskent) girdiğinde auto-impersonation
    // tetiklenebilmesi için bu isolation geçidine izin veriyoruz.
    if (urlTenantSlug !== sessionTenantSlug && urlTenantSlug !== 'admin') {
      if (userRole === 'platform_admin') {
        // Platform admin can bypass the isolation gate for auto-impersonation dynamic alignment
        return NextResponse.next();
      }
      if (process.env.NODE_ENV !== 'production') console.log(`[AUTH AUDIT] Tenant isolation failure: Attempted /${urlTenantSlug} but session is /${sessionTenantSlug}`);
      return NextResponse.redirect(new URL(`/${sessionTenantSlug}`, req.url));
    }

    // Admin Rota Kontrolü
    if (urlTenantSlug === 'admin') {
      if (userRole === 'platform_admin' || userRole === 'owner') {
        return NextResponse.redirect(new URL(`/${sessionTenantSlug}/admin`, req.url));
      } else {
        if (process.env.NODE_ENV !== 'production') console.log(`[AUTH AUDIT] Non-admin attempted to access /admin`);
        return NextResponse.redirect(new URL(`/${sessionTenantSlug}`, req.url));
      }
    }
    
    if (baseRoute === '/admin') {
      if (userRole !== 'platform_admin' && userRole !== 'owner') {
        if (process.env.NODE_ENV !== 'production') console.log(`[AUTH AUDIT] Non-admin attempted to access baseRoute /admin`);
        return NextResponse.redirect(new URL(`/${sessionTenantSlug}`, req.url));
      }
    }

    // Diğer sayfalar için yetki matrisi kontrolü
    const allowedRoles = ROLE_PERMISSIONS[baseRoute];
    const isTempOwner = userRole === 'owner';
    
    if (allowedRoles && !allowedRoles.includes(userRole) && !isTempOwner) {
      if (process.env.NODE_ENV !== 'production') console.log(`[AUTH AUDIT] Role permission denied for ${baseRoute}. Role: ${userRole}`);
      return NextResponse.redirect(new URL(`/${sessionTenantSlug}`, req.url));
    }

    return NextResponse.next();
  } catch (error) {
    if (process.env.NODE_ENV !== 'production') console.log(`[AUTH AUDIT] JWT verification failed or other error, clearing cookie`);
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
