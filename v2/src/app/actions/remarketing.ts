"use server";

import { withActionGuard } from "@/lib/core/action-guard";
import { TemplateResolverService, type TemplateListItem } from "@/lib/services/template-resolver.service";
import { CredentialsService } from "@/lib/services/credentials.service";
import { logAudit } from "@/lib/audit";

const UUID_REGEX = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

export interface RemarketingDraftResult {
  success: boolean;
  blocked: boolean;
  blockReason?: string;

  draft?: string;
  patientName?: string;
  phone?: string;
  department?: string;
  language?: string;
  templateId?: string | null;
  templateName?: string;

  canSendFreeform?: boolean;
  requiresApprovedTemplate?: boolean;
  lastInboundAt?: string;
  channelReady?: boolean;
  channelError?: string;

  hasRecentDraftWarning?: boolean;
}

/**
 * T3: prepareRemarketingDraft Server Action (Zero Outbound)
 * 
 * - Tenant/Auth Guard & Input Validation.
 * - Stop Rules / Eligibility Check.
 * - WhatsApp 24h Customer Service Window check.
 * - Dedupe / Cooldown (24-hour draft warning) check.
 * - WhatsApp integration readiness check.
 * - Resolves best template & renders with context variables.
 * - Absolutely NO database writes or WhatsApp API dispatches.
 */
