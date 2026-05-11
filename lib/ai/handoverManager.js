import { sql } from '../db/index.js';
import axios from 'axios';

export const HANDOVER_TRIGGERS = {
  APPOINTMENT: 'appointment',  // Kesin niyet: "geleceğim", "ayarlayın"
  INTEREST: 'interest',        // İlgi sinyali: "randevu alabilir miyim?", "fiyat ne kadar?"
  PRICE: 'price',
  FRUSTRATION: 'frustration',
  MANUAL: 'manual'
};

// Sıcak lead (Handover) kararı
// ÖNEMLİ: Artık ana geçişler conversationPhaseManager.js içindeki Progressive Trust Funnel üzerinden sağlanıyor.
// Bu fonksiyon sadece ekstrem durumlarda (hastanın çok sinirlenmesi veya acil insan istemesi) devreye girecek.
export function checkHandoverTriggers(userMessage, score, currentPhase) {
  const text = (userMessage || '').toLowerCase();
  
  // === ACİL / SİNİR DURUMU (Hasta botla konuşmak istemiyorsa veya şikayetçiyse) ===
  if (/insan|müşteri temsilcisi|gerçek biri|şikayet|kötü|rezalet|yeter|saçma/i.test(text) && text.length < 100) {
    return HANDOVER_TRIGGERS.FRUSTRATION;
  }

  // Randevu, fiyat, zaman bildirimleri artık phaseManager tarafından GREETING -> DISCOVERY -> TRUST -> TIME_CONFIRM -> HANDOVER olarak yönetilir.
  return null;
}

// ============================================================
// TELEGRAM BİLDİRİM
// ============================================================
export async function sendTelegramAlert(message, replyMarkup = null) {
  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  
  if (!botToken || !chatId) {
    console.log('⚠️ Telegram bildirim ayarlanmamış (TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID)');
    return false;
  }

  try {
    const payload = {
      chat_id: chatId,
      text: message,
      parse_mode: 'HTML'
    };
    if (replyMarkup) {
      payload.reply_markup = replyMarkup;
    }
    await axios.post(`https://api.telegram.org/bot${botToken}/sendMessage`, payload);
    console.log('📱 Telegram bildirimi gönderildi');
    return true;
  } catch(e) {
    console.error('Telegram hata:', e.message);
    return false;
  }
}

