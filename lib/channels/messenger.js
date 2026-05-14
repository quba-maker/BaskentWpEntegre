import axios from 'axios';
import { getSetting, saveMessage, getConversationStatus, resetFollowUpCount, getConversationHistory } from '../db/index.js';
import { processMessage, analyzeConversation } from '../ai/brain.js';

function getPageToken(pageId, tenantMeta = null) {
  // Tenant meta'dan token varsa onu kullan
  if (tenantMeta?.meta_page_token) return tenantMeta.meta_page_token;
  // Fallback: env'den sayfa bazlı token
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
    // 🏭 TENANT CONTEXT — webhook router'dan enjekte edilir
    const tenantId = body.tenant_id || null;
    const tenantMeta = body.tenant_meta || {};

    const channelBotEnabled = await getSetting('channel_messenger_enabled', 'false', tenantId);

    const event = body.entry[0].messaging[0];
    const senderId = event.sender.id;
    const pageId = event.recipient.id;
    
    if (!event.message || !event.message.text) return; 

    if (event.message.is_echo || senderId === pageId) {
      console.log(`🔇 [Messenger] Yankı (Echo) veya Kendi Mesajımız Yoksayıldı.`);
      return;
    }
    
    const text = event.message.text;
    console.log(`📩 [Messenger] Yeni Mesaj (${senderId}) -> Sayfa (${pageId}): ${text}`);

    // 1. Mesajı veritabanına kaydet — tenant ile
    await saveMessage(senderId, 'in', text, null, 'messenger', tenantId);
    await resetFollowUpCount(senderId);

    // 📛 Facebook kullanıcı adını çek ve kaydet (ilk mesajda)
    try {
      const { neon } = await import('@neondatabase/serverless');
      const sqlDb = neon(process.env.DATABASE_URL);
      const existing = await sqlDb`SELECT patient_name FROM conversations WHERE phone_number = ${senderId}`;
      if (!existing[0]?.patient_name || existing[0].patient_name === senderId) {
        const token = getPageToken(pageId, tenantMeta);
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

    // 2. Manuel devral kontrolü — Bot TAMAMEN DURUR
    const status = await getConversationStatus(senderId);
    if (status === 'human') {
      console.log(`🛑 [Messenger] Manuel devral aktif: ${senderId} — Bot yanıt VERMİYOR.`);
      return;
    }

    // 3. Çalışma saatleri kontrolü — tenant bazlı
    const hoursConfig = await getSetting('working_hours', '{"enabled":false}', tenantId);
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
          await saveMessage(senderId, 'out', offMsg, 'mesai-disi', 'messenger', tenantId);
          await sendMessengerMessage(senderId, offMsg, pageId);
          console.log(`🕐 [Messenger] Mesai dışı yanıt: ${senderId}`);
          return;
        }
      }
    } catch(e) {}

    // 4. Sohbet geçmişini al
    const history = await getConversationHistory(senderId, 10);

    // ⛔ BOT ANA ŞARTELİ — Kanal kapalıysa mesaj kaydedilir ama bot cevap vermez
    if (channelBotEnabled === 'false') {
      console.log(`⛔ [Messenger] Bot devre dışı — mesaj kaydedildi ama bot yanıt vermiyor: ${senderId}`);
      analyzeConversation(senderId, text, '').catch(e => console.error('Messenger analiz hatası:', e.message));
      return;
    }

    // 4.5. Maks bot mesaj kontrolü — tenant bazlı
    const maxMsgsSetting = await getSetting('bot_max_messages', '8', tenantId);
    if (maxMsgsSetting !== 'unlimited') {
      try {
        const { neon } = await import('@neondatabase/serverless');
        const sqlDb = neon(process.env.DATABASE_URL);
        const botMsgCount = await sqlDb`SELECT COUNT(*) as c FROM messages WHERE phone_number = ${senderId} AND direction = 'out' AND model_used IS NOT NULL AND model_used != 'panel'`;
        if (parseInt(botMsgCount[0].c) >= parseInt(maxMsgsSetting)) {
          console.log(`🔄 [Messenger] Maks bot mesaj sınırı aşıldı → Otomatik insana devir: ${senderId}`);
          await sqlDb`UPDATE conversations SET status = 'human', temperature = 'warm' WHERE phone_number = ${senderId}`;
          return;
        }
      } catch(e) {}
    }

    // 5. AI Beyninden cevap al — tenantId ile
    const { response, usedModel } = await processMessage('messenger', text, history, pageId, senderId, tenantId);

    // 5. Cevabı kaydet ve gönder — tenant ile
    await saveMessage(senderId, 'out', response, usedModel, 'messenger', tenantId);
    try {
      await sendMessengerMessage(senderId, response, pageId);
      console.log(`📤 [Messenger] Yanıt gönderildi: ${senderId}`);
    } catch (e) { 
      console.error('❌ Messenger Mesaj gönderme hatası:', e.response?.data || e.message); 
    }

    // 6. Konuşma analizi
    analyzeConversation(senderId, text, response).catch(e => console.error('Messenger analiz hatası:', e.message));

  } catch (error) {
    console.error('❌ Messenger Handler Hatası:', error);
  }
}
