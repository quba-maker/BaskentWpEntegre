import { sql } from '../db/index.js';
import axios from 'axios';

export const HANDOVER_TRIGGERS = {
  APPOINTMENT: 'appointment',
  PRICE: 'price',
  FRUSTRATION: 'frustration',
  MANUAL: 'manual'
};

// Sıcak lead (Handover) kararı
export function checkHandoverTriggers(userMessage, score, currentPhase) {
  const text = (userMessage || '').toLowerCase();
  
  // Yüksek skorlu lead → direkt devret
  if (score >= 50) return HANDOVER_TRIGGERS.APPOINTMENT;
  
  // Hasta net şekilde fiyat sorarsa
  if (/fiyat|ücret|ne kadar|maliyet|price|cost|كم|سعر|цена|combien|wieviel/i.test(text)) {
    return HANDOVER_TRIGGERS.PRICE;
  }
  
  // Hasta randevu, gelmek veya onay sinyali verirse
  if (/randevu|geleceğim|geliyorum|gelebilir|gelirim|appointment|booking|موعد|запись|termin|rendez|hemen gel|kabul|onaylıyorum|tamam.*gel|olur.*gel|hazırım|ne zaman gel|ayarlayın|ayarlayalım|planlayalım|uygun.*gün|uygun.*saat/i.test(text)) {
    return HANDOVER_TRIGGERS.APPOINTMENT;
  }

  // Hasta şikayetçi olursa (Bot anlamıyor vb.)
  if (/insan|müşteri temsilcisi|bot|anlamıyorsun|human|representative|agent|gerçek.*kişi|canlı.*destek/i.test(text)) {
    return HANDOVER_TRIGGERS.FRUSTRATION;
  }

  return null;
}

// ============================================================
// TELEGRAM BİLDİRİM
// ============================================================
async function sendTelegramAlert(message) {
  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  
  if (!botToken || !chatId) {
    console.log('⚠️ Telegram bildirim ayarlanmamış (TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID)');
    return false;
  }

  try {
    await axios.post(`https://api.telegram.org/bot${botToken}/sendMessage`, {
      chat_id: chatId,
      text: message,
      parse_mode: 'HTML'
    });
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
export async function executeHandover(phone, triggerReason, patientName, department) {
  if (!sql) return;

  try {
    // 1. Botu durdur ve sıcaklığı 'hot' yap
    await sql`UPDATE conversations SET status = 'human', temperature = 'hot', phase = 'handover' WHERE phone_number = ${phone}`;

    // 2. Alert tablosuna yaz
    await sql`CREATE TABLE IF NOT EXISTS alerts (id SERIAL PRIMARY KEY, phone_number VARCHAR(20), alert_type VARCHAR(50), message TEXT, is_read BOOLEAN DEFAULT false, created_at TIMESTAMP DEFAULT NOW())`;
    
    let reasonText = 'Sıcak Lead';
    let reasonEmoji = '🔥';
    if (triggerReason === HANDOVER_TRIGGERS.PRICE) { reasonText = 'FİYAT SORDU'; reasonEmoji = '💰'; }
    if (triggerReason === HANDOVER_TRIGGERS.APPOINTMENT) { reasonText = 'RANDEVU İSTİYOR'; reasonEmoji = '📅'; }
    if (triggerReason === HANDOVER_TRIGGERS.FRUSTRATION) { reasonText = 'İNSAN DESTEĞİ İSTİYOR'; reasonEmoji = '⚠️'; }

    const alertMsg = `${reasonEmoji} [${reasonText}] ${patientName || phone} acil yanıt bekliyor! Bölüm: ${department || 'Genel'}`;
    
    // Aynı telefon için son 3 saatte açılmış alarm varsa tekrar açma
    const recent = await sql`SELECT id FROM alerts WHERE phone_number = ${phone} AND created_at > NOW() - INTERVAL '3 hours'`;
    if (recent.length === 0) {
      await sql`INSERT INTO alerts (phone_number, alert_type, message) VALUES (${phone}, 'hot_lead', ${alertMsg})`;
      console.log(`\n🚨🚨🚨 İNSANA DEVİR (HANDOVER) 🚨🚨🚨\n${alertMsg}\nTelefon: ${phone}\n`);

      // 3. 📱 TELEGRAM BİLDİRİM — Gerçek push notification
      const telegramMsg = `🚨 <b>SICAK LEAD — ACİL YANIT GEREKLİ</b>

${reasonEmoji} <b>${reasonText}</b>
👤 Hasta: <b>${patientName || 'Bilinmiyor'}</b>
📱 Tel: <code>${phone}</code>
🏥 Bölüm: ${department || 'Genel'}
⏰ Zaman: ${new Date().toLocaleString('tr-TR', { timeZone: 'Europe/Istanbul' })}

⚡ <i>5 dakika içinde arayın!</i>`;
      
      await sendTelegramAlert(telegramMsg);
      
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
      const nextInterval = level === 1 ? '10 minutes' : '30 minutes';
      await sqlConn`UPDATE escalations SET escalation_level = ${level}, next_escalation_at = NOW() + INTERVAL '${nextInterval}' WHERE id = ${esc.id}`;
    }

    return pending.length;
  } catch(e) {
    console.error('Escalation check hatası:', e.message);
    return 0;
  }
}
