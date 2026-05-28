"use server";

import { withActionGuard } from "@/lib/core/action-guard";
import { RuleEvaluatorService, type RuleCondition, type RuleAction } from "@/lib/services/automation/rule-evaluator.service";
import { logger } from "@/lib/core/logger";

const log = logger.withContext({ module: 'AutomationRulesActions' });

// Whitelist configuration
const ALLOWED_TRIGGERS = ['form_submission', 'opportunity_stage_changed', 'task_overdue'];
const ALLOWED_ACTIONS = ['create_task', 'send_notification', 'audit_log'];
const FORBIDDEN_ACTIONS = [
  'telegram_notification', 'send_whatsapp', 'send_message', 'send_media', 
  'greeting_send', 'webhook_call', 'external_api', 'sql_raw'
];

/**
 * Server-side validation for rule schema and parameter constraints
 */
function validateRulePayload(name: string, triggerEvent: string, conditions: any[], actions: any[]) {
  if (!name || name.trim() === "") {
    throw new Error("Kural adı zorunludur.");
  }
  if (!ALLOWED_TRIGGERS.includes(triggerEvent)) {
    throw new Error(`Geçersiz tetikleyici olay: ${triggerEvent}`);
  }
  if (!Array.isArray(conditions)) {
    throw new Error("Koşullar geçerli bir dizi (array) olmalıdır.");
  }
  if (!Array.isArray(actions) || actions.length === 0) {
    throw new Error("Kural en az bir aksiyon içermelidir.");
  }

  // Validate conditions
  for (const cond of conditions) {
    if (!cond.field || !cond.operator) {
      throw new Error("Geçersiz koşul formatı.");
    }
  }

  // Validate actions (Whitelist & Blacklist check)
  for (const action of actions) {
    if (!action.type) {
      throw new Error("Aksiyon tipi zorunludur.");
    }
    if (FORBIDDEN_ACTIONS.includes(action.type)) {
      throw new Error(`Aksiyon '${action.type}' güvenlik politikası gereği BLOKLANMIŞTIR.`);
    }
    if (!ALLOWED_ACTIONS.includes(action.type)) {
      throw new Error(`Desteklenmeyen aksiyon tipi: ${action.type}`);
    }

    // Template size safety limit
    if (action.title && action.title.length > 4096) {
      throw new Error("Aksiyon başlığı 4096 karakter sınırını aşamaz.");
    }
    if (action.description && action.description.length > 4096) {
      throw new Error("Aksiyon açıklaması 4096 karakter sınırını aşamaz.");
    }
    if (action.body && action.body.length > 4096) {
      throw new Error("Aksiyon metni 4096 karakter sınırını aşamaz.");
    }

    // Required fields check
    if (action.type === 'create_task') {
      if (!action.task_type) throw new Error("create_task aksiyonu için görev tipi zorunludur.");
      if (!action.title) throw new Error("create_task aksiyonu için görev başlığı zorunludur.");
    }
    if (action.type === 'send_notification') {
      if (!action.category) throw new Error("send_notification aksiyonu için kategori zorunludur.");
      if (!action.title) throw new Error("send_notification aksiyonu için bildirim başlığı zorunludur.");
      if (!action.body) throw new Error("send_notification aksiyonu için bildirim metni zorunludur.");
    }
  }
}

// ── QUERIES ──

export async function getAutomationRules() {
  return withActionGuard(
    { actionName: 'getAutomationRules' },
    async (ctx) => {
      // Exclude archived rules: metadata->>'archived_at' IS NULL
      return await ctx.db.executeSafe({
        text: `SELECT * FROM automation_rules 
               WHERE tenant_id = $1 AND (metadata->>'archived_at' IS NULL)
               ORDER BY created_at DESC`,
        values: [ctx.tenantId]
      }) as any[];
    }
  ).then(res => res.data || []);
}

export async function getAutomationRule(id: string) {
  return withActionGuard(
    { actionName: 'getAutomationRule' },
    async (ctx) => {
      const rows = await ctx.db.executeSafe({
        text: `SELECT * FROM automation_rules 
               WHERE id = $1 AND tenant_id = $2 AND (metadata->>'archived_at' IS NULL)
               LIMIT 1`,
        values: [id, ctx.tenantId]
      }) as any[];
      return rows[0] || null;
    }
  ).then(res => res.data || null);
}

