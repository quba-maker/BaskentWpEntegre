import { TenantDB } from "@/lib/core/tenant-db";
import { logger } from "@/lib/core/logger";
import { NotificationService, type NotificationCategory, type NotificationPriority } from "../notification.service";

const log = logger.withContext({ module: 'RuleEvaluatorService' });

// ── WHITELIST ALLOWED ACTIONS ──
const ALLOWED_ACTIONS = ['create_task', 'send_notification', 'audit_log'];

export interface RuleCondition {
  field: string; // e.g. "patient.country", "lead.form_name", "opportunity.stage"
  operator: 'equals' | 'not_equals' | 'contains' | 'is_empty' | 'is_not_empty';
  value?: any;
}

export interface RuleAction {
  type: 'create_task' | 'send_notification' | 'audit_log';
  
  // create_task params
  task_type?: string;
  title?: string;
  description?: string;
  due_in_minutes?: number;

  // send_notification params
  category?: string;
  body?: string;
  priority?: string; // 'normal' | 'high'
}

export interface RuleEvaluatorOptions {
  dryRun?: boolean;
}

// ── HELPER FUNCTIONS ──

// Safe Dot-Path Resolver (No eval, no dynamic code)
function getContextValue(obj: any, path: string): any {
  if (!obj || !path) return undefined;
  const parts = path.split('.');
  let current = obj;
  for (const part of parts) {
    if (current === null || current === undefined || typeof current !== 'object') {
      return undefined;
    }
    current = current[part];
  }
  return current;
}

// Safe Template Renderer
function renderTemplate(template: string, context: Record<string, any>): string {
  if (!template) return "";
  const rendered = template.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_, path) => {
    const val = getContextValue(context, path);
    if (val === null || val === undefined) return "";
    const str = String(val).trim();
    if (str.toLowerCase() === "null" || str.toLowerCase() === "undefined") return "";
    return str;
  });
  // Max length safety constraint (500 chars)
  return rendered.substring(0, 500);
}

// Logical operator evaluator
function evaluateCondition(cond: RuleCondition, context: Record<string, any>): boolean {
  const val = getContextValue(context, cond.field);
  const expected = cond.value;

  switch (cond.operator) {
    case 'equals':
      return val !== undefined && val !== null && String(val).toLowerCase() === String(expected).toLowerCase();
    case 'not_equals':
      return val === undefined || val === null || String(val).toLowerCase() !== String(expected).toLowerCase();
    case 'contains':
      return val !== undefined && val !== null && String(val).toLowerCase().includes(String(expected).toLowerCase());
    case 'is_empty':
      return val === undefined || val === null || String(val).trim() === "";
    case 'is_not_empty':
      return val !== undefined && val !== null && String(val).trim() !== "";
    default:
      return false;
  }
}

export class RuleEvaluatorService {
  constructor(private db: TenantDB) {}

