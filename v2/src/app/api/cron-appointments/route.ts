import { NextResponse } from "next/server";
import { neon } from "@neondatabase/serverless";

// ==========================================
// QUBA AI — Cron Appointments (Tenant-Aware)
// Randevu hatırlatması — tüm tenantlar için çalışır
// ==========================================

export async function GET() {
  try {
    const sql = neon(process.env.DATABASE_URL!);
    
    // Tüm aktif tenantların yarınki randevularını bul
    const tenants = await sql`SELECT id, slug, meta_page_token, whatsapp_phone_id, reminder_template, reminder_hours_before FROM tenants WHERE status = 'active'`;
    
    const results: any[] = [];
    
    for (const tenant of tenants) {
      try {
        // events tablosu yoksa atla
        const eventsExist = await sql`
          SELECT EXISTS (
            SELECT FROM information_schema.tables WHERE table_name = 'events'
          ) as exists
        `;
        if (!eventsExist[0]?.exists) {
          results.push({ tenant: tenant.slug, status: 'no_events_table' });
          continue;
        }

        const hoursBefore = tenant.reminder_hours_before || 24;

        // Randevuları bul (Interval dinamik)
        const appointments = await sql`
          SELECT e.phone_number, e.scheduled_date, c.patient_name
          FROM events e
          LEFT JOIN conversations c ON c.phone_number = e.phone_number
          WHERE c.tenant_id = ${tenant.id}
            AND e.event_type = 'appointment_request'
            AND e.status IN ('scheduled', 'confirmed')
            AND e.scheduled_date::date = (CURRENT_DATE + INTERVAL '1 hour' * ${hoursBefore})::date
          LIMIT 20
        `;

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
            
            const token = tenant.meta_page_token || process.env.META_ACCESS_TOKEN;
            const phoneId = tenant.whatsapp_phone_id || process.env.PHONE_NUMBER_ID;
            
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
              
              await sql`INSERT INTO messages (tenant_id, phone_number, direction, content, model_used) VALUES (${tenant.id}, ${apt.phone_number}, 'out', ${msg}, 'cron-reminder')`;
            }
          } catch (e: any) {
            console.error(`Appointment reminder hatası (${apt.phone_number}):`, e.message);
          }
        }
        
        results.push({ tenant: tenant.slug, reminders: appointments.length });
      } catch (e: any) {
        results.push({ tenant: tenant.slug, error: e.message });
      }
    }

    return NextResponse.json({ success: true, results });
  } catch (e: any) {
    console.error("Cron appointments hatası:", e);
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