export async function getAutomationRuns(ruleId?: string) {
  return withActionGuard(
    { actionName: 'getAutomationRuns' },
    async (ctx) => {
      let queryText = `
        SELECT r.*, ar.name as rule_name 
        FROM automation_runs r
        JOIN automation_rules ar ON ar.id = r.rule_id
        WHERE r.tenant_id = $1
      `;
      const values: any[] = [ctx.tenantId];

      if (ruleId) {
        queryText += ` AND r.rule_id = $2`;
        values.push(ruleId);
      }

      queryText += ` ORDER BY r.created_at DESC LIMIT 50`;

      return await ctx.db.executeSafe({ text: queryText, values }) as any[];
    }
  ).then(res => res.data || []);
}

export async function getAutomationTestEntities() {
  return withActionGuard(
    { actionName: 'getAutomationTestEntities' },
    async (ctx) => {
      // Get last 5 leads for testing
      return await ctx.db.executeSafe({
        text: `SELECT id, patient_name as name, phone_number, form_name, source, email, created_at 
               FROM leads 
               WHERE tenant_id = $1 
               ORDER BY created_at DESC 
               LIMIT 5`,
        values: [ctx.tenantId]
      }) as any[];
    }
  ).then(res => res.data || []);
}

// ── MUTATIONS ──

export async function createAutomationRule(input: {
  name: string;
  description?: string;
  triggerEvent: string;
  conditions: RuleCondition[];
  actions: RuleAction[];
}) {
  return withActionGuard(
    { actionName: 'createAutomationRule' },
    async (ctx) => {
      // Server-side validation
      validateRulePayload(input.name, input.triggerEvent, input.conditions, input.actions);

      const rows = await ctx.db.executeSafe({
        text: `INSERT INTO automation_rules (
                 tenant_id, name, description, trigger_event, conditions, actions, is_active, created_by
               ) VALUES ($1, $2, $3, $4, $5::jsonb, $6::jsonb, false, $7)
               RETURNING id`,
        values: [
          ctx.tenantId,
          input.name,
          input.description || null,
          input.triggerEvent,
          JSON.stringify(input.conditions),
          JSON.stringify(input.actions),
          ctx.userId || null
        ]
      }) as any[];

      log.info('[RULE_CREATED] New inactive automation rule created', {
        ruleId: rows[0]?.id,
        tenantId: ctx.tenantId
      });

      return { success: true, ruleId: rows[0]?.id };
    }
  ).then(res => {
    if (!res.success) return { success: false, error: res.error };
    return res.data || { success: true };
  });
}

export async function updateAutomationRule(
  id: string,
  input: {
    name: string;
    description?: string;
    triggerEvent: string;
    conditions: RuleCondition[];
    actions: RuleAction[];
  }
) {
  return withActionGuard(
    { actionName: 'updateAutomationRule' },
    async (ctx) => {
      // Server-side validation
      validateRulePayload(input.name, input.triggerEvent, input.conditions, input.actions);

      await ctx.db.executeSafe({
        text: `UPDATE automation_rules 
               SET name = $1, description = $2, trigger_event = $3, 
                   conditions = $4::jsonb, actions = $5::jsonb, updated_at = NOW()
               WHERE id = $6 AND tenant_id = $7 AND (metadata->>'archived_at' IS NULL)`,
        values: [
          input.name,
          input.description || null,
          input.triggerEvent,
          JSON.stringify(input.conditions),
          JSON.stringify(input.actions),
          id,
          ctx.tenantId
        ]
      });

      log.info('[RULE_UPDATED] Automation rule updated', { ruleId: id, tenantId: ctx.tenantId });
      return { success: true };
    }
  ).then(res => {
    if (!res.success) return { success: false, error: res.error };
    return { success: true };
  });
}

export async function setAutomationRuleActive(id: string, isActive: boolean) {
  return withActionGuard(
    { actionName: 'setAutomationRuleActive' },
    async (ctx) => {
      // Core safety checks before activating
      if (isActive) {
        const rule = await ctx.db.executeSafe({
          text: `SELECT conditions, actions FROM automation_rules WHERE id = $1 AND tenant_id = $2 LIMIT 1`,
          values: [id, ctx.tenantId]
        }) as any[];

        if (rule.length === 0) {
          throw new Error("Kural bulunamadı.");
        }

        const actions = Array.isArray(rule[0].actions) ? rule[0].actions : [];
        if (actions.length === 0) {
          throw new Error("Aksiyonu bulunmayan kuralları aktif edemezsiniz.");
        }
      }

      await ctx.db.executeSafe({
        text: `UPDATE automation_rules SET is_active = $1, updated_at = NOW() 
               WHERE id = $2 AND tenant_id = $3 AND (metadata->>'archived_at' IS NULL)`,
        values: [isActive, id, ctx.tenantId]
      });

      log.info('[RULE_ACTIVE_CHANGED] Rule is_active changed', { ruleId: id, isActive, tenantId: ctx.tenantId });
      return { success: true };
    }
  ).then(res => {
    if (!res.success) return { success: false, error: res.error };
    return { success: true };
  });
}

