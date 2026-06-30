import { NextRequest, NextResponse } from 'next/server';
import { withTenantDB } from '@/lib/core/tenant-db';
import { logger } from '@/lib/core/logger';
import { ingestSheetRow, updateSheetsHealthStatus } from '@/lib/services/sheets-ingestion.service';
import crypto from 'crypto';

const log = logger.withContext({ module: 'SheetsWebhook' });

// ═══════════════════════════════════════════════════════════
// HMAC VERIFICATION
// ═══════════════════════════════════════════════════════════

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
    // ── 0. Read raw body for HMAC verification ──
    const rawBody = await request.text();
    let body: any;
    try {
      body = JSON.parse(rawBody);
    } catch {
      return NextResponse.json({ success: false, error: 'Invalid JSON' }, { status: 400 });
    }

    // ── 1. Tenant Resolution ──
    const tenantSlug = request.nextUrl.searchParams.get('tenant') || body.tenant_slug;
    const systemDb = withTenantDB('admin-system', true);
    
    let tenantId: string | null = null;
    let tenantName: string | null = null;
    
    if (tenantSlug) {
      const tenants = await systemDb.executeSafe({
        text: `SELECT id, name FROM tenants WHERE slug = $1 AND status = 'active'`,
        values: [tenantSlug]
      }) as any[];
      if (tenants && tenants.length > 0) {
        tenantId = tenants[0].id;
        tenantName = tenants[0].name;
      }
    }
    if (!tenantId) {
      log.warn('[WEBHOOK_NO_TENANT] Explicit tenant resolution failed', { tenantSlug });
      return NextResponse.json(
        { success: false, error: 'Tenant information missing or inactive, webhook rejected. No fallback applied.' },
        { status: 400 }
      );
    }

    const db = withTenantDB(tenantId);

    // ── 2. Load Tenant-Specific Webhook Secret ──
    let tenantSecret: string | null = null;
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
      log.warn('[WEBHOOK_SECRET_RESOLVE_FAIL] Failed to resolve tenant secret', { tenantId });
    }

    // ── 3. HMAC Authentication ──
    const globalSecret = process.env.SHEETS_WEBHOOK_SECRET;
    const signature = request.headers.get('x-sheets-signature');
    const timestamp = request.headers.get('x-sheets-timestamp');

    if (tenantSecret || globalSecret) {
      if (!signature || !timestamp) {
        log.warn('[WEBHOOK_AUTH_MISSING] Missing auth headers');
        return NextResponse.json({ error: 'Missing auth headers' }, { status: 401 });
      }

      // Replay protection: ±5 minutes
      const now = Math.floor(Date.now() / 1000);
      const ts = parseInt(timestamp);
      if (isNaN(ts) || Math.abs(now - ts) > 300) {
        log.warn('[WEBHOOK_REPLAY] Timestamp expired', { now, ts, diff: Math.abs(now - ts) });
        return NextResponse.json({ error: 'Timestamp expired' }, { status: 401 });
      }

      let isVerified = false;

      if (tenantSecret) {
        // Strict mode: If tenant secret exists, verify ONLY with it. No global fallback allowed.
        isVerified = verifyHmac(tenantSecret, timestamp, rawBody, signature);
        if (!isVerified) {
          log.warn('[WEBHOOK_AUTH_FAIL] Invalid signature against strict tenant secret');
          return NextResponse.json({ error: 'Invalid signature' }, { status: 401 });
        }
      } else if (globalSecret) {
        // Fallback mode: If no tenant secret, try global secret(s)
        const secretList = globalSecret.split(',').map(s => s.trim()).filter(s => s.length > 0);
        if (secretList.length === 0) {
          log.warn('[WEBHOOK_EMPTY_SECRETS] SHEETS_WEBHOOK_SECRET contains no valid keys');
          return NextResponse.json({ error: 'Invalid webhook configuration' }, { status: 500 });
        }
        for (const currentSecret of secretList) {
          if (verifyHmac(currentSecret, timestamp, rawBody, signature)) {
            isVerified = true;
            break;
          }
        }
        if (!isVerified) {
          log.warn('[WEBHOOK_AUTH_FAIL] Invalid signature against global fallback secrets');
          return NextResponse.json({ error: 'Invalid signature' }, { status: 401 });
        }
      }
    } else {
      // Auth-less fallback — migration period only
      log.warn('[WEBHOOK_NO_SECRET] Neither tenant nor global webhook secret set — accepting unverified request');
    }

    // ── 4. Parse payload: support both old {data:{}} and new {headers:[], values:[]} ──
    const { sheetName, sheet_name } = body;
    const effectiveSheetName = sheetName || sheet_name || 'Google Sheets';

    let rowData = body.data;

    // New App Script format: headers[] + values[] → key-value map
    if (!rowData && body.headers && body.values) {
      rowData = {};
      (body.headers as string[]).forEach((h: string, i: number) => {
        rowData[h] = (body.values as string[])[i] || '';
      });
    }

    // ── 4. Pipeline Config Resolution ──
    let activeSheets: string[] = [];
    let greetingGroupId: string | null = null;
    let outboundChannelId: string | null = null;

    try {
      const pipeRes = await db.executeSafe({
        text: `SELECT config, greeting_group_id, outbound_channel_id FROM ingestion_pipelines WHERE tenant_id = $1 AND provider = 'google_sheets' LIMIT 1`,
        values: [tenantId]
      }) as any[];
      if (pipeRes && pipeRes.length > 0) {
        const cfg = typeof pipeRes[0].config === 'string' ? JSON.parse(pipeRes[0].config) : pipeRes[0].config;
        activeSheets = cfg?.activeSheets || [];
        greetingGroupId = pipeRes[0].greeting_group_id || null;
        outboundChannelId = pipeRes[0].outbound_channel_id || null;
      }
    } catch (e) {}

    // ── 5. Sheet Filter ──
    if (!effectiveSheetName || !activeSheets.includes(effectiveSheetName)) {
      log.warn('[WEBHOOK_SKIP_DISALLOWED_TAB] Sheet tab is not in activeSheets config', { effectiveSheetName, activeSheets });
      return NextResponse.json({ success: true, message: `Sheet '${effectiveSheetName}' is ignored by configuration.` });
    }

    if (!rowData) {
      return NextResponse.json({ success: false, error: 'No data provided' }, { status: 400 });
    }

    // ── 6. Delegate to Shared Ingestion Service ──
    log.info('[WEBHOOK_INGEST]', { tenantId, sheetName: effectiveSheetName, source: 'webhook' });

    const result = await ingestSheetRow({
      tenantId,
      tenantName: tenantName || undefined,
      sheetName: effectiveSheetName,
      data: rowData,
      outboundChannelId,
      greetingGroupId,
      // Live webhook: send the approved WhatsApp greeting template automatically.
      // Batch/cron sync paths remain skipAutoMessage=true to avoid sending old leads.
      skipAutoMessage: false,
      source: 'webhook'
    });

    log.info('[WEBHOOK_RESULT]', { status: result.status, leadId: result.leadId, messageSent: result.messageSent });

    // ── 7. Health status update ──
    await updateSheetsHealthStatus(
      tenantId,
      result.status === 'error' ? 'warning' : 'healthy',
      'webhook',
      {
        created: result.status === 'created' ? 1 : 0,
        duplicates: result.status === 'duplicate' ? 1 : 0,
        errors: result.status === 'error' ? 1 : 0,
        errorMessage: result.error
      }
    );

    // Auth-less health warning
    if (!tenantSecret && !globalSecret) {
      await updateSheetsHealthStatus(tenantId, 'warning', 'webhook', {
        created: 0, duplicates: 0, errors: 0,
        errorMessage: 'SHEETS_WEBHOOK_SECRET not configured — webhook is unprotected'
      });
    }

    if (result.status === 'error') {
      return NextResponse.json({ success: false, error: result.error }, { status: 400 });
    }

    return NextResponse.json({
      success: true,
      message: result.status === 'created'
        ? 'New lead inserted successfully. Auto-bot triggered.'
        : 'Lead already exists, note updated if available.',
      ...result
    });

  } catch (error: any) {
    log.error('Sheets Webhook Error', error instanceof Error ? error : new Error(String(error)));
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
