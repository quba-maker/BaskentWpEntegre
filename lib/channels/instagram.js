import axios from 'axios';
import { getSetting, saveMessage, getConversationStatus, getConversationHistory } from '../db/index.js';
import { processMessage, analyzeConversation } from '../ai/brain.js';

const IG_TOKENS = [
  process.env.IG_TOKEN_1,
  process.env.IG_TOKEN_2
].filter(Boolean);

export async function sendInstagramMessage(senderId, text, recipientId) {
  let lastError = null;
  
  for (const token of IG_TOKENS) {
    try {
      // Instagram Login Token (IGAA...) kullandığımız için API adresi graph.instagram.com olmalı
      const url = `https://graph.instagram.com/v25.0/me/messages?access_token=${token}`;
      await axios.post(url, {
        recipient: { id: senderId },
        message: { text: text }
      });
      
      return true; // Başarılıysa çık
    } catch (error) {
      lastError = error.response?.data || error.message;
      // Hata alırsa diğer tokene geçer
      continue;
    }
  }

  console.error('❌ Instagram Mesaj Gönderme Hatası:', lastError);
  return false;
}

export async function handleInstagramMessage(body) {
  try {
    // ⛔ KANAL AKTİF/PASİF KONTROLÜ
    const channelEnabled = await getSetting('channel_instagram_enabled', 'false');
    if (channelEnabled === 'false') {
      console.log('⛔ [Instagram] Kanal pasif — mesaj işlenmiyor.');
      return;
    }

    const entry = body.entry?.[0];
    if (!entry) return;
    
    const event = entry.messaging?.[0];
    if (!event || !event.message || !event.message.text) return;

    const senderId = event.sender.id;
    const recipientId = event.recipient.id; // Bu IG Account ID veya Page ID
    const text = event.message.text;

    // Kendi attığımız veya Meta'nın attığı otomatik mesajları (is_echo) yoksay
    if (event.message.is_echo || senderId === recipientId) {
      console.log(`🔇 Yankı (Echo) veya Kendi Mesajımız Yoksayıldı: ${text}`);
      return;
    }

    console.log(`📥 Yeni Instagram Mesajı: ${senderId} -> ${text}`);

    // 1. Mesajı veritabanına kaydet
    await saveMessage(senderId, 'in', text, null, 'instagram');

    // Lead durumunu otomatik güncelle (Instagram'dan cevap verdi)
    try {
      const { neon } = await import('@neondatabase/serverless');
      const sqlDb = neon(process.env.DATABASE_URL);
      await sqlDb`UPDATE leads SET stage = 'responded', responded_at = NOW() WHERE phone_number = ${senderId} AND stage IN ('new', 'contacted')`;
    } catch(e) {}

    // 2. Görüşme durumunu kontrol et (Bot mu, Manuel mi?)
    const status = await getConversationStatus(senderId, 'instagram');
    
    // Eğer durum 'manual' ise (Yani insan devraldıysa) AI cevap vermesin
    if (status === 'manual') {
      console.log(`👤 Görüşme manuel modda. Bot cevap vermiyor. (Kişi: ${senderId})`);
      return;
    }

    // 3. AI için geçmişi çek
    const history = await getConversationHistory(senderId);

    // 4. AI Beyninden cevap al (Instagram modunda)
    const { response, usedModel } = await processMessage('instagram', text, history, recipientId, senderId);

    // 5. Cevabı Instagram'dan gönder
    if (response) {
      await saveMessage(senderId, 'out', response, usedModel, 'instagram');
      // Instagram mesajlarında API üzerinden yanıt vermek için recipient.id (sayfa/ig ID) kullanılır
      await sendInstagramMessage(senderId, response, recipientId);

      // 6. Konuşma analizi — otomatik etiketleme + randevu tespiti
      analyzeConversation(senderId, text, response).catch(e => console.error('IG analiz hatası:', e.message));
    }
  } catch (error) {
    console.error('❌ Instagram Handler Hatası:', error);
  }
}