export async function deleteOrArchiveAutomationRule(id: string) {
  return withActionGuard(
    { actionName: 'deleteOrArchiveAutomationRule' },
    async (ctx) => {
      // Soft Delete (Archive) to preserve run logs relationships
      const nowStr = new Date().toISOString();
      await ctx.db.executeSafe({
        text: `UPDATE automation_rules 
               SET is_active = false,
                   metadata = jsonb_set(
                     jsonb_set(COALESCE(metadata, '{}'::jsonb), '{archived_at}', to_jsonb($1::text)),
                     '{archived_by}', to_jsonb($2::text)
                   ),
                   updated_at = NOW()
               WHERE id = $3 AND tenant_id = $4`,
        values: [nowStr, ctx.userId || 'system', id, ctx.tenantId]
      });

      log.info('[RULE_ARCHIVED] Automation rule soft-deleted/archived successfully', {
        ruleId: id,
        tenantId: ctx.tenantId
      });

      return { success: true };
    }
  ).then(res => {
    if (!res.success) return { success: false, error: res.error };
    return { success: true };
  });
}

export async function runAutomationRuleDryRun(ruleId: string, leadId: string) {
  return withActionGuard(
    { actionName: 'runAutomationRuleDryRun' },
    async (ctx) => {
      // 1. Fetch the rule
      const rules = await ctx.db.executeSafe({
        text: `SELECT * FROM automation_rules WHERE id = $1 AND tenant_id = $2 LIMIT 1`,
        values: [ruleId, ctx.tenantId]
      }) as any[];

      if (rules.length === 0) {
        throw new Error("Kural bulunamadı.");
      }
      const rule = rules[0];

      // 2. Fetch the test lead
      const leads = await ctx.db.executeSafe({
        text: `SELECT * FROM leads WHERE id = $1 AND tenant_id = $2 LIMIT 1`,
        values: [leadId, ctx.tenantId]
      }) as any[];

      if (leads.length === 0) {
        throw new Error("Seçilen test hastası bulunamadı.");
      }
      const lead = leads[0];

      // 3. Assemble mock evaluation context
      const context = {
        tenantId: ctx.tenantId,
        entityType: 'lead' as const,
        entityId: lead.id,
        dedupeKey: `dry_run:${ruleId}:${lead.id}`,
        phone_number: lead.phone_number,
        opportunity_id: lead.linked_opportunity_id || null,
        lead_id: lead.id,
        patient_name: lead.patient_name,
        patient: {
          name: lead.patient_name,
          country: lead.country || null,
          phone: lead.phone_number
        },
        lead: {
          form_name: lead.form_name,
          source: lead.source,
          email: lead.email || null
        },
        opportunity: {
          stage: 'new_lead',
          priority: 'warm',
          department: 'Genel',
          intent_type: 'form_submission'
        }
      };

      // 4. Trigger evaluation in dryRun simulation mode
      const evaluator = new RuleEvaluatorService(ctx.db);
      await evaluator.evaluate(rule.trigger_event, context, { dryRun: true });

      // 5. Fetch the simulated execution telemetry from runs
      const runs = await ctx.db.executeSafe({
        text: `SELECT * FROM automation_runs 
               WHERE tenant_id = $1 AND rule_id = $2 AND dedupe_key = $3 
                 AND dry_run = true
               ORDER BY created_at DESC LIMIT 1`,
        values: [ctx.tenantId, ruleId, `dry_run:${ruleId}:${lead.id}`]
      }) as any[];

      const run = runs[0] || null;
      
      // Clean up the dry run record to keep database clean
      if (run) {
        await ctx.db.executeSafe({
          text: `DELETE FROM automation_runs WHERE id = $1`,
          values: [run.id]
        });
      }

      return {
        matched: run ? run.status === 'dry_run' : false,
        status: run ? run.status : 'skipped',
        error_message: run ? run.error_message : 'Conditions did not match',
        executed_actions: run ? run.executed_actions : []
      };
    }
  ).then(res => {
    if (!res.success) return { success: false, error: res.error };
    return res.data || { success: false, matched: false, executed_actions: [] };
  });
}
