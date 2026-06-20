import { TenantDB } from "@/lib/core/tenant-db";
import { checkMetaWindow } from "../whatsapp/meta-window-guard";
import { logger } from "@/lib/core/logger";

const log = logger.withContext({ module: 'FormAutopilotEligibilityResolver' });

export interface FormAutopilotEligibility {
  eligible: boolean;
  baseEligible: boolean;
  gateOpen: boolean;
  reason: string;
  baseReason?: string;
  gateReason?: string;
  dryRun: boolean;
  featureFlagEnabled: boolean;
  globalDisabled: boolean;
  isTenantAllowed?: boolean;
  leadId?: string;
  conversationId?: string;
  tenantId?: string;
  channelId?: string;
  lastInboundAt?: string;
}

/**
 * Checks autopilot feature flags and configuration from both environment variables and DB settings.
 */
export async function getAutopilotSettings(tenantId: string, db: TenantDB) {
  const globalDisabledEnv = process.env.FORM_AUTOPILOT_GLOBAL_DISABLED === 'true';
  const featureFlagEnabledEnv = process.env.FORM_AUTOPILOT_FOR_OPEN_META_WINDOW_ENABLED === 'true';
  const dryRunEnv = process.env.FORM_AUTOPILOT_DRY_RUN !== 'false';

  let globalDisabled = globalDisabledEnv;
  let featureFlagEnabled = featureFlagEnabledEnv;
  let dryRun = dryRunEnv;

  try {
    const rows = await db.executeSafe({
      text: `SELECT module_name, is_active, config FROM ai_module_settings WHERE tenant_id = $1`,
      values: [tenantId]
    }) as any[];

    for (const row of rows) {
      if (row.module_name === 'form_autopilot_global_disabled') {
        globalDisabled = globalDisabled || row.is_active;
      }
      if (row.module_name === 'form_autopilot_for_open_meta_window') {
        featureFlagEnabled = featureFlagEnabled || row.is_active;
        if (row.config) {
          const config = typeof row.config === 'string' ? JSON.parse(row.config) : row.config;
          if (config && typeof config === 'object') {
            if (config.dry_run !== undefined) {
              dryRun = config.dry_run;
            }
          }
        }
      }
    }
  } catch {
    // Fail-safe default
  }

  return {
    globalDisabled,
    featureFlagEnabled,
    dryRun
  };
}

/**
 * Checks Inbound Autopilot module settings from DB.
 */
export async function getInboundAutopilotSettings(tenantId: string, db: TenantDB) {
  let enabled = false;
  let dryRun = true;
  let rolloutPercentage = 0;
  let departmentMode = 'selected';
  let allowedDepartments: string[] = [];

  try {
    const rows = await db.executeSafe({
      text: `SELECT config FROM ai_module_settings WHERE tenant_id = $1 AND module_name = 'inbound_autopilot_settings' LIMIT 1`,
      values: [tenantId]
    }) as any[];

    if (rows.length > 0 && rows[0].config) {
      const config = typeof rows[0].config === 'string' ? JSON.parse(rows[0].config) : rows[0].config;
      if (config && typeof config === 'object') {
        if (config.enabled !== undefined) enabled = config.enabled;
        if (config.dry_run !== undefined) dryRun = config.dry_run;
        if (config.rollout_percentage !== undefined) rolloutPercentage = Number(config.rollout_percentage);
        if (config.department_mode !== undefined) departmentMode = config.department_mode;
        if (config.allowed_departments !== undefined) {
          allowedDepartments = Array.isArray(config.allowed_departments) ? config.allowed_departments : [];
        }
      }
    }
  } catch {
    // Fail-safe defaults
  }

  return {
    enabled,
    dryRun,
    rolloutPercentage,
    departmentMode,
    allowedDepartments
  };
}

/**
 * Resolves form lead eligibility for autopilot response.
 * Filters are strictly tenant-bound to prevent global leaks.
 */
