"use server";

import { withActionGuard } from "@/lib/core/action-guard";
import { resolvePatientTimezone, formatDualClock } from "@/lib/utils/timezone";
import { TemplateResolverService } from "@/lib/services/template-resolver.service";
import { CredentialsService } from "@/lib/services/credentials.service";
import { logger } from "@/lib/core/logger";
import { resolveTenantDisplayName } from "@/lib/services/meta/tenant-display-name-resolver";

const log = logger.withContext({ module: 'DraftApprovalActions' });

// ==========================================
// TYPES
// ==========================================

export type DraftStatus = 'pending_review' | 'edited' | 'approved' | 'rejected' | 'copied' | 'expired';

export interface DraftRow {
  draft_id: string; // Task ID, Log ID, or Lead ID
  source: 'bot_delegation' | 'appointment_reminder' | 'remarketing' | 'greeting';
  draft_type: string; // e.g., 'unreachable_followup', '3_days_before', etc.
  patient_name: string;
  masked_phone: string;
  phone: string;
  opportunity_id: string | null;
  conversation_id: string | null;
  lead_id: string | null;
  channel: 'whatsapp' | 'instagram' | 'messenger';
  language: string;
  priority: 'low' | 'normal' | 'high' | 'critical';
  stage: string;
  department: string;
  country: string;
  draft_text: string;
  draft_preview: string;
  generated_at: string;
  status: DraftStatus;
  risk_flags: string[];
  whatsapp_24h_window_status: 'open' | 'closed' | 'unknown';
  appointment_info?: {
    due_at: string | null;
    dual_clock?: any;
  };
  ai_summary?: string;
  ai_reason?: string;
}

// ==========================================
// HELPERS
// ==========================================

function maskPhone(phone: string): string {
  if (!phone) return '';
  const cleaned = phone.replace(/\D/g, '');
  if (cleaned.length < 6) return '***';

  let prefix = '';
  let lastFour = cleaned.slice(-4);

  if (cleaned.startsWith('90') && cleaned.length >= 10) {
    prefix = '+90';
  } else if (cleaned.startsWith('49') && cleaned.length >= 10) {
    prefix = '+49';
  } else if (cleaned.startsWith('33') && cleaned.length >= 10) {
    prefix = '+33';
  } else if (cleaned.startsWith('44') && cleaned.length >= 10) {
    prefix = '+44';
  } else if (cleaned.startsWith('1') && cleaned.length >= 10) {
    prefix = '+1';
  } else {
    prefix = `+${cleaned.substring(0, 2)}`;
  }

  const last2a = lastFour.substring(0, 2);
  const last2b = lastFour.substring(2, 4);

  return `${prefix} *** ** ${last2a} ${last2b}`;
}

function calculateRiskFlags(draft: {
  text: string;
  patientName?: string;
  phone?: string;
  stage?: string;
  optOut?: boolean;
  appointmentTime?: string;
  country?: string;
  lastInboundAt?: string;
}): string[] {
  const flags: string[] = [];

  if (!draft.text) return flags;

  // 1. WhatsApp 24h closed
  let isWindowClosed = true;
  if (draft.lastInboundAt) {
    const inboundTime = new Date(draft.lastInboundAt);
    const diffHours = (Date.now() - inboundTime.getTime()) / (1000 * 60 * 60);
    if (diffHours <= 24) {
      isWindowClosed = false;
    }
  }
  if (isWindowClosed) {
    flags.push('whatsapp_24h_window_closed');
    flags.push('template_required');
  }

  // 2. Missing info
  if (!draft.patientName || draft.patientName.trim() === '' || draft.patientName === 'Değerli Hastamız' || draft.patientName === 'İsimsiz Hasta') {
    flags.push('missing_patient_name');
  }
  if (!draft.phone) {
    flags.push('missing_phone');
  }
  if (['confirm_phone_call', 'clinic_appointment_reminder', 'appointment_reschedule_request'].includes(draft.text) && !draft.appointmentTime) {
    flags.push('missing_appointment_time');
  }

  // 3. Medical claim risk
  const riskyTerms = ['tedavi', 'garanti', 'kesin', '100%', 'ilaç', 'iyileşme', 'şifa'];
  if (riskyTerms.some(term => draft.text.toLowerCase().includes(term))) {
    flags.push('medical_claim_risk');
  }

  // 4. Timezone warning (sleep hours: 22:00 - 09:00 patient time)
  if (draft.country) {
    const tzRes = resolvePatientTimezone(draft.country);
    if (tzRes.timezone) {
      try {
        const patientHour = parseInt(new Date().toLocaleTimeString('en-US', {
          timeZone: tzRes.timezone,
          hour12: false,
          hour: '2-digit'
        }));
        if (patientHour >= 22 || patientHour < 9) {
          flags.push('timezone_warning');
        }
      } catch (_) {}
    }
  }

  // 5. Long message
  if (draft.text.length > 500) {
    flags.push('long_message');
  }

  // 6. Opt out
  if (draft.optOut) {
    flags.push('opt_out_detected');
  }

  return flags;
}

