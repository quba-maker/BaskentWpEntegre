"use server";

// sql import removed — all queries use parameterized {text, values} format for proper RLS enforcement
import { withActionGuard } from "@/lib/core/action-guard";
import { logAudit } from "@/lib/audit";
import { FIRST_CONTACT_HARD_DUPLICATE_ACTIONS } from "@/lib/utils/first-contact-status-resolver";

// ==========================================
// QUBA AI — Forms & Leads Actions (Zero-Trust)
// ==========================================

export async function getForms(page: number = 1, search: string = "", source: string = "all", firstContactFilter: string = "all", stageFilter: string = "all") {
  return withActionGuard(
    { actionName: 'getForms' },
    async (ctx) => {
      const limit = 50;
      const offset = (page - 1) * limit;
      const searchFilter = search.trim() ? `%${search.trim()}%` : null;
      const sourceFilter = source !== "all" ? `%${source}%` : null;
      const stageParam = stageFilter !== "all" ? stageFilter : null;
      const firstContactParam = firstContactFilter !== "all" ? firstContactFilter : null;

      // Dynamic WHERE builder matching the cl columns
      const conditions: string[] = [`cl.tenant_id = $1`];
      const params: any[] = [ctx.tenantId];
      let paramIdx = 2;

      if (searchFilter) {
        conditions.push(`(cl.patient_name ILIKE $${paramIdx} OR cl.phone_number ILIKE $${paramIdx} OR cl.email ILIKE $${paramIdx} OR (cl.raw_data IS NOT NULL AND cl.raw_data LIKE $${paramIdx}))`);
        params.push(searchFilter);
        paramIdx++;
      }
      if (sourceFilter) {
        conditions.push(`cl.form_name ILIKE $${paramIdx}`);
        params.push(sourceFilter);
        paramIdx++;
      }
      if (stageParam) {
        conditions.push(`cl.stage = $${paramIdx}`);
        params.push(stageParam);
        paramIdx++;
      }
      if (firstContactParam) {
        if (firstContactParam === 'sent') {
          conditions.push(`cl.first_contact_status IN ('manual_greeting_confirmed', 'inbox_greeting_sent')`);
        } else {
          conditions.push(`cl.first_contact_status = $${paramIdx}`);
          params.push(firstContactParam);
          paramIdx++;
        }
      }

      params.push(limit, offset);
      const limitIdx = paramIdx;
      const offsetIdx = paramIdx + 1;

      const hardDuplicateActionsSql = FIRST_CONTACT_HARD_DUPLICATE_ACTIONS.map(a => `'${a}'`).join(', ');

      const rows = await ctx.db.executeSafe({
        text: `WITH base_leads AS (
                  SELECT l.*, 
                         COALESCE(c_identity.status, c_phone.status) as conversation_status, 
                         COALESCE(c_identity.lead_stage, c_phone.lead_stage) as conv_lead_stage, 
                         COALESCE(mem_identity.summary_text, mem_phone.summary_text) as ai_summary,
                         COALESCE(c_identity.id, c_phone.id) as linked_conv_id,
                         COALESCE(c_identity.country, c_phone.conv_country) as conv_country,
                         COALESCE(c_identity.department, c_phone.conv_department) as conv_department,
                         opp.opp_id,
                         opp.opp_country,
                         opp.opp_department,
                         opp.opp_stage,
                         opp.opp_priority,
                         opp.opp_intent_type,
                         opp.opp_travel_date,
                         opp.opp_next_follow_up_at,
                         opp.opp_summary,
                         opp.opp_requester_name,
                         opp.opp_patient_name,
                         opp.opp_patient_relation,
                         (SELECT action FROM outreach_logs WHERE lead_id = l.id AND tenant_id = l.tenant_id::text ORDER BY created_at DESC LIMIT 1) as last_outreach_action,
                         (SELECT created_at FROM outreach_logs WHERE lead_id = l.id AND tenant_id = l.tenant_id::text ORDER BY created_at DESC LIMIT 1) as last_outreach_at,
                         (
                           SELECT created_at 
                           FROM outreach_logs 
                           WHERE lead_id = l.id AND tenant_id = l.tenant_id::text 
                             AND action IN (${hardDuplicateActionsSql})
                           ORDER BY created_at ASC LIMIT 1
                         ) as first_greeting_at,
                         EXISTS (
                           SELECT 1 FROM outreach_logs 
                           WHERE lead_id = l.id AND tenant_id = l.tenant_id::text 
                             AND action = 'manual_whatsapp_greeting_echo_confirmed'
                         ) as any_confirmed,
                         EXISTS (
                           SELECT 1 FROM outreach_logs 
                           WHERE lead_id = l.id AND tenant_id = l.tenant_id::text 
                             AND action = 'inbox_form_greeting_sent'
                         ) as any_inbox_sent,
                         EXISTS (
                           SELECT 1 FROM outreach_logs 
                           WHERE lead_id = l.id AND tenant_id = l.tenant_id::text 
                             AND action IN ('greeting_sent', 'template_sent', 'form_greeting_template_sent')
                         ) as any_api_sent,
                         EXISTS (
                           SELECT 1 FROM outreach_logs 
                           WHERE lead_id = l.id AND tenant_id = l.tenant_id::text 
                             AND action = 'whatsapp_app_opened_for_greeting'
                         ) as any_opened,
                         CASE 
                           WHEN c_identity.id IS NOT NULL THEN 'customer_id'
                           WHEN c_phone.id IS NOT NULL THEN 'phone_unique'
                           ELSE 'none'
                         END as summary_link_method,
                         (
                           SELECT json_build_object(
                             'has_inbound', count(m_all.id) > 0,
                             'first_inbound_at', min(m_all.created_at),
                             'last_inbound_at', max(m_all.created_at)
                           )
                           FROM conversations c_all
                           JOIN messages m_all ON m_all.conversation_id = c_all.id AND m_all.tenant_id = c_all.tenant_id
                           WHERE c_all.tenant_id = l.tenant_id
                             AND m_all.direction = 'in'
                             AND (m_all.media_metadata IS NULL OR COALESCE(m_all.media_metadata->'native'->>'message_type', '') != 'reaction')
                             AND (
                               (l.customer_id IS NOT NULL AND c_all.customer_id = l.customer_id)
                               OR
                               RIGHT(c_all.phone_number, 10) = RIGHT(l.phone_number, 10)
                               OR
                               (
                                 l.raw_data IS NOT NULL 
                                 AND l.raw_data != ''
                                 AND l.raw_data LIKE '%_all_phones%'
                                 AND (
                                   CASE
                                     WHEN jsonb_typeof(l.raw_data::jsonb->'_all_phones') = 'array' 
                                       THEN (l.raw_data::jsonb->'_all_phones') @> jsonb_build_array(c_all.phone_number)
                                     WHEN jsonb_typeof(l.raw_data::jsonb->'_all_phones') = 'string' 
                                       THEN (l.raw_data::jsonb->>'_all_phones')::jsonb @> jsonb_build_array(c_all.phone_number)
                                     ELSE false
                                   END
                                 )
                               )
                             )
                         ) as inbound_stats
                  FROM leads l
                  -- Layer 1: Safe link via customer_id (identity-based, no ambiguity)
                  LEFT JOIN conversations c_identity ON c_identity.tenant_id = l.tenant_id 
                    AND l.customer_id IS NOT NULL 
                    AND c_identity.customer_id = l.customer_id
                  LEFT JOIN conversation_memory mem_identity ON mem_identity.conversation_id = c_identity.id
                  -- Layer 2: Phone match only if EXACTLY ONE conversation matches (prevents cross-leak)
                  LEFT JOIN LATERAL (
                    SELECT c2.id, c2.status, c2.lead_stage, c2.country as conv_country, c2.department as conv_department
                    FROM conversations c2 
                    WHERE c2.tenant_id = l.tenant_id 
                      AND RIGHT(c2.phone_number, 10) = RIGHT(l.phone_number, 10)
                      AND l.customer_id IS NULL  -- Only use phone fallback when customer_id link unavailable
                      AND (SELECT COUNT(*) FROM conversations cx 
                           WHERE cx.tenant_id = l.tenant_id 
                           AND RIGHT(cx.phone_number, 10) = RIGHT(l.phone_number, 10)) = 1
                    LIMIT 1
                  ) c_phone ON c_identity.id IS NULL
                  LEFT JOIN conversation_memory mem_phone ON mem_phone.conversation_id = c_phone.id AND c_identity.id IS NULL
                  -- Layer 4: Active opportunity preferred
                  LEFT JOIN LATERAL (
                    SELECT o.id as opp_id, 
                           o.country as opp_country, o.department as opp_department,
                           o.stage as opp_stage, o.priority as opp_priority,
                           o.intent_type as opp_intent_type, o.travel_date as opp_travel_date,
                           o.next_follow_up_at as opp_next_follow_up_at,
                           o.summary as opp_summary,
                           o.requester_name as opp_requester_name,
                           o.patient_name as opp_patient_name,
                           o.patient_relation as opp_patient_relation
                    FROM opportunities o
                    WHERE o.tenant_id = l.tenant_id
                      AND o.conversation_id = COALESCE(c_identity.id, c_phone.id)
                    ORDER BY 
                      CASE WHEN o.id = COALESCE(c_identity.active_opportunity_id, (SELECT active_opportunity_id FROM conversations WHERE id = c_phone.id AND tenant_id = l.tenant_id)) THEN 0 ELSE 1 END,
                      o.updated_at DESC
                    LIMIT 1
                  ) opp ON COALESCE(c_identity.id, c_phone.id) IS NOT NULL
                ),
                calculated_leads AS (
                  SELECT bl.*,
                         CASE
                           -- 1. anyInbound is true
                           WHEN (bl.inbound_stats->>'has_inbound')::boolean = true THEN
                             CASE
                               -- We greeted them
                               WHEN bl.first_greeting_at IS NOT NULL THEN
                                 CASE
                                   -- If patient replied after we greeted them
                                   WHEN (bl.inbound_stats->>'last_inbound_at') IS NOT NULL AND bl.first_greeting_at < (bl.inbound_stats->>'last_inbound_at')::timestamp THEN 'patient_replied'
                                   WHEN bl.any_inbox_sent = true THEN 'inbox_greeting_sent'
                                   WHEN bl.any_confirmed = true THEN 'manual_greeting_confirmed'
                                   WHEN bl.any_api_sent = true THEN 'inbox_greeting_sent'
                                   ELSE 'inbox_greeting_sent'
                                 END
                               ELSE 'waiting_inbox_reply'
                             END
                           -- 2. no inbound message
                           ELSE
                             CASE
                               WHEN bl.any_confirmed = true THEN 'manual_greeting_confirmed'
                               WHEN bl.any_inbox_sent = true THEN 'inbox_greeting_sent'
                               WHEN bl.any_api_sent = true THEN 'inbox_greeting_sent'
                               WHEN bl.any_opened = true THEN 'whatsapp_opened'
                               ELSE
                                 CASE
                                   WHEN bl.phone_number IS NULL OR bl.phone_number = '' THEN 'blocked_or_invalid'
                                   WHEN bl.stage NOT IN ('new', 'contacted') THEN 'out_of_scope'
                                   ELSE 'needs_greeting'
                                 END
                             END
                         END as first_contact_status
                  FROM base_leads bl
                )
                SELECT cl.* 
                FROM calculated_leads cl
                WHERE ${conditions.join(' AND ')}
                ORDER BY cl.created_at DESC LIMIT $${limitIdx} OFFSET $${offsetIdx}`,
        values: params
      });

      return rows.map((r: any) => {
        return {
          id: r.id,
          phone_number: r.phone_number,
          patient_name: r.patient_name || "İsimsiz Form",
          current_display_name: r.opp_requester_name || r.opp_patient_name || null,
          email: r.email,
          city: r.city,
          form_name: r.form_name || "Bilinmeyen Form",
          stage: r.conv_lead_stage || r.stage || "new",
          created_at: r.created_at,
          raw_data: r.raw_data ? JSON.parse(r.raw_data) : {},
          country: r.country,
          notes: r.notes || "",
          ai_summary: r.ai_summary || "",
          isBotActive: r.conversation_status === 'bot',
          summaryLinkMethod: r.summary_link_method || 'none',
          linked_conversation_id: r.linked_conv_id || null,
          linked_opportunity_id: r.opp_id || null,
          current_country: r.opp_country || r.conv_country || r.country || null,
          current_department: r.opp_department || r.conv_department || null,
          current_stage: r.opp_stage || null,
          current_priority: r.opp_priority || null,
          current_intent_type: r.opp_intent_type || null,
          current_travel_date: r.opp_travel_date || null,
          current_next_follow_up_at: r.opp_next_follow_up_at || null,
          current_ai_summary: r.opp_summary || "",
          patient_relation: r.opp_patient_relation || null,
          link_confidence: r.summary_link_method || 'none',
          last_outreach_action: r.last_outreach_action || null,
          last_outreach_at: r.last_outreach_at || null,
          first_greeting_at: r.first_greeting_at || null,
          inbound_stats: r.inbound_stats || { has_inbound: false },
          firstContactStatus: r.first_contact_status,
        };
      });
    }
  ).then(res => res.data || []);
}

