"use server";

import { withActionGuard } from "@/lib/core/action-guard";

// =============================================
// AI CONTROL TOWER — Server Actions (Phase 7)
// =============================================

// ─── A. Live AI Activity Feed ───────────────────────

export async function getLiveActivityFeed(limit = 50, cursor?: string) {
  return withActionGuard({ actionName: 'getLiveActivityFeed', roles: ['owner', 'admin'] }, async (ctx) => {
    try {
      const rows = cursor
        ? await ctx.db.executeSafe(
            `SELECT id::text as id, event_type, event_category, severity, payload,
                   conversation_id::text as conversation_id, customer_id::text as customer_id, created_at
            FROM ai_events
            WHERE tenant_id = $1 AND created_at < $2::timestamptz
            ORDER BY created_at DESC LIMIT $3`,
            [ctx.tenantId, cursor, limit]
          )
        : await ctx.db.executeSafe(
            `SELECT id::text as id, event_type, event_category, severity, payload,
                   conversation_id::text as conversation_id, customer_id::text as customer_id, created_at
            FROM ai_events
            WHERE tenant_id = $1
            ORDER BY created_at DESC LIMIT $2`,
            [ctx.tenantId, limit]
          );

      return {
        events: rows,
        nextCursor: rows.length > 0 ? rows[rows.length - 1].created_at : null,
      };
    } catch (e) {
      return { events: [], nextCursor: null };
    }
  });
}

export async function getActivityStats() {
  return withActionGuard({ actionName: 'getActivityStats', roles: ['owner', 'admin'] }, async (ctx) => {
    try {
      const stats = await ctx.db.executeSafe(`
        SELECT 
          COUNT(*) FILTER (WHERE created_at > NOW() - INTERVAL '1 hour') as last_hour,
          COUNT(*) FILTER (WHERE created_at > NOW() - INTERVAL '24 hours') as last_24h,
          COUNT(*) FILTER (WHERE severity = 'error' AND created_at > NOW() - INTERVAL '24 hours') as errors_24h,
          COUNT(*) FILTER (WHERE severity = 'warning' AND created_at > NOW() - INTERVAL '24 hours') as warnings_24h,
          COUNT(*) FILTER (WHERE event_type = 'ai_response_generated' AND created_at > NOW() - INTERVAL '24 hours') as responses_24h,
          COUNT(*) FILTER (WHERE event_type = 'tool_executed' AND created_at > NOW() - INTERVAL '24 hours') as tools_24h,
          COUNT(*) FILTER (WHERE event_type = 'human_escalation' AND created_at > NOW() - INTERVAL '24 hours') as escalations_24h,
          COUNT(*) FILTER (WHERE event_type = 'policy_blocked' AND created_at > NOW() - INTERVAL '24 hours') as policy_blocks_24h
        FROM ai_events
        WHERE tenant_id = $1
      `, [ctx.tenantId]);
      return stats[0] || {};
    } catch {
      return {};
    }
  });
}

// ─── C. Feature Flags ───────────────────────────────

const DEFAULT_FLAGS = [
  { key: 'ai_memory_enabled', label: 'AI Memory & Summarization' },
  { key: 'tool_calling_enabled', label: 'AI Tool Calling' },
  { key: 'live_debug_enabled', label: 'Live Debug Panel' },
  { key: 'auto_crm_sync', label: 'Automatic CRM Sync' },
  { key: 'autonomous_mode', label: 'Autonomous AI Mode' },
  { key: 'ai_sandbox_enabled', label: 'AI Sandbox Lab' },
];

export async function getFeatureFlags() {
  return withActionGuard({ actionName: 'getFeatureFlags', roles: ['owner', 'admin'] }, async (ctx) => {
    try {
      const existing = await ctx.db.executeSafe(`
        SELECT flag_key, is_enabled, config, updated_by, updated_at
        FROM feature_flags
        WHERE tenant_id = $1
        ORDER BY flag_key
      `, [ctx.tenantId]);

      const existingMap = new Map(existing.map((r: any) => [r.flag_key, r]));

      return DEFAULT_FLAGS.map(flag => ({
        key: flag.key,
        label: flag.label,
        enabled: existingMap.has(flag.key) ? existingMap.get(flag.key)!.is_enabled : true,
        updatedBy: existingMap.get(flag.key)?.updated_by || 'default',
        updatedAt: existingMap.get(flag.key)?.updated_at || null,
      }));
    } catch {
      return DEFAULT_FLAGS.map(flag => ({ key: flag.key, label: flag.label, enabled: true, updatedBy: 'default', updatedAt: null }));
    }
  });
}

