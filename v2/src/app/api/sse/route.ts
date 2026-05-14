import { NextRequest } from "next/server";
import { neon } from "@neondatabase/serverless";

// ==========================================
// QUBA AI — Real-Time Server-Sent Events (SSE)
// Panele anlık mesaj bildirimi gönderir
// Client: EventSource('/api/sse?tenant=baskent')
// ==========================================

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const tenantSlug = req.nextUrl.searchParams.get("tenant");
  const authToken = req.nextUrl.searchParams.get("token");

  if (!tenantSlug || !authToken) {
    return new Response("Missing tenant or token", { status: 400 });
  }

  const sql = neon(process.env.DATABASE_URL!);

  // Token doğrulama — basit session check
  // Production'da JWT verify kullanılabilir
  const tenants = await sql`SELECT id FROM tenants WHERE slug = ${tenantSlug} AND status = 'active'`;
  if (tenants.length === 0) {
    return new Response("Invalid tenant", { status: 403 });
  }
  const tenantId = tenants[0].id;

  // SSE stream oluştur
  const encoder = new TextEncoder();
  let lastCheckTime = new Date().toISOString();
  let isActive = true;

  const stream = new ReadableStream({
    async start(controller) {
      // İlk bağlantı onayı
      controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: "connected", tenantId })}\n\n`));

      // Her 3 saniyede yeni mesaj kontrol et
      const interval = setInterval(async () => {
        if (!isActive) {
          clearInterval(interval);
          return;
        }

        try {
          const newMessages = await sql`
            SELECT m.id, m.phone_number, m.content, m.direction, m.channel, m.created_at,
                   c.patient_name
            FROM messages m
            LEFT JOIN conversations c ON c.phone_number = m.phone_number AND c.tenant_id = m.tenant_id
            WHERE m.tenant_id = ${tenantId} 
              AND m.created_at > ${lastCheckTime}::timestamptz
            ORDER BY m.created_at ASC
            LIMIT 20
          `;

          if (newMessages.length > 0) {
            lastCheckTime = newMessages[newMessages.length - 1].created_at;
            
            for (const msg of newMessages) {
              controller.enqueue(encoder.encode(
                `data: ${JSON.stringify({
                  type: "message",
                  id: msg.id,
                  phone: msg.phone_number,
                  name: msg.patient_name || msg.phone_number,
                  content: msg.content?.substring(0, 200),
                  direction: msg.direction,
                  channel: msg.channel,
                  time: msg.created_at,
                })}\n\n`
              ));
            }
          }

          // Heartbeat — bağlantıyı canlı tut
          controller.enqueue(encoder.encode(`: heartbeat ${Date.now()}\n\n`));
        } catch (e: any) {
          console.error("[SSE] Poll error:", e.message);
        }
      }, 3000);

      // 5 dakika sonra bağlantıyı kapat (Vercel timeout koruması)
      setTimeout(() => {
        isActive = false;
        clearInterval(interval);
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: "reconnect" })}\n\n`));
          controller.close();
        } catch { /* stream zaten kapalı */ }
      }, 290_000); // ~5 dakika
    },
    cancel() {
      isActive = false;
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
