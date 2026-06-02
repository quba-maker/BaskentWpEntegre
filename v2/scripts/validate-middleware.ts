import dotenv from "dotenv";
import path from "path";
dotenv.config({ path: path.join(__dirname, "../.env.local") });

// Ensure we have an AUTH_SECRET for test token generation and verification
process.env.AUTH_SECRET = process.env.AUTH_SECRET || "test_auth_secret_key_quba_ai_123";

import Module from "module";

// Mock next/server dynamically to run outside the Next.js runtime environment
const originalRequire = Module.prototype.require;
(Module.prototype as any).require = function (id: string) {
  if (id === "next/server") {
    class MockNextRequest {
      nextUrl: URL;
      url: string;
      cookies: {
        get: (name: string) => { value: string } | undefined;
      };
      constructor(urlStr: string, options: any = {}) {
        this.nextUrl = new URL(urlStr);
        this.url = urlStr;
        const cookiesMap = new Map<string, string>();
        if (options.cookies) {
          Object.entries(options.cookies).forEach(([k, v]) => cookiesMap.set(k, v as string));
        }
        this.cookies = {
          get: (name: string) => {
            const val = cookiesMap.get(name);
            return val ? { value: val } : undefined;
          }
        };
      }
    }

    class MockNextResponse {
      type: string;
      url?: string;
      deletedCookies: string[] = [];
      cookies: {
        delete: (name: string) => void;
      };
      constructor(type: string, url?: string) {
        this.type = type;
        this.url = url;
        this.cookies = {
          delete: (name: string) => {
            this.deletedCookies.push(name);
          }
        };
      }
      static next() {
        return new MockNextResponse("next");
      }
      static redirect(url: any) {
        return new MockNextResponse("redirect", url.toString());
      }
    }

    return {
      NextRequest: MockNextRequest,
      NextResponse: MockNextResponse
    };
  }
  return originalRequire.apply(this, arguments as any);
};

// Now import the middleware and mock request/response classes
const { middleware } = require("../src/middleware");
const { NextRequest } = require("next/server");
import { SignJWT } from "jose";

const SECRET = new TextEncoder().encode(process.env.AUTH_SECRET);

async function generateToken(payload: {
  userId: string;
  email: string;
  name: string;
  role: string;
  tenantId: string;
  tenantSlug: string;
  tenantName: string;
}) {
  return new SignJWT({ ...payload })
    .setProtectedHeader({ alg: "HS256" })
    .setExpirationTime("2h")
    .setIssuedAt()
    .sign(SECRET);
}

const MOCK_PLATFORM_ADMIN = {
  userId: "00000000-0000-0000-0000-000000000000",
  email: "admin@qubamedya.com",
  name: "Quba Admin",
  role: "platform_admin",
  tenantId: "admin-tenant-id",
  tenantSlug: "admin",
  tenantName: "Quba Admin",
};

const MOCK_TENANT_ADMIN = {
  userId: "11111111-1111-1111-1111-111111111111",
  email: "baskent-admin@baskent.com",
  name: "Baskent Admin",
  role: "admin",
  tenantId: "caab9ea1-9591-45e4-bbc5-9c9b498982c8",
  tenantSlug: "baskent",
  tenantName: "Baskent OS",
};

const MOCK_TENANT_AGENT = {
  userId: "22222222-2222-2222-2222-222222222222",
  email: "baskent-agent@baskent.com",
  name: "Baskent Agent",
  role: "agent",
  tenantId: "caab9ea1-9591-45e4-bbc5-9c9b498982c8",
  tenantSlug: "baskent",
  tenantName: "Baskent OS",
};

const MOCK_TENANT_VIEWER = {
  userId: "33333333-3333-3333-3333-333333333333",
  email: "baskent-viewer@baskent.com",
  name: "Baskent Viewer",
  role: "viewer",
  tenantId: "caab9ea1-9591-45e4-bbc5-9c9b498982c8",
  tenantSlug: "baskent",
  tenantName: "Baskent OS",
};

