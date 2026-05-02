import axios from 'axios';
import { getSetting, saveMessage, getConversationStatus, getConversationHistory } from '../db/index.js';
import { processMessage } from '../ai/brain.js';

function getPageToken(pageId) {
  // Instagram DM'leri de bağlı olduğu Facebook Sayfasının (Page) Access Token'ını kullanır.
  // Bu yüzden Messenger'daki gibi aynı Vercel env değişkenlerini okuyacağız.
  // Not: Gelen id (ig_account_id) olabilir, bunu Page Token ile eşleştirmek için
  // PAGE_TOKEN_{SAYFA_ID} kullanacağız veya genel PAGE_ACCESS_TOKEN'a düşeceğiz.
  // Instagram hesabının bağlandığı sayfa ID'sini bulmak gerekebilir, ancak
  // şimdilik genel token veya ID bazlı token okutuyoruz.
  return process.env[`PAGE_TOKEN_${pageId}`] || process.env.PAGE_ACCESS_TOKEN;
}

export async function sendInstagramMessage(senderId, text, pageId) {
  const token = getPageToken(pageId);
  if (!token) {
    console.error('❌ Instagram/Page Token bulunamadı:', pageId);
    return false;
  }

  try {
    const url = `https://graph.facebook.com/v25.0/me/messages?access_token=${token}`;
    await axios.post(url, {
      recipient: { id: senderId },
      message: { text: text }
    });
    
    // Gönderilen mesajı veritabanına kaydet
    await saveMessage(senderId, 'out', text, null, 'instagram');
    return true;
  } catch (error) {
    console.error('❌ Instagram Mesaj Gönderme Hatası:', error.response?.data || error.message);
    return false;
  }
}

export async function handleInstagramMessage(body) {
  try {
    const entry = body.entry?.[0];
    if (!entry) return;
    
    const event = entry.messaging?.[0];
    if (!event || !event.message || !event.message.text) return;

    const senderId = event.sender.id;
    const recipientId = event.recipient.id; // Bu IG Account ID veya Page ID
    const text = event.message.text;

    console.log(`📥 Yeni Instagram Mesajı: ${senderId} -> ${text}`);

    // 1. Mesajı veritabanına kaydet
    await saveMessage(senderId, 'in', text, null, 'instagram');

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
    const aiResponseText = await processMessage(text, 'instagram', history);

    // 5. Cevabı Instagram'dan gönder
    if (aiResponseText) {
      // Instagram mesajlarında API üzerinden yanıt vermek için recipient.id (sayfa/ig ID) kullanılır
      await sendInstagramMessage(senderId, aiResponseText, recipientId);
    }
  } catch (error) {
    console.error('❌ Instagram Handler Hatası:', error);
  }
}
