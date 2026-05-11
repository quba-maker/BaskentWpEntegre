import { sql } from '../lib/db/index.js';
import axios from 'axios';

// Vercel Serverless Function
export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  const { message, callback_query } = req.body;
  const botToken = process.env.TELEGRAM_BOT_TOKEN;

  try {
    // 1. BUTON TIKLAMALARI (Callback Query)
    if (callback_query) {
      const data = callback_query.data; // Örn: crm_contacted_905546833306
      const chatId = callback_query.message.chat.id;
      const messageId = callback_query.message.message_id;
      const callbackId = callback_query.id;
      const userFirstName = callback_query.from.first_name || 'Danışman';

      if (data && data.startsWith('crm_')) {
        const parts = data.split('_');
        const action = parts[1]; // contacted, callmiss, appoint, thinking, lost
        const phone = parts.slice(2).join('_'); // telefon numarası (bazen _ içerebilir)

        const cleanP = phone.replace(/\D/g, '');
        const searchP = cleanP.length > 10 ? cleanP.substring(cleanP.length - 10) : cleanP;
        const likePattern = `%${searchP}%`;

        let newStage = '';
        let newStatus = 'human';
        let feedbackMsg = '';
        let telegramAlertText = callback_query.message.text;
        let statusBadge = '';
        let showFollowUpButtons = false;

        // ============================================================
        // 📞 ARADIM - ULAŞTIM → Sonuç sorusu göster
        // ============================================================
        if (action === 'contacted') {
          feedbackMsg = '✅ Görüşme kaydedildi! Sonucu seçin.';
          statusBadge = `📞 Arandı - Ulaşıldı (${userFirstName})`;
          showFollowUpButtons = true;
          
          // Görüşme notunu ekle
          const conv = await sql`SELECT notes FROM conversations WHERE phone_number LIKE ${likePattern} LIMIT 1`;
          const oldNotes = conv[0]?.notes || '';
          const newNoteEntry = `[SİSTEM - ${userFirstName} - ${new Date().toLocaleTimeString('tr-TR', {timeZone:'Europe/Istanbul',hour:'2-digit',minute:'2-digit'})}]: 📞 Arandı ve ulaşıldı. Sonuç bekleniyor.`;
          await sql`UPDATE conversations SET notes = ${oldNotes ? oldNotes + '\n' + newNoteEntry : newNoteEntry}, updated_at = NOW() WHERE phone_number LIKE ${likePattern}`;

          // Popup göster
          try {
            await axios.post(`https://api.telegram.org/bot${botToken}/answerCallbackQuery`, {
              callback_query_id: callbackId, text: feedbackMsg, show_alert: false
            });
          } catch(e) {}

          // Mesajı güncelle — yeni butonlar göster (Sonuç sorusu)
          try {
            await axios.post(`https://api.telegram.org/bot${botToken}/editMessageText`, {
              chat_id: chatId,
              message_id: messageId,
              text: `${telegramAlertText}\n\n━━━━━━━━━━━━━━\n${statusBadge}\n\n❓ Görüşme sonucu nedir?`,
              reply_markup: {
                inline_keyboard: [
                  [
                    { text: "📅 Randevu Verildi", callback_data: `crm_appoint_${phone}` },
                    { text: "💬 Düşünecek", callback_data: `crm_thinking_${phone}` }
                  ],
                  [
                    { text: "🔄 Tekrar Aranacak", callback_data: `crm_recall_${phone}` },
                    { text: "❌ İlgilenmiyor", callback_data: `crm_lost_${phone}` }
                  ]
                ]
              }
            });
          } catch(e) {}
          
          return res.status(200).json({ ok: true });
        }

        // ============================================================
        // ✅ RANDEVU VERİLDİ
        // ============================================================
        if (action === 'appoint') {
          newStage = 'appointed';
          newStatus = 'closed';
          feedbackMsg = '✅ CRM Güncellendi: Randevu Verildi!';
          statusBadge = `✅ Randevu Verildi (${userFirstName})`;
        }
        
        // ============================================================
        // 💬 DÜŞÜNECEK → 24 saat sonra otomatik follow-up
        // ============================================================
        else if (action === 'thinking') {
          newStage = 'negotiation';
          newStatus = 'active'; // Bot tekrar aktif — 24 saat sonra follow-up atacak
          feedbackMsg = '💬 CRM Güncellendi: Hasta düşünecek. 24 saat sonra otomatik takip yapılacak.';
          statusBadge = `💬 Düşünecek — 24s Takip Kuruldu (${userFirstName})`;
          
          // follow_up_count'u 0'a sıfırla ve last_follow_up_at'ı şimdi yap
          // Böylece follow-up.js 24 saat sonra ilk takibi atar
          await sql`UPDATE conversations SET follow_up_count = 0, last_follow_up_at = NULL, last_message_at = NOW() WHERE phone_number LIKE ${likePattern}`;
        }
        
        // ============================================================
        // 🔄 TEKRAR ARANACAK
        // ============================================================
        else if (action === 'recall') {
          newStage = 'hot_lead';
          feedbackMsg = '🔄 CRM Güncellendi: Tekrar aranacak!';
          statusBadge = `🔄 Tekrar Aranacak (${userFirstName})`;
        }

        // ============================================================
        // 📞 ARADIM - ULAŞAMADIM → 3 deneme sonra otomatik durdur
        // ============================================================
        else if (action === 'callmiss') {
          newStage = 'hot_lead';
          
          // Kaç kez ulaşılamadığını say
          const conv = await sql`SELECT notes FROM conversations WHERE phone_number LIKE ${likePattern} LIMIT 1`;
          const oldNotes = conv[0]?.notes || '';
          const missCount = (oldNotes.match(/ulaşılamadı/gi) || []).length + 1;
          
          if (missCount >= 3) {
            // 3. deneme → Hastaya bilgi mesajı gönder + durdur
            newStatus = 'active'; // Bot geri devralır
            feedbackMsg = `📞 3. kez ulaşılamadı! Hastaya bilgi mesajı gönderildi. Sistem aktif beklemeye alındı.`;
            statusBadge = `📞 3x Ulaşılamadı — Hasta Bilgilendirildi (${userFirstName})`;
            
            // Hastaya Kanala Göre Mesaj Gönder
            try {
              const chInfo = await sql`SELECT COALESCE(last_channel, channel, 'whatsapp') as ch FROM conversations WHERE phone_number LIKE ${likePattern} LIMIT 1`;
              const targetChannel = chInfo[0]?.ch || 'whatsapp';
              
              const isTurkish = phone.startsWith('90');
              const missMsg = isTurkish 
                ? 'Merhaba, sizi randevunuz/talebiniz için birkaç kez aramaya çalıştık ancak ulaşamadık 📱 Müsait olduğunuzda bize bu mesaj üzerinden yazabilir veya 0332 257 06 06 numarasından arayabilirsiniz 🙏'
                : 'Hello, we tried to reach you several times regarding your request but could not connect 📱 When you are available, please reply to this message or call +90 501 015 42 42 🙏';

              if (targetChannel === 'whatsapp' || phone.match(/^9\d{10,}/)) {
                const META = process.env.META_ACCESS_TOKEN;
                const PHONE_ID = process.env.PHONE_NUMBER_ID;
                if (META && PHONE_ID) {
                  await axios({
                    method: 'POST',
                    url: `https://graph.facebook.com/v25.0/${PHONE_ID}/messages`,
                    headers: { Authorization: `Bearer ${META}` },
                    data: { messaging_product: 'whatsapp', to: phone, type: 'text', text: { body: missMsg } }
                  });
                  await sql`INSERT INTO messages (phone_number, direction, content, model_used, channel) VALUES (${phone}, 'out', ${missMsg}, 'callmiss-auto', 'whatsapp')`;
                }
              } else if (targetChannel === 'instagram') {
                const { sendInstagramMessage } = await import('../lib/channels/instagram.js');
                // recipient id for ig is stored in phone field in our DB schema for non-wa channels
                await sendInstagramMessage(phone, missMsg, null); 
                await sql`INSERT INTO messages (phone_number, direction, content, model_used, channel) VALUES (${phone}, 'out', ${missMsg}, 'callmiss-auto', 'instagram')`;
              } else if (targetChannel === 'messenger') {
                const { sendMessengerMessage } = await import('../lib/channels/messenger.js');
                await sendMessengerMessage(phone, missMsg, null); // Page ID is dynamically fetched inside the function if null, but we need to pass a valid pageId normally. However, for a broadcast fallback, it relies on PAGE_ACCESS_TOKEN.
                await sql`INSERT INTO messages (phone_number, direction, content, model_used, channel) VALUES (${phone}, 'out', ${missMsg}, 'callmiss-auto', 'messenger')`;
              }
            } catch(e) { console.error(`Callmiss oto-mesaj hatası (${phone}):`, e.response?.data?.error?.message || e.message); }
          } else {
            feedbackMsg = `📞 ${missCount}. arama — Ulaşılamadı. ${3 - missCount} deneme kaldı.`;
            statusBadge = `📞 ${missCount}/3 Ulaşılamadı (${userFirstName})`;
          }
        }

        // ============================================================
        // ❌ İPTAL / İLGİLENMİYOR
        // ============================================================
        else if (action === 'lost') {
          newStage = 'lost';
          newStatus = 'closed';
          feedbackMsg = '❌ CRM Güncellendi: İptal / Kayıp!';
          statusBadge = `❌ İptal / İlgilenmiyor (${userFirstName})`;
        }

        // Veritabanını Güncelle
        if (newStage) {
          await sql`UPDATE leads SET stage = ${newStage} WHERE phone_number LIKE ${likePattern}`;
          await sql`UPDATE conversations SET lead_stage = ${newStage}, status = ${newStatus} WHERE phone_number LIKE ${likePattern}`;
          
          // Otomatik not ekle (contacted zaten yukarıda eklendi)
          if (action !== 'contacted') {
            const conv = await sql`SELECT notes FROM conversations WHERE phone_number LIKE ${likePattern} LIMIT 1`;
            const oldNotes = conv[0]?.notes || '';
            let systemNote = '';
            if (action === 'callmiss') systemNote = '☎️ Arandı ama ulaşılamadı.';
            else if (action === 'recall') systemNote = '🔄 Tekrar aranacak olarak işaretlendi.';
            else if (action === 'appoint') systemNote = '✅ Randevu oluşturuldu.';
            else if (action === 'thinking') systemNote = '💬 Hasta düşünecek. 24 saat sonra otomatik takip.';
            else if (action === 'lost') systemNote = '❌ Hasta iptal etti / ilgilenmiyor.';
            
            const newNoteEntry = `[SİSTEM - ${userFirstName} - ${new Date().toLocaleTimeString('tr-TR', {timeZone:'Europe/Istanbul',hour:'2-digit',minute:'2-digit'})}]: ${systemNote}`;
            const updatedNotes = oldNotes ? `${oldNotes}\n${newNoteEntry}` : newNoteEntry;
            await sql`UPDATE conversations SET notes = ${updatedNotes}, updated_at = NOW() WHERE phone_number LIKE ${likePattern}`;
          }

          // Popup göster
          try {
            await axios.post(`https://api.telegram.org/bot${botToken}/answerCallbackQuery`, {
              callback_query_id: callbackId, text: feedbackMsg, show_alert: false
            });
          } catch(e) {}

          // Telegram mesajını güncelle (butonları kaldır, durumu yaz)
          try {
            await axios.post(`https://api.telegram.org/bot${botToken}/editMessageText`, {
              chat_id: chatId,
              message_id: messageId,
              text: `${telegramAlertText}\n\n━━━━━━━━━━━━━━\n${statusBadge}`,
              reply_markup: { inline_keyboard: [] }
            });
          } catch(e) {}
        }
      }
    }

    // 2. MESAJ YANITLAMA (CRM'e Not + Hastaya WhatsApp Mesajı)
    if (message && message.reply_to_message) {
      const replyText = message.text;
      const originalText = message.reply_to_message.text;
      const userFirstName = message.from.first_name || 'Danışman';

      // Orijinal mesajdan telefon numarasını çıkar (Tel: 905546833306)
      const phoneMatch = originalText.match(/Tel:\s*(\d+)/);
      if (phoneMatch && phoneMatch[1]) {
        const phone = phoneMatch[1];
        const cleanP = phone.replace(/\D/g, '');
        const searchP = cleanP.length > 10 ? cleanP.substring(cleanP.length - 10) : cleanP;
        const likePattern = `%${searchP}%`;

        // CRM'e not ekle
        const conv = await sql`SELECT notes, last_channel FROM conversations WHERE phone_number LIKE ${likePattern} LIMIT 1`;
        if (conv.length > 0) {
          const oldNotes = conv[0].notes || '';
          const lastChannel = conv[0].last_channel || 'whatsapp';
          const newNoteEntry = `[${userFirstName} - ${new Date().toLocaleTimeString('tr-TR', {timeZone:'Europe/Istanbul',hour:'2-digit',minute:'2-digit'})}]: ${replyText}`;
          const updatedNotes = oldNotes ? `${oldNotes}\n${newNoteEntry}` : newNoteEntry;
          await sql`UPDATE conversations SET notes = ${updatedNotes}, updated_at = NOW() WHERE phone_number LIKE ${likePattern}`;

          // 🚀 HASTAYA KANALA GÖRE MESAJ GÖNDER (WA / IG / MSG)
          let sentToPatient = false;
          let targetChannel = lastChannel || 'whatsapp';
          
          try {
            if (targetChannel === 'whatsapp' || phone.match(/^9\d{10,}/)) {
              const META = process.env.META_ACCESS_TOKEN;
              const PHONE_ID = process.env.PHONE_NUMBER_ID;
              if (META && PHONE_ID) {
                await axios({
                  method: 'POST',
                  url: `https://graph.facebook.com/v25.0/${PHONE_ID}/messages`,
                  headers: { Authorization: `Bearer ${META}` },
                  data: { messaging_product: 'whatsapp', to: phone, type: 'text', text: { body: replyText } }
                });
                await sql`INSERT INTO messages (phone_number, direction, content, model_used, channel) VALUES (${phone}, 'out', ${replyText}, 'human-telegram', 'whatsapp')`;
                sentToPatient = true;
                targetChannel = 'whatsapp';
              }
            } else if (targetChannel === 'instagram') {
              const { sendInstagramMessage } = await import('../lib/channels/instagram.js');
              await sendInstagramMessage(phone, replyText, null);
              await sql`INSERT INTO messages (phone_number, direction, content, model_used, channel) VALUES (${phone}, 'out', ${replyText}, 'human-telegram', 'instagram')`;
              sentToPatient = true;
            } else if (targetChannel === 'messenger') {
              const { sendMessengerMessage } = await import('../lib/channels/messenger.js');
              await sendMessengerMessage(phone, replyText, null);
              await sql`INSERT INTO messages (phone_number, direction, content, model_used, channel) VALUES (${phone}, 'out', ${replyText}, 'human-telegram', 'messenger')`;
              sentToPatient = true;
            }
          } catch(e) { console.error('Telegram→Hasta hata:', e.response?.data?.error?.message || e.message); }

          // Danışmana onay mesajı
          try {
            const confirmMsg = sentToPatient 
              ? `✅ Mesaj hastaya ${targetChannel.toUpperCase()} üzerinden iletildi + CRM'e not eklendi`
              : `📝 CRM'e Not Eklendi (Mesaj hastaya iletilemedi, kanal: ${targetChannel})`;
            await axios.post(`https://api.telegram.org/bot${botToken}/sendMessage`, {
              chat_id: message.chat.id,
              reply_to_message_id: message.message_id,
              text: confirmMsg
            });
          } catch(e) {}
        }
      }
    }

    return res.status(200).json({ ok: true });
  } catch (error) {
    console.error('Telegram Webhook Error:', error);
    return res.status(500).json({ error: 'Internal Server Error' });
  }
}