// ============================================================
// HANDOVER İŞLEMİ — Bot durdur + Alarm + Telegram + Hasta Bilgilendirme
// ============================================================
export async function executeHandover(phone, triggerReason, patientName, department, requestedTime = '') {
  if (!sql) return;

  try {
    let cleanP = (phone || '').replace(/\D/g, '');
    const searchP = cleanP.length > 10 ? cleanP.substring(cleanP.length - 10) : cleanP;
    const likePattern = `%${searchP}%`;

    // 1. Phase ve sıcaklığı güncelle — AMA status='human' YAPMA!
    // status='human' sadece panelden kullanıcı "Manuel Devral" tıkladığında olur.
    await sql`UPDATE conversations SET temperature = 'hot', phase = 'handover' WHERE phone_number LIKE ${likePattern}`;

    // 2. Alert tablosuna yaz
    await sql`CREATE TABLE IF NOT EXISTS alerts (id SERIAL PRIMARY KEY, phone_number VARCHAR(20), alert_type VARCHAR(50), message TEXT, is_read BOOLEAN DEFAULT false, created_at TIMESTAMP DEFAULT NOW())`;
    
    let reasonText = 'Sıcak Lead';
    let reasonEmoji = '🔥';
    if (triggerReason === HANDOVER_TRIGGERS.PRICE) { reasonText = 'FİYAT SORDU'; reasonEmoji = '💰'; }
    if (triggerReason === HANDOVER_TRIGGERS.APPOINTMENT) { reasonText = 'KESİN RANDEVU NİYETİ'; reasonEmoji = '📅'; }
    if (triggerReason === HANDOVER_TRIGGERS.INTEREST) { reasonText = 'İLGİLENİYOR / RANDEVU SORUYOR'; reasonEmoji = '🔥'; }
    if (triggerReason === HANDOVER_TRIGGERS.FRUSTRATION) { reasonText = 'İNSAN DESTEĞİ İSTİYOR'; reasonEmoji = '⚠️'; }

    const alertMsg = `${reasonEmoji} [${reasonText}] ${patientName || phone} acil yanıt bekliyor! Bölüm: ${department || 'Genel'}`;
    
    // TEST AŞAMASI İÇİN 3 SAATLİK LİMİT GEÇİCİ OLARAK KALDIRILDI
    // const recent = await sql`SELECT id FROM alerts WHERE phone_number LIKE ${likePattern} AND created_at > NOW() - INTERVAL '3 hours'`;
    if (true) {
      await sql`INSERT INTO alerts (phone_number, alert_type, message) VALUES (${phone}, 'hot_lead', ${alertMsg})`;
      console.log(`\n🚨🚨🚨 İNSANA DEVİR (HANDOVER) 🚨🚨🚨\n${alertMsg}\nTelefon: ${phone}\n`);

      // 3. 💬 AI KONUŞMA ÖZETİ — Danışman hastayı tanısın
      let conversationSummary = '';
      try {
        const recentMsgs = await sql`
          SELECT direction, content FROM messages 
          WHERE phone_number LIKE ${likePattern} 
          ORDER BY created_at DESC LIMIT 10
        `;
        if (recentMsgs.length > 0) {
          const chatLog = recentMsgs.reverse().map(m => 
            `${m.direction === 'in' ? 'HASTA' : 'BOT'}: ${(m.content || '').substring(0, 150)}`
          ).join('\n');
          
          try {
            const geminiRes = await axios.post(
              `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${process.env.GEMINI_API_KEY}`,
              {
                contents: [{ parts: [{ text: `Aşağıdaki hasta-bot konuşmasını TÜRKÇE olarak EN FAZLA 2 CÜMLEDE özetle. Hastanın ne istediğini, hangi bölümle ilgilendiğini ve mevcut durumunu yaz. Sadece özeti yaz, başka bir şey ekleme.\n\n${chatLog}` }] }]
              },
              { timeout: 8000 }
            );
            conversationSummary = geminiRes.data?.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || '';
          } catch(e) { 
            // AI özet çalışmazsa basit fallback
            const lastPatientMsg = recentMsgs.filter(m => m.direction === 'in').pop();
            conversationSummary = lastPatientMsg ? `Son mesaj: "${(lastPatientMsg.content || '').substring(0, 100)}"` : '';
          }
        }
      } catch(e) { console.error('Konuşma özeti hatası:', e.message); }

      // 4. 📱 TELEGRAM BİLDİRİM — Gerçek push notification
      // Lead skorunu çek
      let leadScore = 0;
      let patientType = 'Yerli';
      try {
        const convInfo = await sql`SELECT lead_score, patient_type FROM conversations WHERE phone_number LIKE ${likePattern} LIMIT 1`;
        if (convInfo.length > 0) {
          leadScore = convInfo[0].lead_score || 0;
          patientType = convInfo[0].patient_type || 'Yerli';
        }
      } catch(e) {}

      const typeEmoji = patientType === 'Gurbetçi' ? '🇩🇪' : patientType === 'Yabancı Turist' ? '🌍' : '🇹🇷';
      
      const crmUrl = `https://baskent-wp-entegre.vercel.app/?phone=${cleanP}`;
      const chatUrl = `https://baskent-wp-entegre.vercel.app/?phone=${cleanP}&view=chat`;
      // Telefon formatı: +90 554 683 33 06
      const formattedPhone = phone.length > 10 ? `+${phone.substring(0,2)} ${phone.substring(2,5)} ${phone.substring(5,8)} ${phone.substring(8,10)} ${phone.substring(10)}` : phone;
      
      const telegramMsg = `🚨 <b>SICAK LEAD — ACİL YANIT GEREKLİ</b>

${reasonEmoji} <b>${reasonText}</b>
👤 Hasta: <b>${patientName || 'Bilinmiyor'}</b> ${typeEmoji}
📱 Tel: <a href="tel:+${phone}">${formattedPhone}</a>
🏥 Bölüm: <b>${department || 'Genel'}</b>
📊 Skor: ${leadScore}/100
${requestedTime ? `⏰ Arama Saati Tercihi: <b>${requestedTime}</b>` : ''}
${conversationSummary ? `\n💬 <b>ÖZET:</b> <i>${conversationSummary}</i>` : ''}
⚡ <i>Zamanında arayarak No-Show riskini düşürün!</i>`;
      
      const inlineKeyboard = {
        inline_keyboard: [
          [
            { text: "🖥️ CRM'de Görüntüle", url: crmUrl },
            { text: "💬 Yazışmaları Gör", url: chatUrl }
          ],
          [
            { text: "📞 Aradım - Ulaştım", callback_data: `crm_contacted_${phone}` },
            { text: "📞 Aradım - Ulaşamadım", callback_data: `crm_callmiss_${phone}` }
          ],
          [
            { text: "✅ Randevu Verildi", callback_data: `crm_appoint_${phone}` },
            { text: "❌ İptal / İlgilenmiyor", callback_data: `crm_lost_${phone}` }
          ]
        ]
      };

      await sendTelegramAlert(telegramMsg, inlineKeyboard);
      
      // 4. 🔄 5 dakika sonra hatırlatma (escalation) — DB'ye escalation kaydı yaz
      try {
        await sql`CREATE TABLE IF NOT EXISTS escalations (id SERIAL PRIMARY KEY, phone_number VARCHAR(20), alert_id INT, escalation_level INT DEFAULT 0, next_escalation_at TIMESTAMP, created_at TIMESTAMP DEFAULT NOW())`;
        const alertRow = await sql`SELECT id FROM alerts WHERE phone_number = ${phone} ORDER BY created_at DESC LIMIT 1`;
        if (alertRow.length > 0) {
          await sql`INSERT INTO escalations (phone_number, alert_id, escalation_level, next_escalation_at) VALUES (${phone}, ${alertRow[0].id}, 0, NOW() + INTERVAL '5 minutes')`;
        }
      } catch(e) { console.error('Escalation kayıt hatası:', e.message); }
    }

    return true;
  } catch(e) {
    console.error('Handover execute hatası:', e.message);
    return false;
  }
}

