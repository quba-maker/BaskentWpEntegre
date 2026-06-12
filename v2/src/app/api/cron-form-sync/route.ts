import { NextRequest, NextResponse } from 'next/server';
import { withTenantDB } from '@/lib/core/tenant-db';
import { logger } from '@/lib/core/logger';
import { ingestSheetBatch, updateSheetsHealthStatus } from '@/lib/services/sheets-ingestion.service';
import { redis } from '@/lib/redis';
import crypto from 'crypto';

const log = logger.withContext({ module: 'CronFormSync' });

export const dynamic = 'force-dynamic';
export const maxDuration = 60; // Max allowed duration on Vercel Pro/Hobby

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

// ── Token-Based Tenant Lock Helper ──
async function acquireTenantLock(tenantSlug: string, ttl: number = 600): Promise<string | null> {
  if (!redis) return 'dummy-token'; // Local fallback if Redis not active
  try {
    const token = crypto.randomUUID();
    const sanitizedSlug = tenantSlug.replace(/[^a-zA-Z0-9_-]/g, '').toLowerCase();
    const key = `cron:form-sync:lock:${sanitizedSlug}`;
    
    // SET with NX (not exists) and EX (expire in seconds)
    const setSuccess = await redis.set(key, token, { nx: true, ex: ttl });
    if (setSuccess) {
      return token;
    }
    return null;
  } catch (err) {
    log.warn('[LOCK_ACQUIRE_ERROR] Redis lock failed, assuming acquired for safety in dev', { error: String(err) });
    return 'fallback-token'; // Non-blocking fallback
  }
}

async function releaseTenantLock(tenantSlug: string, token: string): Promise<boolean> {
  if (!redis || token === 'dummy-token' || token === 'fallback-token') return true;
  try {
    const sanitizedSlug = tenantSlug.replace(/[^a-zA-Z0-9_-]/g, '').toLowerCase();
    const key = `cron:form-sync:lock:${sanitizedSlug}`;
    
    // Lua script to atomically compare and delete lock key
    const releaseScript = `
      if redis.call("get", KEYS[1]) == ARGV[1] then
        return redis.call("del", KEYS[1])
      else
        return 0
      end
    `;
    const result = await redis.eval(releaseScript, [key], [token]);
    return result === 1;
  } catch (err) {
    log.warn('[LOCK_RELEASE_ERROR] Redis unlock failed', { error: String(err) });
    return false;
  }
}