  /**
   * Main entry point to evaluate automation rules for a given trigger event.
   */
  async evaluate(
    triggerEvent: 'form_submission' | 'opportunity_stage_changed' | 'task_overdue',
    context: {
      tenantId: string;
      entityType: 'lead' | 'opportunity' | 'task';
      entityId: string;
      dedupeKey: string; // e.g. "form_submission:lead_uuid"
      [key: string]: any; // custom context fields like patient: { country, name }, etc.
    },
    options?: RuleEvaluatorOptions
  ): Promise<void> {
    const startTime = Date.now();
    const isDryRun = !!options?.dryRun;

    log.info('[EVALUATE_START] Evaluating automation rules', {
      triggerEvent,
      entityId: context.entityId,
      dedupeKey: context.dedupeKey,
      isDryRun
    });

    try {
      // 1. Fetch active rules for this trigger event
      const rules = await this.db.executeSafe({
        text: `SELECT * FROM automation_rules 
               WHERE tenant_id = $1 AND trigger_event = $2 AND is_active = true`,
        values: [context.tenantId, triggerEvent]
      }) as any[];

      if (rules.length === 0) {
        log.info('[EVALUATE_NO_RULES] No active rules found', { triggerEvent, tenantId: context.tenantId });
        return;
      }

      for (const rule of rules) {
        const ruleId = rule.id;
        const ruleName = rule.name;
        
        // 2. IDEMPOTENCY / DEDUPE check (Check if already executed successfully for this dedupe_key)
        if (!isDryRun) {
          const existingRun = await this.db.executeSafe({
            text: `SELECT id FROM automation_runs 
                   WHERE tenant_id = $1 AND rule_id = $2 AND trigger_event = $3 
                     AND entity_type = $4 AND entity_id = $5 AND dedupe_key = $6
                     AND status = 'success' AND dry_run = false
                   LIMIT 1`,
            values: [context.tenantId, ruleId, triggerEvent, context.entityType, context.entityId, context.dedupeKey]
          }) as any[];

          if (existingRun.length > 0) {
            log.info('[EVALUATE_IDEMPOTENCY_SKIP] Rule already executed successfully for this event context', {
              ruleId,
              ruleName,
              dedupeKey: context.dedupeKey
            });
            continue;
          }
        }

        // 3. Evaluate conditions
        const conditions = Array.isArray(rule.conditions) ? rule.conditions as RuleCondition[] : [];
        let conditionsMatch = true;

        for (const cond of conditions) {
          if (!evaluateCondition(cond, context)) {
            conditionsMatch = false;
            break;
          }
        }

        if (!conditionsMatch) {
          log.info('[EVALUATE_CONDITIONS_MISMATCH] Conditions did not match', { ruleId, ruleName });
          // Log skipped run
          if (!isDryRun) {
            await this.db.executeSafe({
              text: `INSERT INTO automation_runs (
                       tenant_id, rule_id, trigger_event, entity_type, entity_id, status, dedupe_key, dry_run, error_message
                     ) VALUES ($1, $2, $3, $4, $5, 'skipped', $6, false, 'Conditions did not match')`,
              values: [context.tenantId, ruleId, triggerEvent, context.entityType, context.entityId, context.dedupeKey]
            });
          }
          continue;
        }

        log.info('[EVALUATE_MATCH] Rule conditions matched! Executing actions...', { ruleId, ruleName });

        // 4. Execute Actions (Whitelist Guard)
        const actions = Array.isArray(rule.actions) ? rule.actions as RuleAction[] : [];
        const executedTelemetry: any[] = [];
        let runStatus: 'success' | 'failed' | 'dry_run' = isDryRun ? 'dry_run' : 'success';
        let runError: string | null = null;

        for (const action of actions) {
          // Whitelist check
          if (!ALLOWED_ACTIONS.includes(action.type)) {
            const err = `Action type '${action.type}' is BLOCKED by whitelist security policy.`;
            log.warn('[ACTION_BLOCKED] Whitelist security violation blocked', { actionType: action.type, ruleId });
            executedTelemetry.push({ action: action.type, status: 'blocked', error: err });
            runStatus = 'failed';
            runError = err;
            continue;
          }

          try {
            if (action.type === 'create_task') {
              const taskType = action.task_type || 'follow_up_no_response';
              const rawTitle = action.title || 'Otomatik Arama Görevi';
              const rawDesc = action.description || 'Otomasyon kuralı tarafından oluşturuldu.';
              const dueInMins = action.due_in_minutes || 15;

              const title = renderTemplate(rawTitle, context);
              const description = renderTemplate(rawDesc, context);
              const dueAt = new Date(Date.now() + dueInMins * 60 * 1000).toISOString();

              // Task Deduplication Guard
              let skipCreation = false;
              if (!isDryRun) {
                const activeTask = await this.db.executeSafe({
                  text: `SELECT id FROM follow_up_tasks 
                         WHERE tenant_id = $1 AND phone_number = $2 AND task_type = $3 
                           AND status IN ('pending', 'in_progress')
                         LIMIT 1`,
                  values: [context.tenantId, context.phone_number, taskType]
                }) as any[];

                if (activeTask.length > 0) {
                  skipCreation = true;
                  log.info('[ACTION_TASK_DEDUPE] Skipped task creation, active pending task already exists', {
                    taskType,
                    phoneNumber: context.phone_number
                  });
                  executedTelemetry.push({
                    action: 'create_task',
                    status: 'skipped_existing_task',
                    existing_task_id: activeTask[0].id
                  });
                }
              }

              if (!skipCreation) {
                let taskId = 'dry-run-task-id';
                if (!isDryRun) {
                  const oppId = context.entityType === 'opportunity' ? context.entityId : (context.opportunity_id || null);
                  const leadId = context.entityType === 'lead' ? context.entityId : (context.lead_id || null);

                  const res = await this.db.executeSafe({
                    text: `INSERT INTO follow_up_tasks (
                             tenant_id, opportunity_id, phone_number, task_type, title, description, 
                             due_at, is_automated, created_by, source_event, metadata
                           ) VALUES ($1, $2, $3, $4, $5, $6, $7, true, 'automation_rule', $8, $9::jsonb)
                           RETURNING id`,
                    values: [
                      context.tenantId,
                      oppId,
                      context.phone_number,
                      taskType,
                      title,
                      description,
                      dueAt,
                      triggerEvent,
                      JSON.stringify({ rule_id: ruleId, lead_id: leadId })
                    ]
                  }) as any[];
                  taskId = res[0]?.id;
                }

                executedTelemetry.push({
                  action: 'create_task',
                  status: isDryRun ? 'dry_run_success' : 'success',
                  task_id: taskId,
                  title,
                  dueAt
                });
              }

            } else if (action.type === 'send_notification') {
              const category = (action.category || 'system_alert') as NotificationCategory;
              const rawTitle = action.title || 'Otomasyon Uyarısı';
              const rawBody = action.body || 'Bir otomasyon kuralı tetiklendi.';
              const priority = (action.priority || 'normal') as NotificationPriority;

              const title = renderTemplate(rawTitle, context);
              const body = renderTemplate(rawBody, context);

              let notifId = 'dry-run-notification-id';
              if (!isDryRun) {
                const oppId = context.entityType === 'opportunity' ? context.entityId : (context.opportunity_id || null);
                const leadId = context.entityType === 'lead' ? context.entityId : (context.lead_id || null);

                // Notification Service Instantiation
                const notifService = new NotificationService(this.db);
                notifId = await notifService.send({
                  tenantId: context.tenantId,
                  category,
                  priority,
                  title,
                  body,
                  opportunityId: oppId,
                  phoneNumber: context.phone_number,
                  metadata: { rule_id: ruleId, lead_id: leadId }
                });
              }

              executedTelemetry.push({
                action: 'send_notification',
                status: isDryRun ? 'dry_run_success' : 'success',
                notification_id: notifId,
                title,
                category
              });

            } else if (action.type === 'audit_log') {
              executedTelemetry.push({
                action: 'audit_log',
                status: 'success',
                log: `Automation rule '${ruleName}' matched and logged successfully.`
              });
            }

          } catch (actionErr: any) {
            const actionMsg = actionErr instanceof Error ? actionErr.message : String(actionErr);
            log.error('[ACTION_EXECUTION_ERROR] Action failed', actionErr, { actionType: action.type });
            executedTelemetry.push({ action: action.type, status: 'failed', error: actionMsg });
            runStatus = 'failed';
            runError = actionMsg;
          }
        }

        // 5. Save run log in automation_runs
        const duration = Date.now() - startTime;
        await this.db.executeSafe({
          text: `INSERT INTO automation_runs (
                   tenant_id, rule_id, trigger_event, entity_type, entity_id, 
                   status, dedupe_key, dry_run, executed_actions, error_message, duration_ms
                 ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10, $11)`,
          values: [
            context.tenantId,
            ruleId,
            triggerEvent,
            context.entityType,
            context.entityId,
            runStatus,
            context.dedupeKey,
            isDryRun,
            JSON.stringify(executedTelemetry),
            runError,
            duration
          ]
        });
      }

    } catch (err: any) {
      log.error('[EVALUATE_CRITICAL_ERROR] Automation rule execution failed critically', err);
      throw err;
    }
  }
}
