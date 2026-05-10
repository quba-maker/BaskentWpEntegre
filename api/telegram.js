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
      const data = callback_query.data; // Örn: crm_appoint_905546833306
      const chatId = callback_query.message.chat.id;
      const messageId = callback_query.message.message_id;
      const callbackId = callback_query.id;
      const userFirstName = callback_query.from.first_name || 'Danışman';

      if (data && data.startsWith('crm_')) {
        const parts = data.split('_');
        const action = parts[1]; // appoint, callmiss, lost
        const phone = parts[2]; // 905546833306

        let newStage = '';
        let newStatus = 'human';
        let feedbackMsg = '';
        let telegramAlertText = callback_query.message.text; // Eski mesaj metni
        let statusBadge = '';

        if (action === 'appoint') {
          newStage = 'appointed';
          newStatus = 'closed';
          feedbackMsg = '✅ CRM Güncellendi: Randevu Verildi!';
          statusBadge = `✅ Randevu Verildi (${userFirstName})`;
        } else if (action === 'callmiss') {
          newStage = 'hot_lead'; // hot_lead'de kalır, geri düşmez
          feedbackMsg = '📞 CRM Güncellendi: Ulaşılamadı — Tekrar aranacak!';
          statusBadge = `📞 Arandı - Ulaşılamadı (${userFirstName})`;
        } else if (action === 'recall') {
          newStage = 'hot_lead'; // hot_lead'de kalır
          feedbackMsg = '🔄 CRM Güncellendi: Tekrar aranacak!';
          statusBadge = `🔄 Tekrar Aranacak (${userFirstName})`;
        } else if (action === 'lost') {
          newStage = 'lost';
          newStatus = 'closed';
          feedbackMsg = '❌ CRM Güncellendi: İptal / Kayıp!';
          statusBadge = `❌ İptal / İlgilenmiyor (${userFirstName})`;
        }

        // Veritabanını Güncelle
        if (newStage) {
          const cleanP = phone.replace(/\D/g, '');
          const searchP = cleanP.length > 10 ? cleanP.substring(cleanP.length - 10) : cleanP;
          const likePattern = `%${searchP}%`;
          
          await sql`UPDATE leads SET stage = ${newStage} WHERE phone_number LIKE ${likePattern}`;
          await sql`UPDATE conversations SET lead_stage = ${newStage}, status = ${newStatus} WHERE phone_number LIKE ${likePattern}`;
          
          // Otomatik not ekle
          const conv = await sql`SELECT notes FROM conversations WHERE phone_number LIKE ${likePattern} LIMIT 1`;
          if (conv.length > 0) {
            const oldNotes = conv[0].notes || '';
            let systemNote = '';
            if (action === 'callmiss') systemNote = '☎️ Arandı ama ulaşılamadı.';
            else if (action === 'recall') systemNote = '🔄 Tekrar aranacak olarak işaretlendi.';
            else if (action === 'appoint') systemNote = '✅ Randevu oluşturuldu.';
            else if (action === 'lost') systemNote = '❌ Hasta iptal etti / ilgilenmiyor.';
            
            const newNoteEntry = `[SİSTEM - ${userFirstName} - ${new Date().toLocaleTimeString('tr-TR')}]: ${systemNote}`;
            const updatedNotes = oldNotes ? `${oldNotes}\n${newNoteEntry}` : newNoteEntry;
            await sql`UPDATE conversations SET notes = ${updatedNotes} WHERE phone_number LIKE ${likePattern}`;
          }

          // Telefona geri bildirim at (butonlara basıldığını ekranda popup olarak gösterir)
          try {
            await axios.post(`https://api.telegram.org/bot${botToken}/answerCallbackQuery`, {
              callback_query_id: callbackId,
              text: feedbackMsg,
              show_alert: false
            });
          } catch(e) {}

          // Telegram'daki mesajı düzenle (Butonları kaldır, durumu yaz)
          try {
            await axios.post(`https://api.telegram.org/bot${botToken}/editMessageText`, {
              chat_id: chatId,
              message_id: messageId,
              text: `${telegramAlertText}\n\n━━━━━━━━━━━━━━\n${statusBadge}`,
              reply_markup: { inline_keyboard: [] } // Butonları sil
            });
          } catch(e) {}
        }
      }
    }

    // 2. MESAJ YANITLAMA (CRM'e Not Düşme)
    if (message && message.reply_to_message) {
      // Bir mesaja yanıt verildi
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

        // Mevcut notu çek ve yeni notu ekle
        const conv = await sql`SELECT notes FROM conversations WHERE phone_number LIKE ${likePattern} LIMIT 1`;
        if (conv.length > 0) {
          const oldNotes = conv[0].notes || '';
          const newNoteEntry = `[${userFirstName} - ${new Date().toLocaleTimeString('tr-TR')}]: ${replyText}`;
          const updatedNotes = oldNotes ? `${oldNotes}\n${newNoteEntry}` : newNoteEntry;

          await sql`UPDATE conversations SET notes = ${updatedNotes} WHERE phone_number LIKE ${likePattern}`;

          // Geri bildirim mesajı (Mesajı beğenme veya onay mesajı atma)
          try {
            await axios.post(`https://api.telegram.org/bot${botToken}/sendMessage`, {
              chat_id: message.chat.id,
              reply_to_message_id: message.message_id,
              text: `📝 CRM'e Not Eklendi: "${replyText}"`
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
