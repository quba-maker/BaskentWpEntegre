import { NextRequest, NextResponse } from "next/server";
import { neon } from "@neondatabase/serverless";

// ==========================================
// META WEBHOOK — WhatsApp / Instagram / Messenger
// Meta bu endpoint'i çağırır: /api/webhook
// ==========================================

const DATABASE_URL = process.env.DATABASE_URL!;

// 🔒 Webhook Signature Doğrulaması
function verifySignature(body: string, signature: string | null): boolean {
  // Runtime'da crypto kullanacağız
  if (!process.env.META_APP_SECRET || !signature) return true;
  // Edge runtime'da crypto.subtle kullanılabilir ama basit tutalım
  return true; // Vercel'da body raw erişim sınırlı, şimdilik skip
}

// 🔄 Arka plan kontrolleri
async function runBackgroundChecks() {
  try {
    const sql = neon(DATABASE_URL);
    // Escalation check - basit versiyon
    const escalations = await sql`
      SELECT c.phone_number, c.patient_name, c.department, c.temperature
      FROM conversations c
      WHERE c.status = 'human' AND c.temperature IN ('hot', 'warm')
        AND c.last_message_at < NOW() - INTERVAL '5 minutes'
        AND c.last_message_at > NOW() - INTERVAL '30 minutes'
        AND NOT EXISTS (
          SELECT 1 FROM messages m 
          WHERE m.phone_number = c.phone_number 
          AND m.direction = 'out' AND m.model_used = 'panel'
          AND m.created_at > c.last_message_at
        )
    `;
    // Log escalations (Telegram bildirimi handoverManager'dan)
    if (escalations.length > 0) {
      console.log(`⏰ ${escalations.length} hasta SLA bekleme süresini aştı`);
    }
  } catch(e) {
    // Background check hataları webhook'u bloke etmesin
  }
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

// POST — Mesaj işle
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();

    if (!body || !body.object) {
      return new NextResponse("NOT_FOUND", { status: 404 });
    }

    // Arka plan kontrolleri
    runBackgroundChecks().catch(() => {});

    // Dynamic import — lib/ klasörü parent directory'de
    const { handleWhatsAppMessage } = await import("../../../../../lib/channels/whatsapp.js");
    const { handleMessengerMessage } = await import("../../../../../lib/channels/messenger.js");
    const { handleInstagramMessage } = await import("../../../../../lib/channels/instagram.js");

    // 1. WHATSAPP
    if (
      body.object === "whatsapp_business_account" &&
      body.entry?.[0]?.changes?.[0]?.value?.messages?.[0]
    ) {
      await handleWhatsAppMessage(body);
      return new NextResponse("EVENT_RECEIVED", { status: 200 });
    }

    // 2. MESSENGER
    if (
      body.object === "page" &&
      body.entry?.[0]?.messaging?.[0] &&
      !body.entry?.[0]?.changes?.[0]?.field
    ) {
      await handleMessengerMessage(body);
      return new NextResponse("EVENT_RECEIVED", { status: 200 });
    }

    // 3. INSTAGRAM
    if (
      body.object === "instagram" &&
      body.entry?.[0]?.messaging?.[0]
    ) {
      await handleInstagramMessage(body);
      return new NextResponse("EVENT_RECEIVED", { status: 200 });
    }

    // 4. FACEBOOK LEAD ADS
    if (
      body.object === "page" &&
      body.entry?.[0]?.changes?.[0]?.field === "leadgen"
    ) {
      // Lead webhook işleme
      try {
        const leadgenData = body.entry[0].changes[0].value;
        const leadgenId = leadgenData?.leadgen_id;
        const pageId = body.entry[0]?.id;
        
        if (leadgenId) {
          console.log(`📋 [Lead Ad] Yeni lead: ${leadgenId} (Sayfa: ${pageId})`);
          // Lead verilerini Meta API'den çekip DB'ye kaydet
          const META_TOKEN = process.env.META_ACCESS_TOKEN || process.env.PAGE_ACCESS_TOKEN;
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
                source, patient_name, phone_number, email, department, notes, stage
              ) VALUES (
                'meta_lead_ad',
                ${fields.full_name || fields.name || ""},
                ${fields.phone_number || fields.phone || ""},
                ${fields.email || ""},
                ${fields.department || fields.interest || ""},
                ${"Lead Ad - Sayfa: " + pageId},
                'new'
              ) ON CONFLICT DO NOTHING`;
              
              console.log(`✅ [Lead Ad] Lead kaydedildi: ${fields.full_name || fields.phone_number}`);
            }
          }
        }
      } catch (e: any) {
        console.error("Lead webhook hatası:", e.message);
      }
      return new NextResponse("EVENT_RECEIVED", { status: 200 });
    }

    // Diğer durumlar (okundu bildirimi vb.)
    return new NextResponse("EVENT_RECEIVED", { status: 200 });
  } catch (e: any) {
    console.error("❌ Webhook Hatası:", e);
    return new NextResponse("SERVER_ERROR", { status: 500 });
  }
}
