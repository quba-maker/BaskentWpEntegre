import { NextRequest, NextResponse } from "next/server";
import { logger } from "./logger";
import { TenantDB, withTenantDB } from "./tenant-db";
import { TenantResolverService, TenantRuntimeConfig } from "@/lib/services/meta/tenant-resolver.service";

// ==========================================
// QUBA AI OS — Zero-Trust Tenant-Aware API Guard
// ==========================================
// V2 Architecture: Tenant-first, signature-per-tenant
//
// Flow:
//   1. Parse body (untrusted)
//   2. Resolve tenant from payload identifiers
//   3. Load tenant's own Meta App Secret
//   4. Verify webhook signature with tenant secret
//   5. Build isolated runtime context
//   6. Execute handler
//
// Fallback: process.env.META_APP_SECRET for tenants
// without their own meta_app_secret (migration period)
// ==========================================

export interface ApiContext {
  req: NextRequest;
  tenantId?: string;
  tenantMeta?: any;
  tenantRuntime?: TenantRuntimeConfig;
  db?: TenantDB;
}

export type ApiHandler = (ctx: ApiContext) => Promise<NextResponse>;

export interface ApiGuardOptions {
  routeName: string;
  requireTenant?: boolean;
  verifySignature?: boolean;
}

export function withApiGuard(
  options: ApiGuardOptions,
  handler: ApiHandler
) {
  return async (req: NextRequest): Promise<NextResponse> => {
    // Check if traceId is passed from upstream (e.g. queue worker or external service)
    const traceId = req.headers.get("x-trace-id") || crypto.randomUUID();
    
    // We import dynamically or top-level. Since this is an edge/nextjs env, let's just require it.
    const { runWithTrace } = await import("@/lib/core/trace-context");
    
    return runWithTrace({ traceId }, async () => {
      const log = logger.withContext({ module: 'ApiGuard', route: options.routeName });
      const startTime = Date.now();

      try {
        // ─────────────────────────────────────────
      // STEP 1: Parse raw body (needed for both
      //         tenant resolution AND signature)
      // ─────────────────────────────────────────
      let rawBody = "";
      let body: any = null;

      rawBody = await req.clone().text().catch(() => "");
      try {
        if (rawBody) body = JSON.parse(rawBody);
      } catch (e) {}

      // ─────────────────────────────────────────
      // STEP 2: Resolve tenant from webhook payload
      //         BEFORE signature verification
      // ─────────────────────────────────────────
      let tenantRuntime: TenantRuntimeConfig | null = null;
      let tenantId: string | undefined = undefined;
      let tenantMeta: any = null;

      if (options.requireTenant) {
        const resolver = new TenantResolverService();
        tenantRuntime = await resolver.resolve(body);

        if (!tenantRuntime) {
          log.warn("Unroutable webhook (no matching active tenant)", {
            bodyType: body?.object,
            entryId: body?.entry?.[0]?.id
          });
          // 200 dönerek Meta'nın retry etmesini engelliyoruz
          return new NextResponse("EVENT_RECEIVED_UNROUTABLE", { status: 200 });
        }

        tenantId = tenantRuntime.tenantId;
        tenantMeta = tenantRuntime.raw;
      }

      // ─────────────────────────────────────────
      // STEP 3: Tenant-Aware Signature Verification
      //
      // Priority chain:
      //   1. tenant.meta_app_secret (tenant's own app)
      //   2. process.env.META_APP_SECRET (platform app)
      //
      // This supports both:
      //   - Tenants with their own Meta App (legacy)
      //   - Tenants connected via Quba AI platform app
      // ─────────────────────────────────────────
      if (options.verifySignature) {
        const tenantSecret = tenantRuntime?.metaAppSecret;
        const globalSecret = process.env.META_APP_SECRET;
        const secretSource = tenantSecret ? 'tenant_db' : 'env_global';
        const APP_SECRET = (tenantSecret || globalSecret || "").trim();

        if (APP_SECRET) {
          const signature = req.headers.get("x-hub-signature-256");
          if (!signature) {
            log.warn("Missing x-hub-signature-256 header", {
              tenantSlug: tenantRuntime?.tenantSlug || 'unknown'
            });
            return new NextResponse("FORBIDDEN", { status: 403 });
          }

          const crypto = await import("crypto");
          const expectedSig = "sha256=" + crypto
            .createHmac("sha256", APP_SECRET)
            .update(rawBody)
            .digest("hex");

          if (signature !== expectedSig) {
            log.warn("Signature mismatch", {
              tenantSlug: tenantRuntime?.tenantSlug || 'unknown',
              secretSource,
              secretLength: APP_SECRET.length,
              secretPrefix: APP_SECRET.substring(0, 4) + "...",
              receivedPrefix: signature.substring(0, 20),
              expectedPrefix: expectedSig.substring(0, 20),
              bodyLength: rawBody.length
            });
            return new NextResponse("FORBIDDEN", { status: 403 });
          }

          log.info("Webhook signature verified", {
            tenantSlug: tenantRuntime?.tenantSlug || 'unknown',
            secretSource
          });

        } else {
          // No secret configured anywhere — allow but warn
          log.warn("No META_APP_SECRET configured (tenant or env), skipping verification", {
            tenantSlug: tenantRuntime?.tenantSlug || 'unknown'
          });
        }
      }

      // ─────────────────────────────────────────
      // STEP 4: Inject tenant context into body
      //         (Legacy handler compatibility)
      // ─────────────────────────────────────────
      if (body && tenantId) {
        body.tenant_id = tenantId;
        body.tenant_meta = tenantMeta;
      }

      // ─────────────────────────────────────────
      // STEP 5: Build isolated runtime context
      // ─────────────────────────────────────────
      const ctx: ApiContext = {
        req,
        tenantId,
        tenantMeta,
        tenantRuntime: tenantRuntime || undefined,
        db: tenantId ? withTenantDB(tenantId) : undefined
      };

      // Inject parsed body for downstream handlers
      if (body) {
        (req as any).parsedBody = body;
      }

      log.info("API request validated", {
        tenantId,
        tenantSlug: tenantRuntime?.tenantSlug
      });

      // ─────────────────────────────────────────
      // STEP 6: Execute handler
      // ─────────────────────────────────────────
      const response = await handler(ctx);

      log.info("API request completed", {
        tenantId,
        tenantSlug: tenantRuntime?.tenantSlug,
        durationMs: Date.now() - startTime,
        status: response.status
      });

      return response;

      } catch (error: any) {
        log.error("API Guard crash", error, {
          durationMs: Date.now() - startTime
        });
        return new NextResponse("SERVER_ERROR", { status: 500 });
      }
    });
  };
}
