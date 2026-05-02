import axios from 'axios';
import { getSetting, saveMessage, getConversationStatus, getConversationHistory } from '../db/index.js';
import { processMessage } from '../ai/brain.js';

const IG_TOKENS = [
  'IGAAc7T3ixmxxBZAFo1V0dzUlNXaTd0SFB4Yk9pU1Rad0FsZAlJLREVPd01neXg2YW5kZA2pOSjZAnM0tidi16ZAjZA5eGZAET0ZAHTnpnYjZAvakJhU0JHTTZAUUzVIajdISFplQUhidGltRVByc3ktUHd6UDFobl96WXZAtb3RhbVQ5bDZAnOAZDZD', // baskenthealth_konya
  'IGAAc7T3ixmxxBZAGFtRms0ZAFdFMnpiWmctSFEzTnJXMG5Uc2N3UjY2YjNUR2wwU3lPZAmZABWk95RGNiQ3pnQnNFaWx6T1I0RGhJWDRLYnFuampCRFYtYTdWR0dGMmF3RmZAmeGRZAT0ZAoWVctR3RHRWNtNVhkUER0SGVTOGJLRzlmYwZDZD' // baskenthastanesi_konya
];

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
      
      // Gönderilen mesajı veritabanına kaydet
      await saveMessage(senderId, 'out', text, null, 'instagram');
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
