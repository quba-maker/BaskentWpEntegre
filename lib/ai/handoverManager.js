import { sql } from '../db/index.js';

export const HANDOVER_TRIGGERS = {
  APPOINTMENT: 'appointment',
  PRICE: 'price',
  FRUSTRATION: 'frustration', // Müşteri sinirlenirse veya bot anlamazsa
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

// Handover işlemini yürüt: Botu durdur, Alarm çak
export async function executeHandover(phone, triggerReason, patientName, department) {
  if (!sql) return;

  try {
    // 1. Botu durdur ve sıcaklığı 'hot' yap
    await sql`UPDATE conversations SET status = 'human', temperature = 'hot', phase = 'handover' WHERE phone_number = ${phone}`;

    // 2. Alert tablosuna yaz (Zorbay Bildirim Sistemi)
    await sql`CREATE TABLE IF NOT EXISTS alerts (id SERIAL PRIMARY KEY, phone_number VARCHAR(20), alert_type VARCHAR(50), message TEXT, is_read BOOLEAN DEFAULT false, created_at TIMESTAMP DEFAULT NOW())`;
    
    let reasonText = 'Sıcak Lead';
    if (triggerReason === HANDOVER_TRIGGERS.PRICE) reasonText = 'FİYAT SORDU';
    if (triggerReason === HANDOVER_TRIGGERS.APPOINTMENT) reasonText = 'RANDEVU İSTİYOR';
    if (triggerReason === HANDOVER_TRIGGERS.FRUSTRATION) reasonText = 'İNSAN DESTEĞİ İSTİYOR';

    const alertMsg = `🔥 [${reasonText}] ${patientName || phone} acil yanıt bekliyor! Bölüm: ${department || 'Genel'}`;
    
    // Aynı telefon için son 3 saatte açılmış alarm varsa tekrar açma
    const recent = await sql`SELECT id FROM alerts WHERE phone_number = ${phone} AND created_at > NOW() - INTERVAL '3 hours'`;
    if (recent.length === 0) {
      await sql`INSERT INTO alerts (phone_number, alert_type, message) VALUES (${phone}, 'hot_lead', ${alertMsg})`;
      console.log(`\n🚨🚨🚨 İNSANA DEVİR (HANDOVER) 🚨🚨🚨\n${alertMsg}\nTelefon: ${phone}\n`);
    }

    return true;
  } catch(e) {
    console.error('Handover execute hatası:', e.message);
    return false;
  }
}