// ==========================================
// ACTIONS
// ==========================================

export async function getPendingDrafts(filters?: {
  type?: string;
  query?: string;
  lang?: string;
  priority?: string;
}) {
  return withActionGuard(
    { actionName: 'getPendingDrafts' },
    async (ctx) => {
      const db = ctx.db;
      const allDrafts: DraftRow[] = [];

      // ────────────────────────────────────────────────────────
      // 1. Fetch Bot Delegation Drafts
      // ────────────────────────────────────────────────────────
      if (!filters?.type || filters.type === 'all' || filters.type === 'bot_delegation') {
        const botTasks = await db.executeSafe({
          text: `
            SELECT t.id, t.opportunity_id, t.phone_number, t.created_at, t.metadata,
                   o.patient_name, o.stage, o.department, o.country, o.summary, o.ai_reason,
                   c.id as conv_id
            FROM follow_up_tasks t
            LEFT JOIN opportunities o ON o.id::text = t.opportunity_id::text AND o.tenant_id = t.tenant_id
            LEFT JOIN conversations c ON c.id::text = o.conversation_id::text AND c.tenant_id = o.tenant_id
            WHERE t.tenant_id = $1
              AND t.task_type = 'bot_handoff_followup'
              AND t.status = 'in_progress'
              AND t.metadata->'bot_delegation'->>'status' = 'draft_ready'
          `,
          values: [ctx.tenantId]
        }) as any[];

        for (const task of botTasks) {
          const meta = typeof task.metadata === 'string' ? JSON.parse(task.metadata) : (task.metadata || {});
          const botDel = meta.bot_delegation || {};
          
          // Get last inbound message time
          const lastInbound = await db.executeSafe({
            text: `SELECT created_at FROM messages WHERE phone_number = $1 AND tenant_id = $2 AND direction = 'in' ORDER BY created_at DESC LIMIT 1`,
            values: [task.phone_number, ctx.tenantId]
          }) as any[];
          const lastInboundAt = lastInbound[0]?.created_at;

          // Dual clock
          let dualClock;
          if (botDel.appointment_task_id) {
            const appt = await db.executeSafe({
              text: `SELECT due_at FROM follow_up_tasks WHERE id = $1 LIMIT 1`,
              values: [botDel.appointment_task_id]
            }) as any[];
            if (appt.length > 0 && appt[0].due_at) {
              dualClock = formatDualClock(appt[0].due_at, task.country);
            }
          }

          const txt = botDel.generated_draft || '';
          const riskFlags = calculateRiskFlags({
            text: txt,
            patientName: task.patient_name,
            phone: task.phone_number,
            stage: task.stage,
            optOut: meta.opt_out_requested === true,
            country: task.country,
            lastInboundAt
          });

          allDrafts.push({
            draft_id: task.id,
            source: 'bot_delegation',
            draft_type: botDel.mode || 'unreachable_followup',
            patient_name: task.patient_name || 'İsimsiz Hasta',
            masked_phone: maskPhone(task.phone_number),
            phone: task.phone_number || '',
            opportunity_id: task.opportunity_id,
            conversation_id: task.conv_id || null,
            lead_id: null,
            channel: 'whatsapp',
            language: 'tr',
            priority: task.priority || 'normal',
            stage: task.stage || 'first_contact',
            department: task.department || '',
            country: task.country || 'TR',
            draft_text: txt,
            draft_preview: txt.slice(0, 100) + (txt.length > 100 ? '...' : ''),
            generated_at: botDel.generated_draft_at || task.created_at,
            status: 'pending_review',
            risk_flags: riskFlags,
            whatsapp_24h_window_status: lastInboundAt 
              ? ((Date.now() - new Date(lastInboundAt).getTime()) / (1000 * 60 * 60) <= 24 ? 'open' : 'closed')
              : 'unknown',
            appointment_info: botDel.appointment_task_id ? {
              due_at: null,
              dual_clock: dualClock
            } : undefined,
            ai_summary: task.summary || undefined,
            ai_reason: task.ai_reason || undefined
          });
        }
      }

      // ────────────────────────────────────────────────────────
      // 2. Fetch Appointment Reminder Drafts
      // ────────────────────────────────────────────────────────
      if (!filters?.type || filters.type === 'all' || filters.type === 'appointment_reminder') {
        const reminderTasks = await db.executeSafe({
          text: `
            SELECT t.id, t.opportunity_id, t.phone_number, t.created_at, t.metadata,
                   o.patient_name, o.stage, o.department, o.country, o.summary, o.ai_reason,
                   c.id as conv_id
            FROM follow_up_tasks t
            LEFT JOIN opportunities o ON o.id::text = t.opportunity_id::text AND o.tenant_id = t.tenant_id
            LEFT JOIN conversations c ON c.id::text = o.conversation_id::text AND c.tenant_id = o.tenant_id
            WHERE t.tenant_id = $1
              AND t.task_type = 'appointment_reminder'
              AND t.status = 'completed'
              AND t.metadata->>'generated_draft' IS NOT NULL
              AND NOT EXISTS (
                SELECT 1 FROM outreach_logs ol 
                WHERE ol.metadata->>'reminder_task_id' = t.id::text 
                  AND ol.action IN ('appointment_reminder_approved', 'appointment_reminder_rejected')
              )
          `,
          values: [ctx.tenantId]
        }) as any[];

        for (const task of reminderTasks) {
          const meta = typeof task.metadata === 'string' ? JSON.parse(task.metadata) : (task.metadata || {});
          
          const lastInbound = await db.executeSafe({
            text: `SELECT created_at FROM messages WHERE phone_number = $1 AND tenant_id = $2 AND direction = 'in' ORDER BY created_at DESC LIMIT 1`,
            values: [task.phone_number, ctx.tenantId]
          }) as any[];
          const lastInboundAt = lastInbound[0]?.created_at;

          const txt = meta.generated_draft || '';
          const riskFlags = calculateRiskFlags({
            text: txt,
            patientName: task.patient_name,
            phone: task.phone_number,
            stage: task.stage,
            optOut: meta.opt_out_requested === true,
            country: task.country,
            lastInboundAt
          });

          allDrafts.push({
            draft_id: task.id,
            source: 'appointment_reminder',
            draft_type: meta.reminder_type || 'custom_reminder',
            patient_name: task.patient_name || 'İsimsiz Hasta',
            masked_phone: maskPhone(task.phone_number),
            phone: task.phone_number || '',
            opportunity_id: task.opportunity_id,
            conversation_id: task.conv_id || null,
            lead_id: null,
            channel: 'whatsapp',
            language: 'tr',
            priority: task.priority || 'normal',
            stage: task.stage || 'first_contact',
            department: task.department || '',
            country: task.country || 'TR',
            draft_text: txt,
            draft_preview: txt.slice(0, 100) + (txt.length > 100 ? '...' : ''),
            generated_at: meta.generated_draft_at || task.created_at,
            status: 'pending_review',
            risk_flags: riskFlags,
            whatsapp_24h_window_status: lastInboundAt 
              ? ((Date.now() - new Date(lastInboundAt).getTime()) / (1000 * 60 * 60) <= 24 ? 'open' : 'closed')
              : 'unknown',
            appointment_info: meta.scheduled_for_appointment_at ? {
              due_at: meta.scheduled_for_appointment_at,
              dual_clock: formatDualClock(meta.scheduled_for_appointment_at, task.country)
            } : undefined,
            ai_summary: task.summary || undefined,
            ai_reason: task.ai_reason || undefined
          });
        }
      }

      // ────────────────────────────────────────────────────────
      // 3. Fetch Remarketing Drafts
      // ────────────────────────────────────────────────────────
      if (!filters?.type || filters.type === 'all' || filters.type === 'remarketing') {
        const remarketingLogs = await db.executeSafe({
          text: `
            SELECT ol.id, ol.opportunity_id, o.phone_number, ol.created_at, ol.metadata,
                   o.patient_name, o.stage, o.department, o.country, o.summary, o.ai_reason,
                   c.id as conv_id, l.id as lead_id
            FROM outreach_logs ol
            JOIN opportunities o ON o.id::text = ol.opportunity_id::text AND o.tenant_id::text = ol.tenant_id::text
            LEFT JOIN conversations c ON c.id::text = o.conversation_id::text AND c.tenant_id = o.tenant_id
            LEFT JOIN leads l ON (l.customer_id::text = c.customer_id::text OR RIGHT(l.phone_number, 10) = RIGHT(o.phone_number, 10)) AND l.tenant_id = o.tenant_id
            WHERE ol.tenant_id = $1
              AND ol.action = 'remarketing_draft_prepared'
              AND o.stage NOT IN ('lost', 'not_qualified', 'arrived', 'not_interested')
              AND NOT EXISTS (
                SELECT 1 FROM outreach_logs ol2 
                WHERE ol2.opportunity_id = ol.opportunity_id 
                  AND ol2.action IN ('remarketing_draft_approved', 'remarketing_draft_rejected')
                  AND ol2.created_at > ol.created_at
              )
          `,
          values: [ctx.tenantId]
        }) as any[];

        for (const logItem of remarketingLogs) {
          const meta = typeof logItem.metadata === 'string' ? JSON.parse(logItem.metadata) : (logItem.metadata || {});
          
          const lastInbound = await db.executeSafe({
            text: `SELECT created_at FROM messages WHERE phone_number = $1 AND tenant_id = $2 AND direction = 'in' ORDER BY created_at DESC LIMIT 1`,
            values: [logItem.phone_number, ctx.tenantId]
          }) as any[];
          const lastInboundAt = lastInbound[0]?.created_at;

          const txt = meta.draftText || meta.draft || '';
          const riskFlags = calculateRiskFlags({
            text: txt,
            patientName: logItem.patient_name,
            phone: logItem.phone_number,
            stage: logItem.stage,
            optOut: meta.opt_out_requested === true,
            country: logItem.country,
            lastInboundAt
          });

          allDrafts.push({
            draft_id: logItem.id,
            source: 'remarketing',
            draft_type: 'remarketing_draft',
            patient_name: logItem.patient_name || 'İsimsiz Hasta',
            masked_phone: maskPhone(logItem.phone_number),
            phone: logItem.phone_number || '',
            opportunity_id: logItem.opportunity_id,
            conversation_id: logItem.conv_id || null,
            lead_id: logItem.lead_id || null,
            channel: 'whatsapp',
            language: 'tr',
            priority: 'normal',
            stage: logItem.stage || 'first_contact',
            department: logItem.department || '',
            country: logItem.country || 'TR',
            draft_text: txt,
            draft_preview: txt.slice(0, 100) + (txt.length > 100 ? '...' : ''),
            generated_at: meta.saved_at || logItem.created_at,
            status: 'pending_review',
            risk_flags: riskFlags,
            whatsapp_24h_window_status: lastInboundAt 
              ? ((Date.now() - new Date(lastInboundAt).getTime()) / (1000 * 60 * 60) <= 24 ? 'open' : 'closed')
              : 'unknown',
            ai_summary: logItem.summary || undefined,
            ai_reason: logItem.ai_reason || undefined
          });
        }

        // Fetch No-Reply Automation tasks (Disabled for Onay Merkezi - handled inbox-native & takip)
        const noReplyTasks: any[] = [];
      }

      // ────────────────────────────────────────────────────────
      // 4. Fetch Dynamic Greeting Drafts
      // ────────────────────────────────────────────────────────
      if (!filters?.type || filters.type === 'all' || filters.type === 'greeting') {
        const pendingLeads = await db.executeSafe({
          text: `
            SELECT l.id, l.linked_opportunity_id, l.phone_number, l.created_at, l.patient_name, l.form_name, l.country, l.raw_data,
                   o.stage, o.department, o.summary, o.ai_reason, c.id as conv_id
            FROM leads l
            LEFT JOIN opportunities o ON o.id::text = l.linked_opportunity_id::text AND o.tenant_id::text = l.tenant_id::text
            LEFT JOIN conversations c ON (c.customer_id::text = l.customer_id::text OR RIGHT(c.phone_number, 10) = RIGHT(l.phone_number, 10)) AND c.tenant_id::text = l.tenant_id::text
            WHERE l.tenant_id = $1
              AND (o.id IS NULL OR o.stage NOT IN ('lost', 'not_qualified', 'arrived', 'not_interested'))
              AND NOT EXISTS (
                SELECT 1 FROM outreach_logs ol
                WHERE ol.lead_id = l.id
                  AND ol.action IN ('greeting_sent', 'bot_activated', 'greeting_draft_rejected', 'greeting_draft_approved')
              )
            ORDER BY l.created_at DESC
            LIMIT 50
          `,
          values: [ctx.tenantId]
        }) as any[];

        for (const lead of pendingLeads) {
          // Resolve dynamically using TemplateResolverService (on-the-fly)
          let resolvedDraft = 'Merhaba, sizinle randevu ve takip detaylarını görüşmek isteriz.';
          let templateName = 'Sistem Varsayılanı';
          let templateId = null;

          try {
            let tenantName = 'Ekibimiz';
             const resolvedName = await resolveTenantDisplayName(db, ctx.tenantId);
             if (resolvedName) tenantName = resolvedName;

            const resolved = await TemplateResolverService.resolve(db, {
              tenantId: ctx.tenantId,
              tenantName,
              patientName: lead.patient_name || '',
              formName: lead.form_name || undefined,
              department: lead.department || undefined,
              country: lead.country || undefined,
              phoneNumber: lead.phone_number,
            }, 'auto');
            
            resolvedDraft = resolved.rendered;
            templateName = resolved.templateName;
            templateId = resolved.templateId || null;
          } catch (_) {}

          resolvedDraft += '\n\n*(Not: Bu taslak sadece koordinatör içindir, hastaya otomatik gönderilmez.)*';

          const riskFlags = calculateRiskFlags({
            text: resolvedDraft,
            patientName: lead.patient_name,
            phone: lead.phone_number,
            stage: lead.stage,
            country: lead.country
          });

          allDrafts.push({
            draft_id: lead.id,
            source: 'greeting',
            draft_type: 'greeting_draft',
            patient_name: lead.patient_name || 'İsimsiz Hasta',
            masked_phone: maskPhone(lead.phone_number),
            phone: lead.phone_number || '',
            opportunity_id: lead.linked_opportunity_id || null,
            conversation_id: lead.conv_id || null,
            lead_id: lead.id,
            channel: 'whatsapp',
            language: 'tr',
            priority: 'normal',
            stage: lead.stage || 'first_contact',
            department: lead.department || '',
            country: lead.country || 'TR',
            draft_text: resolvedDraft,
            draft_preview: resolvedDraft.slice(0, 100) + (resolvedDraft.length > 100 ? '...' : ''),
            generated_at: lead.created_at,
            status: 'pending_review',
            risk_flags: riskFlags,
            whatsapp_24h_window_status: 'closed', // Greeting is first-contact, window usually closed/needs template
            ai_summary: lead.summary || undefined,
            ai_reason: lead.ai_reason || undefined
          });
        }
      }

      // Apply in-memory filters
      let filtered = allDrafts;

      if (filters?.query) {
        const q = filters.query.toLowerCase();
        filtered = filtered.filter(d => 
          d.patient_name.toLowerCase().includes(q) || 
          d.phone.includes(q) ||
          d.department.toLowerCase().includes(q) ||
          d.country.toLowerCase().includes(q)
        );
      }

      if (filters?.priority && filters.priority !== 'all') {
        filtered = filtered.filter(d => d.priority === filters.priority);
      }

      // Sort by generated_at DESC
      filtered.sort((a, b) => new Date(b.generated_at).getTime() - new Date(a.generated_at).getTime());

      return filtered;
    }
  );
}

