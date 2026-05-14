import { neon } from "@neondatabase/serverless";

// ==========================================
// QUBA AI — Message Retry Utility
// Başarısız mesaj gönderimlerini kuyruğa alır
// ve exponential backoff ile tekrar dener
// ==========================================

const DATABASE_URL = process.env.DATABASE_URL!;

/**
 * Başarısız mesajı retry kuyruğuna ekle
 */
export async function enqueueRetry(params: {
  tenantId: string;
  phoneNumber: string;
  channel: string;
  content: string;
  error: string;
}) {
  try {
    const sql = neon(DATABASE_URL);
    await sql`
      INSERT INTO message_retry_queue (tenant_id, phone_number, channel, content, last_error, next_retry_at)
      VALUES (${params.tenantId}, ${params.phoneNumber}, ${params.channel}, ${params.content}, ${params.error}, NOW() + INTERVAL '2 minutes')
    `;
  } catch (e: any) {
    console.error("[RETRY] Kuyruğa eklenemedi:", e.message);
  }
}

/**
 * Bekleyen retry'ları işle — cron job tarafından çağrılır
 * Her çağrıda max 10 mesaj işler (Vercel timeout koruması)
 */
export async function processRetryQueue(): Promise<{ processed: number; failed: number; skipped: number }> {
  const sql = neon(DATABASE_URL);
  const stats = { processed: 0, failed: 0, skipped: 0 };

  try {
    // Bekleyen mesajları al (max 10)
    const pending = await sql`
      SELECT q.*, t.meta_page_token, t.whatsapp_phone_id
      FROM message_retry_queue q
      JOIN tenants t ON t.id = q.tenant_id
      WHERE q.status = 'pending' AND q.next_retry_at <= NOW()
      ORDER BY q.next_retry_at ASC
      LIMIT 10
    `;

    for (const msg of pending) {
      try {
        if (msg.channel === "whatsapp") {
          const token = msg.meta_page_token || process.env.META_ACCESS_TOKEN;
          const phoneId = msg.whatsapp_phone_id || process.env.PHONE_NUMBER_ID;

          if (!token || !phoneId) {
            await markFailed(sql, msg.id, "Token/PhoneID eksik");
            stats.failed++;
            continue;
          }

          const response = await fetch(`https://graph.facebook.com/v25.0/${phoneId}/messages`, {
            method: "POST",
            headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
            body: JSON.stringify({
              messaging_product: "whatsapp",
              to: msg.phone_number,
              type: "text",
              text: { body: msg.content },
            }),
          });

          if (response.ok) {
            // Başarılı — kuyruğu temizle ve messages tablosuna kaydet
            await sql`UPDATE message_retry_queue SET status = 'sent' WHERE id = ${msg.id}`;
            await sql`INSERT INTO messages (tenant_id, phone_number, direction, content, channel, model_used) VALUES (${msg.tenant_id}, ${msg.phone_number}, 'out', ${msg.content}, 'whatsapp', 'retry')`;
            stats.processed++;
          } else {
            const err = await response.text();
            await handleRetryFailure(sql, msg, err);
            stats.failed++;
          }
        } else {
          // Instagram/Messenger retry — gelecekte eklenecek
          stats.skipped++;
        }
      } catch (e: any) {
        await handleRetryFailure(sql, msg, e.message);
        stats.failed++;
      }
    }
  } catch (e: any) {
    console.error("[RETRY] Queue processing hatası:", e.message);
  }

  return stats;
}

/**
 * Retry başarısız — attempt sayısını artır, exponential backoff uygula
 */
async function handleRetryFailure(sql: any, msg: any, error: string) {
  const newAttempt = (msg.attempt_count || 0) + 1;

  if (newAttempt >= msg.max_attempts) {
    // Max deneme aşıldı → kalıcı başarısızlık
    await sql`
      UPDATE message_retry_queue 
      SET status = 'failed', attempt_count = ${newAttempt}, last_error = ${error}
      WHERE id = ${msg.id}
    `;
  } else {
    // Exponential backoff: 2^attempt dakika (2, 4, 8 dk)
    const delayMinutes = Math.pow(2, newAttempt);
    await sql`
      UPDATE message_retry_queue 
      SET attempt_count = ${newAttempt}, last_error = ${error},
          next_retry_at = NOW() + ${delayMinutes + ' minutes'}::interval
      WHERE id = ${msg.id}
    `;
  }
}

async function markFailed(sql: any, id: string, error: string) {
  await sql`UPDATE message_retry_queue SET status = 'failed', last_error = ${error} WHERE id = ${id}`;
}