async function runMiddlewareValidation() {
  console.log("==========================================================");
  console.log("🛡️  QUBA AI — Dynamic Middleware Routing Protection Audit");
  console.log("==========================================================");

  // ----------------------------------------------------
  // TEST 1: Public Pages & Public APIs (No Session Required)
  // ----------------------------------------------------
  console.log("\n🧪 [Assertion group 1] Validating public routes bypass (No Session required)...");
  
  const publicPages = ["/login", "/privacy", "/terms", "/data-deletion", "/legal", "/support"];
  for (const page of publicPages) {
    const req = new NextRequest(`http://localhost:3000${page}`);
    const res = await middleware(req);
    if (!res || res.type !== "next") {
      throw new Error(`Public page ${page} was blocked or redirected. Expected next, got: ${res?.type}`);
    }
  }
  console.log("   ✅ Public pages bypass: PASS");

  const publicApiRoutes = [
    "/api/webhooks/meta",
    "/api/webhooks/meta/v2",
    "/api/sheets-webhook",
    "/api/telegram",
    "/api/health",
    "/api/cron/appointments",
    "/api/cron-form-sync",
    "/api/follow-up"
  ];
  for (const apiRoute of publicApiRoutes) {
    const req = new NextRequest(`http://localhost:3000${apiRoute}`);
    const res = await middleware(req);
    if (!res || res.type !== "next") {
      throw new Error(`Public API route ${apiRoute} was blocked. Expected next, got: ${res?.type}`);
    }
  }
  console.log("   ✅ Public API prefix bypass: PASS");

  // ----------------------------------------------------
  // TEST 2: Private Routes (Session Required)
  // ----------------------------------------------------
  console.log("\n🧪 [Assertion group 2] Validating private route protections...");
  
  const privateRoutes = [
    "/baskent/inbox",
    "/baskent/forms",
    "/baskent/takip",
    "/baskent/onay",
    "/baskent/settings"
  ];
  for (const route of privateRoutes) {
    // A: No cookie
    const reqNoCookie = new NextRequest(`http://localhost:3000${route}`);
    const resNoCookie = await middleware(reqNoCookie);
    if (!resNoCookie || resNoCookie.type !== "redirect" || !resNoCookie.url?.endsWith("/login")) {
      throw new Error(`Private route ${route} did not redirect to /login when missing session cookie.`);
    }

    // B: Invalid cookie
    const reqBadCookie = new NextRequest(`http://localhost:3000${route}`, {
      cookies: { quba_session: "invalid_jwt_token_format_or_signature" }
    });
    const resBadCookie = await middleware(reqBadCookie);
    if (!resBadCookie || resBadCookie.type !== "redirect" || !resBadCookie.url?.endsWith("/login")) {
      throw new Error(`Private route ${route} did not redirect to /login when containing malformed token.`);
    }
    if (!resBadCookie.deletedCookies.includes("quba_session")) {
      throw new Error(`Session cookie 'quba_session' was not cleared upon validation failure for ${route}`);
    }
  }
  console.log("   ✅ Private UI session requirements and bad cookie clearing: PASS");

  // ----------------------------------------------------
  // TEST 3: API Route Pass-Through (Auth managed internally by API itself)
  // ----------------------------------------------------
  console.log("\n🧪 [Assertion group 3] Validating internal-auth API route pass-through...");
  
  const internalAuthApis = [
    "/api/ably/auth",
    "/api/panel/upload",
    "/api/setup"
  ];
  for (const apiRoute of internalAuthApis) {
    const req = new NextRequest(`http://localhost:3000${apiRoute}`);
    const res = await middleware(req);
    if (!res || res.type !== "next") {
      throw new Error(`Internal API route ${apiRoute} was blocked by middleware. Expected pass-through next, got: ${res?.type}`);
    }
  }
  console.log("   ✅ API routes internal auth delegation pass-through: PASS");

  // ----------------------------------------------------
  // TEST 4: Already logged-in users landing page / login redirections
  // ----------------------------------------------------
  console.log("\n🧪 [Assertion group 4] Validating landing/login redirection for active sessions...");
  
  const adminToken = await generateToken(MOCK_PLATFORM_ADMIN);
  const tenantAdminToken = await generateToken(MOCK_TENANT_ADMIN);

  // A: Platform admin visiting /login -> redirects to /admin (impersonation console)
  const reqL1 = new NextRequest("http://localhost:3000/login", { cookies: { quba_session: adminToken } });
  const resL1 = await middleware(reqL1);
  if (!resL1 || resL1.type !== "redirect" || !resL1.url?.endsWith("/admin")) {
    throw new Error(`Platform admin visiting /login was not redirected to /admin. Got: ${resL1?.url}`);
  }

  // B: Platform admin visiting / -> redirects to /admin
  const reqH1 = new NextRequest("http://localhost:3000/", { cookies: { quba_session: adminToken } });
  const resH1 = await middleware(reqH1);
  if (!resH1 || resH1.type !== "redirect" || !resH1.url?.endsWith("/admin")) {
    throw new Error(`Platform admin visiting / was not redirected to /admin. Got: ${resH1?.url}`);
  }

  // C: Tenant admin visiting /login -> redirects to /[tenantSlug] (/baskent)
  const reqL2 = new NextRequest("http://localhost:3000/login", { cookies: { quba_session: tenantAdminToken } });
  const resL2 = await middleware(reqL2);
  if (!resL2 || resL2.type !== "redirect" || !resL2.url?.endsWith("/baskent")) {
    throw new Error(`Tenant admin visiting /login was not redirected to /baskent. Got: ${resL2?.url}`);
  }

  // D: Tenant admin visiting / -> redirects to /[tenantSlug] (/baskent)
  const reqH2 = new NextRequest("http://localhost:3000/", { cookies: { quba_session: tenantAdminToken } });
  const resH2 = await middleware(reqH2);
  if (!resH2 || resH2.type !== "redirect" || !resH2.url?.endsWith("/baskent")) {
    throw new Error(`Tenant admin visiting / was not redirected to /baskent. Got: ${resH2?.url}`);
  }
  console.log("   ✅ Active session smart redirections: PASS");

  // ----------------------------------------------------
  // TEST 5: Tenant Isolation Gate
  // ----------------------------------------------------
  console.log("\n🧪 [Assertion group 5] Validating tenant isolation safeguards...");
  
  // A: Baskent admin attempts to access /merve/inbox -> Redirects to /baskent
  const reqIso1 = new NextRequest("http://localhost:3000/merve/inbox", { cookies: { quba_session: tenantAdminToken } });
  const resIso1 = await middleware(reqIso1);
  if (!resIso1 || resIso1.type !== "redirect" || !resIso1.url?.endsWith("/baskent")) {
    throw new Error(`Baskent admin was not isolated from /merve/inbox. Redirected to: ${resIso1?.url}`);
  }

  // B: Baskent admin attempts to access /admin -> Redirects to /baskent
  const reqIso2 = new NextRequest("http://localhost:3000/admin", { cookies: { quba_session: tenantAdminToken } });
  const resIso2 = await middleware(reqIso2);
  if (!resIso2 || resIso2.type !== "redirect" || !resIso2.url?.endsWith("/baskent")) {
    throw new Error(`Baskent admin was allowed into /admin root or not redirected to /baskent. Redirected to: ${resIso2?.url}`);
  }

  // C: Platform Admin attempts to access /baskent/inbox -> Bypass isolation for impersonation/alignment
  const reqIso3 = new NextRequest("http://localhost:3000/baskent/inbox", { cookies: { quba_session: adminToken } });
  const resIso3 = await middleware(reqIso3);
  if (!resIso3 || resIso3.type !== "next") {
    throw new Error(`Platform Admin bypass for tenant impersonation was blocked. Expected next, got: ${resIso3?.type}`);
  }
  console.log("   ✅ Multi-tenant isolation gates: PASS");

  // ----------------------------------------------------
  // TEST 6: Role Page Permissions (ROLE_PERMISSIONS matrix)
  // ----------------------------------------------------
  console.log("\n🧪 [Assertion group 6] Validating page-level role authorization permissions...");
  
  const tenantAgentToken = await generateToken(MOCK_TENANT_AGENT);
  const tenantViewerToken = await generateToken(MOCK_TENANT_VIEWER);

  // Matrix mappings in middleware.ts:
  // /bot -> platform_admin, admin, agent
  // /users, /settings, /integrations -> platform_admin, admin

  // A: Viewer accessing /bot -> Perm denied, redirects to /baskent
  const reqP1 = new NextRequest("http://localhost:3000/baskent/bot", { cookies: { quba_session: tenantViewerToken } });
  const resP1 = await middleware(reqP1);
  if (!resP1 || resP1.type !== "redirect" || !resP1.url?.endsWith("/baskent")) {
    throw new Error(`Viewer role was allowed to access /bot or redirected incorrectly. Got: ${resP1?.url}`);
  }

  // B: Agent accessing /bot -> Allowed
  const reqP2 = new NextRequest("http://localhost:3000/baskent/bot", { cookies: { quba_session: tenantAgentToken } });
  const resP2 = await middleware(reqP2);
  if (!resP2 || resP2.type !== "next") {
    throw new Error(`Agent was blocked from /bot. Expected next, got: ${resP2?.type}`);
  }

  // C: Agent accessing /settings -> Perm denied, redirects to /baskent
  const reqP3 = new NextRequest("http://localhost:3000/baskent/settings", { cookies: { quba_session: tenantAgentToken } });
  const resP3 = await middleware(reqP3);
  if (!resP3 || resP3.type !== "redirect" || !resP3.url?.endsWith("/baskent")) {
    throw new Error(`Agent was allowed to access /settings. Redirected to: ${resP3?.url}`);
  }

  // D: Admin accessing /settings -> Allowed
  const reqP4 = new NextRequest("http://localhost:3000/baskent/settings", { cookies: { quba_session: tenantAdminToken } });
  const resP4 = await middleware(reqP4);
  if (!resP4 || resP4.type !== "next") {
    throw new Error(`Admin was blocked from /settings. Expected next, got: ${resP4?.type}`);
  }
  console.log("   ✅ Role-based path access control limits: PASS");

  console.log("\n🎉 ALL MIDDLEWARE ROUTING SECURITY ASSERTONS PASSED SUCCESSFULLY!");
  console.log("==========================================================\n");
  process.exit(0);
}

runMiddlewareValidation().catch(e => {
  console.error("\n❌ VALIDATION CRASHED WITH ERROR:\n", e);
  process.exit(1);
});
