import axios from 'axios';
import { neon } from '@neondatabase/serverless';

export default async function handler(req, res) {
  // Cron job güvenlik kontrolü
  const authHeader = req.headers.authorization;
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}` && req.query.key !== 'baskent2024setup') {
    return res.status(401).json({ error: 'Yetkisiz' });
  }

  const META_ACCESS_TOKEN = process.env.META_ACCESS_TOKEN;
  const PHONE_NUMBER_ID = process.env.PHONE_NUMBER_ID;
  const DATABASE_URL = process.env.DATABASE_URL;
  if (!DATABASE_URL) return res.status(500).json({ error: 'DB yok' });

  const sql = neon(DATABASE_URL);

  // follow_up_count sütunu yoksa ekle
  try { await sql`ALTER TABLE conversations ADD COLUMN IF NOT EXISTS follow_up_count INT DEFAULT 0`; } catch(e) {}
  try { await sql`ALTER TABLE conversations ADD COLUMN IF NOT EXISTS last_follow_up_at TIMESTAMP`; } catch(e) {}

  try {
    // 24 saat önce mesaj gönderilmiş ama cevap alınmamış konuşmalar
    // Son mesaj bottan gelen ve 24+ saat geçmiş olanlar
    const staleConversations = await sql`
      SELECT c.phone_number, c.patient_name, c.follow_up_count, c.status,
        (SELECT content FROM messages WHERE phone_number = c.phone_number ORDER BY created_at DESC LIMIT 1) as last_content,
        (SELECT direction FROM messages WHERE phone_number = c.phone_number ORDER BY created_at DESC LIMIT 1) as last_direction,
        (SELECT created_at FROM messages WHERE phone_number = c.phone_number ORDER BY created_at DESC LIMIT 1) as last_msg_time
      FROM conversations c
      WHERE c.status != 'human'
        AND c.follow_up_count < 2
        AND c.last_message_at < NOW() - INTERVAL '24 hours'
    `;

    let sent = 0;
    let skipped = 0;

    for (const conv of staleConversations) {
      // Son mesaj bizden gitmişse (hasta cevap vermemiş)
      if (conv.last_direction !== 'out') {
        skipped++;
        continue;
      }

      // follow_up_count'a göre mesaj belirle
      let followUpMsg = '';
      const name = conv.patient_name ? conv.patient_name : '';

      if (conv.follow_up_count === 0) {
        // İlk hatırlatma (24 saat sonra)
        followUpMsg = name
          ? `${name}, randevunuzla ilgili size ulaşmaya çalışmıştık. Size uygun bir zaman belirleyebilir miyiz? Sağlığınız bizim için önemli.`
          : `Randevunuzla ilgili size ulaşmaya çalışmıştık. Size uygun bir zaman belirleyebilir miyiz? Sağlığınız bizim için önemli.`;
      } else if (conv.follow_up_count === 1) {
        // Son hatırlatma (48 saat sonra)
        followUpMsg = name
          ? `${name}, son olarak hatırlatmak istedik. Randevu veya sağlık konusunda yardımcı olabiliriz. İstediğiniz zaman bize yazabilirsiniz.`
          : `Son olarak hatırlatmak istedik. Randevu veya sağlık konusunda yardımcı olabiliriz. İstediğiniz zaman bize yazabilirsiniz.`;
      }

      if (!followUpMsg) continue;

      // WhatsApp mesajı gönder
      try {
        await axios({
          method: 'POST',
          url: `https://graph.facebook.com/v25.0/${PHONE_NUMBER_ID}/messages`,
          headers: { Authorization: `Bearer ${META_ACCESS_TOKEN}` },
          data: { messaging_product: 'whatsapp', to: conv.phone_number, type: 'text', text: { body: followUpMsg } }
        });

        // Mesajı kaydet
        await sql`INSERT INTO messages (phone_number, direction, content, model_used) VALUES (${conv.phone_number}, 'out', ${followUpMsg}, 'follow-up')`;
        
        // Follow-up sayacını güncelle
        await sql`UPDATE conversations SET follow_up_count = follow_up_count + 1, last_follow_up_at = NOW(), last_message_at = NOW() WHERE phone_number = ${conv.phone_number}`;

        console.log(`📤 Takip mesajı #${conv.follow_up_count + 1} gönderildi: ${conv.phone_number}`);
        sent++;
      } catch (e) {
        console.error(`❌ Takip mesajı hatası (${conv.phone_number}):`, e.response?.data?.error?.message || e.message);
      }
    }

    // Hasta cevap verdiğinde follow_up_count sıfırlansın (webhook'ta halledilecek)
    console.log(`✅ Takip tamamlandı: ${sent} gönderildi, ${skipped} atlandı`);
    return res.status(200).json({ success: true, sent, skipped, total: staleConversations.length });

  } catch (error) {
    console.error('❌ Follow-up hatası:', error.message);
    return res.status(500).json({ error: error.message });
  }
}
// deploy 1777506259