export async function getDraftApprovalDetail(draftId: string, source: 'bot_delegation' | 'appointment_reminder' | 'remarketing' | 'greeting') {
  return withActionGuard(
    { actionName: 'getDraftApprovalDetail' },
    async (ctx) => {
      const db = ctx.db;

      // Log draft review opened action in audit
      await db.executeSafe({
        text: `INSERT INTO outreach_logs (tenant_id, action, actor_id, metadata)
               VALUES ($1, 'draft_review_opened', $2, $3::jsonb)`,
        values: [
          ctx.tenantId,
          ctx.userId,
          JSON.stringify({ draft_id: draftId, source, zero_outbound_p0: true })
        ]
      });

      // Quick fetch of details
      const drafts = await getPendingDrafts({ type: source });
      const draft = drafts.data?.find(d => d.draft_id === draftId);
      
      if (!draft) {
        throw new Error('Taslak detayı bulunamadı.');
      }

      return draft;
    }
  );
}

export async function updateDraftText(draftId: string, source: 'bot_delegation' | 'appointment_reminder' | 'remarketing' | 'greeting', editedText: string) {
  return withActionGuard(
    { actionName: 'updateDraftText' },
    async (ctx) => {
      if (!editedText || editedText.trim() === '') {
        throw new Error('Taslak metni boş olamaz.');
      }
      if (editedText.length > 4096) {
        throw new Error('Taslak metni en fazla 4096 karakter olabilir.');
      }

      const db = ctx.db;

      // Log draft edit audit log
      await db.executeSafe({
        text: `INSERT INTO outreach_logs (tenant_id, action, actor_id, metadata)
               VALUES ($1, 'draft_text_edited', $2, $3::jsonb)`,
        values: [
          ctx.tenantId,
          ctx.userId,
          JSON.stringify({ draft_id: draftId, source, editedText, zero_outbound_p0: true })
        ]
      });

      if (source === 'bot_delegation') {
        const task = await db.executeSafe(`SELECT metadata FROM follow_up_tasks WHERE id = $1 AND tenant_id = $2`, [draftId, ctx.tenantId]);
        if (task.length > 0) {
          const meta = typeof task[0].metadata === 'string' ? JSON.parse(task[0].metadata) : task[0].metadata;
          if (meta.bot_delegation) {
            meta.bot_delegation.generated_draft = editedText;
            meta.bot_delegation.status = 'edited';
            await db.executeSafe(`UPDATE follow_up_tasks SET metadata = $1::jsonb WHERE id = $2 AND tenant_id = $3`, [JSON.stringify(meta), draftId, ctx.tenantId]);
          }
        }
      } else if (source === 'appointment_reminder') {
        const task = await db.executeSafe(`SELECT metadata FROM follow_up_tasks WHERE id = $1 AND tenant_id = $2`, [draftId, ctx.tenantId]);
        if (task.length > 0) {
          const meta = typeof task[0].metadata === 'string' ? JSON.parse(task[0].metadata) : task[0].metadata;
          meta.generated_draft = editedText;
          await db.executeSafe(`UPDATE follow_up_tasks SET metadata = $1::jsonb WHERE id = $2 AND tenant_id = $3`, [JSON.stringify(meta), draftId, ctx.tenantId]);
        }
      } else if (source === 'remarketing') {
        const task = await db.executeSafe(`SELECT metadata FROM follow_up_tasks WHERE id = $1 AND tenant_id = $2`, [draftId, ctx.tenantId]);
        if (task.length > 0) {
          const meta = typeof task[0].metadata === 'string' ? JSON.parse(task[0].metadata) : task[0].metadata;
          meta.draft_text = editedText;
          await db.executeSafe(`UPDATE follow_up_tasks SET metadata = $1::jsonb WHERE id = $2 AND tenant_id = $3`, [JSON.stringify(meta), draftId, ctx.tenantId]);
        } else {
          const logItem = await db.executeSafe(`SELECT metadata FROM outreach_logs WHERE id = $1 AND tenant_id = $2`, [draftId, ctx.tenantId]);
          if (logItem.length > 0) {
            const meta = typeof logItem[0].metadata === 'string' ? JSON.parse(logItem[0].metadata) : logItem[0].metadata;
            if (meta.draftText !== undefined) meta.draftText = editedText;
            if (meta.draft !== undefined) meta.draft = editedText;
            await db.executeSafe(`UPDATE outreach_logs SET metadata = $1::jsonb WHERE id = $2 AND tenant_id = $3`, [JSON.stringify(meta), draftId, ctx.tenantId]);
          }
        }
      }

      return { success: true };
    }
  );
}

