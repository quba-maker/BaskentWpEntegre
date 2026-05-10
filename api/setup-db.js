import { neon } from '@neondatabase/serverless';

export default async function handler(req, res) {
  if (req.query.key !== 'baskent2024setup') {
    return res.status(403).json({ error: 'Yetkisiz erişim' });
  }

  const sql = neon(process.env.DATABASE_URL);

  try {
    await sql`CREATE TABLE IF NOT EXISTS conversations (
      id SERIAL PRIMARY KEY, phone_number VARCHAR(20) NOT NULL,
      patient_name VARCHAR(100), tags TEXT DEFAULT '[]', notes TEXT DEFAULT '',
      department VARCHAR(100), patient_type VARCHAR(50),
      created_at TIMESTAMP DEFAULT NOW(), last_message_at TIMESTAMP DEFAULT NOW(),
      message_count INT DEFAULT 0, status VARCHAR(20) DEFAULT 'active'
    )`;

    await sql`CREATE TABLE IF NOT EXISTS messages (
      id SERIAL PRIMARY KEY, phone_number VARCHAR(20) NOT NULL,
      direction VARCHAR(3) NOT NULL, content TEXT NOT NULL,
      model_used VARCHAR(50), media_url TEXT, media_type VARCHAR(20),
      created_at TIMESTAMP DEFAULT NOW()
    )`;

    await sql`CREATE TABLE IF NOT EXISTS leads (
      id SERIAL PRIMARY KEY, phone_number VARCHAR(20),
      patient_name VARCHAR(100), email VARCHAR(200), city VARCHAR(100),
      form_id VARCHAR(50), form_name VARCHAR(200), ad_id VARCHAR(50),
      leadgen_id VARCHAR(50) UNIQUE, tags TEXT DEFAULT '[]',
      raw_data TEXT DEFAULT '{}', stage VARCHAR(20) DEFAULT 'new',
      score INT DEFAULT 0, notes TEXT DEFAULT '',
      contacted_at TIMESTAMP, responded_at TIMESTAMP,
      created_at TIMESTAMP DEFAULT NOW()
    )`;
    // Geriye dönük kolon garantisi
    try { await sql`ALTER TABLE leads ADD COLUMN IF NOT EXISTS score INT DEFAULT 0`; } catch(e){}
    try { await sql`ALTER TABLE leads ADD COLUMN IF NOT EXISTS form_id VARCHAR(50)`; } catch(e){}
    try { await sql`ALTER TABLE leads ADD COLUMN IF NOT EXISTS leadgen_id VARCHAR(50)`; } catch(e){}
    try { await sql`ALTER TABLE leads ADD COLUMN IF NOT EXISTS raw_data TEXT DEFAULT '{}'`; } catch(e){}
    try { await sql`ALTER TABLE leads ADD COLUMN IF NOT EXISTS contacted_at TIMESTAMP`; } catch(e){}
    try { await sql`ALTER TABLE leads ADD COLUMN IF NOT EXISTS responded_at TIMESTAMP`; } catch(e){}

    await sql`CREATE TABLE IF NOT EXISTS events (
      id SERIAL PRIMARY KEY, phone_number VARCHAR(20),
      event_type VARCHAR(50), details TEXT,
      status VARCHAR(20) DEFAULT 'pending',
      scheduled_date TIMESTAMP,
      assigned_doctor VARCHAR(100),
      created_at TIMESTAMP DEFAULT NOW()
    )`;
    try { await sql`ALTER TABLE events ADD COLUMN IF NOT EXISTS scheduled_date TIMESTAMP`; } catch(e){}
    try { await sql`ALTER TABLE events ADD COLUMN IF NOT EXISTS assigned_doctor VARCHAR(100)`; } catch(e){}
    // Show-up tracking
    try { await sql`ALTER TABLE events ADD COLUMN IF NOT EXISTS showed_up BOOLEAN`; } catch(e){}
    try { await sql`ALTER TABLE events ADD COLUMN IF NOT EXISTS showed_up_at TIMESTAMP`; } catch(e){}
    try { await sql`ALTER TABLE events ADD COLUMN IF NOT EXISTS no_show_reason TEXT`; } catch(e){}
    try { await sql`ALTER TABLE events ADD COLUMN IF NOT EXISTS treatment_completed BOOLEAN`; } catch(e){}
    try { await sql`ALTER TABLE events ADD COLUMN IF NOT EXISTS satisfaction_score INT`; } catch(e){}

    await sql`CREATE TABLE IF NOT EXISTS settings (
      id SERIAL PRIMARY KEY, key VARCHAR(100) UNIQUE NOT NULL,
      value TEXT NOT NULL, updated_at TIMESTAMP DEFAULT NOW()
    )`;

    await sql`CREATE TABLE IF NOT EXISTS templates (
      id SERIAL PRIMARY KEY, title VARCHAR(200) NOT NULL,
      content TEXT NOT NULL, category VARCHAR(50),
      is_active BOOLEAN DEFAULT true, created_at TIMESTAMP DEFAULT NOW()
    )`;

    await sql`CREATE TABLE IF NOT EXISTS tags (
      id SERIAL PRIMARY KEY, name VARCHAR(100) UNIQUE NOT NULL,
      color VARCHAR(7) DEFAULT '#3b82f6', created_at TIMESTAMP DEFAULT NOW()
    )`;

    // Yeni sütunları ekle (varsa hata vermez)
    try { await sql`ALTER TABLE conversations ADD COLUMN IF NOT EXISTS tags TEXT DEFAULT '[]'`; } catch(e) {}
    try { await sql`ALTER TABLE conversations ADD COLUMN IF NOT EXISTS notes TEXT DEFAULT ''`; } catch(e) {}
    try { await sql`ALTER TABLE messages ADD COLUMN IF NOT EXISTS media_url TEXT`; } catch(e) {}
    try { await sql`ALTER TABLE messages ADD COLUMN IF NOT EXISTS media_type VARCHAR(20)`; } catch(e) {}
    try { await sql`ALTER TABLE conversations ADD COLUMN IF NOT EXISTS follow_up_count INT DEFAULT 0`; } catch(e) {}
    try { await sql`ALTER TABLE conversations ADD COLUMN IF NOT EXISTS last_follow_up_at TIMESTAMP`; } catch(e) {}
    try { await sql`ALTER TABLE conversations ADD COLUMN IF NOT EXISTS department VARCHAR(100)`; } catch(e) {}
    try { await sql`ALTER TABLE conversations ADD COLUMN IF NOT EXISTS patient_type VARCHAR(50)`; } catch(e) {}
    try { await sql`ALTER TABLE conversations ADD COLUMN IF NOT EXISTS last_channel VARCHAR(20)`; } catch(e) {}
    try { await sql`ALTER TABLE conversations ADD COLUMN IF NOT EXISTS has_lead BOOLEAN DEFAULT false`; } catch(e) {}
    try { await sql`ALTER TABLE conversations ADD COLUMN IF NOT EXISTS phase VARCHAR(50) DEFAULT 'greeting'`; } catch(e) {}

    // Varsayılan etiketler
    const existingTags = await sql`SELECT COUNT(*) as c FROM tags`;
    if (Number(existingTags[0].c) === 0) {
      await sql`INSERT INTO tags (name, color) VALUES ('Bel Fıtığı', '#ef4444'), ('Estetik', '#8b5cf6'), ('Diş', '#06b6d4'), ('Ortopedi', '#f59e0b'), ('Genel', '#6b7280'), ('Randevu Alındı', '#22c55e')`;
    }

    // Varsayılan prompt
    const ep = await sql`SELECT * FROM settings WHERE key = 'system_prompt'`;
    if (ep.length === 0) {
      await sql`INSERT INTO settings (key, value) VALUES ('system_prompt', 'Sen Başkent Üniversitesi Konya Hastanesi danışmanısın. Samimi, kısa, doğal yaz. Fiyat verme, randevuya yönlendir.')`;
    }
    const em = await sql`SELECT * FROM settings WHERE key = 'ai_model'`;
    if (em.length === 0) await sql`INSERT INTO settings (key, value) VALUES ('ai_model', 'gemini-2.5-flash')`;
    const eh = await sql`SELECT * FROM settings WHERE key = 'working_hours'`;
    if (eh.length === 0) await sql`INSERT INTO settings (key, value) VALUES ('working_hours', '{"enabled":false,"start":"09:00","end":"18:00","offMessage":"Mesai dışıyız."}')`;

    res.status(200).json({ success: true, message: '✅ Veritabanı güncellendi!', tables: ['conversations', 'messages', 'settings', 'templates', 'tags'] });
  } catch (error) {
    console.error('DB Setup hatası:', error);
    res.status(500).json({ error: error.message });
  }
}