export async function toggleFeatureFlag(flagKey: string, enabled: boolean) {
  return withActionGuard({ actionName: 'toggleFeatureFlag', roles: ['owner', 'admin'] }, async (ctx) => {
    await ctx.db.executeSafe(`
      INSERT INTO feature_flags (tenant_id, flag_key, is_enabled, updated_by)
      VALUES ($1, $2, $3, $4)
      ON CONFLICT (tenant_id, flag_key) DO UPDATE SET
        is_enabled = $3, updated_by = $4, updated_at = NOW()
    `, [ctx.tenantId, flagKey, enabled, ctx.email]);

    const { FeatureFlagService } = await import('@/lib/services/feature-flag.service');
    FeatureFlagService.invalidateCache(ctx.tenantId);

    return true;
  });
}

// ─── D. Tool Activity Monitor ───────────────────────

export async function getToolActivityStats() {
  return withActionGuard({ actionName: 'getToolActivityStats', roles: ['owner', 'admin'] }, async (ctx) => {
    try {
      const rows = await ctx.db.executeSafe(`
        SELECT 
          payload->>'toolName' as tool_name,
          COUNT(*) FILTER (WHERE event_type = 'tool_executed') as success_count,
          COUNT(*) FILTER (WHERE event_type = 'tool_failed') as failure_count,
          COUNT(*) as total_calls,
          AVG((payload->>'durationMs')::numeric) FILTER (WHERE payload->>'durationMs' IS NOT NULL) as avg_latency_ms,
          MAX(created_at) as last_execution,
          COUNT(*) FILTER (WHERE payload->>'reason' = 'hallucinated_tool') as hallucination_count,
          COUNT(*) FILTER (WHERE payload->>'status' = 'aborted_timeout') as timeout_count
        FROM ai_events
        WHERE tenant_id = $1 AND event_category = 'tool' AND created_at > NOW() - INTERVAL '7 days'
        GROUP BY payload->>'toolName'
        ORDER BY total_calls DESC
      `, [ctx.tenantId]);
      return rows;
    } catch {
      return [];
    }
  });
}

// ─── E. Decision Trace Viewer ───────────────────────

export async function getRecentConversationsForTrace(limit = 10) {
  return withActionGuard({ actionName: 'getRecentConversationsForTrace', roles: ['owner', 'admin'] }, async (ctx) => {
    try {
      const rows = await ctx.db.executeSafe(`
        SELECT c.id::text as id, c.phone_number, c.status, c.lead_stage, c.updated_at,
               cp.first_name, cp.last_name
        FROM conversations c
        LEFT JOIN customer_profiles cp ON cp.id = c.customer_id
        WHERE c.tenant_id = $1
        ORDER BY c.updated_at DESC
        LIMIT $2
      `, [ctx.tenantId, limit]);
      return rows;
    } catch {
      return [];
    }
  });
}

export async function getDecisionTrace(conversationId: string) {
  return withActionGuard({ actionName: 'getDecisionTrace', roles: ['owner', 'admin'] }, async (ctx) => {
    try {
      const events = await ctx.db.executeSafe(`
        SELECT id::text as id, event_type, event_category, severity, payload, created_at
        FROM ai_events
        WHERE tenant_id = $1 AND conversation_id = $2
        ORDER BY created_at ASC LIMIT 200
      `, [ctx.tenantId, conversationId]);

      const conv = await ctx.db.executeSafe(`
        SELECT c.phone_number, c.status, c.lead_stage, c.department,
               cp.first_name, cp.last_name, cp.primary_phone,
               cm.summary_text, cm.buying_intent, cm.sentiment
        FROM conversations c
        LEFT JOIN customer_profiles cp ON cp.id = c.customer_id
        LEFT JOIN conversation_memory cm ON cm.conversation_id::text = c.id::text
        WHERE c.id::text = $1 AND c.tenant_id = $2
        LIMIT 1
      `, [conversationId, ctx.tenantId]);

      return {
        conversation: conv[0] || null,
        events,
        pipelineStages: buildPipelineFromEvents(events),
      };
    } catch (e) {
      return { conversation: null, events: [], pipelineStages: [] };
    }
  });
}

function buildPipelineFromEvents(events: any[]) {
  const stageOrder = [
    'brain_resolved', 'identity_resolved', 'duplicate_message_dropped',
    'working_hours_blocked', 'max_messages_reached',
    'ai_response_generated', 'ai_timeout',
    'tool_executed', 'tool_failed',
    'policy_blocked', 'human_escalation',
    'crm_extraction_completed', 'crm_extraction_failed',
    'memory_updated', 'memory_failed',
  ];

  const stages = stageOrder.map(stage => {
    const matching = events.filter((e: any) => e.event_type === stage);
    return {
      stage,
      occurred: matching.length > 0,
      count: matching.length,
      lastEvent: matching.length > 0 ? matching[matching.length - 1] : null,
    };
  });

  return stages.filter(s => s.occurred);
}