export async function markDraftApproved(draftId: string, source: 'bot_delegation' | 'appointment_reminder' | 'remarketing' | 'greeting', editedText: string) {
  return withActionGuard(
    { actionName: 'markDraftApproved' },
    async (ctx) => {
      const db = ctx.db;

      // 1. Fetch draft info to get opportunity/lead info
      const drafts = await getPendingDrafts({ type: source });
      const draft = drafts.data?.find(d => d.draft_id === draftId);

      const oppId = draft?.opportunity_id || null;
      const leadId = draft?.lead_id || null;

      // 2. Perform updates depending on source
      if (source === 'bot_delegation') {
        // Complete the task under 2V life-cycle
        const task = await db.executeSafe(`SELECT metadata FROM follow_up_tasks WHERE id = $1 AND tenant_id = $2`, [draftId, ctx.tenantId]);
        if (task.length > 0) {
          const meta = typeof task[0].metadata === 'string' ? JSON.parse(task[0].metadata) : task[0].metadata;
          meta.bot_delegation.status = 'completed';
          meta.bot_delegation.generated_draft = editedText;
          meta.bot_delegation.approved_at = new Date().toISOString();
          
          await db.executeSafe(`
            UPDATE follow_up_tasks 
            SET status = 'completed', metadata = $1::jsonb, updated_at = NOW() 
            WHERE id = $2 AND tenant_id = $3
          `, [JSON.stringify(meta), draftId, ctx.tenantId]);
        }

        // Insert outreach log
        await db.executeSafe({
          text: `INSERT INTO outreach_logs (tenant_id, opportunity_id, action, actor_id, metadata)
                 VALUES ($1, $2, 'bot_delegation_completed', $3, $4::jsonb)`,
          values: [
            ctx.tenantId, oppId, ctx.userId,
            JSON.stringify({ task_id: draftId, draft: editedText, zero_outbound_p0: true })
          ]
        });

      } else if (source === 'appointment_reminder') {
        // Mark as approved in outreach logs so it disappears from queue
        await db.executeSafe({
          text: `INSERT INTO outreach_logs (tenant_id, opportunity_id, action, actor_id, metadata)
                 VALUES ($1, $2, 'appointment_reminder_approved', $3, $4::jsonb)`,
          values: [
            ctx.tenantId, oppId, ctx.userId,
            JSON.stringify({ reminder_task_id: draftId, draft: editedText, zero_outbound_p0: true })
          ]
        });
      } else if (source === 'remarketing') {
        const task = await db.executeSafe(`SELECT metadata FROM follow_up_tasks WHERE id = $1 AND tenant_id = $2`, [draftId, ctx.tenantId]);
        if (task.length > 0) {
          const meta = typeof task[0].metadata === 'string' ? JSON.parse(task[0].metadata) : task[0].metadata;
          meta.sent = true;
          meta.approved_at = new Date().toISOString();
          meta.approved_draft = editedText;

          await db.executeSafe(`
            UPDATE follow_up_tasks 
            SET status = 'completed', metadata = $1::jsonb, updated_at = NOW() 
            WHERE id = $2 AND tenant_id = $3
          `, [JSON.stringify(meta), draftId, ctx.tenantId]);

          await db.executeSafe({
            text: `INSERT INTO outreach_logs (tenant_id, opportunity_id, action, actor_id, metadata)
                   VALUES ($1, $2, 'no_reply_automation_draft_approved', $3, $4::jsonb)`,
            values: [
              ctx.tenantId, oppId, ctx.userId,
              JSON.stringify({
                dedupe_key: meta.dedupe_key,
                attempt_number: meta.attempt_number,
                draft: editedText,
                zero_outbound_p0: true
              })
            ]
          });
        } else {
          await db.executeSafe({
            text: `INSERT INTO outreach_logs (tenant_id, opportunity_id, action, actor_id, metadata)
                   VALUES ($1, $2, 'remarketing_draft_approved', $3, $4::jsonb)`,
            values: [
              ctx.tenantId, oppId, ctx.userId,
              JSON.stringify({ remarketing_log_id: draftId, draft: editedText, zero_outbound_p0: true })
            ]
          });
        }
      } else if (source === 'greeting') {
        // Mark as approved in outreach logs so it disappears from queue
        await db.executeSafe({
          text: `INSERT INTO outreach_logs (tenant_id, lead_id, opportunity_id, action, actor_id, metadata)
                 VALUES ($1, $2, $3, 'greeting_draft_approved', $4, $5::jsonb)`,
          values: [
            ctx.tenantId, leadId, oppId, ctx.userId,
            JSON.stringify({ draft: editedText, zero_outbound_p0: true })
          ]
        });
      }

      // General draft audit log
      await db.executeSafe({
        text: `INSERT INTO outreach_logs (tenant_id, action, actor_id, metadata)
               VALUES ($1, 'draft_approved', $2, $3::jsonb)`,
        values: [
          ctx.tenantId,
          ctx.userId,
          JSON.stringify({ draft_id: draftId, source, approved_draft: editedText, zero_outbound_p0: true })
        ]
      });

      return { success: true };
    }
  );
}

