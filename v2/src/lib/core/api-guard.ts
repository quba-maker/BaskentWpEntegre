import { NextRequest, NextResponse } from "next/server";
import { logger } from "./logger";
import { TenantDB, withTenantDB } from "./tenant-db";
import { neon } from "@neondatabase/serverless";

// ==========================================
// QUBA AI — Zero-Trust API/Webhook Guard
// ==========================================

export interface ApiContext {
  req: NextRequest;
  tenantId?: string;
  tenantMeta?: any;
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
    const log = logger.withContext({ module: 'ApiGuard', route: options.routeName });
    const startTime = Date.now();

    try {
      let body: any = null;
      let rawBody = "";

      // 1. Signature Verification (Meta Webhooks)
      if (options.verifySignature) {
        const APP_SECRET = process.env.META_APP_SECRET;
        if (APP_SECRET) {
          const signature = req.headers.get("x-hub-signature-256");
          if (!signature) {
            log.warn("Missing signature in webhook");
            return new NextResponse("FORBIDDEN", { status: 403 });
          }
          
          rawBody = await req.clone().text();
          const crypto = await import("crypto");
          const trimmedSecret = APP_SECRET.trim();
          const expectedSig = "sha256=" + crypto
            .createHmac("sha256", trimmedSecret)
            .update(rawBody)
            .digest("hex");
            
          if (signature !== expectedSig) {
            log.warn("Signature mismatch in webhook", {
              receivedPrefix: signature.substring(0, 20),
              expectedPrefix: expectedSig.substring(0, 20),
              secretLength: trimmedSecret.length,
              secretPrefix: trimmedSecret.substring(0, 4) + "...",
              bodyLength: rawBody.length,
              hasWhitespace: APP_SECRET !== trimmedSecret
            });
            return new NextResponse("FORBIDDEN", { status: 403 });
          }
        }
      }

      // JSON body parse
      if (!rawBody) {
        rawBody = await req.clone().text().catch(() => "");
      }
      try {
        if (rawBody) body = JSON.parse(rawBody);
      } catch (e) {}

      let tenantId: string | undefined = undefined;
      let tenantMeta: any = null;

      // 2. Tenant Detection Logic
      if (options.requireTenant) {
        const sql = neon(process.env.DATABASE_URL!);
        
        if (body?.object === "whatsapp_business_account" && body.entry?.[0]?.changes?.[0]?.value?.metadata?.phone_number_id) {
          const id = body.entry[0].changes[0].value.metadata.phone_number_id;
          const tenants = await sql`SELECT * FROM tenants WHERE whatsapp_phone_id = ${id} AND status = 'active' LIMIT 1`;
          if (tenants.length > 0) { tenantId = tenants[0].id; tenantMeta = tenants[0]; }
        } 
        else if (body?.object === "page" && body.entry?.[0]?.id) {
          const id = body.entry[0].id;
          const tenants = await sql`SELECT * FROM tenants WHERE meta_page_id = ${id} AND status = 'active' LIMIT 1`;
          if (tenants.length > 0) { tenantId = tenants[0].id; tenantMeta = tenants[0]; }
        }
        else if (body?.object === "instagram" && body.entry?.[0]?.id) {
          const id = body.entry[0].id;
          const tenants = await sql`SELECT * FROM tenants WHERE instagram_id = ${id} AND status = 'active' LIMIT 1`;
          if (tenants.length > 0) { tenantId = tenants[0].id; tenantMeta = tenants[0]; }
        }

        if (!tenantId) {
          log.warn("Unroutable webhook received (No matching active tenant)", { bodyType: body?.object });
          // Meta'nın retry etmesini engellemek için 200 dönüyoruz ama işlemi sönümlüyoruz
          return new NextResponse("EVENT_RECEIVED_UNROUTABLE", { status: 200 });
        }
        
        // Body içine tenant bilgisini inject et (Legacy sistemleri bozmamak için)
        if (body) {
          body.tenant_id = tenantId;
          body.tenant_meta = tenantMeta;
          // Req'i yeniden kurgulamak zor olduğu için context ile geçeceğiz
        }
      }

      const ctx: ApiContext = {
        req,
        tenantId,
        tenantMeta,
        db: tenantId ? withTenantDB(tenantId) : undefined
      };
      
      // Inject body to req for child components
      if (body) {
        (req as any).parsedBody = body;
      }

      log.info("API request validated", { tenantId });

      const response = await handler(ctx);
      
      log.info("API request completed", { tenantId, durationMs: Date.now() - startTime, status: response.status });
      return response;

    } catch (error: any) {
      log.error("API request crashed", error, { durationMs: Date.now() - startTime });
      return new NextResponse("SERVER_ERROR", { status: 500 });
    }
  };
}
