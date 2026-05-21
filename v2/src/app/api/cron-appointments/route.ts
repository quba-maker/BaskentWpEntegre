import { NextResponse } from "next/server";
import { withTenantDB } from "@/lib/core/tenant-db";
import { logger } from "@/lib/core/logger";
import { CredentialsService } from "@/lib/services/credentials.service";

const log = logger.withContext({ module: 'CronAppointments' });

// ==========================================
// QUBA AI — Cron Appointments (Tenant-Aware)
// Randevu hatırlatması — tüm tenantlar için çalışır
// ==========================================

export async function GET() {
  try {
    const systemDb = withTenantDB('admin-system', true);
    
    // Tüm aktif tenantların yarınki randevularını bul
    const tenants = await systemDb.executeSafe({
      text: "SELECT id, slug, reminder_template, reminder_hours_before FROM tenants WHERE status = 'active'"
    }) as any[];
    
    const results: any[] = [];
    
    for (const tenant of tenants) {
      try {
        const db = withTenantDB(tenant.id);

        // events tablosu yoksa atla
        const eventsExist = await systemDb.executeSafe({
          text: `
            SELECT EXISTS (
              SELECT FROM information_schema.tables WHERE table_name = 'events'
            ) as exists
          `
        }) as any[];

        if (!eventsExist[0]?.exists) {
          results.push({ tenant: tenant.slug, status: 'no_events_table' });
          continue;
        }

        const hoursBefore = tenant.reminder_hours_before || 24;

        // Randevuları bul (Interval dinamik)
        const appointments = await db.executeSafe({
          text: `
            SELECT e.phone_number, e.scheduled_date, c.patient_name
            FROM events e
            LEFT JOIN conversations c ON c.phone_number = e.phone_number
            WHERE c.tenant_id = $1
              AND e.event_type = 'appointment_request'
              AND e.status IN ('scheduled', 'confirmed')
              AND e.scheduled_date::date = (CURRENT_DATE + INTERVAL '1 hour' * $2)::date
            LIMIT 20
          `,
          values: [tenant.id, hoursBefore]
        }) as any[];

        for (const apt of appointments) {
          try {
            const dateStr = new Date(apt.scheduled_date).toLocaleString('tr-TR', {
              day: '2-digit', month: 'long', hour: '2-digit', minute: '2-digit'
            });
            
            // SaaS Logic: Use tenant's custom reminder template or fallback
            const template = tenant.reminder_template || "Merhaba {{patient_name}} 🙏 Yarın {{time}} için planlanan randevunuzu hatırlatmak istiyoruz. Görüşmek üzere!";
            const msg = template
              .replace("{{patient_name}}", apt.patient_name || '')
              .replace("{{time}}", dateStr)
              .replace("{{date}}", dateStr);
            
            const creds = await CredentialsService.resolveCredentials(tenant.id, "whatsapp");
            const token = creds.accessToken;
            const phoneId = creds.whatsappPhoneNumberId;
            
            if (token && phoneId) {
              await fetch(`https://graph.facebook.com/v25.0/${phoneId}/messages`, {
                method: "POST",
                headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
                body: JSON.stringify({
                  messaging_product: "whatsapp",
                  to: apt.phone_number,
                  type: "text",
                  text: { body: msg }
                })
              });
              
              await db.executeSafe({
                text: "INSERT INTO messages (tenant_id, phone_number, direction, content) VALUES ($1, $2, 'out', $3)",
                values: [tenant.id, apt.phone_number, msg]
              });
            }
          } catch (e: any) {
            log.error(`Appointment reminder hatası`, e instanceof Error ? e : new Error(String(e)), { phone: apt.phone_number });
          }
        }
        
        results.push({ tenant: tenant.slug, reminders: appointments.length });
      } catch (e: any) {
        results.push({ tenant: tenant.slug, error: e.message });
      }
    }

    return NextResponse.json({ success: true, results });
  } catch (e: any) {
    log.error("Cron appointments hatası", e instanceof Error ? e : new Error(String(e)));
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
