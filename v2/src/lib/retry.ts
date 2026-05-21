import { logger } from "@/lib/core/logger";
import { CredentialsService } from "@/lib/services/credentials.service";
import { withTenantDB } from "@/lib/core/tenant-db";

const log = logger.withContext({ module: 'RetryQueue' });

// ==========================================
// QUBA AI — Message Retry Utility
// Başarısız mesaj gönderimlerini kuyruğa alır
// ve exponential backoff ile tekrar dener
// ==========================================

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
    const db = withTenantDB(params.tenantId);
    await db.executeSafe({
      text: `
        INSERT INTO message_retry_queue (tenant_id, phone_number, channel, content, last_error, next_retry_at)
        VALUES ($1, $2, $3, $4, $5, NOW() + INTERVAL '2 minutes')
      `,
      values: [params.tenantId, params.phoneNumber, params.channel, params.content, params.error]
    });
  } catch (e: any) {
    log.error("Retry kuyruğa eklenemedi", e instanceof Error ? e : new Error(String(e)));
  }
}

/**
 * Bekleyen retry'ları işle — cron job tarafından çağrılır
 * Her çağrıda max 10 mesaj işler (Vercel timeout koruması)
 */
export async function processRetryQueue(): Promise<{ processed: number; failed: number; skipped: number }> {
  const stats = { processed: 0, failed: 0, skipped: 0 };

  try {
    // Bekleyen mesajları al (max 10) - platform/admin context
    const adminDb = withTenantDB('admin-system', true);
    const pending = await adminDb.executeSafe({
      text: `
        SELECT id, tenant_id, phone_number, channel, content, attempt_count, max_attempts, last_error
        FROM message_retry_queue
        WHERE status = 'pending' AND next_retry_at <= NOW()
        ORDER BY next_retry_at ASC
        LIMIT 10
      `
    }) as any[];

    for (const msg of pending) {
      try {
        const tenantDb = withTenantDB(msg.tenant_id);

        if (msg.channel === "whatsapp") {
          const creds = await CredentialsService.resolveCredentials(msg.tenant_id, "whatsapp");
          const token = creds.accessToken;
          const phoneId = creds.whatsappPhoneNumberId;

          log.info(`[CREDENTIAL_SOURCE] Retry WhatsApp`, { tenantId: msg.tenant_id, source: creds.source, hasToken: !!token, hasPhoneId: !!phoneId });

          if (!token || !phoneId) {
            log.error(`[CREDENTIAL_MISSING] Retry failed — no WhatsApp credentials`, undefined, { tenantId: msg.tenant_id, source: creds.source });
            await markFailed(tenantDb, msg.id, "CREDENTIAL_MISSING: WhatsApp token/PhoneID not found");
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
            await tenantDb.executeSafe({
              text: "UPDATE message_retry_queue SET status = 'sent' WHERE id = $1",
              values: [msg.id]
            });
            await tenantDb.executeSafe({
              text: "INSERT INTO messages (tenant_id, phone_number, direction, content, channel) VALUES ($1, $2, 'out', $3, 'whatsapp')",
              values: [msg.tenant_id, msg.phone_number, msg.content]
            });
            stats.processed++;
          } else {
            const err = await response.text();
            await handleRetryFailure(tenantDb, msg, err);
            stats.failed++;
          }
        } else if (msg.channel === "instagram") {
          const creds = await CredentialsService.resolveCredentials(msg.tenant_id, "instagram");
          const token = creds.accessToken;

          log.info(`[CREDENTIAL_SOURCE] Retry Instagram`, { tenantId: msg.tenant_id, source: creds.source, hasToken: !!token });

          if (!token) {
            log.error(`[CREDENTIAL_MISSING] Retry failed — no Instagram credentials`, undefined, { tenantId: msg.tenant_id, source: creds.source });
            await markFailed(tenantDb, msg.id, "CREDENTIAL_MISSING: Instagram token not found");
            stats.failed++;
            continue;
          }

          const response = await fetch(`https://graph.instagram.com/v25.0/me/messages`, {
            method: "POST",
            headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
            body: JSON.stringify({ recipient: { id: msg.phone_number }, message: { text: msg.content } }),
          });

          if (response.ok) {
            await tenantDb.executeSafe({
              text: "UPDATE message_retry_queue SET status = 'sent' WHERE id = $1",
              values: [msg.id]
            });
            await tenantDb.executeSafe({
              text: "INSERT INTO messages (tenant_id, phone_number, direction, content, channel) VALUES ($1, $2, 'out', $3, 'instagram')",
              values: [msg.tenant_id, msg.phone_number, msg.content]
            });
            stats.processed++;
          } else {
            const err = await response.text();
            await handleRetryFailure(tenantDb, msg, err);
            stats.failed++;
          }
        } else if (msg.channel === "messenger") {
          const creds = await CredentialsService.resolveCredentials(msg.tenant_id, "messenger");
          const token = creds.accessToken;

          log.info(`[CREDENTIAL_SOURCE] Retry Messenger`, { tenantId: msg.tenant_id, source: creds.source, hasToken: !!token });

          if (!token) {
            log.error(`[CREDENTIAL_MISSING] Retry failed — no Messenger credentials`, undefined, { tenantId: msg.tenant_id, source: creds.source });
            await markFailed(tenantDb, msg.id, "CREDENTIAL_MISSING: Messenger page token not found");
            stats.failed++;
            continue;
          }

          const response = await fetch(`https://graph.facebook.com/v25.0/me/messages?access_token=${token}`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ recipient: { id: msg.phone_number }, message: { text: msg.content } }),
          });

          if (response.ok) {
            await tenantDb.executeSafe({
              text: "UPDATE message_retry_queue SET status = 'sent' WHERE id = $1",
              values: [msg.id]
            });
            await tenantDb.executeSafe({
              text: "INSERT INTO messages (tenant_id, phone_number, direction, content, channel) VALUES ($1, $2, 'out', $3, 'messenger')",
              values: [msg.tenant_id, msg.phone_number, msg.content]
            });
            stats.processed++;
          } else {
            const err = await response.text();
            await handleRetryFailure(tenantDb, msg, err);
            stats.failed++;
          }
        } else {
          stats.skipped++;
        }
      } catch (e: any) {
        const tenantDb = withTenantDB(msg.tenant_id);
        await handleRetryFailure(tenantDb, msg, e.message);
        stats.failed++;
      }
    }
  } catch (e: any) {
    log.error("Retry queue processing hatası", e instanceof Error ? e : new Error(String(e)));
  }

  return stats;
}

/**
 * Retry başarısız — attempt sayısını artır, exponential backoff uygula
 */
async function handleRetryFailure(db: any, msg: any, error: string) {
  const newAttempt = (msg.attempt_count || 0) + 1;

  if (newAttempt >= msg.max_attempts) {
    // Max deneme aşıldı → kalıcı başarısızlık
    await db.executeSafe({
      text: `
        UPDATE message_retry_queue 
        SET status = 'failed', attempt_count = $1, last_error = $2
        WHERE id = $3
      `,
      values: [newAttempt, error, msg.id]
    });
  } else {
    // Exponential backoff: 2^attempt dakika (2, 4, 8 dk)
    const delayMinutes = Math.pow(2, newAttempt);
    await db.executeSafe({
      text: `
        UPDATE message_retry_queue 
        SET attempt_count = $1, last_error = $2,
            next_retry_at = NOW() + $3::interval
        WHERE id = $4
      `,
      values: [newAttempt, error, `${delayMinutes} minutes`, msg.id]
    });
  }
}

async function markFailed(db: any, id: string, error: string) {
  await db.executeSafe({
    text: "UPDATE message_retry_queue SET status = 'failed', last_error = $1 WHERE id = $2",
    values: [error, id]
  });
}
