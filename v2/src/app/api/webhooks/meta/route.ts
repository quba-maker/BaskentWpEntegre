import { NextRequest, NextResponse } from "next/server";
import { neon } from "@neondatabase/serverless";
import { waitUntil } from "@vercel/functions";
import { withApiGuard } from "@/lib/core/api-guard";
import { QueueService } from "@/lib/queue/queue.service";
import { logger } from "@/lib/core/logger";

const log = logger.withContext({ module: 'MetaWebhook' });

// ==========================================
// QUBA AI — Multi-Tenant Webhook Router (Queue-Driven)
// Meta bu endpoint'i çağırır: /api/webhooks/meta
// Gelen mesajı tenant'a göre yönlendirir ve QueueService'e aktarır
// ==========================================

const DATABASE_URL = process.env.DATABASE_URL || "postgres://dummy:dummy@dummy.com/dummy";
export const maxDuration = 60; // Max duration for background ops


// GET — Meta Webhook doğrulama
export async function GET(req: NextRequest) {
  const mode = req.nextUrl.searchParams.get("hub.mode");
  const token = req.nextUrl.searchParams.get("hub.verify_token");
  const challenge = req.nextUrl.searchParams.get("hub.challenge");

  const VERIFY_TOKEN = process.env.WEBHOOK_VERIFY_TOKEN || process.env.META_VERIFY_TOKEN;

  if (mode === "subscribe" && token === VERIFY_TOKEN) {
    log.info("Meta Webhook doğrulandı");
    return new NextResponse(challenge, { status: 200 });
  }

  return NextResponse.json({ error: "Doğrulama başarısız" }, { status: 403 });
}

export const POST = withApiGuard(
  { routeName: 'MetaWebhookQueue', verifySignature: true, requireTenant: true },
  async (ctx) => {
    const body = (ctx.req as any).parsedBody;
    const tenant = ctx.tenantMeta;

    if (!body || !body.object) {
      return new NextResponse("NOT_FOUND", { status: 404 });
    }

    const { WebhookDedupeService } = await import("@/lib/services/webhook-dedupe.service");
    const dedupeService = new WebhookDedupeService(ctx.db!);
    const queue = new QueueService();

    // 1. WHATSAPP
    if (
      body.object === "whatsapp_business_account" &&
      body.entry?.[0]?.changes?.[0]?.value?.messages?.[0]
    ) {
      const msg = body.entry[0].changes[0].value.messages[0];
      const senderPhone = body.entry[0].changes[0].value.contacts?.[0]?.wa_id;
      
      log.info(`[WEBHOOK_RECEIVED] [WA MESSAGE] Received msg_id: ${msg.id} from ${senderPhone}`);

      const { isDuplicate } = await dedupeService.checkAndLock({
        provider: 'whatsapp',
        providerMessageId: msg.id,
        senderId: senderPhone,
        timestamp: msg.timestamp ? parseInt(msg.timestamp) : Date.now()
      });

      if (isDuplicate) {
        log.warn(`[WEBHOOK_DUPLICATE] Dropping duplicate msg_id: ${msg.id}`);
        return new NextResponse("EVENT_RECEIVED_DUPLICATE", { status: 200 });
      }

      log.info(`[WA] Enqueueing`, { tenantName: tenant.name, tenantSlug: tenant.slug });
      
      // Send to Queue instead of synchronous wait
      waitUntil(queue.publish(ctx.tenantId!, 'whatsapp.message.received', body));
      
      return new NextResponse("EVENT_RECEIVED", { status: 200 });
    }

    // 1.5 WHATSAPP STATUSES (Delivery Receipts)
    if (
      body.object === "whatsapp_business_account" &&
      body.entry?.[0]?.changes?.[0]?.value?.statuses?.[0]
    ) {
      const statusObj = body.entry[0].changes[0].value.statuses[0];
      const statusId = statusObj.id; // Original message ID
      
      log.info(`[WEBHOOK_RECEIVED] [WA STATUS] Received status: ${statusObj.status} for msg_id: ${statusId}`);

      const { isDuplicate } = await dedupeService.checkAndLock({
        provider: 'whatsapp',
        providerMessageId: `${statusId}_${statusObj.status}`, // e.g. wamid.xxxx_delivered
        senderId: statusObj.recipient_id,
        timestamp: statusObj.timestamp ? parseInt(statusObj.timestamp) : Date.now()
      });

      if (isDuplicate) {
        log.warn(`[WEBHOOK_DUPLICATE] Dropping duplicate status: ${statusObj.status} for msg_id: ${statusId}`);
        return new NextResponse("EVENT_RECEIVED_DUPLICATE", { status: 200 });
      }

      log.info(`[WA Status] Enqueueing receipt: ${statusObj.status}`, { tenantName: tenant.name, tenantSlug: tenant.slug });
      
      waitUntil(queue.publish(ctx.tenantId!, 'whatsapp.status.received', body));
      
      return new NextResponse("EVENT_RECEIVED", { status: 200 });
    }

    // 2. MESSENGER
    if (
      body.object === "page" &&
      body.entry?.[0]?.messaging?.[0] &&
      !body.entry?.[0]?.changes?.[0]?.field
    ) {
      const msg = body.entry[0].messaging[0];
      if (msg.message?.mid) {
        const { isDuplicate } = await dedupeService.checkAndLock({
          provider: 'messenger',
          providerMessageId: msg.message.mid,
          senderId: msg.sender.id,
          timestamp: msg.timestamp || Date.now()
        });
        if (isDuplicate) return new NextResponse("EVENT_RECEIVED_DUPLICATE", { status: 200 });
      }

      log.info(`[MSG] Enqueueing`, { tenantName: tenant.name, tenantSlug: tenant.slug });
      waitUntil(queue.publish(ctx.tenantId!, 'messenger.message.received', body));
      return new NextResponse("EVENT_RECEIVED", { status: 200 });
    }

    // 3. INSTAGRAM
    if (
      body.object === "instagram" &&
      body.entry?.[0]?.messaging?.[0]
    ) {
      const msg = body.entry[0].messaging[0];
      if (msg.message?.mid) {
        const { isDuplicate } = await dedupeService.checkAndLock({
          provider: 'instagram',
          providerMessageId: msg.message.mid,
          senderId: msg.sender.id,
          timestamp: msg.timestamp || Date.now()
        });
        if (isDuplicate) return new NextResponse("EVENT_RECEIVED_DUPLICATE", { status: 200 });
      }

      log.info(`[IG] Enqueueing`, { tenantName: tenant.name, tenantSlug: tenant.slug });
      waitUntil(queue.publish(ctx.tenantId!, 'instagram.message.received', body));
      return new NextResponse("EVENT_RECEIVED", { status: 200 });
    }

    // 4. FACEBOOK LEAD ADS
    if (
      body.object === "page" &&
      body.entry?.[0]?.changes?.[0]?.field === "leadgen"
    ) {
      try {
        const leadgenData = body.entry[0].changes[0].value;
        const leadgenId = leadgenData?.leadgen_id;
        const pageId = body.entry[0]?.id;

        if (leadgenId) {
          log.info(`[Lead] Lead received`, { tenantName: tenant?.name, leadgenId });
          
          waitUntil(queue.publish(ctx.tenantId!, 'meta.lead.received', { leadgenId, pageId, tenant }));
        }
      } catch (e: any) {
        log.error("Lead webhook hatası", e instanceof Error ? e : new Error(String(e)));
      }
      return new NextResponse("EVENT_RECEIVED", { status: 200 });
    }

    // Diğer durumlar
    return new NextResponse("EVENT_RECEIVED", { status: 200 });
  }
);
