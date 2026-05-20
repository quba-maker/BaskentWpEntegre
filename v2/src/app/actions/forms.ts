"use server";

import { sql } from "@/lib/db";
import { withActionGuard } from "@/lib/core/action-guard";
import { logAudit } from "@/lib/audit";

// ==========================================
// QUBA AI — Forms & Leads Actions (Zero-Trust)
// ==========================================

export async function getForms(page: number = 1, search: string = "", source: string = "all") {
  return withActionGuard(
    { actionName: 'getForms' },
    async (ctx) => {
      const limit = 50;
      const offset = (page - 1) * limit;
      const searchFilter = search.trim() ? `%${search.trim()}%` : null;
      const sourceFilter = source !== "all" ? `%${source}%` : null;

      let rows;
      
      if (searchFilter && sourceFilter) {
        rows = await ctx.db.executeSafe(sql`
          SELECT l.*, c.status as conversation_status, mem.summary_text as ai_summary
          FROM leads l
          LEFT JOIN conversations c ON c.phone_number = l.phone_number AND c.tenant_id = l.tenant_id
          LEFT JOIN conversation_memory mem ON mem.conversation_id::text = c.id::text
          WHERE l.tenant_id = ${ctx.tenantId}
            AND (l.patient_name ILIKE ${searchFilter} OR l.phone_number ILIKE ${searchFilter} OR l.email ILIKE ${searchFilter})
            AND l.form_name ILIKE ${sourceFilter}
          ORDER BY l.created_at DESC
          LIMIT ${limit} OFFSET ${offset}
        `);
      } else if (searchFilter) {
        rows = await ctx.db.executeSafe(sql`
          SELECT l.*, c.status as conversation_status, mem.summary_text as ai_summary
          FROM leads l
          LEFT JOIN conversations c ON c.phone_number = l.phone_number AND c.tenant_id = l.tenant_id
          LEFT JOIN conversation_memory mem ON mem.conversation_id::text = c.id::text
          WHERE l.tenant_id = ${ctx.tenantId}
            AND (l.patient_name ILIKE ${searchFilter} OR l.phone_number ILIKE ${searchFilter} OR l.email ILIKE ${searchFilter})
          ORDER BY l.created_at DESC
          LIMIT ${limit} OFFSET ${offset}
        `);
      } else if (sourceFilter) {
        rows = await ctx.db.executeSafe(sql`
          SELECT l.*, c.status as conversation_status, mem.summary_text as ai_summary
          FROM leads l
          LEFT JOIN conversations c ON c.phone_number = l.phone_number AND c.tenant_id = l.tenant_id
          LEFT JOIN conversation_memory mem ON mem.conversation_id::text = c.id::text
          WHERE l.tenant_id = ${ctx.tenantId}
            AND l.form_name ILIKE ${sourceFilter}
          ORDER BY l.created_at DESC
          LIMIT ${limit} OFFSET ${offset}
        `);
      } else {
        rows = await ctx.db.executeSafe(sql`
          SELECT l.*, c.status as conversation_status, mem.summary_text as ai_summary
          FROM leads l
          LEFT JOIN conversations c ON c.phone_number = l.phone_number AND c.tenant_id = l.tenant_id
          LEFT JOIN conversation_memory mem ON mem.conversation_id::text = c.id::text
          WHERE l.tenant_id = ${ctx.tenantId}
          ORDER BY l.created_at DESC
          LIMIT ${limit} OFFSET ${offset}
        `);
      }

      return rows.map((r: any) => ({
        id: r.id,
        phone_number: r.phone_number,
        patient_name: r.patient_name || "İsimsiz Form",
        email: r.email,
        city: r.city,
        form_name: r.form_name || "Bilinmeyen Form",
        stage: r.stage || "new",
        created_at: r.created_at,
        raw_data: r.raw_data ? JSON.parse(r.raw_data) : {},
        country: r.country,
        notes: r.notes || "",
        ai_summary: r.ai_summary || "",
        isBotActive: r.conversation_status === 'bot'
      }));
    }
  ).then(res => res.data || []);
}