export async function updateLeadNotes(id: number, notes: string) {
  return withActionGuard(
    { actionName: 'updateLeadNotes' },
    async (ctx) => {
      const lead = await ctx.db.executeSafe({
        text: `SELECT phone_number FROM leads WHERE id = $1 AND tenant_id = $2`,
        values: [id, ctx.tenantId]
      });
      if (lead.length === 0) throw new Error("Kayıt bulunamadı.");

      await ctx.db.executeSafe({
        text: `UPDATE leads SET notes = $1 WHERE id = $2 AND tenant_id = $3`,
        values: [notes, id, ctx.tenantId]
      });

      const SHEET_URL = process.env.GOOGLE_SHEET_UPDATE_URL || process.env.GOOGLE_SHEET_URL;
      if (SHEET_URL && lead.length > 0) {
        try {
          await fetch(SHEET_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              action: 'updateNoteByPhone',
              phone: lead[0].phone_number,
              note: notes
            })
          });
        } catch (sheetErr) {
          const { logger: formsLogger } = await import("@/lib/core/logger");
          formsLogger.withContext({ module: 'Forms' }).warn("Google Sheets note sync failed", { error: String(sheetErr) });
        }
      }

      return { success: true };
    }
  ).then(res => {
    if (!res.success) return { success: false, error: res.error };
    return { success: true };
  });
}

