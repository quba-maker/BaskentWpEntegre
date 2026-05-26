import { NextRequest, NextResponse } from "next/server";
import { withTenantDB } from "@/lib/core/tenant-db";
import { logger } from "@/lib/core/logger";

const log = logger.withContext({ module: 'TelegramWebhook' });

// ==========================================
// QUBA AI — Telegram Webhook (Native Next.js)
// P1 Hardened: Patient messaging blocked, V1 callbacks disabled
// ==========================================

/**
 * Feature flags for P1 safety
 */
const ENABLE_TELEGRAM_PATIENT_MESSAGING = process.env.ENABLE_TELEGRAM_PATIENT_MESSAGING === 'true'; // P2 only
const ENABLE_V1_TELEGRAM_CALLBACKS = process.env.ENABLE_V1_TELEGRAM_CALLBACKS === 'true'; // P1.1 refactor needed

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { message, callback_query } = body;
    const botToken = process.env.TELEGRAM_BOT_TOKEN;
    
    if (!botToken) {
      return NextResponse.json({ error: "TELEGRAM_BOT_TOKEN not configured" }, { status: 500 });
    }

    const systemDb = withTenantDB('admin-system', true);

    // 1. BUTON TIKLAMALARI (CRM Callback)
    if (callback_query) {
      const data = callback_query.data;
      const chatId = callback_query.message.chat.id;
      const callbackId = callback_query.id;

      if (data?.startsWith("crm_")) {
        // ══════════════════════════════════════════════
        // P1 SAFETY: V1 callbacks are DISABLED by default
        // These callbacks bypass UnifiedStageService and can
        // desync opportunity.stage. Refactor → P1.1 scope.
        // ══════════════════════════════════════════════
        if (!ENABLE_V1_TELEGRAM_CALLBACKS) {
          log.warn('[TELEGRAM_V1_CALLBACK_BLOCKED] V1 callback action blocked by feature flag', {
            action: data,
            user: callback_query.from?.first_name || 'unknown',
          });

          await answerCallback(botToken, callbackId, 
            "⚠️ Bu Telegram aksiyonu geçici olarak devre dışı. Lütfen panelden işlem yapın."
          );
          
          // Update the message to show it's disabled
          try {
            await editMessage(botToken, chatId, callback_query.message.message_id,
              `${callback_query.message.text}\n\n━━━━━━━━━━━━━━\n⚠️ Telegram buton aksiyonları geçici olarak devre dışı.\n📌 Lütfen panelden (ai.qubamedya.com) işlem yapın.`,
              []
            );
          } catch {}

          return NextResponse.json({ ok: true, blocked: true });
        }

        // ── LEGACY V1 CALLBACK LOGIC (only if ENABLE_V1_TELEGRAM_CALLBACKS=true) ──
        const parts = data.split("_");
        const action = parts[1];
        const phone = parts.slice(2).join("_");
        const cleanP = phone.replace(/\D/g, "");
        const searchP = cleanP.length > 10 ? cleanP.substring(cleanP.length - 10) : cleanP;
        const likePattern = `%${searchP}%`;

        const convCheck = await systemDb.executeSafe({
          text: `SELECT tenant_id FROM conversations WHERE phone_number LIKE $1 LIMIT 1`,
          values: [likePattern]
        }) as any[];

        if (!convCheck || convCheck.length === 0) {
          log.warn(`[TELEGRAM] Conversation not found for phone: ${phone}`);
          return NextResponse.json({ ok: false, error: "Conversation not found" });
        }

        const tenantId = convCheck[0].tenant_id;
        const db = withTenantDB(tenantId);
        const userFirstName = callback_query.from.first_name || "Danışman";

        let newStage = "";
        let newStatus = "active";
        let feedbackMsg = "";
        let telegramAlertText = callback_query.message.text;
        let statusBadge = "";

        if (action === "contacted") {
          feedbackMsg = "✅ Görüşme kaydedildi! Sonucu seçin.";
          statusBadge = `📞 Arandı - Ulaşıldı (${userFirstName})`;

          const conv = await db.executeSafe({
            text: `SELECT notes FROM conversations WHERE phone_number LIKE $1 LIMIT 1`,
            values: [likePattern]
          }) as any[];
          const oldNotes = conv[0]?.notes || "";
          const ts = new Date().toLocaleTimeString("tr-TR", { timeZone: "Europe/Istanbul", hour: "2-digit", minute: "2-digit" });
          const newNote = `[SİSTEM - ${userFirstName} - ${ts}]: 📞 Arandı ve ulaşıldı. Sonuç bekleniyor.`;
          
          await db.executeSafe({
            text: `UPDATE conversations SET notes = $1, updated_at = NOW() WHERE phone_number LIKE $2`,
            values: [oldNotes ? oldNotes + "\n" + newNote : newNote, likePattern]
          });

          await answerCallback(botToken, callbackId, feedbackMsg);
          await editMessage(botToken, chatId, callback_query.message.message_id,
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

        if (action === "appoint") {
          newStage = "appointed"; newStatus = "closed";
          feedbackMsg = "✅ CRM Güncellendi: Randevu Verildi!";
          statusBadge = `✅ Randevu Verildi (${userFirstName})`;
        } else if (action === "thinking") {
          newStage = "negotiation"; newStatus = "active";
          feedbackMsg = "💬 CRM Güncellendi: Hasta düşünecek. 24 saat sonra otomatik takip.";
          statusBadge = `💬 Düşünecek — 24s Takip Kuruldu (${userFirstName})`;
          
          await db.executeSafe({
            text: `UPDATE conversations SET follow_up_count = 0, last_follow_up_at = NULL, last_message_at = NOW() WHERE phone_number LIKE $1`,
            values: [likePattern]
          });
        } else if (action === "recall") {
          newStage = "hot_lead";
          feedbackMsg = "🔄 CRM Güncellendi: Tekrar aranacak!";
          statusBadge = `🔄 Tekrar Aranacak (${userFirstName})`;
        } else if (action === "callmiss") {
          newStage = "hot_lead";
          const conv = await db.executeSafe({
            text: `SELECT notes FROM conversations WHERE phone_number LIKE $1 LIMIT 1`,
            values: [likePattern]
          }) as any[];
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
        } else if (action === "lost") {
          newStage = "lost"; newStatus = "closed";
          feedbackMsg = "❌ CRM Güncellendi: İptal / Kayıp!";
          statusBadge = `❌ İptal / İlgilenmiyor (${userFirstName})`;
        }

        if (newStage) {
          await db.executeSafe({
            text: `UPDATE leads SET stage = $1 WHERE phone_number LIKE $2`,
            values: [newStage, likePattern]
          });
          await db.executeSafe({
            text: `UPDATE conversations SET lead_stage = $1, status = $2 WHERE phone_number LIKE $3`,
            values: [newStage, newStatus, likePattern]
          });

          if (action !== "contacted") {
            const conv = await db.executeSafe({
              text: `SELECT notes FROM conversations WHERE phone_number LIKE $1 LIMIT 1`,
              values: [likePattern]
            }) as any[];
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
            
            await db.executeSafe({
              text: `UPDATE conversations SET notes = $1, updated_at = NOW() WHERE phone_number LIKE $2`,
              values: [oldNotes ? oldNotes + "\n" + newNote : newNote, likePattern]
            });
          }

          await answerCallback(botToken, callbackId, feedbackMsg);
          await editMessage(botToken, chatId, callback_query.message.message_id,
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

      // ══════════════════════════════════════════════
      // P1 SAFETY: Patient messaging is HARD-BLOCKED
      // ENABLE_TELEGRAM_PATIENT_MESSAGING must be explicitly true.
      // WhatsApp Graph API call is UNREACHABLE when flag is false.
      // ══════════════════════════════════════════════
      if (!ENABLE_TELEGRAM_PATIENT_MESSAGING) {
        log.info('[TELEGRAM_PATIENT_MSG_BLOCKED] Patient messaging blocked by feature flag', {
          user: userFirstName,
          hasReplyText: !!replyText,
        });

        // Still allow CRM note if we can parse the phone
        const phoneMatch = originalText?.match(/Tel:\s*(\d+)/);
        if (phoneMatch?.[1] && replyText) {
          const phone = phoneMatch[1];
          const cleanP = phone.replace(/\D/g, "");
          const searchP = cleanP.length > 10 ? cleanP.substring(cleanP.length - 10) : cleanP;
          const likePattern = `%${searchP}%`;

          const conv = await systemDb.executeSafe({
            text: `SELECT notes, tenant_id FROM conversations WHERE phone_number LIKE $1 LIMIT 1`,
            values: [likePattern]
          }) as any[];

          if (conv && conv.length > 0) {
            const oldNotes = conv[0].notes || "";
            const convTenantId = conv[0].tenant_id;
            const db = withTenantDB(convTenantId);
            const ts = new Date().toLocaleTimeString("tr-TR", { timeZone: "Europe/Istanbul", hour: "2-digit", minute: "2-digit" });
            const newNote = `[${userFirstName} - ${ts}]: ${replyText}`;
            
            await db.executeSafe({
              text: `UPDATE conversations SET notes = $1, updated_at = NOW() WHERE phone_number LIKE $2`,
              values: [oldNotes ? oldNotes + "\n" + newNote : newNote, likePattern]
            });

            await sendTelegramMessage(botToken, message.chat.id,
              `📝 CRM'e Not Eklendi.\n⚠️ Hasta mesajı gönderme bu sürümde devre dışı. Mesaj hastaya iletilmedi.\n📌 Hastaya mesaj göndermek için panelden WhatsApp kullanın.`,
              message.message_id
            );
          }
        }

        return NextResponse.json({ ok: true, patientMsgBlocked: true });
      }

      // ── LEGACY REPLY LOGIC (only if ENABLE_TELEGRAM_PATIENT_MESSAGING=true) ──
      const phoneMatch = originalText?.match(/Tel:\s*(\d+)/);
      if (phoneMatch?.[1]) {
        const phone = phoneMatch[1];
        const cleanP = phone.replace(/\D/g, "");
        const searchP = cleanP.length > 10 ? cleanP.substring(cleanP.length - 10) : cleanP;
        const likePattern = `%${searchP}%`;

        const conv = await systemDb.executeSafe({
          text: `SELECT notes, last_channel, tenant_id FROM conversations WHERE phone_number LIKE $1 LIMIT 1`,
          values: [likePattern]
        }) as any[];

        if (conv && conv.length > 0) {
          const oldNotes = conv[0].notes || "";
          const targetChannel = conv[0].last_channel || "whatsapp";
          const convTenantId = conv[0].tenant_id;
          
          const db = withTenantDB(convTenantId);
          const ts = new Date().toLocaleTimeString("tr-TR", { timeZone: "Europe/Istanbul", hour: "2-digit", minute: "2-digit" });
          const newNote = `[${userFirstName} - ${ts}]: ${replyText}`;
          
          await db.executeSafe({
            text: `UPDATE conversations SET notes = $1, updated_at = NOW() WHERE phone_number LIKE $2`,
            values: [oldNotes ? oldNotes + "\n" + newNote : newNote, likePattern]
          });

          let sentToPatient = false;
          try {
            if (targetChannel === "whatsapp" || phone.match(/^9\d{10,}/)) {
              const { CredentialsService } = await import("@/lib/services/credentials.service");
              let META: string | null = null;
              let PHONE_ID: string | null = null;
              if (convTenantId) {
                const creds = await CredentialsService.resolveCredentials(convTenantId, "whatsapp");
                META = creds.accessToken;
                PHONE_ID = creds.whatsappPhoneNumberId;
              }
              if (!META) META = process.env.META_ACCESS_TOKEN || null;
              if (!PHONE_ID) PHONE_ID = process.env.PHONE_NUMBER_ID || null;

              if (META && PHONE_ID) {
                await fetch(`https://graph.facebook.com/v25.0/${PHONE_ID}/messages`, {
                  method: "POST",
                  headers: { Authorization: `Bearer ${META}`, "Content-Type": "application/json" },
                  body: JSON.stringify({ messaging_product: "whatsapp", to: phone, type: "text", text: { body: replyText } }),
                });
                
                await db.executeSafe({
                  text: `INSERT INTO messages (tenant_id, phone_number, direction, content, channel) VALUES ($1, $2, 'out', $3, 'whatsapp')`,
                  values: [convTenantId, phone, replyText]
                });
                sentToPatient = true;
              }
            }
          } catch (e: any) {
            log.error("Telegram→Hasta hata", e instanceof Error ? e : new Error(String(e)));
          }

          const confirmMsg = sentToPatient
            ? `✅ Mesaj hastaya ${targetChannel.toUpperCase()} üzerinden iletildi + CRM'e not eklendi`
            : `📝 CRM'e Not Eklendi (Mesaj hastaya iletilemedi)`;
          await sendTelegramMessage(botToken, message.chat.id, confirmMsg, message.message_id);
        }
      }
    }

    return NextResponse.json({ ok: true });
  } catch (error: any) {
    log.error("Telegram Webhook Error", error instanceof Error ? error : new Error(String(error)));
    return NextResponse.json({ error: error.message }, { status: 500 });
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
