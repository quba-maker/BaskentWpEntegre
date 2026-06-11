import { NextRequest, NextResponse } from 'next/server';
import { withTenantDB } from '@/lib/core/tenant-db';
import { logger } from '@/lib/core/logger';
import { ingestSheetBatch, updateSheetsHealthStatus } from '@/lib/services/sheets-ingestion.service';
import { CredentialsService } from '@/lib/services/credentials.service';
import { redis } from '@/lib/redis';
import crypto from 'crypto';

const log = logger.withContext({ module: 'CronFormSync' });

/**
 * ═══════════════════════════════════════════════════════
 * Catch-up Form Sync Endpoint
 * ═══════════════════════════════════════════════════════
 * 
 * Tetikleyiciler:
 *   P0:   Admin manual trigger (curl/fetch)
 *   P0.5: App Script time-driven trigger (POST)
 *   P1:   QStash scheduler veya Vercel Pro Cron
 * 
 * NOT: vercel.json'a cron olarak EKLENMEYecek (Hobby plan sınırı).
 * Bu route sadece external tetikleyiciler tarafından çağrılır.
 */

export const dynamic = 'force-dynamic';
export const maxDuration = 60; // Hobby plan max

const SYNC_LOCK_KEY = 'cron:form-sync:lock';
const SYNC_LOCK_TTL = 120; // seconds — auto-expire if process crashes/times out

// ── HMAC Verification (shared with webhook) ──
function verifyHmac(secret: string, timestamp: string, rawBody: string, signature: string): boolean {
  const expectedSig = 'sha256=' + crypto
    .createHmac('sha256', secret)
    .update(timestamp + '.' + rawBody)
    .digest('hex');

  const sigBuf = Buffer.from(signature);
  const expBuf = Buffer.from(expectedSig);

  if (sigBuf.length !== expBuf.length) return false;
  return crypto.timingSafeEqual(sigBuf, expBuf);
}

