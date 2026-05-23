import { NextRequest, NextResponse } from 'next/server';
import { withTenantDB } from '@/lib/core/tenant-db';
import { logger } from '@/lib/core/logger';
import { ingestSheetRow } from '@/lib/services/sheets-ingestion.service';

const log = logger.withContext({ module: 'SheetsWebhook' });

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { sheetName, data } = body;

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
    // Fallback: baskent (geriye uyumluluk)
    if (!tenantId) {
      const fallback = await systemDb.executeSafe({
        text: `SELECT id, name FROM tenants WHERE slug = 'baskent' LIMIT 1`,
        values: []
      }) as any[];
      if (fallback && fallback.length > 0) {
        tenantId = fallback[0].id;
        tenantName = fallback[0].name;
      }
    }

    if (!tenantId) {
      return NextResponse.json({ success: false, error: 'No active tenant found' }, { status: 404 });
    }

    const db = withTenantDB(tenantId);

    // ── 2. Pipeline Config Resolution ──
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

    // ── 3. Sheet Filter ──
    if (activeSheets.length > 0 && sheetName && !activeSheets.includes(sheetName)) {
      return NextResponse.json({ success: true, message: `Sheet '${sheetName}' is ignored by configuration.` });
    }

    if (!data) {
      return NextResponse.json({ success: false, error: 'No data provided' }, { status: 400 });
    }

    // ── 4. Delegate to Shared Ingestion Service ──
    log.info('[WEBHOOK_INGEST]', { tenantId, sheetName, source: 'webhook' });

    const result = await ingestSheetRow({
      tenantId,
      tenantName: tenantName || undefined,
      sheetName: sheetName || 'Google Sheets',
      data,
      outboundChannelId,
      greetingGroupId,
      skipAutoMessage: false, // Webhook = new row → send auto-message
      source: 'webhook'
    });

    log.info('[WEBHOOK_RESULT]', { status: result.status, leadId: result.leadId, messageSent: result.messageSent });

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
