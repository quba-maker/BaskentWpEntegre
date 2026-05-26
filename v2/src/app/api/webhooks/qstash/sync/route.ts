import { NextResponse } from 'next/server';
import { withTenantDB } from "@/lib/core/tenant-db";
import { decryptPayload } from "@/lib/core/encryption";
import { Receiver } from "@upstash/qstash";
import { Redis } from "@upstash/redis";
import { logAudit } from "@/lib/audit";

// ==========================================
// QStash Webhook - Google Sheets Sync (Async Orchestration)
// ==========================================

const redis = Redis.fromEnv();

async function updateSyncProgress(tenantId: string, correlationId: string, progress: number, status: string, message: string) {
  try {
    if (!correlationId) return;
    await redis.set(`sync_status:${tenantId}:${correlationId}`, {
      status,
      progress,
      message,
      updatedAt: new Date().toISOString()
    }, { ex: 3600 });
  } catch(e) {
    // Non-blocking
  }
}

export async function POST(req: Request) {
  // ═══════════════════════════════════════════════════════
  // DEPRECATED GUARD — P1 will migrate to shared ingestSheetBatch()
  // This route uses an old, basic parser without country code inference,
  // multi-phone dedup, or content-aware field detection.
  // To prevent accidental data corruption, it's disabled by default.
  // Set ENABLE_LEGACY_QSTASH_SHEETS_SYNC=true to re-enable.
  // ═══════════════════════════════════════════════════════
  if (process.env.ENABLE_LEGACY_QSTASH_SHEETS_SYNC !== 'true') {
    console.warn('[QSTASH_DEPRECATED] Legacy QStash sheets sync route is disabled. Set ENABLE_LEGACY_QSTASH_SHEETS_SYNC=true to re-enable.');
    return NextResponse.json(
      { error: 'This route is deprecated. Use /api/cron-form-sync or /api/sheets-webhook instead.' },
      { status: 410 }
    );
  }

  let bodyPayload: any = {};
  let rawBody = "";
  try {
    rawBody = await req.text();
    
    // 1. Verify QStash Signature (Security)
    if (process.env.VERCEL_ENV === "production") {
      const signature = req.headers.get("upstash-signature");
      if (!signature) {
        return NextResponse.json({ error: "Missing signature" }, { status: 401 });
      }
      
      const receiver = new Receiver({
        currentSigningKey: process.env.QSTASH_CURRENT_SIGNING_KEY || "",
        nextSigningKey: process.env.QSTASH_NEXT_SIGNING_KEY || "",
      });

      const isValid = await receiver.verify({
        signature,
        body: rawBody,
      });

      if (!isValid) {
        return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
      }
    }

    bodyPayload = JSON.parse(rawBody);
    const { tenantId, initiatedBy, correlationId, pipelineRunId } = bodyPayload;

    if (!tenantId) {
      return NextResponse.json({ error: "Missing tenantId" }, { status: 400 });
    }

    await updateSyncProgress(tenantId, correlationId, 10, 'processing', 'Validating credentials...');

    // 2. Fetch Encrypted Credentials
    const db = withTenantDB(tenantId);
    const integrations = await db.executeSafe({
      text: `
        SELECT credentials FROM tenant_integrations 
        WHERE tenant_id = $1 AND provider = 'google_sheets' LIMIT 1
      `,
      values: [tenantId]
    }) as any[];

    if (!integrations || integrations.length === 0) {
      await updateSyncProgress(tenantId, correlationId, 0, 'error', 'Integration not found');
      return NextResponse.json({ error: "Integration not found" }, { status: 404 });
    }

    let payload;
    try {
      payload = decryptPayload(integrations[0].credentials);
    } catch (e) {
      await updateHealthStatus(tenantId, 'google_sheets', 'decryption_failed', String(e));
      await updateSyncProgress(tenantId, correlationId, 0, 'error', 'Credential decryption failed');
      return NextResponse.json({ error: "Decryption failed" }, { status: 500 });
    }

    const SHEETS_API_KEY = payload.apiKey;
    const SPREADSHEET_ID = payload.spreadsheetId;
    const activeSheets = payload.activeSheets || [];

    if (!SHEETS_API_KEY || !SPREADSHEET_ID) {
      await updateHealthStatus(tenantId, 'google_sheets', 'invalid_credentials', "Missing apiKey or spreadsheetId");
      await updateSyncProgress(tenantId, correlationId, 0, 'error', 'Invalid Google Sheets configuration');
      return NextResponse.json({ error: "Invalid credentials" }, { status: 400 });
    }

    const BASE_URL = `https://sheets.googleapis.com/v4/spreadsheets/${SPREADSHEET_ID}`;

    await updateSyncProgress(tenantId, correlationId, 30, 'processing', 'Fetching spreadsheet metadata...');

    const metaResp = await fetch(`${BASE_URL}?key=${SHEETS_API_KEY}&fields=sheets.properties`);
    if (!metaResp.ok) {
      const errorText = await metaResp.text();
      let status = 'disconnected';
      if (metaResp.status === 401 || metaResp.status === 403) status = 'expired_token';
      if (metaResp.status === 429) status = 'quota_exceeded';
      
      await updateHealthStatus(tenantId, 'google_sheets', status, errorText);
      await logAudit({
        tenantId,
        userId: initiatedBy,
        action: "google_sheets_sync_failed",
        entityType: "integration",
        entityId: "google_sheets",
        details: { correlationId, pipelineRunId, error: errorText }
      });
      await updateSyncProgress(tenantId, correlationId, 0, 'error', `API Error: ${status}`);
      return NextResponse.json({ error: "Failed to fetch metadata" }, { status: metaResp.status });
    }

    const metaData = await metaResp.json();
    let tabs = metaData.sheets
      .filter((s: any) => !s.properties.hidden)
      .map((s: any) => s.properties.title);
      
    if (activeSheets.length > 0) {
      tabs = tabs.filter((t: string) => activeSheets.includes(t));
    }

    if (tabs.length === 0) {
      await updateHealthStatus(tenantId, 'google_sheets', 'healthy', null);
      await updateSyncProgress(tenantId, correlationId, 100, 'completed', 'No active tabs to sync');
      return NextResponse.json({ success: true, message: "No tabs to sync" });
    }

    await updateSyncProgress(tenantId, correlationId, 50, 'processing', `Downloading data from ${tabs.length} tabs...`);

    const rangeParams = tabs.map((t: string) => `ranges=${encodeURIComponent(t)}`).join('&');
    const batchUrl = `${BASE_URL}/values:batchGet?key=${SHEETS_API_KEY}&${rangeParams}&valueRenderOption=FORMATTED_VALUE`;
    
    const batchResp = await fetch(batchUrl);
    if (!batchResp.ok) {
      const errorText = await batchResp.text();
      await updateHealthStatus(tenantId, 'google_sheets', 'sync_failed', errorText);
      await logAudit({
        tenantId,
        userId: initiatedBy,
        action: "google_sheets_sync_failed",
        entityType: "integration",
        entityId: "google_sheets",
        details: { correlationId, pipelineRunId, error: errorText }
      });
      await updateSyncProgress(tenantId, correlationId, 0, 'error', 'Data download failed');
      return NextResponse.json({ error: "Failed to fetch values" }, { status: batchResp.status });
    }

    const batchData = await batchResp.json();
    let newLeadsCount = 0;

    await updateSyncProgress(tenantId, correlationId, 70, 'processing', 'Processing and importing rows...');

    for (let i = 0; i < batchData.valueRanges.length; i++) {
      const vr = batchData.valueRanges[i];
      const tabName = tabs[i];
      const values = vr.values || [];
      if (values.length <= 1) continue;

      const headers = values[0].map((h: string) => String(h).toLowerCase().trim());
      
      const phoneIdx = headers.findIndex((h: string) => h.includes('telefon') || h.includes('phone') || h === 'numara' || h.includes('cep'));
      const nameIdx = headers.findIndex((h: string) => !h.endsWith('id') && !h.endsWith('_id') && !h.includes(' id') && (h.includes('isim') || h.includes('soyad') || h === 'ad' || h === 'adı' || h === 'adınız' || h === 'name' || h === 'full name' || h === 'full_name'));
      const emailIdx = headers.findIndex((h: string) => h.includes('mail') || h.includes('e-posta'));
      const formNameIdx = headers.findIndex((h: string) => !h.endsWith('id') && !h.endsWith('_id') && !h.includes(' id') && (h.includes('form adı') || h.includes('form name') || h.includes('form_name') || h.includes('kampanya adı') || h.includes('campaign_name') || h.includes('campaign name') || h === 'kampanya' || h === 'campaign' || h === 'form'));

      if (phoneIdx === -1) continue;

      for (let r = 1; r < values.length; r++) {
        const row = values[r];
        let phone = row[phoneIdx];
        if (!phone) continue;
        
        phone = String(phone).replace(/[^0-9]/g, '');
        if (phone.length < 10) continue;
        phone = phone.substring(0, 20);

        let name = nameIdx !== -1 && row[nameIdx] ? String(row[nameIdx]).substring(0, 100) : null;
        let email = emailIdx !== -1 && row[emailIdx] ? String(row[emailIdx]).substring(0, 200) : null;
        let formName = formNameIdx !== -1 && row[formNameIdx] ? String(row[formNameIdx]).substring(0, 200) : tabName;

        const raw_data: any = {};
        headers.forEach((h: string, idx: number) => { raw_data[h] = row[idx] || ""; });

        // Idempotency check via phone matching
        const existing = await db.executeSafe({
          text: `
            SELECT id FROM leads 
            WHERE phone_number LIKE '%' || RIGHT($1, 10) || '%' 
              AND tenant_id = $2 LIMIT 1
          `,
          values: [phone, tenantId]
        }) as any[];
        
        if (existing && existing.length === 0) {
          const inserted = await db.executeSafe({
            text: `
              INSERT INTO leads (tenant_id, phone_number, patient_name, email, form_name, raw_data, stage, created_at)
              VALUES ($1, $2, $3, $4, $5, $6, 'new', NOW())
              RETURNING id
            `,
            values: [tenantId, phone, name, email, formName, JSON.stringify(raw_data)]
          }) as any[];
          
          newLeadsCount++;

          // Create pipeline_events idempotently
          if (inserted && inserted.length > 0) {
            await db.executeSafe({
              text: `
                INSERT INTO pipeline_events (tenant_id, lead_id, event_type, payload, created_at)
                SELECT $1, $2, 'lead_ingested', $3, NOW()
                WHERE NOT EXISTS (
                  SELECT 1 FROM pipeline_events 
                  WHERE lead_id = $4 AND event_type = 'lead_ingested' AND tenant_id = $5
                )
              `,
              values: [tenantId, inserted[0].id, JSON.stringify({ source: 'google_sheets', tabName, pipelineRunId }), inserted[0].id, tenantId]
            });
          }
        }
      }
    }

    await updateHealthStatus(tenantId, 'google_sheets', 'healthy', null);
    await updateSyncProgress(tenantId, correlationId, 100, 'completed', `${newLeadsCount} new leads synchronized.`);
    
    await logAudit({
      tenantId,
      userId: initiatedBy,
      action: "google_sheets_sync_completed",
      entityType: "integration",
      entityId: "google_sheets",
      details: { correlationId, pipelineRunId, newLeadsCount }
    });

    return NextResponse.json({ success: true, count: newLeadsCount });
  } catch (error: any) {
    console.error("QStash Webhook Error:", error);
    
    if (bodyPayload?.tenantId && bodyPayload?.correlationId) {
       await updateSyncProgress(bodyPayload.tenantId, bodyPayload.correlationId, 0, 'error', `Fatal error: ${error.message}`);
       await logAudit({
          tenantId: bodyPayload.tenantId,
          userId: bodyPayload.initiatedBy,
          action: "google_sheets_sync_failed",
          entityType: "integration",
          entityId: "google_sheets",
          details: { correlationId: bodyPayload.correlationId, pipelineRunId: bodyPayload.pipelineRunId, error: error.message }
       });
    }

    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

async function updateHealthStatus(tenantId: string, provider: string, status: string, errorLog: string | null) {
  try {
    const db = withTenantDB(tenantId);
    await db.executeSafe({
      text: `
        UPDATE tenant_integrations
        SET health_status = $1,
            error_log = $2,
            last_sync_at = NOW(),
            updated_at = NOW()
        WHERE tenant_id = $3 AND provider = $4
      `,
      values: [status, errorLog ? JSON.stringify({ message: errorLog, time: new Date().toISOString() }) : null, tenantId, provider]
    });
  } catch (e) {
    console.error("Failed to update integration health status", e);
  }
}
