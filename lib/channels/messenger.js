import axios from 'axios';
import { getSetting, saveMessage, getConversationStatus, resetFollowUpCount, getConversationHistory } from '../db/index.js';
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
    // ⛔ KANAL AKTİF/PASİF KONTROLÜ
    const channelEnabled = await getSetting('channel_messenger_enabled', 'false');
    if (channelEnabled === 'false') {
      console.log('⛔ [Messenger] Kanal pasif — mesaj işlenmiyor.');
      return;
    }

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
    await resetFollowUpCount(senderId);

    // 📛 Facebook kullanıcı adını çek ve kaydet (ilk mesajda)
    try {
      const { neon } = await import('@neondatabase/serverless');
      const sqlDb = neon(process.env.DATABASE_URL);
      const existing = await sqlDb`SELECT patient_name FROM conversations WHERE phone_number = ${senderId}`;
      if (!existing[0]?.patient_name || existing[0].patient_name === senderId) {
        const token = getPageToken(pageId);
        if (token) {
          try {
            const profileRes = await axios.get(`https://graph.facebook.com/v25.0/${senderId}`, {
              params: { fields: 'first_name,last_name', access_token: token }
            });
            const fbName = [profileRes.data?.first_name, profileRes.data?.last_name].filter(Boolean).join(' ');
            if (fbName) {
              await sqlDb`UPDATE conversations SET patient_name = ${fbName} WHERE phone_number = ${senderId}`;
              console.log(`📛 [Messenger] Kullanıcı adı kaydedildi: ${senderId} → ${fbName}`);
            }
          } catch(profileErr) {
            console.error('FB profil çekme hatası:', profileErr.response?.data?.error?.message || profileErr.message);
          }
        }
      }

      // Lead durumunu otomatik güncelle (Messenger'dan cevap verdi)
      await sqlDb`UPDATE leads SET stage = 'discovery', responded_at = NOW() WHERE phone_number = ${senderId} AND stage IN ('new', 'contacted')`;
    } catch(e) { console.error('FB profil/lead güncelleme hatası:', e.message); }

    // 2. Canlı müdahale kontrolü
    const status = await getConversationStatus(senderId);
    if (status === 'human') {
      console.log(`👤 [Messenger] İnsan müdahalesi aktif: ${senderId} - Bot sekreter modunda oyalıyor`);
    }

    // 3. Çalışma saatleri kontrolü (WhatsApp ile aynı mantık)
    const hoursConfig = await getSetting('working_hours', '{"enabled":false}');
    try {
      const h = JSON.parse(hoursConfig);
      if (h.enabled) {
        const now = new Date();
        const tr = new Date(now.toLocaleString('en-US', { timeZone: 'Europe/Istanbul' }));
        const hour = tr.getHours();
        const min = tr.getMinutes();
        const current = hour * 60 + min;
        const [sh, sm] = h.start.split(':').map(Number);
        const [eh, em] = h.end.split(':').map(Number);
        if (current < sh * 60 + sm || current > eh * 60 + em) {
          const offMsg = h.offMessage || 'Mesai saatlerimiz dışındasınız. En kısa sürede dönüş yapacağız.';
          await saveMessage(senderId, 'out', offMsg, 'mesai-disi', 'messenger');
          await sendMessengerMessage(senderId, offMsg, pageId);
          console.log(`🕐 [Messenger] Mesai dışı yanıt: ${senderId}`);
          return;
        }
      }
    } catch(e) {}

    // 4. Sohbet geçmişini al
    const history = await getConversationHistory(senderId, 10);

    // 5. AI Beyninden cevap al
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
