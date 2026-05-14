import { NextRequest, NextResponse } from "next/server";
import { neon } from "@neondatabase/serverless";

// ==========================================
// QUBA AI — Telegram Webhook (Native Next.js)
// CRM buton aksiyonları + Telegram reply → Hasta mesajı
// ==========================================

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { message, callback_query } = body;
    const botToken = process.env.TELEGRAM_BOT_TOKEN;
    
    if (!botToken) {
      return NextResponse.json({ error: "TELEGRAM_BOT_TOKEN not configured" }, { status: 500 });
    }

    const sql = neon(process.env.DATABASE_URL!);

    // 1. BUTON TIKLAMALARI (CRM Callback)
    if (callback_query) {
      const data = callback_query.data;
      const chatId = callback_query.message.chat.id;
      const messageId = callback_query.message.message_id;
      const callbackId = callback_query.id;
      const userFirstName = callback_query.from.first_name || "Danışman";

      if (data?.startsWith("crm_")) {
        const parts = data.split("_");
        const action = parts[1];
        const phone = parts.slice(2).join("_");
        const cleanP = phone.replace(/\D/g, "");
        const searchP = cleanP.length > 10 ? cleanP.substring(cleanP.length - 10) : cleanP;
        const likePattern = `%${searchP}%`;

        let newStage = "";
        let newStatus = "active";
        let feedbackMsg = "";
        let telegramAlertText = callback_query.message.text;
        let statusBadge = "";

        // 📞 ARADIM - ULAŞTIM
        if (action === "contacted") {
          feedbackMsg = "✅ Görüşme kaydedildi! Sonucu seçin.";
          statusBadge = `📞 Arandı - Ulaşıldı (${userFirstName})`;

          const conv = await sql`SELECT notes FROM conversations WHERE phone_number LIKE ${likePattern} LIMIT 1`;
          const oldNotes = conv[0]?.notes || "";
          const ts = new Date().toLocaleTimeString("tr-TR", { timeZone: "Europe/Istanbul", hour: "2-digit", minute: "2-digit" });
          const newNote = `[SİSTEM - ${userFirstName} - ${ts}]: 📞 Arandı ve ulaşıldı. Sonuç bekleniyor.`;
          await sql`UPDATE conversations SET notes = ${oldNotes ? oldNotes + "\n" + newNote : newNote}, updated_at = NOW() WHERE phone_number LIKE ${likePattern}`;

          await answerCallback(botToken, callbackId, feedbackMsg);
          await editMessage(botToken, chatId, messageId,
            `${telegramAlertText}\n\n━━━━━━━━━━━━━━\n${statusBadge}\n\n❓ Görüşme sonucu nedir?`,
            [
              [
                { text: "📅 Randevu Verildi", callback_data: `crm_appoint_${phone}` },
                { text: "💬 Düşünecek", callback_data: `crm_thinking_${phone}` },
              ],
              [
                { text: "🔄 Tekrar Aranacak", callback_data: `crm_recall_${phone}` },
                { text: "❌ İlgilenmiyor", callback_data: `crm_lost_${phone}` },
              ],
            ]
          );
          return NextResponse.json({ ok: true });
        }

        // ✅ Randevu Verildi
        if (action === "appoint") {
          newStage = "appointed"; newStatus = "closed";
          feedbackMsg = "✅ CRM Güncellendi: Randevu Verildi!";
          statusBadge = `✅ Randevu Verildi (${userFirstName})`;
        }
        // 💬 Düşünecek
        else if (action === "thinking") {
          newStage = "negotiation"; newStatus = "active";
          feedbackMsg = "💬 CRM Güncellendi: Hasta düşünecek. 24 saat sonra otomatik takip.";
          statusBadge = `💬 Düşünecek — 24s Takip Kuruldu (${userFirstName})`;
          await sql`UPDATE conversations SET follow_up_count = 0, last_follow_up_at = NULL, last_message_at = NOW() WHERE phone_number LIKE ${likePattern}`;
        }
        // 🔄 Tekrar Aranacak
        else if (action === "recall") {
          newStage = "hot_lead";
          feedbackMsg = "🔄 CRM Güncellendi: Tekrar aranacak!";
          statusBadge = `🔄 Tekrar Aranacak (${userFirstName})`;
        }
        // 📞 Ulaşılamadı
        else if (action === "callmiss") {
          newStage = "hot_lead";
          const conv = await sql`SELECT notes FROM conversations WHERE phone_number LIKE ${likePattern} LIMIT 1`;
          const oldNotes = conv[0]?.notes || "";
          const missCount = (oldNotes.match(/ulaşılamadı/gi) || []).length + 1;

          if (missCount >= 3) {
            newStatus = "active";
            feedbackMsg = `📞 3. kez ulaşılamadı! Sistem aktif beklemeye alındı.`;
            statusBadge = `📞 3x Ulaşılamadı (${userFirstName})`;
          } else {
            feedbackMsg = `📞 ${missCount}. arama — Ulaşılamadı. ${3 - missCount} deneme kaldı.`;
            statusBadge = `📞 ${missCount}/3 Ulaşılamadı (${userFirstName})`;
          }
        }
        // ❌ İlgilenmiyor
        else if (action === "lost") {
          newStage = "lost"; newStatus = "closed";
          feedbackMsg = "❌ CRM Güncellendi: İptal / Kayıp!";
          statusBadge = `❌ İptal / İlgilenmiyor (${userFirstName})`;
        }

        // DB güncelle
        if (newStage) {
          await sql`UPDATE leads SET stage = ${newStage} WHERE phone_number LIKE ${likePattern}`;
          await sql`UPDATE conversations SET lead_stage = ${newStage}, status = ${newStatus} WHERE phone_number LIKE ${likePattern}`;

          if (action !== "contacted") {
            const conv = await sql`SELECT notes FROM conversations WHERE phone_number LIKE ${likePattern} LIMIT 1`;
            const oldNotes = conv[0]?.notes || "";
            const noteMap: Record<string, string> = {
              callmiss: "☎️ Arandı ama ulaşılamadı.",
              recall: "🔄 Tekrar aranacak olarak işaretlendi.",
              appoint: "✅ Randevu oluşturuldu.",
              thinking: "💬 Hasta düşünecek. 24 saat sonra otomatik takip.",
              lost: "❌ Hasta iptal etti / ilgilenmiyor.",
            };
            const systemNote = noteMap[action] || "";
            const ts = new Date().toLocaleTimeString("tr-TR", { timeZone: "Europe/Istanbul", hour: "2-digit", minute: "2-digit" });
            const newNote = `[SİSTEM - ${userFirstName} - ${ts}]: ${systemNote}`;
            await sql`UPDATE conversations SET notes = ${oldNotes ? oldNotes + "\n" + newNote : newNote}, updated_at = NOW() WHERE phone_number LIKE ${likePattern}`;
          }

          await answerCallback(botToken, callbackId, feedbackMsg);
          await editMessage(botToken, chatId, messageId,
            `${telegramAlertText}\n\n━━━━━━━━━━━━━━\n${statusBadge}`,
            []
          );
        }
      }
    }

    // 2. REPLY → Hastaya mesaj gönder + CRM'e not
    if (message?.reply_to_message) {
      const replyText = message.text;
      const originalText = message.reply_to_message.text;
      const userFirstName = message.from.first_name || "Danışman";

      const phoneMatch = originalText.match(/Tel:\s*(\d+)/);
      if (phoneMatch?.[1]) {
        const phone = phoneMatch[1];
        const cleanP = phone.replace(/\D/g, "");
        const searchP = cleanP.length > 10 ? cleanP.substring(cleanP.length - 10) : cleanP;
        const likePattern = `%${searchP}%`;

        const conv = await sql`SELECT notes, last_channel, tenant_id FROM conversations WHERE phone_number LIKE ${likePattern} LIMIT 1`;
        if (conv.length > 0) {
          const oldNotes = conv[0].notes || "";
          const targetChannel = conv[0].last_channel || "whatsapp";
          const convTenantId = conv[0].tenant_id;
          const ts = new Date().toLocaleTimeString("tr-TR", { timeZone: "Europe/Istanbul", hour: "2-digit", minute: "2-digit" });
          const newNote = `[${userFirstName} - ${ts}]: ${replyText}`;
          await sql`UPDATE conversations SET notes = ${oldNotes ? oldNotes + "\n" + newNote : newNote}, updated_at = NOW() WHERE phone_number LIKE ${likePattern}`;

          let sentToPatient = false;
          try {
            if (targetChannel === "whatsapp" || phone.match(/^9\d{10,}/)) {
              // Tenant'ın kendi token'ını DB'den çek
              let META: string | null = null;
              let PHONE_ID: string | null = null;
              if (convTenantId) {
                const tenantRows = await sql`SELECT meta_page_token, whatsapp_phone_id FROM tenants WHERE id = ${convTenantId}`;
                if (tenantRows.length > 0) {
                  META = tenantRows[0].meta_page_token || process.env.META_ACCESS_TOKEN;
                  PHONE_ID = tenantRows[0].whatsapp_phone_id || process.env.PHONE_NUMBER_ID;
                }
              }
              if (!META) META = process.env.META_ACCESS_TOKEN || null;
              if (!PHONE_ID) PHONE_ID = process.env.PHONE_NUMBER_ID || null;

              if (META && PHONE_ID) {
                await fetch(`https://graph.facebook.com/v25.0/${PHONE_ID}/messages`, {
                  method: "POST",
                  headers: { Authorization: `Bearer ${META}`, "Content-Type": "application/json" },
                  body: JSON.stringify({ messaging_product: "whatsapp", to: phone, type: "text", text: { body: replyText } }),
                });
                await sql`INSERT INTO messages (tenant_id, phone_number, direction, content, model_used, channel) VALUES (${convTenantId}, ${phone}, 'out', ${replyText}, 'human-telegram', 'whatsapp')`;
                sentToPatient = true;
              }
            }
          } catch (e: any) {
            console.error("Telegram→Hasta hata:", e.message);
          }

          // Danışmana onay mesajı
          const confirmMsg = sentToPatient
            ? `✅ Mesaj hastaya ${targetChannel.toUpperCase()} üzerinden iletildi + CRM'e not eklendi`
            : `📝 CRM'e Not Eklendi (Mesaj hastaya iletilemedi)`;
          await sendTelegramMessage(botToken, message.chat.id, confirmMsg, message.message_id);
        }
      }
    }

    return NextResponse.json({ ok: true });
  } catch (e: any) {
    console.error("Telegram Webhook Error:", e);
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

// Helper fonksiyonlar
async function answerCallback(token: string, callbackId: string, text: string) {
  try {
    await fetch(`https://api.telegram.org/bot${token}/answerCallbackQuery`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ callback_query_id: callbackId, text, show_alert: false }),
    });
  } catch {}
}

async function editMessage(token: string, chatId: number, messageId: number, text: string, keyboard: any[]) {
  try {
    await fetch(`https://api.telegram.org/bot${token}/editMessageText`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        message_id: messageId,
        text,
        reply_markup: { inline_keyboard: keyboard },
      }),
    });
  } catch {}
}

async function sendTelegramMessage(token: string, chatId: number, text: string, replyTo?: number) {
  try {
    await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text, ...(replyTo ? { reply_to_message_id: replyTo } : {}) }),
    });
  } catch {}
}