export async function POST(request: NextRequest) {
  // ── 0. Overlap Guard: prevent concurrent sync runs ──
  let lockAcquired = false;
  if (redis) {
    try {
      const lock = await redis!.set(SYNC_LOCK_KEY, Date.now().toString(), { ex: SYNC_LOCK_TTL, nx: true });
      if (!lock) {
        log.warn('[CRON_SYNC_OVERLAP] Previous sync still running, skipping this run');
        return NextResponse.json({ skipped: true, reason: 'previous_sync_still_running' });
      }
      lockAcquired = true;
    } catch (lockErr) {
      // Redis failure is non-blocking — proceed without lock
      log.warn('[CRON_SYNC_LOCK_ERROR] Redis lock failed, proceeding without guard', { error: (lockErr as any)?.message || String(lockErr) });
    }
  }

  try {
    const rawBody = await request.text();

    // ── 1. Tenant resolution (moved up for provider-aware HMAC validation) ──
    const tenantSlug = request.nextUrl.searchParams.get('tenant');
    const systemDb = withTenantDB('admin-system', true);

    // If tenant slug provided, resolve that one tenant first to get webhook secret
    let tenants: { id: string; name: string }[] = [];

    if (tenantSlug) {
      const res = await systemDb.executeSafe({
        text: `SELECT id, name FROM tenants WHERE slug = $1 AND status = 'active'`,
        values: [tenantSlug]
      }) as any[];
      tenants = res || [];
    }

    // ── 2. Load Tenant-Specific Webhook Secret ──
    let tenantSecret: string | null = null;
    if (tenants.length > 0) {
      const tenantId = tenants[0].id;
      const db = withTenantDB(tenantId);
      try {
        const integration = await db.executeSafe({
          text: `SELECT credentials FROM tenant_integrations WHERE tenant_id = $1 AND provider = 'google_sheets' LIMIT 1`,
          values: [tenantId]
        }) as any[];
        if (integration.length > 0 && integration[0].credentials) {
          const { decryptPayload } = await import('@/lib/core/encryption');
          const creds = typeof integration[0].credentials === 'string'
            ? JSON.parse(integration[0].credentials)
            : integration[0].credentials;
          let decrypted: any = {};
          if (creds.encrypted_payload && creds.version) {
            decrypted = decryptPayload(creds);
          } else {
            decrypted = creds;
          }
          tenantSecret = decrypted.webhookSecret || null;
        }
      } catch (e) {
        log.warn('[CRON_SECRET_RESOLVE_FAIL] Failed to resolve tenant secret', { tenantId });
      }
    }

    // ── 3. Authentication: Bearer OR HMAC ──
    const authHeader = request.headers.get('authorization');
    const sheetsSignature = request.headers.get('x-sheets-signature');
    const sheetsTimestamp = request.headers.get('x-sheets-timestamp');
    const cronSecret = process.env.CRON_SECRET;
    const globalWebhookSecret = process.env.SHEETS_WEBHOOK_SECRET;

    const isCronAuth = cronSecret && authHeader === `Bearer ${cronSecret}`;
    let isHmacAuth = false;

    if (sheetsSignature && sheetsTimestamp && (tenantSecret || globalWebhookSecret)) {
      const now = Math.floor(Date.now() / 1000);
      const ts = parseInt(sheetsTimestamp!);
      if (!isNaN(ts) && Math.abs(now - ts) <= 300) {
        if (tenantSecret) {
          // Strict mode: verify ONLY with tenant secret. No fallback to global.
          isHmacAuth = verifyHmac(tenantSecret, sheetsTimestamp!, rawBody, sheetsSignature!);
        } else if (globalWebhookSecret) {
          // Fallback mode: try global secrets
          const secretList = globalWebhookSecret.split(',').map(s => s.trim()).filter(s => s.length > 0);
          for (const currentSecret of secretList) {
            if (verifyHmac(currentSecret, sheetsTimestamp!, rawBody, sheetsSignature!)) {
              isHmacAuth = true;
              break;
            }
          }
        }
      }
    }

    if (!isCronAuth && !isHmacAuth) {
      if (cronSecret || globalWebhookSecret || tenantSecret) {
        log.warn('[CRON_SYNC_AUTH_FAIL] Unauthorized request');
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
      }
      // No secrets configured — development fallback
      log.warn('[CRON_SYNC_NO_AUTH] No auth secrets configured');
    }

    // If no tenant slug was provided, fetch all active tenants
    if (!tenantSlug) {
      // Sync all tenants with active Google Sheets integration
      const res = await systemDb.executeSafe({
        text: `SELECT t.id, t.name FROM tenants t
               JOIN tenant_integrations ti ON t.id = ti.tenant_id
               WHERE ti.provider = 'google_sheets' AND ti.is_active = true AND t.status = 'active'`,
        values: []
      }) as any[];
      tenants = res || [];
    }

    if (tenants.length === 0) {
      return NextResponse.json({ success: true, message: 'No active tenants with Google Sheets integration found' });
    }

    log.info('[CRON_SYNC_START]', { tenantCount: tenants.length, source: 'cron_sync' });

    // ── 3. Process each tenant ──
    const results: Record<string, any> = {};

    for (const tenant of tenants) {
      try {
        const db = withTenantDB(tenant.id);

        // Load credentials
        const integrations = await db.executeSafe({
          text: `SELECT credentials FROM tenant_integrations WHERE tenant_id = $1 AND provider = 'google_sheets' LIMIT 1`,
          values: [tenant.id]
        }) as any[];

        if (!integrations || integrations.length === 0) {
          results[tenant.name] = { skipped: true, reason: 'No credentials' };
          continue;
        }

        let payload;
        try {
          const { decryptPayload } = await import('@/lib/core/encryption');
          payload = decryptPayload(integrations[0].credentials);
        } catch (e: any) {
          log.error('[CRON_DECRYPT_ERROR]', new Error(e?.message || 'Unknown'));
          results[tenant.name] = { error: 'Decrypt failed' };
          continue;
        }

        const { apiKey, spreadsheetId, activeSheets = [] } = payload;
        if (!apiKey || !spreadsheetId) {
          results[tenant.name] = { skipped: true, reason: 'Missing apiKey or spreadsheetId' };
          continue;
        }

        // Load pipeline routing
        let outboundChannelId: string | null = null;
        let greetingGroupId: string | null = null;

        try {
          const pipeRes = await db.executeSafe({
            text: `SELECT greeting_group_id, outbound_channel_id FROM ingestion_pipelines WHERE tenant_id = $1 AND provider = 'google_sheets' LIMIT 1`,
            values: [tenant.id]
          }) as any[];
          if (pipeRes && pipeRes.length > 0) {
            greetingGroupId = pipeRes[0].greeting_group_id || null;
            outboundChannelId = pipeRes[0].outbound_channel_id || null;
          }
        } catch (_) {}

        // Run batch ingestion
        const result = await ingestSheetBatch({
          tenantId: tenant.id,
          tenantName: tenant.name,
          apiKey,
          spreadsheetId,
          activeSheets,
          outboundChannelId,
          greetingGroupId,
          skipAutoMessage: true, // Cron sync: never send auto-messages
          source: 'cron_sync',
          maxRowsPerRun: 2000,
          timeBudgetMs: 45_000,
        });

        // Update health status (cron_last_run_at)
        await updateSheetsHealthStatus(
          tenant.id,
          result.errors > 0 ? 'warning' : 'healthy',
          'cron_sync',
          { created: result.created, duplicates: result.duplicates, errors: result.errors }
        );

        results[tenant.name] = {
          created: result.created,
          updated: result.updated,
          duplicates: result.duplicates,
          errors: result.errors,
          partial: result.partial,
        };

      } catch (tenantErr: any) {
        log.error('[CRON_TENANT_ERROR]', tenantErr instanceof Error ? tenantErr : new Error(String(tenantErr)));
        results[tenant.name] = { error: tenantErr?.message || 'Unknown error' };

        // Record error in health
        await updateSheetsHealthStatus(tenant.id, 'error', 'cron_sync', {
          created: 0, duplicates: 0, errors: 1,
          errorMessage: tenantErr?.message
        });
      }
    }

    log.info('[CRON_SYNC_DONE]', { results });

    return NextResponse.json({ success: true, results });

  } catch (error: any) {
    log.error('[CRON_SYNC_FATAL]', error instanceof Error ? error : new Error(String(error)));
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  } finally {
    // ── Release overlap lock ──
    if (lockAcquired && redis) {
      try {
        await redis!.del(SYNC_LOCK_KEY);
      } catch (unlockErr) {
        // Non-blocking — TTL will auto-expire the lock
        log.warn('[CRON_SYNC_UNLOCK_ERROR] Failed to release lock, TTL will auto-expire', { error: (unlockErr as any)?.message || String(unlockErr) });
      }
    }
  }
}