export async function prepareRemarketingDraft(opportunityId: string): Promise<RemarketingDraftResult> {
  return withActionGuard(
    { actionName: 'prepareRemarketingDraft' },
    async (ctx) => {
      // 1. UUID Validation
      if (!opportunityId || !UUID_REGEX.test(opportunityId)) {
        return {
          success: false,
          blocked: true,
          blockReason: "Geçersiz fırsat referans numarası (UUID)."
        };
      }

      // 2. Fetch Opportunity + associated conversation/lead data
      const oppRows = await ctx.db.executeSafe({
        text: `SELECT o.id, o.tenant_id, o.patient_name, o.phone_number, o.department, o.stage, o.conversation_id,
                      COALESCE((o.metadata->>'opt_out_requested')::boolean, false) as opt_out,
                      c.id as conv_id, c.customer_id as cust_id,
                      l.id as lead_id
               FROM opportunities o
               LEFT JOIN conversations c ON c.id = o.conversation_id AND c.tenant_id = o.tenant_id
               LEFT JOIN leads l ON (l.customer_id = c.customer_id OR RIGHT(l.phone_number, 10) = RIGHT(o.phone_number, 10)) AND l.tenant_id = o.tenant_id
               WHERE o.id = $1 AND o.tenant_id = $2
               ORDER BY l.created_at DESC LIMIT 1`,
        values: [opportunityId, ctx.tenantId]
      }) as any[];

      if (oppRows.length === 0) {
        return {
          success: false,
          blocked: true,
          blockReason: "Fırsat kaydı bulunamadı veya bu kayda erişim yetkiniz yok."
        };
      }

      const opp = oppRows[0];

      // 3. Stop Rules / Eligibility Guards
      // Lost, not_qualified, arrived, not_interested stages
      const blockedStages = new Set(['lost', 'not_qualified', 'arrived', 'not_interested']);
      if (blockedStages.has(opp.stage)) {
        return {
          success: false,
          blocked: true,
          blockReason: `Bu fırsatın aşaması '${opp.stage}' (terminal stage) olduğu için yeni takip taslağı önerilmez.`
        };
      }

      if (opp.opt_out) {
        return {
          success: false,
          blocked: true,
          blockReason: "Bu hasta tüm otomatik ve manuel bildirim listelerinden çıkış talep etmiştir (opt-out)."
        };
      }

      if (!opp.phone_number) {
        return {
          success: false,
          blocked: true,
          blockReason: "Hastanın geçerli bir telefon numarası bulunmuyor."
        };
      }

      // 4. WhatsApp 24-hour Customer Window calculation
      const lastInbound = await ctx.db.executeSafe({
        text: `SELECT created_at FROM messages
               WHERE phone_number = $1 AND tenant_id = $2 AND direction = 'in'
               ORDER BY created_at DESC LIMIT 1`,
        values: [opp.phone_number, ctx.tenantId]
      }) as any[];

      let canSendFreeform = false;
      let requiresApprovedTemplate = true;
      let lastInboundAt: string | undefined;

      if (lastInbound.length > 0) {
        const inboundTime = new Date(lastInbound[0].created_at);
        lastInboundAt = inboundTime.toISOString();
        const diffMs = Date.now() - inboundTime.getTime();
        const diffHours = diffMs / (1000 * 60 * 60);

        if (diffHours <= 24) {
          canSendFreeform = true;
          requiresApprovedTemplate = false;
        }
      }

      // 5. Cooldown / Dedupe (24h draft/send check) warning
      const recentLogs = await ctx.db.executeSafe({
        text: `SELECT 1 FROM outreach_logs
               WHERE opportunity_id = $1 AND tenant_id = $2::text
                 AND action IN ('remarketing_draft_prepared', 'remarketing_sent')
                 AND created_at > NOW() - INTERVAL '24 hours'
               LIMIT 1`,
        values: [opportunityId, String(ctx.tenantId)]
      }) as any[];

      const hasRecentDraftWarning = recentLogs.length > 0;

      // 6. WhatsApp Channel Readiness Check
      let channelReady = false;
      let channelError: string | undefined;

      try {
        const creds = await CredentialsService.resolveCredentials(ctx.tenantId, 'whatsapp');
        if (creds && creds.accessToken && creds.whatsappPhoneNumberId) {
          channelReady = true;
        } else {
          channelError = "WhatsApp API erişim bilgileri (accessToken / whatsappPhoneNumberId) eksik.";
        }
      } catch (err: any) {
        channelError = `Kanal kontrol hatası: ${err.message}`;
      }

      // 7. Resolve Template Resolver using TemplateResolverService.resolve with templateType: 'remarketing'
      // Fetch tenant name fallback
      let tenantName = "Ekibimiz";
      try {
        const tenantInfo = await ctx.db.executeSafe({
          text: `SELECT name FROM tenants WHERE id = $1 LIMIT 1`,
          values: [ctx.tenantId]
        }) as any[];
        if (tenantInfo.length > 0) {
          tenantName = tenantInfo[0].name;
        }
      } catch (_) {}

      const resolved = await TemplateResolverService.resolve(
        ctx.db,
        {
          tenantId: ctx.tenantId,
          tenantName: tenantName,
          patientName: opp.patient_name || undefined,
          department: opp.department || undefined,
          phoneNumber: opp.phone_number,
        },
        undefined,
        'remarketing'
      );

      return {
        success: true,
        blocked: false,
        draft: resolved.rendered,
        patientName: opp.patient_name || "İsimsiz Hasta",
        phone: opp.phone_number,
        department: opp.department || undefined,
        language: resolved.language,
        templateId: resolved.templateId,
        templateName: resolved.templateName,
        canSendFreeform,
        requiresApprovedTemplate,
        lastInboundAt,
        channelReady,
        channelError,
        hasRecentDraftWarning
      };
    }
  ).then(res => {
    if (!res.success) {
      return {
        success: false,
        blocked: true,
        blockReason: res.error || "Gözlenmeyen bir server aksiyonu hatası oluştu."
      } as RemarketingDraftResult;
    }
    return res.data as RemarketingDraftResult;
  });
}

/**
 * T3: saveRemarketingDraft Server Action (Zero Outbound)
 * 
 * - Tenant/Auth Guard.
 * - Character count check (max 4096).
 * - Scoped query verification.
 * - Inserts internal log into outreach_logs only (action = 'remarketing_draft_prepared').
 * - Updates last_remarketing_draft_at metadata on opportunity (lightweight).
 * - Absolutely NO patient outbound messages or database messages table writes.
 */