export async function markDraftRejected(draftId: string, source: 'bot_delegation' | 'appointment_reminder' | 'remarketing' | 'greeting', reason?: string) {
  return withActionGuard(
    { actionName: 'markDraftRejected' },
    async (ctx) => {
      const db = ctx.db;

      const drafts = await getPendingDrafts({ type: source });
      const draft = drafts.data?.find(d => d.draft_id === draftId);
      const oppId = draft?.opportunity_id || null;
      const leadId = draft?.lead_id || null;

      if (source === 'bot_delegation') {
        const task = await db.executeSafe(`SELECT metadata FROM follow_up_tasks WHERE id = $1 AND tenant_id = $2`, [draftId, ctx.tenantId]);
        if (task.length > 0) {
          const meta = typeof task[0].metadata === 'string' ? JSON.parse(task[0].metadata) : task[0].metadata;
          meta.bot_delegation.status = 'cancelled';
          meta.bot_delegation.rejected_at = new Date().toISOString();
          meta.bot_delegation.reject_reason = reason || 'Reddedildi';

          await db.executeSafe(`
            UPDATE follow_up_tasks 
            SET status = 'cancelled', skipped_reason = $1, metadata = $2::jsonb, updated_at = NOW() 
            WHERE id = $3 AND tenant_id = $4
          `, [`Rejected: ${reason || 'Reddedildi'}`, JSON.stringify(meta), draftId, ctx.tenantId]);
        }

        await db.executeSafe({
          text: `INSERT INTO outreach_logs (tenant_id, opportunity_id, action, actor_id, metadata)
                 VALUES ($1, $2, 'bot_delegation_cancelled', $3, $4::jsonb)`,
          values: [
            ctx.tenantId, oppId, ctx.userId,
            JSON.stringify({ task_id: draftId, reason: reason || 'Reddedildi', zero_outbound_p0: true })
          ]
        });

      } else if (source === 'appointment_reminder') {
        await db.executeSafe({
          text: `INSERT INTO outreach_logs (tenant_id, opportunity_id, action, actor_id, metadata)
                 VALUES ($1, $2, 'appointment_reminder_rejected', $3, $4::jsonb)`,
          values: [
            ctx.tenantId, oppId, ctx.userId,
            JSON.stringify({ reminder_task_id: draftId, reason: reason || 'Reddedildi', zero_outbound_p0: true })
          ]
        });
      } else if (source === 'remarketing') {
        const task = await db.executeSafe(`SELECT metadata FROM follow_up_tasks WHERE id = $1 AND tenant_id = $2`, [draftId, ctx.tenantId]);
        if (task.length > 0) {
          const meta = typeof task[0].metadata === 'string' ? JSON.parse(task[0].metadata) : task[0].metadata;
          meta.rejected_at = new Date().toISOString();
          meta.reject_reason = reason || 'Reddedildi';

          await db.executeSafe(`
            UPDATE follow_up_tasks 
            SET status = 'cancelled', skipped_reason = $1, metadata = $2::jsonb, updated_at = NOW() 
            WHERE id = $3 AND tenant_id = $4
          `, [`Rejected: ${reason || 'Reddedildi'}`, JSON.stringify(meta), draftId, ctx.tenantId]);

          await db.executeSafe({
            text: `INSERT INTO outreach_logs (tenant_id, opportunity_id, action, actor_id, metadata)
                   VALUES ($1, $2, 'no_reply_automation_draft_rejected', $3, $4::jsonb)`,
            values: [
              ctx.tenantId, oppId, ctx.userId,
              JSON.stringify({
                dedupe_key: meta.dedupe_key,
                attempt_number: meta.attempt_number,
                reason: reason || 'Reddedildi',
                zero_outbound_p0: true
              })
            ]
          });
        } else {
          await db.executeSafe({
            text: `INSERT INTO outreach_logs (tenant_id, opportunity_id, action, actor_id, metadata)
                   VALUES ($1, $2, 'remarketing_draft_rejected', $3, $4::jsonb)`,
            values: [
              ctx.tenantId, oppId, ctx.userId,
              JSON.stringify({ remarketing_log_id: draftId, reason: reason || 'Reddedildi', zero_outbound_p0: true })
            ]
          });
        }
      } else if (source === 'greeting') {
        await db.executeSafe({
          text: `INSERT INTO outreach_logs (tenant_id, lead_id, opportunity_id, action, actor_id, metadata)
                 VALUES ($1, $2, $3, 'greeting_draft_rejected', $4, $5::jsonb)`,
          values: [
            ctx.tenantId, leadId, oppId, ctx.userId,
            JSON.stringify({ reason: reason || 'Reddedildi', zero_outbound_p0: true })
          ]
        });
      }

      await db.executeSafe({
        text: `INSERT INTO outreach_logs (tenant_id, action, actor_id, metadata)
               VALUES ($1, 'draft_rejected', $2, $3::jsonb)`,
        values: [
          ctx.tenantId,
          ctx.userId,
          JSON.stringify({ draft_id: draftId, source, reason: reason || 'Reddedildi', zero_outbound_p0: true })
        ]
      });

      return { success: true };
    }
  );
}

