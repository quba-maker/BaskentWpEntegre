import axios from 'axios';
import { getSetting, saveMessage, getConversationStatus, getConversationHistory } from '../db/index.js';
import { processMessage } from '../ai/brain.js';

const PAGE_ACCESS_TOKEN = process.env.PAGE_ACCESS_TOKEN; // Messenger için sayfa token'ı gerekir

// Messenger üzerinden mesaj gönderme
export async function sendMessengerMessage(senderId, text) {
  if (!PAGE_ACCESS_TOKEN) {
    console.error('❌ PAGE_ACCESS_TOKEN eksik. Messenger mesajı gönderilemedi.');
    return;
  }
  
  await axios({
    method: 'POST',
    url: `https://graph.facebook.com/v25.0/me/messages?access_token=${PAGE_ACCESS_TOKEN}`,
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
    
    // Sadece metin mesajlarını işle
    if (!event.message || !event.message.text) return; 
    
    const text = event.message.text;
    console.log(`📩 [Messenger] Yeni Mesaj (${senderId}): ${text}`);

    // 1. Mesajı veritabanına kaydet
    // Not: phone parametresine şimdilik senderId yazıyoruz. (DB'de VARCHAR olduğu için sorun olmaz)
    await saveMessage(senderId, 'in', text, null, 'messenger');

    // 2. Canlı müdahale kontrolü (İnsan devraldıysa bot susar)
    const status = await getConversationStatus(senderId);
    if (status === 'human') {
      console.log(`👤 [Messenger] İnsan müdahalesi aktif: ${senderId} - Bot cevap vermiyor`);
      return;
    }

    // 3. Sohbet geçmişini al
    const history = await getConversationHistory(senderId, 10);

    // 4. AI Beyninden cevap al (Kanal olarak 'messenger' gönderiyoruz)
    const { response, usedModel } = await processMessage('messenger', text, history);

    // 5. Cevabı kaydet ve gönder
    await saveMessage(senderId, 'out', response, usedModel, 'messenger');
    try {
      await sendMessengerMessage(senderId, response);
      console.log(`📤 [Messenger] Yanıt gönderildi: ${senderId}`);
    } catch (e) { 
      console.error('❌ Messenger Mesaj gönderme hatası:', e.response?.data || e.message); 
    }

  } catch (error) {
    console.error('❌ Messenger Handler Hatası:', error);
  }
}
