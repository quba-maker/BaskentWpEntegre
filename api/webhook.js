import axios from 'axios';
import { neon } from '@neondatabase/serverless';

export default async function handler(req, res) {
  const META_ACCESS_TOKEN = process.env.META_ACCESS_TOKEN;
  const PHONE_NUMBER_ID = process.env.PHONE_NUMBER_ID;
  const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
  const DATABASE_URL = process.env.DATABASE_URL;

  const sql = DATABASE_URL ? neon(DATABASE_URL) : null;

  // Ayar oku
  async function getSetting(key, fallback = null) {
    if (!sql) return fallback;
    try {
      const r = await sql`SELECT value FROM settings WHERE key = ${key}`;
      return r.length > 0 ? r[0].value : fallback;
    } catch (e) { return fallback; }
  }

  // Mesajı kaydet
  async function saveMessage(phone, dir, content, model = null) {
    if (!sql) return;
    try {
      await sql`INSERT INTO messages (phone_number, direction, content, model_used) VALUES (${phone}, ${dir}, ${content}, ${model})`;
      const ex = await sql`SELECT id FROM conversations WHERE phone_number = ${phone}`;
      if (ex.length > 0) {
        await sql`UPDATE conversations SET last_message_at = NOW(), message_count = message_count + 1 WHERE phone_number = ${phone}`;
      } else {
        await sql`INSERT INTO conversations (phone_number, message_count) VALUES (${phone}, 1)`;
      }
    } catch (e) { console.error('DB kayıt hatası:', e.message); }
  }

  // Çalışma saatleri kontrolü
  function isWorkingHours(settings) {
    try {
      const h = JSON.parse(settings);
      if (!h.enabled) return { working: true };
      const now = new Date();
      const tr = new Date(now.toLocaleString('en-US', { timeZone: 'Europe/Istanbul' }));
      const hour = tr.getHours();
      const min = tr.getMinutes();
      const current = hour * 60 + min;
      const [sh, sm] = h.start.split(':').map(Number);
      const [eh, em] = h.end.split(':').map(Number);
      const start = sh * 60 + sm;
      const end = eh * 60 + em;
      if (current >= start && current <= end) return { working: true };
      return { working: false, message: h.offMessage || 'Mesai saatlerimiz dışındasınız. En kısa sürede dönüş yapacağız.' };
    } catch (e) { return { working: true }; }
  }

  // WhatsApp mesaj gönder
  async function sendWhatsApp(phone, text) {
    await axios({
      method: 'POST',
      url: `https://graph.facebook.com/v25.0/${PHONE_NUMBER_ID}/messages`,
      headers: { Authorization: `Bearer ${META_ACCESS_TOKEN}` },
      data: { messaging_product: 'whatsapp', to: phone, type: 'text', text: { body: text } }
    });
  }

  // GET - Webhook doğrulama
  if (req.method === 'GET') {
    const mode = req.query['hub.mode'];
    const token = req.query['hub.verify_token'];
    const challenge = req.query['hub.challenge'];
    if (mode === 'subscribe' && token === 'baskent_wp_secret_token_123') {
      console.log('✅ Webhook doğrulandı!');
      return res.status(200).send(challenge);
    }
    return res.status(403).json({ error: 'Doğrulama başarısız' });
  }

  // POST - Mesaj işle
  if (req.method === 'POST') {
    const body = req.body;
    if (body.object) {
      if (
        body.entry?.[0]?.changes?.[0]?.value?.messages?.[0]
      ) {
        const phone = body.entry[0].changes[0].value.contacts[0].wa_id;
        const message = body.entry[0].changes[0].value.messages[0];

        if (message.type === 'text') {
          const text = message.text.body;
          console.log(`📩 Yeni Mesaj (${phone}): ${text}`);
          await saveMessage(phone, 'in', text);

          // Canlı müdahale kontrolü
          if (sql) {
            try {
              const conv = await sql`SELECT status FROM conversations WHERE phone_number = ${phone}`;
              if (conv.length > 0 && conv[0].status === 'human') {
                console.log(`👤 İnsan müdahalesi aktif: ${phone} - Bot cevap vermiyor`);
                return res.status(200).send('EVENT_RECEIVED');
              }
            } catch (e) {}
          }

          // Çalışma saatleri kontrolü
          const hoursConfig = await getSetting('working_hours', '{"enabled":false}');
          const hours = isWorkingHours(hoursConfig);
          if (!hours.working) {
            await saveMessage(phone, 'out', hours.message, 'mesai-disi');
            try {
              await sendWhatsApp(phone, hours.message);
              console.log(`🕐 Mesai dışı yanıt gönderildi: ${phone}`);
            } catch (e) { console.error('❌ Mesaj hatası:', e.response?.data || e.message); }
            return res.status(200).send('EVENT_RECEIVED');
          }

          // Prompt ve model al
          const systemPrompt = await getSetting('system_prompt', getDefaultPrompt());
          const primaryModel = await getSetting('ai_model', 'gemini-2.5-flash-lite');
          const models = [primaryModel, 'gemini-2.5-flash'];

          // Konuşma geçmişini al (dil tutarlılığı için)
          let history = [];
          if (sql) {
            try {
              const prev = await sql`SELECT direction, content FROM messages WHERE phone_number = ${phone} ORDER BY created_at DESC LIMIT 20`;
              history = prev.reverse().map(m => ({
                role: m.direction === 'in' ? 'user' : 'model',
                parts: [{ text: m.content }]
              }));
            } catch (e) {}
          }
          history.push({ role: 'user', parts: [{ text: text }] });

          let botResponse = "";
          let usedModel = "";
          let aiSuccess = false;

          for (const model of models) {
            try {
              console.log(`🤖 Deneniyor: ${model}`);
              const r = await axios({
                method: 'POST',
                url: `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${GEMINI_API_KEY}`,
                headers: { 'Content-Type': 'application/json' },
                data: {
                  systemInstruction: {
                    parts: [{ text: `${systemPrompt}\n\n#LANGUAGE DETECTION - THIS OVERRIDES EVERYTHING:\nDetect the language of the LAST user message ONLY. Respond ENTIRELY in that detected language. Do NOT look at previous messages to determine language. If the last message is in Arabic, respond in Arabic. If in English, respond in English. If in Russian, respond in Russian. If in Turkish, respond in Turkish. NEVER mix languages. NEVER default to Turkish unless the user wrote in Turkish.` }]
                  },
                  contents: history,
                  generationConfig: { temperature: 0.7, maxOutputTokens: 1024 }
                },
                timeout: 15000
              });
              if (r.data?.candidates?.[0]?.content?.parts?.[0]?.text) {
                botResponse = r.data.candidates[0].content.parts[0].text;
                usedModel = model;
                console.log(`✅ Cevap alındı (${model})`);
                aiSuccess = true;
                break;
              }
            } catch (e) {
              console.error(`❌ ${model} hatası:`, e.response?.data?.error?.message || e.message);
            }
          }

          if (!aiSuccess) {
            botResponse = "Merhaba, Başkent Üniversitesi Konya Hastanesi'ne ilginiz için teşekkür ederiz. Yetkili arkadaşımız size en kısa sürede dönüş yapacaktır.";
            usedModel = "fallback";
          }

          await saveMessage(phone, 'out', botResponse, usedModel);
          try {
            await sendWhatsApp(phone, botResponse);
            console.log(`📤 Yanıt gönderildi: ${phone}`);
          } catch (e) { console.error('❌ Mesaj hatası:', e.response?.data || e.message); }
        }
      }
      return res.status(200).send('EVENT_RECEIVED');
    }
    return res.status(404).send('NOT_FOUND');
  }
  return res.status(405).send('Method Not Allowed');
}

function getDefaultPrompt() {
  return `Sen Başkent Üniversitesi Konya Hastanesi'nde çalışan gerçek bir hasta danışmanısın.
ÖNEMLİ: Her mesaja "Merhaba" diye BAŞLAMA. Samimi, kısa (2-3 cümle), doğal yaz. Robot gibi konuşma.
Fiyat ASLA verme, randevuya yönlendir. Kullanıcının dilinde cevap ver.`;
}