export async function saveRemarketingDraft(opportunityId: string, draftText: string): Promise<{ success: boolean; error?: string }> {
  return withActionGuard(
    { actionName: 'saveRemarketingDraft' },
    async (ctx) => {
      // 1. UUID Validation
      if (!opportunityId || !UUID_REGEX.test(opportunityId)) {
        throw new Error("Geçersiz fırsat referans numarası (UUID).");
      }

      // 2. Draft length check
      if (!draftText || draftText.trim() === "") {
        throw new Error("Taslak metni boş olamaz.");
      }
      if (draftText.length > 4096) {
        throw new Error("Taslak metni maksimum 4096 karakter sınırını aşamaz.");
      }

      // 3. Verify opportunity belongs to tenant
      const oppRows = await ctx.db.executeSafe({
        text: `SELECT o.id, o.tenant_id, o.phone_number,
                      c.id as conv_id, c.customer_id as cust_id,
                      l.id as lead_id
               FROM opportunities o
               LEFT JOIN conversations c ON c.id = o.conversation_id AND c.tenant_id = o.tenant_id
               LEFT JOIN leads l ON (l.customer_id = c.customer_id OR RIGHT(l.phone_number, 10) = RIGHT(o.phone_number, 10)) AND l.tenant_id = o.tenant_id
               WHERE o.id = $1 AND o.tenant_id = $2
               ORDER BY l.created_at DESC LIMIT 1`,
        values: [opportunityId, ctx.tenantId]
      }) as any[];

      if (oppRows.length === 0) {
        throw new Error("Fırsat kaydı bulunamadı veya yetkiniz yok.");
      }

      const opp = oppRows[0];
      const leadId = opp.lead_id || null;

      // 4. Update opportunity lightweight metadata (preventing main opportunity object inflation)
      await ctx.db.executeSafe({
        text: `UPDATE opportunities
               SET metadata = jsonb_set(
                 jsonb_set(COALESCE(metadata, '{}'::jsonb), '{last_remarketing_draft_at}', to_jsonb(NOW()::text)),
                 '{last_remarketing_draft_by}', to_jsonb($2::text)
               ),
               updated_at = NOW()
               WHERE id = $1 AND tenant_id = $3`,
        values: [opportunityId, ctx.userId, ctx.tenantId]
      });

      // 5. Insert audit log in outreach_logs
      // Store the heavy draft text ONLY inside outreach_logs metadata to avoid inflating opportunity object
      await ctx.db.executeSafe({
        text: `INSERT INTO outreach_logs (
                 tenant_id, lead_id, conversation_id, opportunity_id, action, channel, actor_id, metadata
               ) VALUES ($1, $2, $3, $4, 'remarketing_draft_prepared', 'whatsapp', $5, $6::jsonb)`,
        values: [
          String(ctx.tenantId),
          leadId, // UUID
          opp.conv_id || null, // string
          opportunityId, // string
          ctx.userId,
          JSON.stringify({ draftText, saved_at: new Date().toISOString() })
        ]
      });

      // 6. Log audit
      logAudit({
        tenantId: ctx.tenantId,
        userId: ctx.userId,
        userEmail: ctx.email,
        action: "remarketing_draft_saved",
        entityType: "opportunity",
        entityId: opportunityId,
        details: { leadId }
      });

      return { success: true };
    }
  ).then(res => {
    if (!res.success) {
      return { success: false, error: res.error };
    }
    return { success: true };
  });
}

/**
 * Helper to fetch all templates of type 'remarketing' for the select dropdown.
 */
export async function getRemarketingTemplates(): Promise<TemplateListItem[]> {
  return withActionGuard(
    { actionName: 'getRemarketingTemplates' },
    async (ctx) => {
      return await TemplateResolverService.listTemplates(ctx.db, ctx.tenantId, 'remarketing');
    }
  ).then(res => res.data || []);
}
