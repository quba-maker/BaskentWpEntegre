import { neon } from '@neondatabase/serverless';

const DATABASE_URL = process.env.DATABASE_URL;
export const sql = DATABASE_URL ? neon(DATABASE_URL) : null;

export async function getSetting(key, fallback = null) {
  if (!sql) return fallback;
  try {
    const r = await sql`SELECT value FROM settings WHERE key = ${key}`;
    return r.length > 0 ? r[0].value : fallback;
  } catch (e) { return fallback; }
}

export async function saveMessage(phone, dir, content, model = null, channel = 'whatsapp') {
  if (!sql) return;
  try {
    // Mesajı kaydet
    await sql`INSERT INTO messages (phone_number, direction, content, model_used, channel) VALUES (${phone}, ${dir}, ${content}, ${model}, ${channel})`;
    
    // Konuşma geçmişini güncelle
    const ex = await sql`SELECT id FROM conversations WHERE phone_number = ${phone}`;
    if (ex.length > 0) {
      await sql`UPDATE conversations SET last_message_at = NOW(), message_count = message_count + 1, channel = ${channel} WHERE phone_number = ${phone}`;
    } else {
      await sql`INSERT INTO conversations (phone_number, message_count, channel) VALUES (${phone}, 1, ${channel})`;
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
