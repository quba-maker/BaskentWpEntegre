import axios from 'axios';
import { neon } from '@neondatabase/serverless';

// WhatsApp Template mesajı gönderme (24 saat penceresi kapandıktan sonra)
async function sendTemplateMessage(phoneId, token, phone, templateName, languageCode = 'tr') {
  return axios({
    method: 'POST',
    url: `https://graph.facebook.com/v25.0/${phoneId}/messages`,
    headers: { Authorization: `Bearer ${token}` },
    data: {
      messaging_product: 'whatsapp',
      to: phone,
      type: 'template',
      template: {
        name: templateName,
        language: { code: languageCode }
      }
    }
  });
}

// Normal metin mesajı gönderme (24 saat penceresi açıkken)
async function sendTextMessage(phoneId, token, phone, text) {
  return axios({
    method: 'POST',
    url: `https://graph.facebook.com/v25.0/${phoneId}/messages`,
    headers: { Authorization: `Bearer ${token}` },
    data: { messaging_product: 'whatsapp', to: phone, type: 'text', text: { body: text } }
  });
}

export default async function handler(req, res) {
  const authHeader = req.headers.authorization;
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}` && req.query.key !== 'baskent2024setup') {
    return res.status(401).json({ error: 'Yetkisiz' });
  }

  const META = process.env.META_ACCESS_TOKEN;
  const PHONE_ID = process.env.PHONE_NUMBER_ID;
  const DATABASE_URL = process.env.DATABASE_URL;
  if (!DATABASE_URL) return res.status(500).json({ error: 'DB yok' });

  const sql = neon(DATABASE_URL);

  try { await sql`ALTER TABLE conversations ADD COLUMN IF NOT EXISTS follow_up_count INT DEFAULT 0`; } catch(e) {}
  try { await sql`ALTER TABLE conversations ADD COLUMN IF NOT EXISTS last_follow_up_at TIMESTAMP`; } catch(e) {}

  // Kullanılacak şablon adını ayarlardan oku
  let templateName = 'hello_world'; // Meta varsayılan onaylı şablon
  try {
    const s = await sql`SELECT value FROM settings WHERE key = 'followup_template_name'`;
    if (s.length > 0 && s[0].value) templateName = s[0].value;
  } catch(e) {}

  try {
    const staleConversations = await sql`
      SELECT c.phone_number, c.patient_name, c.follow_up_count, c.status,
        (SELECT direction FROM messages WHERE phone_number = c.phone_number ORDER BY created_at DESC LIMIT 1) as last_direction,
        (SELECT created_at FROM messages WHERE phone_number = c.phone_number AND direction = 'in' ORDER BY created_at DESC LIMIT 1) as last_patient_msg_time
      FROM conversations c
      WHERE c.status != 'human'
        AND c.follow_up_count < 2
        AND c.last_message_at < NOW() - INTERVAL '6 hours'
    `;

    let sent = 0, skipped = 0, templateUsed = 0, textUsed = 0;

    for (const conv of staleConversations) {
      if (conv.last_direction !== 'out') { skipped++; continue; }

      const name = conv.patient_name || '';
      
      // 24 saat penceresi kontrolü
      const lastPatientMsg = conv.last_patient_msg_time ? new Date(conv.last_patient_msg_time) : null;
      const hoursSince = lastPatientMsg ? (Date.now() - lastPatientMsg.getTime()) / 3600000 : 999;
      const windowOpen = hoursSince < 24;

      let msgContent = '';

      try {
        if (windowOpen) {
          // ✅ Pencere açık — normal metin
          if (conv.follow_up_count === 0) {
            msgContent = name
              ? `${name}, randevunuzla ilgili size ulaşmaya çalışmıştık. Size uygun bir zaman belirleyebilir miyiz? Sağlığınız bizim için önemli.`
              : `Randevunuzla ilgili size ulaşmaya çalışmıştık. Size uygun bir zaman belirleyebilir miyiz? Sağlığınız bizim için önemli.`;
          } else {
            msgContent = name
              ? `${name}, son olarak hatırlatmak istedik. Randevu veya sağlık konusunda yardımcı olabiliriz. İstediğiniz zaman bize yazabilirsiniz.`
              : `Son olarak hatırlatmak istedik. Randevu veya sağlık konusunda yardımcı olabiliriz. İstediğiniz zaman bize yazabilirsiniz.`;
          }
          await sendTextMessage(PHONE_ID, META, conv.phone_number, msgContent);
          textUsed++;
          console.log(`📤 [Metin] Takip #${conv.follow_up_count + 1}: ${conv.phone_number}`);
        } else {
          // ⏰ Pencere KAPALI — şablon mesaj
          await sendTemplateMessage(PHONE_ID, META, conv.phone_number, templateName);
          msgContent = `[Şablon: ${templateName}]`;
          templateUsed++;
          console.log(`📋 [Şablon] Takip #${conv.follow_up_count + 1}: ${conv.phone_number} (${Math.round(hoursSince)}s)`);
        }

        await sql`INSERT INTO messages (phone_number, direction, content, model_used, channel) VALUES (${conv.phone_number}, 'out', ${msgContent}, 'follow-up', 'whatsapp')`;
        await sql`UPDATE conversations SET follow_up_count = follow_up_count + 1, last_follow_up_at = NOW(), last_message_at = NOW() WHERE phone_number = ${conv.phone_number}`;
        sent++;
      } catch (e) {
        console.error(`❌ Takip hatası (${conv.phone_number}):`, e.response?.data?.error?.message || e.message);
      }
    }

    console.log(`✅ Takip: ${sent} gönderildi (${textUsed} metin, ${templateUsed} şablon), ${skipped} atlandı`);
    return res.json({ success: true, sent, skipped, textUsed, templateUsed, total: staleConversations.length });

  } catch (error) {
    console.error('❌ Follow-up hatası:', error.message);
    return res.status(500).json({ error: error.message });
  }
}