export async function deleteAllLeads() {
  return withActionGuard(
    { 
      actionName: 'deleteAllLeads',
      roles: ['owner', 'admin', 'platform_admin']
    },
    async (ctx) => {
      await ctx.db.executeSafe({ text: `DELETE FROM leads WHERE tenant_id = $1`, values: [ctx.tenantId] });
      
      logAudit({
        tenantId: ctx.tenantId,
        userId: ctx.userId,
        userEmail: ctx.email,
        action: "leads_bulk_delete",
        entityType: "lead",
        entityId: "bulk",
      });

      return { success: true, message: "Firma lead kayıtları başarıyla silindi." };
    }
  ).then(res => {
    if (!res.success) return { success: false, error: res.error };
    return { success: true, message: res.data?.message };
  });
}

export async function getCampaignNames() {
  return withActionGuard(
    { actionName: 'getCampaignNames' },
    async (ctx) => {
      const campaigns = await ctx.db.executeSafe({
        text: `SELECT DISTINCT form_name FROM leads WHERE tenant_id = $1 AND form_name IS NOT NULL AND form_name != '' ORDER BY form_name ASC`,
        values: [ctx.tenantId]
      });
      return campaigns.map((c: any) => c.form_name);
    }
  ).then(res => res.data || []);
}

export async function updateLeadStage(id: number, stage: string) {
  return withActionGuard(
    { actionName: 'updateLeadStage' },
    async (ctx) => {
      const lead = await ctx.db.executeSafe({
        text: `SELECT phone_number, raw_data FROM leads WHERE id = $1 AND tenant_id = $2`,
        values: [id, ctx.tenantId]
      });
      if (lead.length === 0) throw new Error("Kayıt bulunamadı.");

      // Route through UnifiedStageService (maps lead stage → opp stage internally)
      const { UnifiedStageService } = await import('@/lib/services/unified-stage.service');
      const { LEAD_TO_OPP_MAP } = await import('@/lib/config/stage-mapping');
      
      // Convert lead-system stage to opportunity-system stage for unified service
      const oppTargetStage = LEAD_TO_OPP_MAP[stage] || stage;
      
      const result = await UnifiedStageService.update({
        tenantId: ctx.tenantId,
        source: 'forms',
        leadId: id,
        phoneNumber: lead[0].phone_number,
        targetStage: oppTargetStage,
        actorId: ctx.userId,
      });

      // Google Sheets sync (non-blocking, post-transaction)
      if (result.success || result.legacyFallback) {
        const SHEET_URL = process.env.GOOGLE_SHEET_UPDATE_URL || process.env.GOOGLE_SHEET_URL;
        if (SHEET_URL) {
          try {
            const { LEAD_STAGE_LABELS } = await import('@/lib/config/stage-mapping');
            await fetch(SHEET_URL, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                action: 'updateStatusByPhone',
                phone: lead[0].phone_number,
                status: LEAD_STAGE_LABELS[result.mirrorLeadStage || stage] || stage
              })
            });
          } catch (sheetErr) {
            const { logger: formsLogger } = await import("@/lib/core/logger");
            formsLogger.withContext({ module: 'Forms' }).warn("Google Sheets status sync failed", { error: String(sheetErr) });
          }
        }
      }

      return result;
    }
  ).then(res => {
    if (!res.success) return { success: false, error: res.error, blocked: res.data?.blocked, blockReason: res.data?.blockReason };
    return res.data || { success: true };
  });
}

