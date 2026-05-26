import { NextRequest, NextResponse } from 'next/server';
import { withTenantDB } from '@/lib/core/tenant-db';
import { logger } from '@/lib/core/logger';
import { ingestSheetBatch, updateSheetsHealthStatus } from '@/lib/services/sheets-ingestion.service';
import { CredentialsService } from '@/lib/services/credentials.service';
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
  try {
    const rawBody = await request.text();

    // ── 1. Authentication: Bearer OR HMAC ──
    const authHeader = request.headers.get('authorization');
    const sheetsSignature = request.headers.get('x-sheets-signature');
    const sheetsTimestamp = request.headers.get('x-sheets-timestamp');
    const cronSecret = process.env.CRON_SECRET;
    const webhookSecret = process.env.SHEETS_WEBHOOK_SECRET;

    const isCronAuth = cronSecret && authHeader === `Bearer ${cronSecret}`;
    let isHmacAuth = false;

    if (webhookSecret && sheetsSignature && sheetsTimestamp) {
      const now = Math.floor(Date.now() / 1000);
      const ts = parseInt(sheetsTimestamp);
      if (!isNaN(ts) && Math.abs(now - ts) <= 300) {
        isHmacAuth = verifyHmac(webhookSecret, sheetsTimestamp, rawBody, sheetsSignature);
      }
    }

    if (!isCronAuth && !isHmacAuth) {
      if (cronSecret || webhookSecret) {
        log.warn('[CRON_SYNC_AUTH_FAIL] Unauthorized request');
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
      }
      // No secrets configured — development fallback
      log.warn('[CRON_SYNC_NO_AUTH] No auth secrets configured');
    }

    // ── 2. Tenant resolution ──
    const tenantSlug = request.nextUrl.searchParams.get('tenant');
    const systemDb = withTenantDB('admin-system', true);

    // If tenant slug provided, sync that one tenant
    // Otherwise, sync all active tenants with google_sheets integration
    let tenants: { id: string; name: string }[] = [];

    if (tenantSlug) {
      const res = await systemDb.executeSafe({
        text: `SELECT id, name FROM tenants WHERE slug = $1 AND status = 'active'`,
        values: [tenantSlug]
      }) as any[];
      tenants = res || [];
    } else {
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
  }
}