export async function markDraftCopied(draftId: string, source: 'bot_delegation' | 'appointment_reminder' | 'remarketing' | 'greeting') {
  return withActionGuard(
    { actionName: 'markDraftCopied' },
    async (ctx) => {
      const db = ctx.db;

      await db.executeSafe({
        text: `INSERT INTO outreach_logs (tenant_id, action, actor_id, metadata)
               VALUES ($1, 'draft_copied', $2, $3::jsonb)`,
        values: [
          ctx.tenantId,
          ctx.userId,
          JSON.stringify({ draft_id: draftId, source, zero_outbound_p0: true })
        ]
      });

      return { success: true };
    }
  );
}

export async function getDraftApprovalStats() {
  return withActionGuard(
    { actionName: 'getDraftApprovalStats' },
    async (ctx) => {
      const db = ctx.db;

      const drafts = await getPendingDrafts();
      const list = drafts.data || [];

      const pending = list.length;
      
      // Dynamic calculated metrics
      const botDelegationCount = list.filter(d => d.source === 'bot_delegation').length;
      const reminderCount = list.filter(d => d.source === 'appointment_reminder').length;
      const remarketingCount = list.filter(d => d.source === 'remarketing').length;
      const greetingCount = list.filter(d => d.source === 'greeting').length;

      const riskyCount = list.filter(d => d.risk_flags.length > 0).length;

      // Calculate drafts generated today (TR timezone)
      const todayStr = new Date().toLocaleDateString('en-CA', { timeZone: 'Europe/Istanbul' }); // YYYY-MM-DD
      const generatedToday = list.filter(d => {
        try {
          const dStr = new Date(d.generated_at).toLocaleDateString('en-CA', { timeZone: 'Europe/Istanbul' });
          return dStr === todayStr;
        } catch (_) {
          return false;
        }
      }).length;

      return {
        pending,
        generatedToday,
        botDelegationCount,
        reminderCount,
        remarketingCount,
        greetingCount,
        riskyCount
      };
    }
  );
}
