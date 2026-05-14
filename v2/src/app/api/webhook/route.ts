import { NextRequest, NextResponse } from "next/server";
import { neon } from "@neondatabase/serverless";

// ==========================================
// QUBA AI — Multi-Tenant Webhook Router
// Meta bu endpoint'i çağırır: /api/webhook
// Gelen mesajı tenant'a göre yönlendirir
// ==========================================

const DATABASE_URL = process.env.DATABASE_URL!;

// Tenant bilgisini page_id veya phone_id ile bul
async function findTenant(identifier: string, type: "page" | "phone" | "instagram") {
  const sql = neon(DATABASE_URL);
  
  let tenants;
  if (type === "page") {
    tenants = await sql`SELECT * FROM tenants WHERE meta_page_id = ${identifier} AND status = 'active'`;
  } else if (type === "instagram") {
    tenants = await sql`SELECT * FROM tenants WHERE instagram_id = ${identifier} AND status = 'active'`;
  } else {
    tenants = await sql`SELECT * FROM tenants WHERE whatsapp_phone_id = ${identifier} AND status = 'active'`;
  }
  
  return tenants.length > 0 ? tenants[0] : null;
}

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

// POST — Mesaj işle (Tenant Router)
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();

    if (!body || !body.object) {
      return new NextResponse("NOT_FOUND", { status: 404 });
    }

    // Dynamic import — lib/ klasörü parent directory'de
    const { handleWhatsAppMessage } = await import("../../../../../lib/channels/whatsapp.js");
    const { handleMessengerMessage } = await import("../../../../../lib/channels/messenger.js");
    const { handleInstagramMessage } = await import("../../../../../lib/channels/instagram.js");

    // 1. WHATSAPP
    if (
      body.object === "whatsapp_business_account" &&
      body.entry?.[0]?.changes?.[0]?.value?.messages?.[0]
    ) {
      const phoneNumberId = body.entry[0].changes[0].value?.metadata?.phone_number_id;
      const tenant = phoneNumberId ? await findTenant(phoneNumberId, "phone") : null;
      
      if (tenant) {
        console.log(`📱 [WA] Tenant: ${tenant.name} (${tenant.slug})`);
      }

      // Mevcut handler'ı çağır (tenant bilgisi ileride handler'a geçirilecek)
      await handleWhatsAppMessage(body);
      return new NextResponse("EVENT_RECEIVED", { status: 200 });
    }

    // 2. MESSENGER
    if (
      body.object === "page" &&
      body.entry?.[0]?.messaging?.[0] &&
      !body.entry?.[0]?.changes?.[0]?.field
    ) {
      const pageId = body.entry[0]?.id;
      const tenant = pageId ? await findTenant(pageId, "page") : null;
      
      if (tenant) {
        console.log(`💬 [MSG] Tenant: ${tenant.name} (${tenant.slug})`);
      }

      await handleMessengerMessage(body);
      return new NextResponse("EVENT_RECEIVED", { status: 200 });
    }

    // 3. INSTAGRAM
    if (
      body.object === "instagram" &&
      body.entry?.[0]?.messaging?.[0]
    ) {
      const igId = body.entry[0]?.id;
      const tenant = igId ? await findTenant(igId, "instagram") : null;
      
      if (tenant) {
        console.log(`📸 [IG] Tenant: ${tenant.name} (${tenant.slug})`);
      }

      await handleInstagramMessage(body);
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
        const tenant = pageId ? await findTenant(pageId, "page") : null;

        if (leadgenId) {
          console.log(`📋 [Lead] ${tenant?.name || "Bilinmeyen"} — Lead: ${leadgenId}`);
          
          // Tenant'ın token'ını kullan, yoksa env'den al
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

              const sql = neon(DATABASE_URL);
              await sql`INSERT INTO leads (
                tenant_id, source, patient_name, phone_number, email, department, notes, stage
              ) VALUES (
                ${tenant?.id || null},
                'meta_lead_ad',
                ${fields.full_name || fields.name || ""},
                ${fields.phone_number || fields.phone || ""},
                ${fields.email || ""},
                ${fields.department || fields.interest || ""},
                ${"Lead Ad - Sayfa: " + pageId},
                'new'
              ) ON CONFLICT DO NOTHING`;
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
  } catch (e: any) {
    console.error("❌ Webhook Hatası:", e);
    return new NextResponse("SERVER_ERROR", { status: 500 });
  }
}
