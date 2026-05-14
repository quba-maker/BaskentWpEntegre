import { neon } from '@neondatabase/serverless';

const DATABASE_URL = process.env.DATABASE_URL;
export const sql = DATABASE_URL ? neon(DATABASE_URL) : null;

// ==========================================
// QUBA AI — Legacy DB Module (Tenant-Aware)
// brain.js ve channel handler'lar bu modülü kullanır
// Tüm fonksiyonlar artık tenantId kabul eder
// ==========================================

export async function getSetting(key, fallback = null, tenantId = null) {
  if (!sql) return fallback;
  try {
    let r;
    if (tenantId) {
      r = await sql`SELECT value FROM settings WHERE key = ${key} AND tenant_id = ${tenantId}`;
      // Tenant-specific yoksa global fallback dene
      if (r.length === 0) {
        r = await sql`SELECT value FROM settings WHERE key = ${key} AND tenant_id IS NULL`;
      }
    } else {
      r = await sql`SELECT value FROM settings WHERE key = ${key} LIMIT 1`;
    }
    return r.length > 0 ? r[0].value : fallback;
  } catch (e) { return fallback; }
}

export async function saveMessage(phone, dir, content, model = null, channel = 'whatsapp', tenantId = null) {
  if (!sql) return;
  try {
    // Mesajı kaydet — tenant_id ile
    if (tenantId) {
      await sql`INSERT INTO messages (tenant_id, phone_number, direction, content, model_used, channel) VALUES (${tenantId}, ${phone}, ${dir}, ${content}, ${model}, ${channel})`;
    } else {
      await sql`INSERT INTO messages (phone_number, direction, content, model_used, channel) VALUES (${phone}, ${dir}, ${content}, ${model}, ${channel})`;
    }
    
    // Konuşma geçmişini güncelle
    const ex = await sql`SELECT id FROM conversations WHERE phone_number = ${phone}`;
    if (ex.length > 0) {
      await sql`UPDATE conversations SET last_message_at = NOW(), message_count = message_count + 1, channel = ${channel} WHERE phone_number = ${phone}`;
      if (dir === 'in') {
        await sql`UPDATE conversations SET last_channel = ${channel} WHERE phone_number = ${phone}`;
      }
    } else {
      if (tenantId) {
        await sql`INSERT INTO conversations (tenant_id, phone_number, message_count, channel) VALUES (${tenantId}, ${phone}, 1, ${channel})`;
      } else {
        await sql`INSERT INTO conversations (phone_number, message_count, channel) VALUES (${phone}, 1, ${channel})`;
      }
    }
  } catch (e) { 
    console.error('DB kayıt hatası:', e.message); 
  }
}

export async function getConversationStatus(phone) {
  if (!sql) return 'bot';
  try {
    const conv = await sql`SELECT status FROM conversations WHERE phone_number = ${phone}`;
    return conv.length > 0 ? conv[0].status : 'bot';
  } catch (e) { return 'bot'; }
}

export async function resetFollowUpCount(phone) {
  if (!sql) return;
  try { 
    await sql`UPDATE conversations SET follow_up_count = 0 WHERE phone_number = ${phone}`; 
  } catch(e) {}
}

export async function getConversationState(phone) {
  if (!sql) return { phase: 'greeting', temperature: 'cold' };
  try {
    // Schema migration check
    try { await sql`ALTER TABLE conversations ADD COLUMN IF NOT EXISTS phase VARCHAR(50) DEFAULT 'greeting'`; } catch(e) {}
    try { await sql`ALTER TABLE conversations ADD COLUMN IF NOT EXISTS temperature VARCHAR(20) DEFAULT 'cold'`; } catch(e) {}

    const conv = await sql`SELECT phase, temperature FROM conversations WHERE phone_number = ${phone}`;
    if (conv.length > 0) {
      return { 
        phase: conv[0].phase || 'greeting', 
        temperature: conv[0].temperature || 'cold' 
      };
    }
    return { phase: 'greeting', temperature: 'cold' };
  } catch (e) {
    console.error('State okuma hatası:', e.message);
    return { phase: 'greeting', temperature: 'cold' };
  }
}

export async function updateConversationState(phone, phase, temperature) {
  if (!sql) return;
  try {
    if (phase && temperature) {
      await sql`UPDATE conversations SET phase = ${phase}, temperature = ${temperature} WHERE phone_number = ${phone}`;
    } else if (phase) {
      await sql`UPDATE conversations SET phase = ${phase} WHERE phone_number = ${phone}`;
    } else if (temperature) {
      await sql`UPDATE conversations SET temperature = ${temperature} WHERE phone_number = ${phone}`;
    }
  } catch (e) { console.error('State güncelleme hatası:', e.message); }
}

export async function getConversationHistory(phone, limit = 20) {
  if (!sql) return [];
  try {
    const prev = await sql`SELECT direction, content FROM messages WHERE phone_number = ${phone} ORDER BY created_at DESC LIMIT ${limit}`;
    return prev.reverse().map(m => ({
      role: m.direction === 'in' ? 'user' : 'model',
      parts: [{ text: m.content }]
    }));
  } catch (e) { return []; }
}
