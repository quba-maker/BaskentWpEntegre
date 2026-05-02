import axios from 'axios';
import { getSetting, saveMessage, getConversationStatus, getConversationHistory } from '../db/index.js';
import { processMessage, analyzeConversation } from '../ai/brain.js';

function getPageToken(pageId) {
  // Birden fazla sayfa olduğu için Vercel'da PAGE_TOKEN_{SAYFA_ID} şeklinde ararız
  return process.env[`PAGE_TOKEN_${pageId}`] || process.env.PAGE_ACCESS_TOKEN;
}

// Messenger üzerinden mesaj gönderme
export async function sendMessengerMessage(senderId, text, pageId) {
  const token = getPageToken(pageId);
  
  if (!token) {
    console.error(`❌ Sayfa (${pageId}) için PAGE_TOKEN eksik. Messenger mesajı gönderilemedi.`);
    return;
  }
  
  await axios({
    method: 'POST',
    url: `https://graph.facebook.com/v25.0/me/messages?access_token=${token}`,
    data: {
      recipient: { id: senderId },
      message: { text: text },
      messaging_type: 'RESPONSE'
    }
  });
}

// Messenger mesajını işleme
export async function handleMessengerMessage(body) {
  try {
    const event = body.entry[0].messaging[0];
    const senderId = event.sender.id;
    const pageId = event.recipient.id; // Hangi sayfaya mesaj geldiği
    
    // Sadece metin mesajlarını işle
    if (!event.message || !event.message.text) return; 

    // Kendi attığımız veya Meta'nın attığı otomatik mesajları (is_echo) yoksay
    if (event.message.is_echo || senderId === pageId) {
      console.log(`🔇 [Messenger] Yankı (Echo) veya Kendi Mesajımız Yoksayıldı.`);
      return;
    }
    
    const text = event.message.text;
    console.log(`📩 [Messenger] Yeni Mesaj (${senderId}) -> Sayfa (${pageId}): ${text}`);

    // 1. Mesajı veritabanına kaydet
    await saveMessage(senderId, 'in', text, null, 'messenger');

    // Lead durumunu otomatik güncelle (Messenger'dan cevap verdi)
    try {
      const { neon } = await import('@neondatabase/serverless');
      const sqlDb = neon(process.env.DATABASE_URL);
      await sqlDb`UPDATE leads SET stage = 'responded', responded_at = NOW() WHERE phone_number = ${senderId} AND stage IN ('new', 'contacted')`;
    } catch(e) {}

    // 2. Canlı müdahale kontrolü (İnsan devraldıysa bot susar)
    const status = await getConversationStatus(senderId);
    if (status === 'human') {
      console.log(`👤 [Messenger] İnsan müdahalesi aktif: ${senderId} - Bot cevap vermiyor`);
      return;
    }

    // 3. Sohbet geçmişini al
    const history = await getConversationHistory(senderId, 10);

    // 4. AI Beyninden cevap al (Kanal olarak 'messenger' gönderiyoruz)
    const { response, usedModel } = await processMessage('messenger', text, history, pageId, senderId);

    // 5. Cevabı kaydet ve gönder
    await saveMessage(senderId, 'out', response, usedModel, 'messenger');
    try {
      await sendMessengerMessage(senderId, response, pageId);
      console.log(`📤 [Messenger] Yanıt gönderildi: ${senderId}`);
    } catch (e) { 
      console.error('❌ Messenger Mesaj gönderme hatası:', e.response?.data || e.message); 
    }

    // 6. Konuşma analizi — otomatik etiketleme + randevu tespiti
    analyzeConversation(senderId, text, response).catch(e => console.error('Messenger analiz hatası:', e.message));

  } catch (error) {
    console.error('❌ Messenger Handler Hatası:', error);
  }
}
