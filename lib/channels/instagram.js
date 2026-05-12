import axios from 'axios';
import { getSetting, saveMessage, getConversationStatus, resetFollowUpCount, getConversationHistory } from '../db/index.js';
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
    // Kanal aktiflik durumu (bot yanıt için kontrol edilecek, mesaj kaydı her zaman yapılır)
    const channelBotEnabled = await getSetting('channel_instagram_enabled', 'false');

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
    await resetFollowUpCount(senderId);

    // 📛 Instagram kullanıcı adını çek ve kaydet (ilk mesajda)
    try {
      const { neon } = await import('@neondatabase/serverless');
      const sqlDb = neon(process.env.DATABASE_URL);
      const existing = await sqlDb`SELECT patient_name FROM conversations WHERE phone_number = ${senderId}`;
      if (!existing[0]?.patient_name || existing[0].patient_name === senderId) {
        // Instagram Graph API ile kullanıcı adını çek
        for (const token of IG_TOKENS) {
          try {
            const profileRes = await axios.get(`https://graph.instagram.com/v25.0/${senderId}?fields=username,name`, {
              params: { access_token: token }
            });
            const igUsername = profileRes.data?.name || profileRes.data?.username || null;
            if (igUsername) {
              await sqlDb`UPDATE conversations SET patient_name = ${igUsername} WHERE phone_number = ${senderId}`;
              console.log(`📛 [Instagram] Kullanıcı adı kaydedildi: ${senderId} → ${igUsername}`);
              break;
            }
          } catch(profileErr) {
            // Token yetkisiz olabilir, diğerini dene
            continue;
          }
        }
      }

      // Lead durumunu otomatik güncelle (Instagram'dan cevap verdi)
      await sqlDb`UPDATE leads SET stage = 'discovery', responded_at = NOW() WHERE phone_number = ${senderId} AND stage IN ('new', 'contacted')`;
    } catch(e) { console.error('IG profil/lead güncelleme hatası:', e.message); }

    // 2. Manuel devral kontrolü — Bot TAMAMEN DURUR
    const status = await getConversationStatus(senderId);
    if (status === 'human') {
      console.log(`🛑 [Instagram] Manuel devral aktif: ${senderId} — Bot yanıt VERMİYOR.`);
      return;
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
          await saveMessage(senderId, 'out', offMsg, 'mesai-disi', 'instagram');
          await sendInstagramMessage(senderId, offMsg, recipientId);
          console.log(`🕐 [Instagram] Mesai dışı yanıt: ${senderId}`);
          return;
        }
      }
    } catch(e) {}

    // 4. AI için geçmişi çek
    const history = await getConversationHistory(senderId);

    // ⛔ BOT ANA ŞARTELİ — Kanal kapalıysa mesaj kaydedilir ama bot cevap vermez
    if (channelBotEnabled === 'false') {
      console.log(`⛔ [Instagram] Bot devre dışı — mesaj kaydedildi ama bot yanıt vermiyor: ${senderId}`);
      analyzeConversation(senderId, text, '').catch(e => console.error('IG analiz hatası:', e.message));
      return;
    }

    // 4.5. Maks bot mesaj kontrolü
    const maxMsgsSetting = await getSetting('bot_max_messages', '8');
    if (maxMsgsSetting !== 'unlimited') {
      try {
        const { neon } = await import('@neondatabase/serverless');
        const sqlDb = neon(process.env.DATABASE_URL);
        const botMsgCount = await sqlDb`SELECT COUNT(*) as c FROM messages WHERE phone_number = ${senderId} AND direction = 'out' AND model_used IS NOT NULL AND model_used != 'panel'`;
        if (parseInt(botMsgCount[0].c) >= parseInt(maxMsgsSetting)) {
          console.log(`🔄 [Instagram] Maks bot mesaj sınırı aşıldı → Otomatik insana devir: ${senderId}`);
          await sqlDb`UPDATE conversations SET status = 'human', temperature = 'warm' WHERE phone_number = ${senderId}`;
          return;
        }
      } catch(e) {}
    }

    // 5. AI Beyninden cevap al (Instagram modunda)
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
