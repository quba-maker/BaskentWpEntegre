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
      template: { name: templateName, language: { code: languageCode } }
    }
  });
}

// Normal metin mesajı gönderme
async function sendTextMessage(phoneId, token, phone, text) {
  return axios({
    method: 'POST',
    url: `https://graph.facebook.com/v25.0/${phoneId}/messages`,
    headers: { Authorization: `Bearer ${token}` },
    data: { messaging_product: 'whatsapp', to: phone, type: 'text', text: { body: text } }
  });
}

// Dil tespit fonksiyonu
function detectLang(text) {
  if (!text) return 'tr';
  if (/[\u0600-\u06FF]/.test(text)) return 'ar';
  if (/[\u0400-\u04FF]/.test(text)) return 'ru';
  const l = text.toLowerCase();
  if (/^(hello|hi|hey|i need|i want|please|thank|good)/.test(l)) return 'en';
  if (/^(hallo|guten|ich|danke|bitte)/.test(l)) return 'de';
  if (/^(bonjour|salut|je|merci)/.test(l)) return 'fr';
  return 'tr';
}

// Dile göre follow-up metin mesajları
const followUpTexts = {
  tr: [
    (n) => `${n ? n+', r' : 'R'}andevunuzla ilgili size ulaşmaya çalışmıştık. Size uygun bir zaman belirleyebilir miyiz? Sağlığınız bizim için önemli.`,
    (n) => `${n ? n+', s' : 'S'}on olarak hatırlatmak istedik. Randevu veya sağlık konusunda yardımcı olabiliriz. İstediğiniz zaman bize yazabilirsiniz.`
  ],
  en: [
    (n) => `${n ? n+', w' : 'W'}e tried to reach you regarding your appointment. Could we schedule a convenient time? Your health is important to us.`,
    (n) => `${n ? n+', j' : 'J'}ust a final reminder. We are here to help with your health consultation. Feel free to message us anytime.`
  ],
  ar: [
    (n) => `${n ? n+'، ' : ''}حاولنا التواصل معكم بخصوص موعدكم. هل يمكننا تحديد وقت مناسب لكم؟ صحتكم تهمنا.`,
    (n) => `${n ? n+'، ' : ''}تذكير أخير. نحن هنا لمساعدتكم في استشارتكم الصحية. لا تترددوا في مراسلتنا في أي وقت.`
  ],
  de: [
    (n) => `${n ? n+', w' : 'W'}ir haben versucht, Sie bezüglich Ihres Termins zu erreichen. Können wir eine passende Zeit vereinbaren? Ihre Gesundheit ist uns wichtig.`,
    (n) => `${n ? n+', e' : 'E'}ine letzte Erinnerung. Wir sind hier, um Ihnen bei Ihrer Gesundheitsberatung zu helfen. Schreiben Sie uns jederzeit.`
  ],
  fr: [
    (n) => `${n ? n+', n' : 'N'}ous avons essayé de vous joindre concernant votre rendez-vous. Pouvons-nous convenir d'un moment? Votre santé est importante pour nous.`,
    (n) => `${n ? n+', u' : 'U'}n dernier rappel. Nous sommes là pour vous aider. N'hésitez pas à nous écrire à tout moment.`
  ],
  ru: [
    (n) => `${n ? n+', м' : 'М'}ы пытались связаться с вами по поводу вашей записи. Можем ли мы назначить удобное время? Ваше здоровье важно для нас.`,
    (n) => `${n ? n+', п' : 'П'}оследнее напоминание. Мы готовы помочь вам с медицинской консультацией. Пишите нам в любое время.`
  ]
};

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

  // Şablon adını ayarlardan oku
  let templateName = 'randevu_hatirlatma';
  try {
    const s = await sql`SELECT value FROM settings WHERE key = 'followup_template_name'`;
    if (s.length > 0 && s[0].value) templateName = s[0].value;
  } catch(e) {}

  try {
    const staleConversations = await sql`
      SELECT c.phone_number, c.patient_name, c.follow_up_count, c.status,
        (SELECT direction FROM messages WHERE phone_number = c.phone_number ORDER BY created_at DESC LIMIT 1) as last_direction,
        (SELECT created_at FROM messages WHERE phone_number = c.phone_number AND direction = 'in' ORDER BY created_at DESC LIMIT 1) as last_patient_msg_time,
        (SELECT content FROM messages WHERE phone_number = c.phone_number AND direction = 'in' ORDER BY created_at DESC LIMIT 1) as last_patient_text
      FROM conversations c
      WHERE c.follow_up_count < 2
        AND c.last_message_at < NOW() - INTERVAL '24 hours'
    `;

    let sent = 0, skipped = 0, templateUsed = 0, textUsed = 0;

    for (const conv of staleConversations) {
      if (conv.last_direction !== 'out') { skipped++; continue; }

      const name = conv.patient_name || '';
      const lang = detectLang(conv.last_patient_text);
      
      // 24 saat penceresi kontrolü
      const lastPatientMsg = conv.last_patient_msg_time ? new Date(conv.last_patient_msg_time) : null;
      const hoursSince = lastPatientMsg ? (Date.now() - lastPatientMsg.getTime()) / 3600000 : 999;
      const windowOpen = hoursSince < 24;

      let msgContent = '';

      try {
        if (windowOpen) {
          // ✅ Pencere açık — hastanın dilinde metin gönder
          const texts = followUpTexts[lang] || followUpTexts.tr;
          const idx = Math.min(conv.follow_up_count, texts.length - 1);
          msgContent = texts[idx](name);
          await sendTextMessage(PHONE_ID, META, conv.phone_number, msgContent);
          textUsed++;
          console.log(`📤 [Metin/${lang}] Takip #${conv.follow_up_count + 1}: ${conv.phone_number}`);
        } else {
          // ⏰ Pencere KAPALI — hastanın dilinde şablon gönder
          await sendTemplateMessage(PHONE_ID, META, conv.phone_number, templateName, lang);
          msgContent = `[Şablon: ${templateName} (${lang})]`;
          templateUsed++;
          console.log(`📋 [Şablon/${lang}] Takip #${conv.follow_up_count + 1}: ${conv.phone_number} (${Math.round(hoursSince)}s)`);
        }

        await sql`INSERT INTO messages (phone_number, direction, content, model_used, channel) VALUES (${conv.phone_number}, 'out', ${msgContent}, 'follow-up', 'whatsapp')`;
        await sql`UPDATE conversations SET follow_up_count = follow_up_count + 1, last_follow_up_at = NOW(), last_message_at = NOW(), phase = 'recovery' WHERE phone_number = ${conv.phone_number}`;
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
