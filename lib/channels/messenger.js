import axios from 'axios';
import { getSetting, saveMessage, getConversationStatus, getConversationHistory } from '../db/index.js';
import { processMessage } from '../ai/brain.js';

const PAGE_TOKENS = {
  '107027185544203': process.env.PAGE_TOKEN_107027185544203 || 'EAAMEZBSqN8IQBRVyLEYmxMrEPu2LT8qZBQZBOVK20XeF5NZCG5MaO1USMqH0ZBCJwG9QbrUqTVgNn3g6lOAQiVZAEN1rv9CcrZCfkj6fDcXeZB6IncZAm9Xol9I2hjJzJ6U1NpZB15IVD9grc68LvtjpBSgFOzipS6EPMOO3jZCIu3JHvZBBArrBgbe6BBq22ztKqZANFoLYWqR9D9qXMQOZC8Rs33Ijyk', // Baskent Konya Hospital (EN)
  '103094588239235': process.env.PAGE_TOKEN_103094588239235 || 'EAAMEZBSqN8IQBRfznsqxwiLNZCgDgunfugfUh5Nhbxut5A45MfaXpX4ZCHTfYIMZCiFeG9j04xueYnTv2qLU4n4ENHAxAjdpyhTGJuI6nPzbF2PUSvod0Q0gZC2CZCrEOhZAvnqAiZBlPs6kQIWtHyeDlabgjy2e93QeuviFWTL6t0VqExfDu5SBgWUymYJZA7CRpDptz6y3ZB1IiffSBopamc3Edo' // Başkent Hastanesi Konya (TR)
};

function getPageToken(pageId) {
  return PAGE_TOKENS[pageId] || process.env[`PAGE_TOKEN_${pageId}`] || process.env.PAGE_ACCESS_TOKEN;
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
    
    const text = event.message.text;
    console.log(`📩 [Messenger] Yeni Mesaj (${senderId}) -> Sayfa (${pageId}): ${text}`);

    // 1. Mesajı veritabanına kaydet
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
      await sendMessengerMessage(senderId, response, pageId);
      console.log(`📤 [Messenger] Yanıt gönderildi: ${senderId}`);
    } catch (e) { 
      console.error('❌ Messenger Mesaj gönderme hatası:', e.response?.data || e.message); 
    }

  } catch (error) {
    console.error('❌ Messenger Handler Hatası:', error);
  }
}