export async function resolveFormAutopilotEligibility(
  tenantId: string,
  leadId: string,
  conversationId: string,
  db: TenantDB
): Promise<FormAutopilotEligibility> {
  try {
    // 1. Fetch Tenant Slug for Allowlist Check
    const tenantRows = await db.executeSafe({
      text: `SELECT slug FROM tenants WHERE id = $1 LIMIT 1`,
      values: [tenantId]
    }) as any[];

    if (tenantRows.length === 0) {
      return {
        eligible: false,
        baseEligible: false,
        gateOpen: false,
        reason: 'tenant_not_found',
        baseReason: 'tenant_not_found',
        dryRun: true,
        featureFlagEnabled: false,
        globalDisabled: true
      };
    }

    const tenantSlug = tenantRows[0].slug;

    const allowedTenantsList = (process.env.FORM_AUTOPILOT_ALLOWED_TENANTS || '')
      .split(',')
      .map(t => t.trim().toLowerCase())
      .filter(Boolean);
    const isTenantAllowed = allowedTenantsList.includes(tenantSlug.toLowerCase());

    // 2. Fetch Conversation details for security checks
    // We select status, tenant_id, and autopilot_enabled (using fallback check if column isn't present)
    const convRows = await db.executeSafe({
      text: `SELECT channel, channel_id, customer_id, status, tenant_id, autopilot_enabled FROM conversations WHERE id = $1 AND tenant_id = $2 LIMIT 1`,
      values: [conversationId, tenantId]
    }) as any[];

    if (convRows.length === 0) {
      return {
        eligible: false,
        baseEligible: false,
        gateOpen: false,
        reason: 'conversation_not_found',
        baseReason: 'conversation_not_found',
        dryRun: true,
        featureFlagEnabled: false,
        globalDisabled: true
      };
    }

    const conv = convRows[0];
    const channelId = conv.channel;

    let isManuallyDisabledForInbound = false;
    if (conv.customer_id) {
      const profileRows = await db.executeSafe({
        text: `SELECT primary_phone, metadata FROM customer_profiles WHERE id = $1 AND tenant_id = $2 LIMIT 1`,
        values: [conv.customer_id, tenantId]
      }) as any[];
      if (profileRows.length > 0) {
        const metadata = profileRows[0].metadata || {};
        const overrides = metadata.inbound_autopilot_overrides || {};
        const chId = conv.channel_id || conv.channel;
        if (chId && (overrides[chId]?.disabled === true || overrides[chId]?.disabled === 'true')) {
          isManuallyDisabledForInbound = true;
        }
      }
    }

    // Fetch lead details for cross check (tenant/channel mismatch checks)
    const leadRows = await db.executeSafe({
      text: `SELECT tenant_id, phone_number FROM leads WHERE id = $1 AND tenant_id = $2 LIMIT 1`,
      values: [leadId, tenantId]
    }) as any[];

    if (leadRows.length === 0) {
      return {
        eligible: false,
        baseEligible: false,
        gateOpen: false,
        reason: 'lead_not_found',
        baseReason: 'lead_not_found',
        dryRun: true,
        featureFlagEnabled: false,
        globalDisabled: true
      };
    }

    const lead = leadRows[0];

    // 3. Resolve Flags / Gates
    const settings = await getAutopilotSettings(tenantId, db);

    // 4. Check Meta 24h Window
    const windowCheck = await checkMetaWindow(conversationId, tenantId, db);

    // 5. Evaluate Technical Eligibility (baseEligible)
    let baseEligible = true;
    let baseReason = 'eligible';
    let lastInboundAt = windowCheck.lastInboundAt;

    if (conv.tenant_id !== tenantId || lead.tenant_id !== tenantId) {
      baseEligible = false;
      baseReason = 'tenant_mismatch';
    } else if (conv.status === 'human') {
      baseEligible = false;
      baseReason = 'status_human';
    } else if (conv.autopilot_enabled === false && !isManuallyDisabledForInbound) {
      baseEligible = false;
      baseReason = 'autopilot_disabled';
    } else if (channelId !== 'whatsapp') {
      baseEligible = false;
      baseReason = 'not_whatsapp_channel';
    } else if (!windowCheck.open) {
      if (windowCheck.reason === 'no_inbound' || windowCheck.reason === 'unknown') {
        baseEligible = false;
        baseReason = 'form_only_outbound'; // WhatsApp conversation exists but patient never messaged us
      } else {
        baseEligible = false;
        baseReason = 'template_required'; // Window expired
      }
    } else {
      // Idempotency: Tenant-bound search to avoid duplicate greetings
      const dupLogs = await db.executeSafe({
        text: `
          SELECT id FROM ai_audit_logs
          WHERE tenant_id = $1
            AND conversation_id = $2
            AND action IN ('FORM_AUTOPILOT_ELIGIBLE', 'FORM_AUTOPILOT_DRY_RUN', 'FORM_AUTOPILOT_SENT')
            AND result_summary->>'channelId' = $3
            AND result_summary->>'leadId' = $4
          LIMIT 1
        `,
        values: [tenantId, conversationId, channelId, leadId]
      }) as any[];

      if (dupLogs.length > 0) {
        baseEligible = false;
        baseReason = 'already_processed';
      }
    }

    // 6. Evaluate Gate (gateOpen)
    let gateOpen = true;
    let gateReason = 'gate_open';

    if (!isTenantAllowed) {
      gateOpen = false;
      gateReason = 'tenant_not_allowlisted';
    } else if (settings.globalDisabled) {
      gateOpen = false;
      gateReason = 'global_disabled';
    } else if (!settings.featureFlagEnabled) {
      gateOpen = false;
      gateReason = 'feature_flag_disabled';
    }

    // 7. Final Decision
    const eligible = baseEligible && gateOpen;
    const finalReason = eligible 
      ? 'eligible'
      : (!baseEligible ? baseReason : gateReason);

    return {
      eligible,
      baseEligible,
      gateOpen,
      reason: finalReason,
      baseReason,
      gateReason,
      dryRun: settings.dryRun,
      featureFlagEnabled: settings.featureFlagEnabled,
      globalDisabled: settings.globalDisabled,
      isTenantAllowed,
      leadId,
      conversationId,
      tenantId,
      channelId,
      lastInboundAt
    };
  } catch (err) {
    log.error('Failed resolving form autopilot eligibility', err instanceof Error ? err : new Error(String(err)));
    return {
      eligible: false,
      baseEligible: false,
      gateOpen: false,
      reason: 'internal_error',
      baseReason: 'internal_error',
      dryRun: true,
      featureFlagEnabled: false,
      globalDisabled: true
    };
  }
}