// ── Unified Request Handler ──
async function handleSyncRequest(request: NextRequest, method: 'GET' | 'POST') {
  const startTime = Date.now();
  
  let rawBody = "";
  let body: any = null;

  if (method === 'POST') {
    try {
      rawBody = await request.text();
      if (rawBody) {
        body = JSON.parse(rawBody);
      }
    } catch (_) {}
  }

  // Get tenant slug from searchParams or POST body
  const tenantSlug = request.nextUrl.searchParams.get('tenant') || body?.tenant_slug;
  const isDryRun = request.nextUrl.searchParams.get('dryRun') === 'true' || body?.dryRun === true || body?.trigger === 'health_ping';

  const systemDb = withTenantDB('admin-system', true);
  let tenants: { id: string; name: string; slug: string }[] = [];

  // 1. Resolve Tenant(s)
  if (tenantSlug) {
    const res = await systemDb.executeSafe({
      text: `SELECT id, name, slug FROM tenants WHERE slug = $1 AND status = 'active'`,
      values: [tenantSlug]
    }) as any[];
    tenants = res || [];
  }

  // 2. Load Tenant-Specific Webhook Secret
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
      log.warn('[CRON_SECRET_RESOLVE_FAIL] Failed to resolve tenant secret', { tenantId, conversationId: 'cron_sync_no_conversation' });
    }
  }

  // 3. Authentication & Authorization checks
  const authHeader = request.headers.get('authorization');
  const cronSecret = process.env.CRON_SECRET;
  const isCronAuth = cronSecret && authHeader === `Bearer ${cronSecret}`;

  if (method === 'GET') {
    // GET: Only Bearer Token Auth allowed
    if (!isCronAuth) {
      log.warn('[CRON_SYNC_AUTH_FAIL] Unauthorized GET request', { tenantId: 'system_scheduler', conversationId: 'cron_sync_no_conversation' });
      return NextResponse.json({ error: 'Unauthorized: GET requires Bearer Token' }, { status: 401 });
    }
  } else {
    // POST:
    const sheetsSignature = request.headers.get('x-sheets-signature');
    const sheetsTimestamp = request.headers.get('x-sheets-timestamp');
    const globalWebhookSecret = process.env.SHEETS_WEBHOOK_SECRET;
    let isHmacAuth = false;

    if (sheetsSignature && sheetsTimestamp && (tenantSecret || globalWebhookSecret)) {
      const now = Math.floor(Date.now() / 1000);
      const ts = parseInt(sheetsTimestamp!);
      // Replay protection: ±5 minutes (300s)
      if (!isNaN(ts) && Math.abs(now - ts) <= 300) {
        if (tenantSecret) {
          isHmacAuth = verifyHmac(tenantSecret, sheetsTimestamp!, rawBody, sheetsSignature!);
        } else if (globalWebhookSecret) {
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

    if (tenantSlug) {
      // Tenant-specific POST: Bearer OR HMAC allowed
      if (!isCronAuth && !isHmacAuth) {
        const resolvedTenantId = tenants.length > 0 ? tenants[0].id : 'system_scheduler';
        log.warn('[CRON_SYNC_AUTH_FAIL] Unauthorized tenant POST request', { tenantId: resolvedTenantId, conversationId: 'cron_sync_no_conversation', tenantSlug });
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
      }
    } else {
      // Global POST: ONLY Bearer allowed
      if (!isCronAuth) {
        log.warn('[CRON_SYNC_AUTH_FAIL] Unauthorized global POST request', { tenantId: 'system_scheduler', conversationId: 'cron_sync_no_conversation' });
        return NextResponse.json({ error: 'Unauthorized: Global POST requires Bearer Token' }, { status: 401 });
      }
    }
  }

  // 4. Dry-Run Connection Test Bypasses DB writes entirely
  if (isDryRun) {
    if (!tenantSlug) {
      return NextResponse.json({ error: 'Tenant parameter is required for dry-run connection test' }, { status: 400 });
    }
    if (tenants.length === 0) {
      return NextResponse.json({ error: 'Tenant not found or inactive' }, { status: 404 });
    }

    const tenantId = tenants[0].id;
    const db = withTenantDB(tenantId);
    let credentialsValid = false;
    let spreadsheetConfigured = false;

    try {
      const integration = await db.executeSafe({
        text: `SELECT credentials FROM tenant_integrations WHERE tenant_id = $1 AND provider = 'google_sheets' LIMIT 1`,
        values: [tenantId]
      }) as any[];
      if (integration.length > 0 && integration[0].credentials) {
        const { decryptPayload } = await import('@/lib/core/encryption');
        const decrypted = decryptPayload(integration[0].credentials);
        if (decrypted && decrypted.apiKey && decrypted.spreadsheetId) {
          credentialsValid = true;
        }
      }

      const pipeline = await db.executeSafe({
        text: `SELECT config FROM ingestion_pipelines WHERE tenant_id = $1 AND provider = 'google_sheets' LIMIT 1`,
        values: [tenantId]
      }) as any[];
      if (pipeline.length > 0 && pipeline[0].config) {
        const cfg = typeof pipeline[0].config === 'string' ? JSON.parse(pipeline[0].config) : pipeline[0].config;
        if (cfg && cfg.spreadsheetId) {
          spreadsheetConfigured = true;
        }
      }
    } catch (err: any) {
      log.error('[DRY_RUN_CHECK_FAIL] Dry-run validation error', err, { tenantId, conversationId: 'cron_sync_no_conversation' });
      return NextResponse.json({ success: false, error: `Validation error: ${err.message}` }, { status: 400 });
    }

    log.info('[DRY_RUN_SUCCESS] Connection test successful', { tenantId, conversationId: 'cron_sync_no_conversation', tenantSlug });
    return NextResponse.json({
      success: true,
      dryRun: true,
      message: 'Connection test successful',
      tenant: tenantSlug,
      checks: {
        credentialsValid,
        spreadsheetConfigured
      }
    });
  }

  // 5. Tenant Resolution for Sync
  if (!tenantSlug) {
    // Global sync path: fetch all active tenants
    const res = await systemDb.executeSafe({
      text: `SELECT t.id, t.name, t.slug FROM tenants t
             JOIN tenant_integrations ti ON t.id = ti.tenant_id
             WHERE ti.provider = 'google_sheets' AND ti.is_active = true AND t.status = 'active'`,
      values: []
    }) as any[];
    tenants = res || [];
  } else {
    if (tenants.length === 0) {
      return NextResponse.json({ success: false, error: 'Tenant not found or inactive' }, { status: 404 });
    }
  }

  // Apply Allowlist Filtering if configured
  const allowlistEnv = process.env.GOOGLE_SHEETS_SERVER_SYNC_TENANT_ALLOWLIST;
  if (allowlistEnv) {
    const allowlist = allowlistEnv.split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
    if (allowlist.length > 0) {
      tenants = tenants.filter(t => allowlist.includes(t.slug.toLowerCase()));
    }
  }

  if (tenants.length === 0) {
    return NextResponse.json({ success: true, message: 'No matching active tenants found for sync' });
  }

  // 6. Loop Sync Execution with Concurrency Lock, Batching, Timeout Guard, and Error Isolation
  const results: Record<string, any> = {};
  let processedCount = 0;
  let failedCount = 0;
  let skippedCount = 0;
  let timedOutEarly = false;

  const maxTenantsPerRun = 20;
  const maxDurationMs = 50000; // 50 seconds timeout guard

  for (const tenant of tenants) {
    // Concurrency limit per execution run
    if (processedCount >= maxTenantsPerRun) {
      log.warn('[CRON_SYNC_BATCH_LIMIT] Reached max processed tenants limit per run', { tenantId: 'system_scheduler', conversationId: 'cron_sync_no_conversation', maxTenantsPerRun });
      skippedCount += (tenants.length - processedCount - failedCount - skippedCount);
      break;
    }

    // Time budget check
    const elapsed = Date.now() - startTime;
    if (elapsed > maxDurationMs) {
      log.warn('[CRON_SYNC_TIMEOUT_GUARD] Timeout limit reached, stopping execution loop early', { tenantId: 'system_scheduler', conversationId: 'cron_sync_no_conversation', elapsed });
      timedOutEarly = true;
      skippedCount += (tenants.length - processedCount - failedCount - skippedCount);
      break;
    }

    // Acquire lock for this tenant slug
    const lockToken = await acquireTenantLock(tenant.slug);
    if (!lockToken) {
      log.warn('[CRON_SYNC_TENANT_LOCKED] Skip tenant because sync is already running', { tenantId: tenant.id, conversationId: 'cron_sync_no_conversation', tenantSlug: tenant.slug });
      results[tenant.name] = { skipped: true, reason: 'concurrency_lock_held' };
      skippedCount++;
      continue;
    }

    try {
      const db = withTenantDB(tenant.id);

      const integrations = await db.executeSafe({
        text: `SELECT credentials FROM tenant_integrations WHERE tenant_id = $1 AND provider = 'google_sheets' LIMIT 1`,
        values: [tenant.id]
      }) as any[];

      if (!integrations || integrations.length === 0) {
        results[tenant.name] = { skipped: true, reason: 'No credentials' };
        skippedCount++;
        continue;
      }

      let payload;
      try {
        const { decryptPayload } = await import('@/lib/core/encryption');
        payload = decryptPayload(integrations[0].credentials);
      } catch (e: any) {
        log.error('[CRON_DECRYPT_ERROR]', new Error(e?.message || 'Unknown'), { tenantId: tenant.id, conversationId: 'cron_sync_no_conversation' });
        results[tenant.name] = { error: 'Decrypt failed' };
        failedCount++;
        continue;
      }

      const { apiKey, spreadsheetId, activeSheets = [] } = payload;
      if (!apiKey || !spreadsheetId) {
        results[tenant.name] = { skipped: true, reason: 'Missing apiKey or spreadsheetId' };
        skippedCount++;
        continue;
      }

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

      // Run Ingestion
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

      // Update Health Status
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

      processedCount++;

    } catch (tenantErr: any) {
      log.error('[CRON_TENANT_ERROR]', tenantErr instanceof Error ? tenantErr : new Error(String(tenantErr)), { tenantId: tenant.id, conversationId: 'cron_sync_no_conversation' });
      results[tenant.name] = { error: tenantErr?.message || 'Unknown error' };
      failedCount++;

      await updateSheetsHealthStatus(tenant.id, 'error', 'cron_sync', {
        created: 0, duplicates: 0, errors: 1,
        errorMessage: tenantErr?.message
      });
    } finally {
      // Always release the tenant lock
      await releaseTenantLock(tenant.slug, lockToken);
    }
  }

  const durationMs = Date.now() - startTime;
  const resolvedTenantId = tenants.length === 1 ? tenants[0].id : 'system_scheduler';
  log.info('[CRON_SYNC_DONE]', { 
    tenantId: resolvedTenantId,
    conversationId: 'cron_sync_no_conversation',
    results, 
    processedCount, 
    failedCount, 
    skippedCount, 
    durationMs, 
    timedOutEarly 
  });

  return NextResponse.json({
    success: true,
    processedTenantsCount: processedCount,
    failedTenantsCount: failedCount,
    skippedTenantsCount: skippedCount,
    durationMs,
    timedOutEarly,
    results
  });
}

export async function GET(request: NextRequest) {
  return handleSyncRequest(request, 'GET');
}

export async function POST(request: NextRequest) {
  return handleSyncRequest(request, 'POST');
}
