import { neon } from '@neondatabase/serverless';

export default async function handler(req, res) {
  // CORS ayarları
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const sql = neon(process.env.DATABASE_URL);
  const { action } = req.query;

  try {
    // =================== DASHBOARD ===================
    if (action === 'dashboard') {
      const totalMessages = await sql`SELECT COUNT(*) as count FROM messages`;
      const todayMessages = await sql`SELECT COUNT(*) as count FROM messages WHERE created_at >= CURRENT_DATE`;
      const activeConversations = await sql`SELECT COUNT(*) as count FROM conversations WHERE status = 'active'`;
      const recentMessages = await sql`SELECT * FROM messages ORDER BY created_at DESC LIMIT 10`;

      return res.json({
        totalMessages: totalMessages[0].count,
        todayMessages: todayMessages[0].count,
        activeConversations: activeConversations[0].count,
        recentMessages
      });
    }

    // =================== KONUŞMALAR ===================
    if (action === 'conversations') {
      const conversations = await sql`
        SELECT c.*, 
          (SELECT content FROM messages WHERE phone_number = c.phone_number ORDER BY created_at DESC LIMIT 1) as last_message
        FROM conversations c 
        ORDER BY last_message_at DESC
      `;
      return res.json(conversations);
    }

    // =================== KONUŞMA DETAYI ===================
    if (action === 'conversation-detail') {
      const { phone } = req.query;
      const messages = await sql`
        SELECT * FROM messages WHERE phone_number = ${phone} ORDER BY created_at ASC
      `;
      return res.json(messages);
    }

    // =================== AYARLAR OKU ===================
    if (action === 'settings' && req.method === 'GET') {
      const settings = await sql`SELECT * FROM settings`;
      const result = {};
      settings.forEach(s => { result[s.key] = s.value; });
      return res.json(result);
    }

    // =================== AYAR GÜNCELLE ===================
    if (action === 'settings' && (req.method === 'POST' || req.method === 'PUT')) {
      const { key, value } = req.body;
      const existing = await sql`SELECT * FROM settings WHERE key = ${key}`;
      if (existing.length > 0) {
        await sql`UPDATE settings SET value = ${value}, updated_at = NOW() WHERE key = ${key}`;
      } else {
        await sql`INSERT INTO settings (key, value) VALUES (${key}, ${value})`;
      }
      return res.json({ success: true, message: `${key} güncellendi` });
    }

    // =================== ŞABLONLAR ===================
    if (action === 'templates' && req.method === 'GET') {
      const templates = await sql`SELECT * FROM templates ORDER BY created_at DESC`;
      return res.json(templates);
    }

    if (action === 'templates' && req.method === 'POST') {
      const { title, content, category } = req.body;
      await sql`INSERT INTO templates (title, content, category) VALUES (${title}, ${content}, ${category})`;
      return res.json({ success: true });
    }

    if (action === 'templates' && req.method === 'DELETE') {
      const { id } = req.query;
      await sql`DELETE FROM templates WHERE id = ${id}`;
      return res.json({ success: true });
    }

    // =================== ANALİTİK ===================
    if (action === 'analytics') {
      const daily = await sql`
        SELECT DATE(created_at) as date, COUNT(*) as count 
        FROM messages 
        WHERE created_at >= CURRENT_DATE - INTERVAL '7 days'
        GROUP BY DATE(created_at) 
        ORDER BY date
      `;
      const byDirection = await sql`
        SELECT direction, COUNT(*) as count FROM messages GROUP BY direction
      `;
      return res.json({ daily, byDirection });
    }

    return res.status(400).json({ error: 'Geçersiz action' });
  } catch (error) {
    console.error('Panel API hatası:', error);
    return res.status(500).json({ error: error.message });
  }
}
