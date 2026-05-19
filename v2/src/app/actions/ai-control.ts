"use server";

import { sql } from "@/lib/db";
import { getSession } from "@/lib/auth/session";
import { BrainVersionService } from "@/lib/services/brain-version.service";

// =============================================
// AI CONTROL TOWER — Server Actions (Phase 7)
// =============================================

async function requireAdminSession() {
  const session = await getSession();
  if (!session || !['admin', 'owner', 'platform_admin'].includes(session.role)) {
    throw new Error('Unauthorized: Admin access required');
  }
  return session;
}

// ─── A. Live AI Activity Feed ───────────────────────

export async function getLiveActivityFeed(limit = 50, cursor?: string) {
  const session = await requireAdminSession();
  const tenantId = session.tenantId;

  try {
    const rows = cursor
      ? await sql`
          SELECT id::text as id, event_type, event_category, severity, payload,
                 conversation_id::text as conversation_id, customer_id::text as customer_id, created_at
          FROM ai_events
          WHERE tenant_id = ${tenantId} AND created_at < ${cursor}::timestamptz
          ORDER BY created_at DESC
          LIMIT ${limit}
        `
      : await sql`
          SELECT id::text as id, event_type, event_category, severity, payload,
                 conversation_id::text as conversation_id, customer_id::text as customer_id, created_at
          FROM ai_events
          WHERE tenant_id = ${tenantId}
          ORDER BY created_at DESC
          LIMIT ${limit}
        `;

    return {
      events: rows,
      nextCursor: rows.length > 0 ? rows[rows.length - 1].created_at : null,
    };
  } catch (e) {
    console.error('[getLiveActivityFeed]', e);
    return { events: [], nextCursor: null };
  }
}

export async function getActivityStats() {
  const session = await requireAdminSession();
  const tenantId = session.tenantId;

  try {
    const stats = await sql`
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
      WHERE tenant_id = ${tenantId}
    `;
    return stats[0] || {};
  } catch {
    return {};
  }
}

// ─── B. Prompt Version Manager (Enhanced) ───────────

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
  const session = await requireAdminSession();
  const tenantId = session.tenantId;

  try {
    const existing = await sql`
      SELECT flag_key, is_enabled, config, updated_by, updated_at
      FROM feature_flags
      WHERE tenant_id = ${tenantId}
      ORDER BY flag_key
    `;

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
}

export async function toggleFeatureFlag(flagKey: string, enabled: boolean) {
  const session = await requireAdminSession();
  const tenantId = session.tenantId;

  try {
    await sql`
      INSERT INTO feature_flags (tenant_id, flag_key, is_enabled, updated_by)
      VALUES (${tenantId}, ${flagKey}, ${enabled}, ${session.name || 'admin'})
      ON CONFLICT (tenant_id, flag_key) DO UPDATE SET
        is_enabled = ${enabled}, 
        updated_by = ${session.name || 'admin'},
        updated_at = NOW()
    `;
    
    // Invalidate in-memory flag cache so worker picks up changes immediately
    const { FeatureFlagService } = await import('@/lib/services/feature-flag.service');
    FeatureFlagService.invalidateCache(tenantId);
    
    return { success: true };
  } catch (e: any) {
    return { success: false, error: e.message };
  }
}

// ─── D. Tool Activity Monitor ───────────────────────

export async function getToolActivityStats() {
  const session = await requireAdminSession();
  const tenantId = session.tenantId;

  try {
    const rows = await sql`
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
      WHERE tenant_id = ${tenantId}
        AND event_category = 'tool'
        AND created_at > NOW() - INTERVAL '7 days'
      GROUP BY payload->>'toolName'
      ORDER BY total_calls DESC
    `;
    return rows;
  } catch {
    return [];
  }
}

// ─── E. Decision Trace Viewer ───────────────────────

export async function getRecentConversationsForTrace(limit = 10) {
  const session = await requireAdminSession();
  const tenantId = session.tenantId;

  try {
    const rows = await sql`
      SELECT c.id::text as id, c.phone_number, c.status, c.lead_stage, c.updated_at,
             cp.first_name, cp.last_name
      FROM conversations c
      LEFT JOIN customer_profiles cp ON cp.id = c.customer_id
      WHERE c.tenant_id = ${tenantId}
      ORDER BY c.updated_at DESC
      LIMIT ${limit}
    `;
    return rows;
  } catch {
    return [];
  }
}

export async function getDecisionTrace(conversationId: string) {
  const session = await requireAdminSession();
  const tenantId = session.tenantId;

  try {
    // Get all events for this conversation in chronological order
    const events = await sql`
      SELECT id::text as id, event_type, event_category, severity, payload, created_at
      FROM ai_events
      WHERE tenant_id = ${tenantId} 
        AND conversation_id = ${conversationId}
      ORDER BY created_at ASC
      LIMIT 200
    `;

    // Get conversation metadata
    const conv = await sql`
      SELECT c.phone_number, c.status, c.lead_stage, c.department,
             cp.first_name, cp.last_name, cp.primary_phone,
             cm.summary_text, cm.buying_intent, cm.sentiment
      FROM conversations c
      LEFT JOIN customer_profiles cp ON cp.id = c.customer_id
      LEFT JOIN conversation_memory cm ON cm.conversation_id::text = c.id::text
      WHERE c.id::text = ${conversationId} AND c.tenant_id = ${tenantId}
      LIMIT 1
    `;

    return {
      conversation: conv[0] || null,
      events,
      pipelineStages: buildPipelineFromEvents(events),
    };
  } catch (e) {
    console.error('[getDecisionTrace]', e);
    return { conversation: null, events: [], pipelineStages: [] };
  }
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

// ─── F. AI Sandbox Lab ──────────────────────────────

