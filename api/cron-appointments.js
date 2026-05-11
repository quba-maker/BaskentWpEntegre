import { neon } from '@neondatabase/serverless';
import { sendTelegramAlert } from '../lib/ai/handoverManager.js';

export default async function handler(req, res) {
  // Sadece Vercel Cron servisinin yetkisi olsun
  if (req.headers.authorization !== `Bearer ${process.env.CRON_SECRET}` && !req.query.dev) {
    return res.status(401).end('Unauthorized');
  }

  const sql = neon(process.env.DATABASE_URL);
  let processed = 0;

  try {
    // Gelecekte planlanmış randevuları getir
    const upcomingApts = await sql`
      SELECT 
        e.id, e.phone_number, e.scheduled_date, e.details,
        c.patient_name, c.department
      FROM events e
      LEFT JOIN conversations c ON c.phone_number = e.phone_number
      WHERE e.event_type = 'appointment_request' 
      AND e.status IN ('scheduled', 'confirmed')
      AND e.scheduled_date > NOW()
    `;

    for (const apt of upcomingApts) {
      if (!apt.scheduled_date) continue;

      const msLeft = new Date(apt.scheduled_date) - new Date();
      const daysLeft = Math.floor(msLeft / (1000 * 60 * 60 * 24));

      // Eğer randevuya tam olarak 7 gün, 3 gün veya 1 gün kalmışsa bildirim gönder
      if ([7, 3, 1].includes(daysLeft)) {
        const alertType = `apt_reminder_${daysLeft}d`;
        
        // Aynı gün içinde 2 kez bildirim atmayı engelle
        const alreadyAlerted = await sql`
          SELECT id FROM alerts 
          WHERE phone_number = ${apt.phone_number} 
          AND alert_type = ${alertType} 
          AND created_at > NOW() - INTERVAL '24 hours'
        `;
        
        if (alreadyAlerted.length === 0) {
          const dateStr = new Date(apt.scheduled_date).toLocaleString('tr-TR', {day:'2-digit',month:'long',year:'numeric',hour:'2-digit',minute:'2-digit'});
          const patientName = apt.patient_name || 'Bilinmiyor';
          const dept = apt.department || 'Bilinmiyor';
          const cleanP = apt.phone_number.replace(/\D/g, '');
          
          // 1. CRM Panel Bildirimi
          await sql`INSERT INTO alerts (phone_number, alert_type, message) VALUES (${apt.phone_number}, ${alertType}, ${'⏳ Yaklaşan Randevu (' + daysLeft + ' gün kaldı): ' + patientName})`;
          
          // 2. Telegram Bildirimi
          const crmUrl = `https://baskent-wp-entegre.vercel.app/?phone=${cleanP}`;
          const formattedPhone = apt.phone_number.length > 10 ? `+${apt.phone_number.substring(0,2)} ${apt.phone_number.substring(2,5)} ${apt.phone_number.substring(5,8)} ${apt.phone_number.substring(8,10)} ${apt.phone_number.substring(10)}` : apt.phone_number;

          await sendTelegramAlert(`⏳ <b>YAKLAŞAN RANDEVU (${daysLeft} gün kaldı)</b>\n\n👤 Hasta: <b>${patientName}</b>\n📱 Tel: <a href="tel:+${apt.phone_number}">${formattedPhone}</a>\n🏥 Bölüm: <b>${dept}</b>\n📅 Tarih: <b>${dateStr}</b>\n\n👉 <i>Koordinatör arkadaşların hastayla iletişime geçip teyit alması önerilir.</i>`, {
            inline_keyboard: [[{ text: "🖥️ CRM'de Görüntüle", url: crmUrl }]]
          });

          processed++;
        }
      }
    }

    res.json({ success: true, processed });
  } catch (error) {
    console.error('CRON Appointments Hatası:', error);
    res.status(500).json({ error: error.message });
  }
}
