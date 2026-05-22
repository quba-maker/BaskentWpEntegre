import { NextResponse } from "next/server";
import { withTenantDB } from "@/lib/core/tenant-db";
import { logger } from "@/lib/core/logger";
import { CredentialsService } from "@/lib/services/credentials.service";

const log = logger.withContext({ module: 'FollowUpCron' });

// ==========================================
// QUBA AI — Follow-Up Cron (Tenant-Aware)
// V2: Reads follow_up_enabled from channel_ai_profiles
// Rollback: USE_V2_FOLLOW_UP=false → settings table
// ==========================================

function isV2FollowUpEnabled(): boolean {
  return process.env.USE_V2_FOLLOW_UP !== 'false'; // default: true
}

export async function GET() {
  try {
    const systemDb = withTenantDB('admin-system', true);
    
    // Tüm aktif tenantları al
    const tenants = await systemDb.executeSafe({
      text: "SELECT id, slug FROM tenants WHERE status = 'active'"
    }) as any[];
    
    const results: any[] = [];
    
    for (const tenant of tenants) {
      try {
        const db = withTenantDB(tenant.id);

        // ── Follow-up enabled kontrolü ──
        let isEnabled = true; // default: enabled

        if (isV2FollowUpEnabled()) {
          // V2: Read from channel_ai_profiles
          const followUpConfig = await db.executeSafe({
            text: `SELECT cap.follow_up_enabled 
                   FROM channel_ai_profiles cap
                   JOIN channel_groups cg ON cap.group_id = cg.id
                   WHERE cg.tenant_id = $1
                   ORDER BY cap.updated_at DESC LIMIT 1`,
            values: [tenant.id]
          }) as any[];

          if (followUpConfig.length > 0 && followUpConfig[0].follow_up_enabled === false) {
            isEnabled = false;
          }
          // No rows = default enabled
        } else {
          // V1 FALLBACK: Read from settings table
          const followUpSettings = await db.executeSafe({
            text: "SELECT value FROM settings WHERE key = 'bot_follow_up_enabled' AND tenant_id = $1",
            values: [tenant.id]
          }) as any[];

          if (followUpSettings.length > 0 && followUpSettings[0].value === 'false') {
            isEnabled = false;
          }
        }

        if (!isEnabled) {
          results.push({ tenant: tenant.slug, status: 'disabled' });
          continue;
        }

        // Takip gereken konuşmaları bul
        const conversations = await db.executeSafe({
          text: `
            SELECT c.phone_number, c.patient_name, c.follow_up_count, c.channel
            FROM conversations c
            WHERE c.tenant_id = $1
              AND c.status = 'bot'
              AND c.follow_up_count < 3
              AND c.last_message_at < NOW() - INTERVAL '24 hours'
              AND c.last_message_at > NOW() - INTERVAL '7 days'
              AND NOT EXISTS (
                SELECT 1 FROM messages m 
                WHERE m.phone_number = c.phone_number 
                  AND m.direction = 'in' 
                  AND m.created_at > c.last_message_at
                  AND m.tenant_id = $2
              )
            LIMIT 10
          `,
          values: [tenant.id, tenant.id]
        }) as any[];

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
            if (conv.channel === 'whatsapp') {
              const creds = await CredentialsService.resolveCredentials(tenant.id, "whatsapp");
              const token = creds.accessToken;
              const phoneId = creds.whatsappPhoneNumberId;
              
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
            await db.executeSafe({
              text: "UPDATE conversations SET follow_up_count = $1, last_message_at = NOW() WHERE phone_number = $2 AND tenant_id = $3",
              values: [count, conv.phone_number, tenant.id]
            });

            await db.executeSafe({
              text: "INSERT INTO messages (tenant_id, phone_number, direction, content, channel) VALUES ($1, $2, 'out', $3, $4)",
              values: [tenant.id, conv.phone_number, msg, conv.channel || 'whatsapp']
            });
            
          } catch (e: any) {
            log.error(`Follow-up hatası`, e instanceof Error ? e : new Error(String(e)), { phone: conv.phone_number });
          }
        }
        
        results.push({ tenant: tenant.slug, followUps: conversations.length });
      } catch (e: any) {
        results.push({ tenant: tenant.slug, error: e.message });
      }
    }

    return NextResponse.json({ success: true, results });
  } catch (e: any) {
    log.error("Follow-up cron hatası", e instanceof Error ? e : new Error(String(e)));
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