// ============================================================
// ESCALATİON KONTROLÜ — follow-up cron tarafından çağrılır
// ============================================================
export async function checkEscalations(sqlConn) {
  try {
    const pending = await sqlConn`
      SELECT e.*, a.phone_number, a.message, c.patient_name, c.department
      FROM escalations e
      JOIN alerts a ON a.id = e.alert_id
      JOIN conversations c ON c.phone_number = a.phone_number
      WHERE e.next_escalation_at < NOW()
        AND e.escalation_level < 3
        AND a.is_read = false
    `;

    for (const esc of pending) {
      const level = esc.escalation_level + 1;
      
      if (level === 1) {
        // 5 dakika geçti — 2. Telegram uyarısı
        await sendTelegramAlert(`⚠️⚠️ <b>HATIRLATMA — 5 DAKİKA GEÇTİ!</b>

👤 <b>${esc.patient_name || esc.phone_number}</b> hala bekliyor!
📱 <code>${esc.phone_number}</code>
🏥 ${esc.department || 'Genel'}

🔴 <b>Hemen arayın!</b>`);
      } else if (level === 2) {
        // 15 dakika geçti — hastaya bilgilendirme mesajı gönder
        const META = process.env.META_ACCESS_TOKEN;
        const PHONE_ID = process.env.PHONE_NUMBER_ID;
        if (META && PHONE_ID) {
          const waitMsg = esc.phone_number.startsWith('90')
            ? 'Özür dileriz, şu an yoğunluk yaşıyoruz. En geç 30 dakika içinde sizi arayacağız 🙏'
            : 'We apologize for the delay. We will call you within 30 minutes 🙏';
          
          try {
            await axios({
              method: 'POST',
              url: `https://graph.facebook.com/v25.0/${PHONE_ID}/messages`,
              headers: { Authorization: `Bearer ${META}` },
              data: { messaging_product: 'whatsapp', to: esc.phone_number, type: 'text', text: { body: waitMsg } }
            });
            await sqlConn`INSERT INTO messages (phone_number, direction, content, model_used) VALUES (${esc.phone_number}, 'out', ${waitMsg}, 'escalation')`;
            console.log(`⏰ Hasta bilgilendirildi (15dk bekleme): ${esc.phone_number}`);
          } catch(e) {}
        }

        await sendTelegramAlert(`🔴🔴🔴 <b>KRİTİK — 15 DAKİKA GEÇTİ!</b>

👤 <b>${esc.patient_name || esc.phone_number}</b>
Hastaya "30 dk içinde arayacağız" mesajı gönderildi.
📱 <code>${esc.phone_number}</code>

⚡ <b>DERHAL ARAYIN!</b>`);
      }

      // Sonraki escalation zamanını ayarla
      if (level === 1) {
        await sqlConn`UPDATE escalations SET escalation_level = ${level}, next_escalation_at = NOW() + INTERVAL '10 minutes' WHERE id = ${esc.id}`;
      } else {
        await sqlConn`UPDATE escalations SET escalation_level = ${level}, next_escalation_at = NOW() + INTERVAL '30 minutes' WHERE id = ${esc.id}`;
      }
    }

    return pending.length;
  } catch(e) {
    console.error('Escalation check hatası:', e.message);
    return 0;
  }
}