export async function syncGoogleSheets() {
  console.log('[SYNC_ACTION_ENTRY] syncGoogleSheets called');
  
  return withActionGuard(
    { actionName: 'syncGoogleSheets', roles: ['owner', 'admin'] },
    async (ctx) => {
      console.log('[SYNC_START] tenantId:', ctx.tenantId);

      // ── 1. Load Google Sheets credentials ──
      const integrations = await ctx.db.executeSafe({
        text: `SELECT credentials FROM tenant_integrations WHERE tenant_id = $1 AND provider = 'google_sheets' LIMIT 1`,
        values: [ctx.tenantId]
      });

      if (integrations.length === 0) {
        return { success: false, error: "Google Sheets entegrasyonu bulunamadı. Lütfen Ayarlar → Entegrasyonlar'dan kurulum yapın." };
      }

      let payload;
      try {
        const { decryptPayload } = await import('@/lib/core/encryption');
        payload = decryptPayload(integrations[0].credentials);
      } catch (e: any) {
        console.error('[SYNC_DECRYPT_ERROR]', e?.message);
        return { success: false, error: `Kimlik bilgileri çözülemedi: ${e?.message}` };
      }

      const SHEETS_API_KEY = payload.apiKey;
      const SPREADSHEET_ID = payload.spreadsheetId;
      const configActiveSheets: string[] = payload.activeSheets || [];

      if (!SHEETS_API_KEY || !SPREADSHEET_ID) {
        return { success: false, error: "Google Sheets API Key veya Spreadsheet ID eksik." };
      }

      // ── 2. Load pipeline routing config ──
      let outboundChannelId: string | null = null;
      let greetingGroupId: string | null = null;
      let tenantName: string | null = null;

      try {
        const pipeRes = await ctx.db.executeSafe({
          text: `SELECT greeting_group_id, outbound_channel_id FROM ingestion_pipelines WHERE tenant_id = $1 AND provider = 'google_sheets' LIMIT 1`,
          values: [ctx.tenantId]
        });
        if (pipeRes.length > 0) {
          greetingGroupId = pipeRes[0].greeting_group_id || null;
          outboundChannelId = pipeRes[0].outbound_channel_id || null;
        }
      } catch (_) {}

      try {
        const { withTenantDB } = await import('@/lib/core/tenant-db');
        const sysDb = withTenantDB('admin-system', true);
        const tenantRes = await sysDb.executeSafe({
          text: `SELECT name FROM tenants WHERE id = $1 LIMIT 1`,
          values: [ctx.tenantId]
        });
        if (tenantRes.length > 0) tenantName = tenantRes[0].name;
      } catch (_) {}

      // ── 3. Delegate to shared ingestion service ──
      const { ingestSheetBatch, updateSheetsHealthStatus } = await import('@/lib/services/sheets-ingestion.service');
      
      const result = await ingestSheetBatch({
        tenantId: ctx.tenantId,
        tenantName: tenantName || undefined,
        apiKey: SHEETS_API_KEY,
        spreadsheetId: SPREADSHEET_ID,
        activeSheets: configActiveSheets,
        outboundChannelId,
        greetingGroupId,
        skipAutoMessage: true, // Batch sync: never send auto-messages
        source: 'manual_sync',
        maxRowsPerRun: 2000,
        timeBudgetMs: 45_000,
      });

      // ── 4. Health status update ──
      await updateSheetsHealthStatus(
        ctx.tenantId,
        result.errors > 0 ? 'warning' : 'healthy',
        'manual_sync',
        { created: result.created, duplicates: result.duplicates, errors: result.errors }
      );

      // ── 5. Audit log ──
      const stats = {
        totalRows: result.totalRows,
        created: result.created,
        updated: result.updated,
        duplicates: result.duplicates,
        errors: result.errors,
        partial: result.partial
      };
      console.log('[SYNC_COMPLETED]', stats);

      logAudit({
        tenantId: ctx.tenantId,
        userId: ctx.userId,
        userEmail: ctx.email,
        action: 'google_sheets_sync_completed',
        entityType: 'integration',
        entityId: 'google_sheets',
        details: stats
      });

      return {
        success: true,
        message: result.message,
        stats
      };
    }
  ).then(res => {
    console.log('[SYNC_ACTION_RETURN]', JSON.stringify(res).slice(0, 300));
    if (!res.success) return { success: false, error: res.error || res.data?.error };
    return { success: true, message: res.data?.message, stats: res.data?.stats };
  });
}