export async function updateLeadNotes(id: number, notes: string) {
  return withActionGuard(
    { actionName: 'updateLeadNotes' },
    async (ctx) => {
      const lead = await ctx.db.executeSafe(sql`
        SELECT phone_number FROM leads WHERE id = ${id} AND tenant_id = ${ctx.tenantId}
      `);
      if (lead.length === 0) throw new Error("Kayıt bulunamadı.");

      await ctx.db.executeSafe(sql`
        UPDATE leads 
        SET notes = ${notes} 
        WHERE id = ${id} AND tenant_id = ${ctx.tenantId}
      `);

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
      await ctx.db.executeSafe(sql`DELETE FROM leads WHERE tenant_id = ${ctx.tenantId}`);
      
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
      const campaigns = await ctx.db.executeSafe(sql`
        SELECT DISTINCT form_name 
        FROM leads 
        WHERE tenant_id = ${ctx.tenantId}
          AND form_name IS NOT NULL AND form_name != ''
        ORDER BY form_name ASC
      `);
      return campaigns.map((c: any) => c.form_name);
    }
  ).then(res => res.data || []);
}

export async function syncGoogleSheets() {
  return withActionGuard(
    { actionName: 'syncGoogleSheets', roles: ['owner', 'admin'] },
    async (ctx) => {
      // Async Orchestration - Send to QStash
      const QSTASH_URL = process.env.QSTASH_URL || "https://qstash.upstash.io/v2/publish/";
      const QSTASH_TOKEN = process.env.QSTASH_TOKEN;
      const NEXT_PUBLIC_BASE_URL = process.env.NEXT_PUBLIC_BASE_URL;

      if (!QSTASH_TOKEN) {
        throw new Error("QStash token is missing. Background queues are disabled.");
      }

      if (!NEXT_PUBLIC_BASE_URL) {
        throw new Error("NEXT_PUBLIC_BASE_URL is missing. Cannot determine webhook destination.");
      }

      // Check if integration exists and is healthy
      const integrations = await ctx.db.executeSafe(sql`
        SELECT health_status FROM tenant_integrations 
        WHERE tenant_id = ${ctx.tenantId} AND provider = 'google_sheets' LIMIT 1
      `);

      if (integrations.length === 0) {
        return { success: false, error: "Google Sheets entegrasyonu bulunamadı. Lütfen ayarlardan kurulum yapın." };
      }

      if (integrations[0].health_status === 'expired_token' || integrations[0].health_status === 'quota_exceeded') {
        return { success: false, error: "Entegrasyon durumu sorunlu (" + integrations[0].health_status + "). Lütfen bağlantıyı güncelleyin." };
      }

      const destinationUrl = `${NEXT_PUBLIC_BASE_URL}/api/webhooks/qstash/sync`;

      const correlationId = crypto.randomUUID();
      const pipelineRunId = `sync_${Date.now()}`;

      const qstashRes = await fetch(QSTASH_URL + destinationUrl, {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${QSTASH_TOKEN}`,
          "Content-Type": "application/json",
          "Upstash-Delay": "0"
        },
        body: JSON.stringify({ 
          tenantId: ctx.tenantId,
          initiatedBy: ctx.userId,
          correlationId,
          pipelineRunId
        })
      });

      if (!qstashRes.ok) {
        const err = await qstashRes.text();
        throw new Error(`Failed to queue sync job: ${err}`);
      }

      // ----------------------------------------------------
      // Init SSE Status in Redis (using Upstash Redis)
      // ----------------------------------------------------
      try {
        const { Redis } = await import('@upstash/redis');
        const redis = Redis.fromEnv();
        await redis.set(`sync_status:${ctx.tenantId}:${correlationId}`, {
          status: 'queued',
          progress: 0,
          message: 'Job queued successfully',
          updatedAt: new Date().toISOString()
        }, { ex: 3600 }); // expire in 1 hour
      } catch(e) {
        // Silently fail Redis so we don't break the main flow
      }

      logAudit({
        tenantId: ctx.tenantId,
        userId: ctx.userId,
        userEmail: ctx.email,
        action: "google_sheets_sync_queued",
        entityType: "integration",
        entityId: "google_sheets",
        details: { correlationId, pipelineRunId }
      });

      return { 
        success: true, 
        message: "Senkronizasyon kuyruğa eklendi. İşlem arka planda tamamlanacak.",
        correlationId 
      };
    }
  ).then(res => {
    if (!res.success) return { success: false, error: res.error };
    return { success: true, message: res.data?.message, correlationId: res.data?.correlationId };
  });
}
