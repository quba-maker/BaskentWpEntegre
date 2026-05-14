import { NextRequest, NextResponse } from "next/server";
import { neon } from "@neondatabase/serverless";
import { waitUntil } from "@vercel/functions";
import { withApiGuard } from "@/lib/core/api-guard";

// ==========================================
// QUBA AI — Multi-Tenant Webhook Router
// Meta bu endpoint'i çağırır: /api/webhook
// Gelen mesajı tenant'a göre yönlendirir
// ==========================================

const DATABASE_URL = process.env.DATABASE_URL!;

// Vercel'in arka plan işlemlerini (waitUntil) hemen kesmemesi için maksimum süre
export const maxDuration = 60;



// GET — Meta Webhook doğrulama
export async function GET(req: NextRequest) {
  const mode = req.nextUrl.searchParams.get("hub.mode");
  const token = req.nextUrl.searchParams.get("hub.verify_token");
  const challenge = req.nextUrl.searchParams.get("hub.challenge");

  const VERIFY_TOKEN = process.env.WEBHOOK_VERIFY_TOKEN || process.env.META_VERIFY_TOKEN;

  if (mode === "subscribe" && token === VERIFY_TOKEN) {
    console.log("✅ Meta Webhook doğrulandı!");
    return new NextResponse(challenge, { status: 200 });
  }

  return NextResponse.json({ error: "Doğrulama başarısız" }, { status: 403 });
}

export const POST = withApiGuard(
  { routeName: 'MetaWebhook', verifySignature: true, requireTenant: true },
  async (ctx) => {
    // 1. Guard zaten tenantId'yi tespit etti, signature'ı doğruladı.
    const body = (ctx.req as any).parsedBody;
    const tenant = ctx.tenantMeta;

    if (!body || !body.object) {
      return new NextResponse("NOT_FOUND", { status: 404 });
    }

    // Dynamic import — lib/ klasörü parent directory'de
    const { handleWhatsAppMessage } = await import("../../../../../lib/channels/whatsapp.js");
    const { handleMessengerMessage } = await import("../../../../../lib/channels/messenger.js");
    const { handleInstagramMessage } = await import("../../../../../lib/channels/instagram.js");
    const { WebhookDedupeService } = await import("@/lib/services/webhook-dedupe.service");

    const dedupeService = new WebhookDedupeService(ctx.db);

    // 1. WHATSAPP
    if (
      body.object === "whatsapp_business_account" &&
      body.entry?.[0]?.changes?.[0]?.value?.messages?.[0]
    ) {
      const msg = body.entry[0].changes[0].value.messages[0];
      const senderPhone = body.entry[0].changes[0].value.contacts?.[0]?.wa_id;
      
      const { isDuplicate } = await dedupeService.checkAndLock({
        provider: 'whatsapp',
        providerMessageId: msg.id,
        senderId: senderPhone,
        timestamp: msg.timestamp ? parseInt(msg.timestamp) : Date.now()
      });

      if (isDuplicate) {
        return new NextResponse("EVENT_RECEIVED_DUPLICATE", { status: 200 });
      }

      console.log(`📱 [WA] Tenant: ${tenant.name} (${tenant.slug})`);
      waitUntil(handleWhatsAppMessage(body));
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

      console.log(`💬 [MSG] Tenant: ${tenant.name} (${tenant.slug})`);
      waitUntil(handleMessengerMessage(body));
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

      console.log(`📸 [IG] Tenant: ${tenant.name} (${tenant.slug})`);
      waitUntil(handleInstagramMessage(body));
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
          console.log(`📋 [Lead] ${tenant?.name || "Bilinmeyen"} — Lead: ${leadgenId}`);
          
          const META_TOKEN = tenant?.meta_page_token || process.env.META_ACCESS_TOKEN;
          if (META_TOKEN) {
            const leadRes = await fetch(
              `https://graph.facebook.com/v25.0/${leadgenId}?access_token=${META_TOKEN}`
            );
            const leadData = await leadRes.json();

            if (leadData?.field_data) {
              const fields: Record<string, string> = {};
              leadData.field_data.forEach((f: any) => {
                fields[f.name] = f.values?.[0] || "";
              });

              // executeSafe ile Zero-Trust RLS enforced yazılım.
              // Note: ctx.db! garantilidir çünkü requireTenant: true
              waitUntil(
                ctx.db!.executeSafe(
                  neon(process.env.DATABASE_URL!)`INSERT INTO leads (
                    tenant_id, source, patient_name, phone_number, email, department, notes, stage
                  ) VALUES (
                    ${tenant.id},
                    'meta_lead_ad',
                    ${fields.full_name || fields.name || ""},
                    ${fields.phone_number || fields.phone || ""},
                    ${fields.email || ""},
                    ${fields.department || fields.interest || ""},
                    ${"Lead Ad - Sayfa: " + pageId},
                    'new'
                  ) ON CONFLICT DO NOTHING`
                )
              );
            }
          }
        }
      } catch (e: any) {
        console.error("Lead webhook hatası:", e.message);
      }
      return new NextResponse("EVENT_RECEIVED", { status: 200 });
    }

    // Diğer durumlar
    return new NextResponse("EVENT_RECEIVED", { status: 200 });
  }
);
