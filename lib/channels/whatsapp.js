import axios from 'axios';
import { getSetting, saveMessage, getConversationStatus, resetFollowUpCount, getConversationHistory } from '../db/index.js';
import { processMessage, analyzeConversation } from '../ai/brain.js';

const META_ACCESS_TOKEN = process.env.META_ACCESS_TOKEN;
const PHONE_NUMBER_ID = process.env.PHONE_NUMBER_ID;

// Çalışma saatleri kontrolü
function isWorkingHours(settingsStr) {
  try {
    const h = JSON.parse(settingsStr);
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

// WhatsApp üzerinden mesaj gönderme
export async function sendWhatsApp(phone, text) {
  await axios({
    method: 'POST',
    url: `https://graph.facebook.com/v25.0/${PHONE_NUMBER_ID}/messages`,
    headers: { Authorization: `Bearer ${META_ACCESS_TOKEN}` },
    data: { messaging_product: 'whatsapp', to: phone, type: 'text', text: { body: text } }
  });
}

// WhatsApp mesajını işleme (metin + sesli mesaj desteği)
export async function handleWhatsAppMessage(body) {
  try {
    const phone = body.entry[0].changes[0].value.contacts[0].wa_id;
    const message = body.entry[0].changes[0].value.messages[0];

    let text = '';
    let isVoice = false;

    if (message.type === 'text') {
      text = message.text.body;
    } else if (message.type === 'audio') {
      // 🎤 Sesli mesaj — Meta'dan indir, Gemini'ye gönder
      isVoice = true;
      try {
        const mediaId = message.audio.id;
        // 1. Media URL al
        const mediaInfo = await axios.get(`https://graph.facebook.com/v25.0/${mediaId}`, {
          headers: { Authorization: `Bearer ${META_ACCESS_TOKEN}` }
        });
        const mediaUrl = mediaInfo.data.url;
        // 2. Ses dosyasını indir
        const audioRes = await axios.get(mediaUrl, {
          headers: { Authorization: `Bearer ${META_ACCESS_TOKEN}` },
          responseType: 'arraybuffer'
        });
        const audioBase64 = Buffer.from(audioRes.data).toString('base64');
        const mimeType = mediaInfo.data.mime_type || 'audio/ogg';
        
        // 3. Gemini'ye gönder — transkript al
        const GEMINI_KEY = process.env.GEMINI_API_KEY;
        const geminiRes = await axios.post(
          `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${GEMINI_KEY}`,
          {
            contents: [{
              parts: [
                { inlineData: { mimeType, data: audioBase64 } },
                { text: 'Bu sesli mesajı kelimesi kelimesine yazıya dök. Sadece transkripsiyonu yaz, başka bir şey ekleme.' }
              ]
            }]
          }
        );
        text = geminiRes.data?.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || '';
        console.log(`🎤 [WhatsApp] Ses transkript (${phone}): ${text}`);
      } catch(e) {
        console.error('❌ Ses transkript hatası:', e.response?.data || e.message);
        text = '[Sesli mesaj gönderildi]';
      }
    } else {
      return; // Diğer mesaj tipleri (sticker, location, vs)
    }

    if (!text) return;
    console.log(`📩 [WhatsApp] ${isVoice ? '🎤' : '💬'} (${phone}): ${text}`);
    
    // 1. Mesajı veritabanına kaydet
    await saveMessage(phone, 'in', isVoice ? `🎤 ${text}` : text, null, 'whatsapp');
    await resetFollowUpCount(phone);

    // Lead durumunu otomatik güncelle (hasta cevap verdi)
    try {
      const { neon } = await import('@neondatabase/serverless');
      const sqlDb = neon(process.env.DATABASE_URL);
      await sqlDb`UPDATE leads SET stage = 'responded', responded_at = NOW() WHERE phone_number = ${phone} AND stage IN ('new', 'contacted')`;
    } catch(e) {}

    // 2. Canlı müdahale kontrolü (Eğer bot kapatılmışsa cevap verme)
    const status = await getConversationStatus(phone);
    if (status === 'human') {
      console.log(`👤 [WhatsApp] İnsan müdahalesi aktif: ${phone} - Bot cevap vermiyor`);
      return;
    }

    // 3. Çalışma saatleri kontrolü
    const hoursConfig = await getSetting('working_hours', '{"enabled":false}');
    const hours = isWorkingHours(hoursConfig);
    if (!hours.working) {
      await saveMessage(phone, 'out', hours.message, 'mesai-disi', 'whatsapp');
      try {
        await sendWhatsApp(phone, hours.message);
        console.log(`🕐 [WhatsApp] Mesai dışı yanıt gönderildi: ${phone}`);
      } catch (e) { console.error('❌ Mesaj hatası:', e.response?.data || e.message); }
      return;
    }

    // 4. Sohbet geçmişini al
    const history = await getConversationHistory(phone, 20);

    // 5. AI Beyninden cevap al
    const { response, usedModel } = await processMessage('whatsapp', text, history, null, phone);

    // 6. Cevabı kaydet ve gönder
    await saveMessage(phone, 'out', response, usedModel, 'whatsapp');
    try {
      await sendWhatsApp(phone, response);
      console.log(`📤 [WhatsApp] Yanıt gönderildi: ${phone}`);
    } catch (e) { console.error('❌ Mesaj hatası:', e.response?.data || e.message); }

    // 7. Konuşma analizi — otomatik etiketleme + randevu tespiti
    analyzeConversation(phone, text, response).catch(e => console.error('Analiz hatası:', e.message));

  } catch (error) {
    console.error('❌ WhatsApp Handler Hatası:', error);
  }
}
