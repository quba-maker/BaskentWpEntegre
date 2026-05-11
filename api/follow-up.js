import axios from 'axios';
import { neon } from '@neondatabase/serverless';
import { checkEscalations, sendTelegramAlert } from '../lib/ai/handoverManager.js';
import { sendInstagramMessage } from '../lib/channels/instagram.js';
import { sendMessengerMessage } from '../lib/channels/messenger.js';

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

// ============================================================
// 4 KADEMELİ TAKİP SİSTEMİ
// Kademe 0: 2 saat   → Nazik hatırlatma
// Kademe 1: 6 saat   → Değer teklifi + sosyal kanıt
// Kademe 2: 24 saat  → Son çağrı + ücretsiz değerlendirme
// Kademe 3: 72 saat  → Template mesaj (24h window kapalı)
// ============================================================

const followUpMessages = {
  tr: [
    // Kademe 0 (2 saat) — Nazik hatırlatma
    (n, dept) => `${n ? n + ', m' : 'M'}esajımızı gördünüz mü? ${dept ? dept + ' konusunda' : 'Sağlığınızla ilgili'} sizinle konuşmak istiyoruz 🙏`,
    // Kademe 1 (6 saat) — Sosyal kanıt + değer
    (n, dept) => `${n ? n + ', g' : 'G'}eçen ay ${dept || 'benzer şikayetle'} gelen hastalarımız tedavilerinden çok memnun kaldı. Sizin durumunuzu da değerlendirebiliriz — ücretsiz ön görüşme hakkınız var.`,
    // Kademe 2 (24 saat) — Son çağrı
    (n, dept) => `${n ? n + ', s' : 'S'}on hatırlatma 🙏 ${dept || 'Sağlık'} konusundaki ücretsiz ön değerlendirme hakkınız hala geçerli. Erken teşhis tedavi başarısını önemli ölçüde artırıyor. Bize yazmak ister misiniz?`,
  ],
  en: [
    (n, dept) => `${n ? n + ', d' : 'D'}id you see our message? We'd love to discuss your ${dept || 'health'} concern 🙏`,
    (n, dept) => `${n ? n + ', l' : 'L'}ast month, patients with similar ${dept || 'conditions'} were very satisfied with their treatment. You have a free preliminary consultation available.`,
    (n, dept) => `${n ? n + ', f' : 'F'}inal reminder 🙏 Your free ${dept || 'health'} evaluation is still available. Early diagnosis significantly improves treatment success.`,
  ],
  ar: [
    (n, dept) => `${n ? n + '، ' : ''}هل رأيت رسالتنا؟ نود مناقشة حالتك ${dept ? 'في ' + dept : 'الصحية'} 🙏`,
    (n, dept) => `${n ? n + '، ' : ''}المرضى الذين زارونا الشهر الماضي كانوا راضين جداً. لديك استشارة أولية مجانية.`,
    (n, dept) => `${n ? n + '، ' : ''}تذكير أخير 🙏 التشخيص المبكر يحسن نتائج العلاج بشكل كبير. هل تود التواصل معنا؟`,
  ],
  de: [
    (n, dept) => `${n ? n + ', h' : 'H'}aben Sie unsere Nachricht gesehen? Wir möchten gerne über Ihr ${dept || 'Gesundheits'}anliegen sprechen 🙏`,
    (n, dept) => `${n ? n + ', l' : 'L'}etzten Monat waren Patienten mit ähnlichen Beschwerden sehr zufrieden. Sie haben eine kostenlose Erstberatung.`,
    (n, dept) => `${n ? n + ', l' : 'L'}etzte Erinnerung 🙏 Ihre kostenlose Bewertung ist noch verfügbar. Früherkennung verbessert den Behandlungserfolg erheblich.`,
  ],
  fr: [
    (n, dept) => `${n ? n + ', a' : 'A'}vez-vous vu notre message ? Nous aimerions discuter de votre ${dept || 'santé'} 🙏`,
    (n, dept) => `${n ? n + ', l' : 'L'}e mois dernier, des patients similaires étaient très satisfaits. Vous avez une consultation préliminaire gratuite.`,
    (n, dept) => `${n ? n + ', d' : 'D'}ernier rappel 🙏 Votre évaluation gratuite est toujours disponible. Un diagnostic précoce améliore considérablement les résultats.`,
  ],
  ru: [
    (n, dept) => `${n ? n + ', в' : 'В'}ы видели наше сообщение? Мы хотели бы обсудить ваш ${dept || 'вопрос здоровья'} 🙏`,
    (n, dept) => `${n ? n + ', в' : 'В'} прошлом месяце пациенты с похожими проблемами были очень довольны лечением. У вас есть бесплатная первичная консультация.`,
    (n, dept) => `${n ? n + ', п' : 'П'}оследнее напоминание 🙏 Ваша бесплатная оценка всё ещё доступна. Ранняя диагностика значительно улучшает результаты лечения.`,
  ]
};

