import { neon } from '@neondatabase/serverless';

export default async function handler(req, res) {
  // Basit güvenlik - sadece doğru şifre ile çalışsın
  if (req.query.key !== 'baskent2024setup') {
    return res.status(403).json({ error: 'Yetkisiz erişim' });
  }

  const sql = neon(process.env.DATABASE_URL);

  try {
    // Konuşmalar tablosu
    await sql`
      CREATE TABLE IF NOT EXISTS conversations (
        id SERIAL PRIMARY KEY,
        phone_number VARCHAR(20) NOT NULL,
        patient_name VARCHAR(100),
        created_at TIMESTAMP DEFAULT NOW(),
        last_message_at TIMESTAMP DEFAULT NOW(),
        message_count INT DEFAULT 0,
        status VARCHAR(20) DEFAULT 'active'
      )
    `;

    // Mesajlar tablosu
    await sql`
      CREATE TABLE IF NOT EXISTS messages (
        id SERIAL PRIMARY KEY,
        phone_number VARCHAR(20) NOT NULL,
        direction VARCHAR(3) NOT NULL,
        content TEXT NOT NULL,
        model_used VARCHAR(50),
        created_at TIMESTAMP DEFAULT NOW()
      )
    `;

    // Ayarlar tablosu (prompt yönetimi vb.)
    await sql`
      CREATE TABLE IF NOT EXISTS settings (
        id SERIAL PRIMARY KEY,
        key VARCHAR(100) UNIQUE NOT NULL,
        value TEXT NOT NULL,
        updated_at TIMESTAMP DEFAULT NOW()
      )
    `;

    // Hızlı cevap şablonları
    await sql`
      CREATE TABLE IF NOT EXISTS templates (
        id SERIAL PRIMARY KEY,
        title VARCHAR(200) NOT NULL,
        content TEXT NOT NULL,
        category VARCHAR(50),
        is_active BOOLEAN DEFAULT true,
        created_at TIMESTAMP DEFAULT NOW()
      )
    `;

    // Varsayılan prompt'u ekle (yoksa)
    const existingPrompt = await sql`SELECT * FROM settings WHERE key = 'system_prompt'`;
    if (existingPrompt.length === 0) {
      await sql`
        INSERT INTO settings (key, value) VALUES ('system_prompt', ${getDefaultPrompt()})
      `;
    }

    // Varsayılan model ayarı
    const existingModel = await sql`SELECT * FROM settings WHERE key = 'ai_model'`;
    if (existingModel.length === 0) {
      await sql`INSERT INTO settings (key, value) VALUES ('ai_model', 'gemini-2.5-flash-lite')`;
    }

    // Çalışma saatleri
    const existingHours = await sql`SELECT * FROM settings WHERE key = 'working_hours'`;
    if (existingHours.length === 0) {
      await sql`INSERT INTO settings (key, value) VALUES ('working_hours', '{"enabled": false, "start": "09:00", "end": "18:00", "offMessage": "Mesai saatlerimiz dışındasınız. En kısa sürede dönüş yapacağız."}')`;
    }

    res.status(200).json({ 
      success: true, 
      message: '✅ Veritabanı tabloları başarıyla oluşturuldu!',
      tables: ['conversations', 'messages', 'settings', 'templates']
    });
  } catch (error) {
    console.error('DB Setup hatası:', error);
    res.status(500).json({ error: error.message });
  }
}

function getDefaultPrompt() {
  return `Sen Başkent Üniversitesi Konya Hastanesi'nde çalışan gerçek bir hasta danışmanısın. Adın yok, sadece hastanenin danışmanısın.

ÖNEMLİ KONUŞMA KURALLARI:
- Her mesaja "Merhaba" diye BAŞLAMA. Sadece ilk mesajda merhaba de, sonraki mesajlarda direkt konuya gir.
- Gerçek bir insan gibi yaz. Robot gibi kalıp cümleler KULLANMA.
- Samimi, sıcak ve doğal ol. Sanki WhatsApp'tan bir arkadaşınla konuşuyormuş gibi ama profesyonel kal.
- Kısa yaz, maksimum 2-3 cümle. Uzun paragraflar YAZMA.
- "Size nasıl yardımcı olabilirim?" gibi klişe cümlelerden KAÇIN.
- Hastanın derdini anla, empati kur, sonra yönlendir.

DOĞAL CEVAP ÖRNEKLERİ:
- "Geçmiş olsun, bel fıtığı gerçekten zorlu bir süreç. Doktorlarımız bu konuda çok deneyimli, sizi bir değerlendirmeye alalım mı?"
- "Anlıyorum sizi. Net bilgi için doktorumuzun sizi görmesi en doğrusu olur. Hangi gün müsaitsiniz?"
- "Tabii ki yardımcı olalım! Randevu için uygun gününüzü söylerseniz hemen ayarlayalım."

FİYAT SORULURSA:
- Asla fiyat verme
- "Fiyat tedavi planına göre değişiyor, doktorumuz sizi değerlendirdikten sonra net bilgi verebiliriz. Önce bir randevu ayarlayalım mı?" gibi doğal geçiş yap

DİL: Kullanıcı hangi dilde yazıyorsa o dilde cevap ver.

HEDEF: Her konuşmayı doğal şekilde randevuya yönlendir ama baskıcı olma.`;
}
