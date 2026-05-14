import { NextResponse } from "next/server";
import { neon } from "@neondatabase/serverless";

// ==========================================
// QUBA AI — Follow-Up Cron (Tenant-Aware)
// Her aktif tenant için ayrı ayrı çalışır
// ==========================================

export async function GET() {
  try {
    const sql = neon(process.env.DATABASE_URL!);
    
    // Tüm aktif tenantları al
    const tenants = await sql`SELECT id, slug, meta_page_token, whatsapp_phone_id FROM tenants WHERE status = 'active'`;
    
    const results: any[] = [];
    
    for (const tenant of tenants) {
      try {
        // Tenant'ın follow-up ayarlarını kontrol et
        const followUpEnabled = await sql`SELECT value FROM settings WHERE key = 'bot_follow_up_enabled' AND tenant_id = ${tenant.id}`;
        if (followUpEnabled.length > 0 && followUpEnabled[0].value === 'false') {
          results.push({ tenant: tenant.slug, status: 'disabled' });
          continue;
        }

        // Takip gereken konuşmaları bul
        const conversations = await sql`
          SELECT c.phone_number, c.patient_name, c.follow_up_count, c.channel
          FROM conversations c
          WHERE c.tenant_id = ${tenant.id}
            AND c.status = 'bot'
            AND c.follow_up_count < 3
            AND c.last_message_at < NOW() - INTERVAL '24 hours'
            AND c.last_message_at > NOW() - INTERVAL '7 days'
            AND NOT EXISTS (
              SELECT 1 FROM messages m 
              WHERE m.phone_number = c.phone_number 
                AND m.direction = 'in' 
                AND m.created_at > c.last_message_at
            )
          LIMIT 10
        `;

        for (const conv of conversations) {
          try {
            // Follow-up mesajı gönder
            const count = (conv.follow_up_count || 0) + 1;
            const followUpMessages = [
              `Merhaba ${conv.patient_name || ''} 🙏 Daha önce iletişime geçmiştik. Tedavi süreciniz hakkında merak ettiğiniz bir şey var mı?`,
              `${conv.patient_name || 'Merhaba'}, sizinle ilgili merak ediyoruz. Sorularınız varsa yanıtlamaktan mutluluk duyarız 😊`,
              `Son hatırlatma: ${conv.patient_name || ''}, randevu planlamak isterseniz size yardımcı olmaktan memnuniyet duyarız. İyi günler dileriz 🌸`
            ];
            const msg = followUpMessages[Math.min(count - 1, 2)];

            // Mesaj gönder (WhatsApp kanalı için)
            if (conv.channel === 'whatsapp' && tenant.whatsapp_phone_id) {
              const token = tenant.meta_page_token || process.env.META_ACCESS_TOKEN;
              const phoneId = tenant.whatsapp_phone_id || process.env.PHONE_NUMBER_ID;
              
              if (token && phoneId) {
                await fetch(`https://graph.facebook.com/v25.0/${phoneId}/messages`, {
                  method: "POST",
                  headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
                  body: JSON.stringify({
                    messaging_product: "whatsapp",
                    to: conv.phone_number,
                    type: "text",
                    text: { body: msg }
                  })
                });
              }
            }

            // DB güncelle
            await sql`UPDATE conversations SET follow_up_count = ${count}, last_message_at = NOW() WHERE phone_number = ${conv.phone_number}`;
            await sql`INSERT INTO messages (tenant_id, phone_number, direction, content, model_used, channel) VALUES (${tenant.id}, ${conv.phone_number}, 'out', ${msg}, 'follow-up-cron', ${conv.channel || 'whatsapp'})`;
            
          } catch (e: any) {
            console.error(`Follow-up hatası (${conv.phone_number}):`, e.message);
          }
        }
        
        results.push({ tenant: tenant.slug, followUps: conversations.length });
      } catch (e: any) {
        results.push({ tenant: tenant.slug, error: e.message });
      }
    }

    return NextResponse.json({ success: true, results });
  } catch (e: any) {
    console.error("Follow-up cron hatası:", e);
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