// Kademe → minimum bekleme süresi (saat)
const FOLLOW_UP_THRESHOLDS = [
  { minHours: 2,  maxFollowUpCount: 0 },  // Kademe 0: 2 saat sonra
  { minHours: 6,  maxFollowUpCount: 1 },  // Kademe 1: 6 saat sonra
  { minHours: 24, maxFollowUpCount: 2 },  // Kademe 2: 24 saat sonra
  { minHours: 72, maxFollowUpCount: 3 },  // Kademe 3: 72 saat sonra (template)
];

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

  // 🕐 Saat kontrolü — sadece 08:00-21:00 TR saatinde çalış
  const trHour = new Date().toLocaleString('en-US', { timeZone: 'Europe/Istanbul', hour: 'numeric', hour12: false });
  const hourNow = parseInt(trHour);
  if (hourNow < 8 || hourNow >= 21) {
    return res.json({ success: true, skipped: 'night_hours', hour: hourNow });
  }

  // DB migration
  try { await sql`ALTER TABLE conversations ADD COLUMN IF NOT EXISTS follow_up_count INT DEFAULT 0`; } catch(e) {}
  try { await sql`ALTER TABLE conversations ADD COLUMN IF NOT EXISTS last_follow_up_at TIMESTAMP`; } catch(e) {}

  // Şablon adını ayarlardan oku
  let templateName = 'randevu_hatirlatma';
  try {
    const s = await sql`SELECT value FROM settings WHERE key = 'followup_template_name'`;
    if (s.length > 0 && s[0].value) templateName = s[0].value;
  } catch(e) {}

  let sent = 0, skipped = 0, templateUsed = 0, textUsed = 0, welcomeSent = 0;

  // ============================================================
  // BÖLÜM 1: Geciken karşılama mesajları (gece gelen leadler)
  // ============================================================
  try {
    const pendingWelcomes = await sql`
      SELECT c.phone_number, c.patient_name, c.department
      FROM conversations c
      WHERE c.phase = 'pending_welcome'
    `;

    for (const pw of pendingWelcomes) {
      const phone = pw.phone_number;
      const name = pw.patient_name || '';
      const dept = pw.department || 'sağlık';
      const isTurkish = phone.startsWith('90');

      // Karşılama mesajı oluştur
      let greetingTr = '', greetingEn = '';
      try {
        const trSet = await sql`SELECT value FROM settings WHERE key = 'form_greeting_tr'`;
        const enSet = await sql`SELECT value FROM settings WHERE key = 'form_greeting_en'`;
        greetingTr = trSet.length > 0 ? trSet[0].value : '';
        greetingEn = enSet.length > 0 ? enSet[0].value : '';
      } catch(e) {}

      const greeting = name ? (isTurkish ? `Merhaba ${name}!` : `Hello ${name}!`) : (isTurkish ? 'Merhaba!' : 'Hello!');
      let welcomeMsg;
      if (isTurkish) {
        welcomeMsg = greetingTr
          ? greetingTr.replace('{isim}', name).replace('{bolum}', dept).trim()
          : `${greeting} Başkent Üniversitesi Konya Hastanesi'nden yazıyoruz 🙏\n\n${dept} konusunda bize ulaştığınızı gördük. Şikayetiniz ne zamandır devam ediyor?\n\nDurumunuzu daha iyi anlamamız için birkaç soru sormak istiyoruz, sonrasında size en uygun değerlendirmeyi sunalım.`;
      } else {
        welcomeMsg = greetingEn
          ? greetingEn.replace('{name}', name).replace('{department}', dept).trim()
          : `${greeting} We're reaching out from Başkent University Konya Hospital 🙏\n\nWe noticed your interest in ${dept}. How long have you been experiencing this issue?\n\nWe'd like to understand your situation better so we can recommend the best course of action for you.`;
      }

      try {
        await sendTextMessage(PHONE_ID, META, phone, welcomeMsg);
        await sql`INSERT INTO messages (phone_number, direction, content, model_used) VALUES (${phone}, 'out', ${welcomeMsg}, 'lead-auto')`;
        await sql`UPDATE conversations SET phase = 'greeting', last_message_at = NOW() WHERE phone_number = ${phone}`;
        await sql`UPDATE leads SET stage = 'contacted', contacted_at = NOW() WHERE phone_number = ${phone} AND stage = 'new'`;
        welcomeSent++;
        console.log(`🌅 Ertelenmiş karşılama gönderildi: ${phone}`);
      } catch(e) {
        console.error(`❌ Ertelenmiş karşılama hatası (${phone}):`, e.response?.data?.error?.message || e.message);
      }
    }
  } catch(e) { console.error('Pending welcome hatası:', e.message); }

  // ============================================================
  // BÖLÜM 2: 4 Kademeli Takip Sistemi
  // ============================================================
  try {
    const candidates = await sql`
      SELECT c.phone_number, c.patient_name, c.follow_up_count, c.status, c.department, c.last_message_at,
        COALESCE(c.last_channel, c.channel, 'whatsapp') as conv_channel,
        (SELECT direction FROM messages WHERE phone_number = c.phone_number ORDER BY created_at DESC LIMIT 1) as last_direction,
        (SELECT created_at FROM messages WHERE phone_number = c.phone_number AND direction = 'in' ORDER BY created_at DESC LIMIT 1) as last_patient_msg_time,
        (SELECT content FROM messages WHERE phone_number = c.phone_number AND direction = 'in' ORDER BY created_at DESC LIMIT 1) as last_patient_text
      FROM conversations c
      WHERE c.follow_up_count < 4
        AND c.phase NOT IN ('pending_welcome', 'handover')
        AND c.status != 'human'
    `;

    for (const conv of candidates) {
      // Son mesaj hasta tarafından geldiyse follow-up atma
      if (conv.last_direction !== 'out') { skipped++; continue; }

      // Kaç saat oldu?
      const lastMsgTime = conv.last_message_at ? new Date(conv.last_message_at) : null;
      if (!lastMsgTime) { skipped++; continue; }
      const hoursSince = (Date.now() - lastMsgTime.getTime()) / 3600000;

      // Doğru kademeyi bul
      const currentCount = conv.follow_up_count || 0;
      const threshold = FOLLOW_UP_THRESHOLDS[currentCount];
      if (!threshold) { skipped++; continue; }
      if (hoursSince < threshold.minHours) { skipped++; continue; }

      const name = conv.patient_name || '';
      const dept = conv.department || '';
      const lang = detectLang(conv.last_patient_text);

      // 24 saat penceresi kontrolü
      const lastPatientMsg = conv.last_patient_msg_time ? new Date(conv.last_patient_msg_time) : null;
      const patientHoursSince = lastPatientMsg ? (Date.now() - lastPatientMsg.getTime()) / 3600000 : 999;
      const windowOpen = patientHoursSince < 24;

      let msgContent = '';

      try {
        const ch = conv.conv_channel || 'whatsapp';
        
        if (currentCount < 3 && windowOpen) {
          // ✅ Pencere açık — kademeli metin mesajı gönder
          const texts = followUpMessages[lang] || followUpMessages.tr;
          const idx = Math.min(currentCount, texts.length - 1);
          msgContent = texts[idx](name, dept);
          
          // 📱 Kanal bazlı gönderim
          if (ch === 'instagram') {
            await sendInstagramMessage(conv.phone_number, msgContent);
          } else if (ch === 'messenger') {
            await sendMessengerMessage(conv.phone_number, msgContent);
          } else {
            await sendTextMessage(PHONE_ID, META, conv.phone_number, msgContent);
          }
          textUsed++;
          console.log(`📤 [Kademe ${currentCount}/${lang}/${ch}] Takip: ${conv.phone_number} (${Math.round(hoursSince)}s sonra)`);
        } else {
          // ⏰ Pencere KAPALI veya kademe 3
          if (ch === 'whatsapp') {
            // WhatsApp — template gönder
            const templateLang = lang === 'tr' ? 'tr' : lang === 'ar' ? 'ar' : lang === 'ru' ? 'ru' : lang === 'de' ? 'de' : lang === 'fr' ? 'fr' : 'en';
            await sendTemplateMessage(PHONE_ID, META, conv.phone_number, templateName, templateLang);
            msgContent = `[Şablon: ${templateName} (${templateLang})]`;
            templateUsed++;
          } else {
            // IG/Messenger — pencere kapalıysa skip (template gönderemeyiz)
            console.log(`⏰ [${ch}] 24s pencere kapalı, takip atlanamıyor: ${conv.phone_number}`);
            skipped++; continue;
          }
          console.log(`📋 [Şablon/Kademe ${currentCount}] Takip: ${conv.phone_number} (${Math.round(hoursSince)}s)`);
        }

        await sql`INSERT INTO messages (phone_number, direction, content, model_used, channel) VALUES (${conv.phone_number}, 'out', ${msgContent}, 'follow-up', ${ch})`;
        await sql`UPDATE conversations SET follow_up_count = follow_up_count + 1, last_follow_up_at = NOW(), last_message_at = NOW() WHERE phone_number = ${conv.phone_number}`;
        
        // 🔄 Follow-up sonrası bot'u tekrar aktif et (hasta cevaplarsa bot yanıt verebilsin)
        if (conv.status !== 'active') {
          await sql`UPDATE conversations SET status = 'active' WHERE phone_number = ${conv.phone_number} AND status != 'human'`;
        }

        // 📱 Telegram'a bildir (Kademe 1+ için — danışman haberdar olsun)
        if (currentCount >= 1) {
          try {
            await sendTelegramAlert(`📋 <b>TAKİP MESAJI GÖNDERİLDİ</b>

👤 ${conv.patient_name || conv.phone_number}
📱 <code>${conv.phone_number}</code>
📊 Kademe: ${currentCount + 1}/4
⏰ Son mesajdan ${Math.round(hoursSince)} saat sonra

<i>${msgContent.substring(0, 100)}...</i>`);
          } catch(e) {}
        }
        
        sent++;
      } catch (e) {
        console.error(`❌ Takip hatası (${conv.phone_number}):`, e.response?.data?.error?.message || e.message);
      }
    }
  } catch(e) { console.error('Follow-up genel hatası:', e.message); }

  // ============================================================
  // BÖLÜM 3: Escalation Kontrolü (Handover SLA)
  // ============================================================
  let escalated = 0;
  try {
    escalated = await checkEscalations(sql);
  } catch(e) { console.error('Escalation check hatası:', e.message); }

  // ============================================================
  // BÖLÜM 3.5: Otomatik Geri Arama Hatırlatması
  // Danışman "Arandı - Ulaşılamadı" butonuna bastıysa,
  // 30 dakika sonra Telegram'a tekrar hatırlatma düş
  // ============================================================
  let recallReminders = 0;
  try {
    // Notlarında "Arandı ama ulaşılamadı" olan ve 30+ dk geçmiş hastaları bul
    const callmissPatients = await sql`
      SELECT c.phone_number, c.patient_name, c.department, c.notes, c.updated_at
      FROM conversations c
      WHERE c.status = 'human'
        AND c.temperature = 'hot'
        AND c.notes LIKE '%ulaşılamadı%'
        AND c.updated_at < NOW() - INTERVAL '30 minutes'
        AND c.updated_at > NOW() - INTERVAL '2 hours'
        AND NOT EXISTS (
          SELECT 1 FROM messages m 
          WHERE m.phone_number = c.phone_number 
          AND m.model_used = 'recall-reminder'
          AND m.created_at > NOW() - INTERVAL '30 minutes'
        )
    `;

    for (const patient of callmissPatients) {
      try {
        const inlineKeyboard = {
          inline_keyboard: [
            [
              { text: "📞 Arandı - Ulaşılamadı", callback_data: `crm_callmiss_${patient.phone_number}` },
              { text: "✅ Randevu Verildi", callback_data: `crm_appoint_${patient.phone_number}` }
            ],
            [
              { text: "❌ İptal / İlgilenmiyor", callback_data: `crm_lost_${patient.phone_number}` }
            ]
          ]
        };

        await sendTelegramAlert(`⏰ <b>GERİ ARAMA HATIRLATMASI</b>

👤 <b>${patient.patient_name || patient.phone_number}</b>
📱 <code>${patient.phone_number}</code>
🏥 ${patient.department || 'Genel'}

📞 <i>30 dakika önce arandı ama ulaşılamadı. Lütfen tekrar arayın!</i>`, inlineKeyboard);

        // Tekrar tetiklenmemesi için marker ekle
        await sql`INSERT INTO messages (phone_number, direction, content, model_used, channel) 
          VALUES (${patient.phone_number}, 'out', '[SİSTEM] Geri arama hatırlatması gönderildi', 'recall-reminder', 'system')`;
        recallReminders++;
      } catch(e) {}
    }
  } catch(e) { console.error('Geri arama hatırlatma hatası:', e.message); }

  // ============================================================
  // BÖLÜM 4: Randevu Hatırlatma (D-3, D-1, D-0)
  // ============================================================
  let reminders = 0;
  try {
    const upcoming = await sql`
      SELECT e.id, e.phone_number, e.scheduled_date, e.status, c.patient_name,
        COALESCE(c.last_channel, c.channel, 'whatsapp') as ch
      FROM events e
      JOIN conversations c ON c.phone_number = e.phone_number
      WHERE e.event_type = 'appointment_request'
        AND e.status IN ('scheduled', 'confirmed')
        AND e.scheduled_date IS NOT NULL
        AND e.showed_up IS NULL
    `;
    
    for (const apt of upcoming) {
      // TR timezone bazlı gün hesaplaması
      const aptDateObj = new Date(apt.scheduled_date);
      const now = new Date();
      const trNow = new Date(now.getTime() + (3 * 3600000));
      const trApt = new Date(aptDateObj.getTime() + (3 * 3600000));
      
      // Saatleri sıfırlayıp sadece gün bazlı fark bulma
      const dateNow = new Date(trNow.getFullYear(), trNow.getMonth(), trNow.getDate());
      const dateApt = new Date(trApt.getFullYear(), trApt.getMonth(), trApt.getDate());
      const daysUntil = Math.round((dateApt - dateNow) / 86400000);

      let reminderType = '';
      if (daysUntil === 3) reminderType = '3 gün';
      else if (daysUntil === 1) reminderType = 'Yarın';
      else if (daysUntil === 0) reminderType = 'Bugün';
      
      if (!reminderType) continue; // Sadece D-3, D-1, D-0

      // Duplicate Kontrolü: Bu kişiye bu 'tip' hatırlatma zaten gitmiş mi?
      const existing = await sql`
        SELECT id FROM messages 
        WHERE phone_number = ${apt.phone_number} 
          AND model_used = 'reminder' 
          AND content ILIKE ${'%' + reminderType + '%'}
        LIMIT 1
      `;
      if (existing.length > 0) continue; // Zaten gitmiş, atla

      const name = apt.patient_name || '';
      const dateStr = aptDateObj.toLocaleDateString('tr-TR', {day:'numeric', month:'long', year:'numeric', hour:'2-digit', minute:'2-digit'});
      
      let reminderMsg = null;
      if (daysUntil === 3) {
        reminderMsg = `${name ? name + ', r' : 'R'}andevunuza 3 gün kaldı 📅\n\n📍 Başkent Üniversitesi Konya Hastanesi\n🕒 ${dateStr}\n\nHerhangi bir sorunuz varsa bize yazabilirsiniz 🙏`;
      } else if (daysUntil === 1) {
        reminderMsg = `${name ? name + ', y' : 'Y'}arın randevunuz var! 📅\n\n📍 Başkent Üniversitesi Konya Hastanesi\n🕒 ${dateStr}\n\nSizi bekliyoruz 🙏`;
      } else if (daysUntil === 0) {
        reminderMsg = `${name ? name + ', b' : 'B'}ugün randevunuz var! 🏥\n\n📍 Başkent Üniversitesi Konya Hastanesi\n🕒 ${dateStr}\n\nGörüşmek üzere, geçmiş olsun 🙏`;
      }
      
      if (reminderMsg) {
        try {
          if (apt.ch === 'whatsapp') {
            await sendTextMessage(PHONE_ID, META, apt.phone_number, reminderMsg);
          } else if (apt.ch === 'instagram') {
            await sendInstagramMessage(apt.phone_number, reminderMsg);
          } else if (apt.ch === 'messenger') {
            await sendMessengerMessage(apt.phone_number, reminderMsg);
          }
          await sql`INSERT INTO messages (phone_number, direction, content, model_used, channel) VALUES (${apt.phone_number}, 'out', ${reminderMsg}, 'reminder', ${apt.ch})`;
          reminders++;
          console.log(`📅 [D-${daysUntil}] Randevu hatırlatma: ${apt.phone_number}`);
        } catch(e) { console.error(`Hatırlatma hatası (${apt.phone_number}):`, e.message); }
      }
    }
  } catch(e) { console.error('Randevu hatırlatma hatası:', e.message); }

  // ============================================================
  // BÖLÜM 5: Kaybedilen Hasta Recovery (30/60/90 gün)
  // ============================================================
  let recovered = 0;
  try {
    const lostLeads = await sql`
      SELECT l.phone_number, l.patient_name, l.form_name, l.stage,
        COALESCE(c.last_channel, c.channel, 'whatsapp') as ch,
        EXTRACT(DAY FROM NOW() - l.created_at) as days_since
      FROM leads l
      LEFT JOIN conversations c ON c.phone_number = l.phone_number
      WHERE l.stage = 'lost'
        AND l.created_at > NOW() - INTERVAL '95 days'
        AND NOT EXISTS (
          SELECT 1 FROM messages m 
          WHERE m.phone_number = l.phone_number 
          AND m.model_used = 'recovery' 
          AND m.created_at > NOW() - INTERVAL '25 days'
        )
    `;
    
    for (const lead of lostLeads) {
      const days = Math.round(lead.days_since);
      if (days < 28 || days > 95) continue;
      
      const name = lead.patient_name || '';
      const dept = lead.form_name || 'sağlık';
      let recoveryMsg = null;
      
      if (days >= 28 && days <= 35) {
        recoveryMsg = `${name ? name + ', g' : 'G'}eçen ay ${dept} konusunda bize ulaşmıştınız. Durumunuzda bir değişiklik oldu mu? Ücretsiz ön değerlendirme hakkınız hala geçerli 🙏`;
      } else if (days >= 55 && days <= 65) {
        recoveryMsg = `${name ? name + ', s' : 'S'}ağlığınız bizim için hala önemli 🙏 ${dept} konusunda uzman ekibimiz sizi değerlendirmeye hazır. İsterseniz size uygun bir zamanda sizi arayalım.`;
      } else if (days >= 85 && days <= 95) {
        recoveryMsg = `${name ? name + ', B' : 'B'}aşkent Üniversitesi Konya Hastanesi'nden yazıyoruz. ${dept} konusundaki durumunuzu merak ettik. Sağlığınızla ilgili herhangi bir konuda yardımcı olabiliriz — bize yazmaktan çekinmeyin 🙏`;
      }
      
      if (recoveryMsg && lead.ch === 'whatsapp') {
        try {
          await sendTextMessage(PHONE_ID, META, lead.phone_number, recoveryMsg);
          await sql`INSERT INTO messages (phone_number, direction, content, model_used, channel) VALUES (${lead.phone_number}, 'out', ${recoveryMsg}, 'recovery', 'whatsapp')`;
          await sql`UPDATE leads SET stage = 'contacted' WHERE phone_number = ${lead.phone_number} AND stage = 'lost'`;
          await sql`UPDATE conversations SET follow_up_count = 0, status = 'active' WHERE phone_number = ${lead.phone_number}`;
          recovered++;
          console.log(`🔄 [D${days}] Recovery: ${lead.phone_number}`);
        } catch(e) {}
      }
    }
  } catch(e) { console.error('Recovery hatası:', e.message); }

  // ============================================================
  // BÖLÜM 6: Post-Tedavi Memnuniyet Anketi
  // ============================================================
  let surveys = 0;
  try {
    const completed = await sql`
      SELECT e.id, e.phone_number, c.patient_name,
        COALESCE(c.last_channel, c.channel, 'whatsapp') as ch
      FROM events e
      JOIN conversations c ON c.phone_number = e.phone_number
      WHERE e.treatment_completed = true
        AND e.satisfaction_score IS NULL
        AND e.showed_up_at < NOW() - INTERVAL '1 day'
        AND e.showed_up_at > NOW() - INTERVAL '3 days'
    `;
    
    for (const ev of completed) {
      const name = ev.patient_name || '';
      const surveyMsg = `${name ? name + ', t' : 'T'}edavinizin tamamlandığını öğrendik! Sizin için her şey yolunda mı? 🙏\n\nDeneyiminizi 1-5 arası puanlasanız kaç verirdiniz?\n⭐ 1 — Memnun değilim\n⭐⭐ 2 — Az memnun\n⭐⭐⭐ 3 — Orta\n⭐⭐⭐⭐ 4 — Memnun\n⭐⭐⭐⭐⭐ 5 — Çok memnun\n\nGörüşleriniz bizim için çok değerli!`;
      
      try {
        if (ev.ch === 'whatsapp') {
          await sendTextMessage(PHONE_ID, META, ev.phone_number, surveyMsg);
        }
        await sql`INSERT INTO messages (phone_number, direction, content, model_used, channel) VALUES (${ev.phone_number}, 'out', ${surveyMsg}, 'survey', ${ev.ch})`;
        surveys++;
        console.log(`⭐ Memnuniyet anketi gönderildi: ${ev.phone_number}`);
      } catch(e) {}
    }
  } catch(e) { console.error('Anket hatası:', e.message); }

  console.log(`✅ Takip: ${sent} gönderildi (${textUsed} metin, ${templateUsed} şablon), ${skipped} atlandı, ${welcomeSent} karşılama, ${escalated} escalation, ${recallReminders} geri arama, ${reminders} hatırlatma, ${recovered} recovery, ${surveys} anket`);
  return res.json({ success: true, sent, skipped, textUsed, templateUsed, welcomeSent, escalated, recallReminders, reminders, recovered, surveys, total: sent + skipped });
}
