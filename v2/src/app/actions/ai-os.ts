"use server";

import { withActionGuard } from "@/lib/core/action-guard";
import { AIEventEmitter } from "@/lib/services/ai/core/event-emitter";
import { BrainVersionService } from "@/lib/services/brain-version.service";
import { getTraceContext } from "@/lib/core/trace-context";

// =============================================
// AI OS — Server Actions (Phase 6)
// =============================================

export async function getAiTimeline(phoneNumber: string, limit = 30) {
  return withActionGuard(
    { actionName: 'getAiTimeline', conversationId: 'ai_timeline_no_conversation' },
    async (ctx) => {
      try {
        const convs = await ctx.db.executeSafe(
          `SELECT id::text as id FROM conversations WHERE phone_number = $1 AND tenant_id = $2 LIMIT 1`,
          [phoneNumber, ctx.tenantId]
        );
        const conversationId = convs[0]?.id;
        if (!conversationId) return [];

        const traceCtx = getTraceContext();
        if (traceCtx && conversationId) {
          traceCtx.conversationId = conversationId;
        }

        return await AIEventEmitter.getTimelineForConversation(ctx.tenantId, conversationId, limit);
      } catch {
        return [];
      }
    }
  );
}

export async function getAiSummary(phoneNumber: string) {
  return withActionGuard({ actionName: 'getAiSummary' }, async (ctx) => {
    try {
      const results = await ctx.db.executeSafe(`
        SELECT cm.summary_text, cm.buying_intent, cm.sentiment, cm.objections, cm.updated_at as memory_updated_at,
               cp.first_name, cp.last_name, cp.primary_email
        FROM conversations c
        LEFT JOIN conversation_memory cm ON cm.conversation_id::text = c.id::text
        LEFT JOIN customer_profiles cp ON cp.id = c.customer_id
        WHERE c.phone_number = $1 AND c.tenant_id = $2 LIMIT 1
      `, [phoneNumber, ctx.tenantId]);

      const row = results[0];
      if (!row || !row.summary_text) return null;

      return {
        summary: row.summary_text,
        intent: row.buying_intent,
        sentiment: row.sentiment,
        objections: row.objections,
        customerName: [row.first_name, row.last_name].filter(Boolean).join(' ').trim() || null,
        email: row.primary_email,
        updatedAt: row.memory_updated_at,
      };
    } catch {
      return null;
    }
  });
}

export async function getAiDebugData() {
  return withActionGuard({ actionName: 'getAiDebugData', roles: ['owner', 'admin'] }, async (ctx) => {
    let toolLogs: any[] = [];
    let metrics: any[] = [];
    let recentEvents: any[] = [];
    let health: any = null;
    let avgResponseMs = 0;
    let totalCalls = 0;
    let slowCalls = 0;
    let currentPrompt: string | null = null;

    try {
      toolLogs = await ctx.db.executeSafe(`
        SELECT tool_name, tool_arguments, validation_passed, execution_mode,
               execution_duration_ms, error_message, result_summary, created_at
        FROM ai_audit_logs WHERE tenant_id = $1 ORDER BY created_at DESC LIMIT 20
      `, [ctx.tenantId]);
    } catch {}

    try {
      metrics = await ctx.db.executeSafe(`
        SELECT model_name, response_time_ms, tool_calls_count, total_tokens, estimated_cost_usd, created_at
        FROM ai_runtime_metrics WHERE tenant_id = $1 ORDER BY created_at DESC LIMIT 30
      `, [ctx.tenantId]);
    } catch {}

    try {
      recentEvents = await ctx.db.executeSafe(`
        SELECT e.event_type, 'orchestration' as event_category,
               CASE WHEN e.status = 'error' THEN 'error' ELSE 'info' END as severity,
               e.payload, e.created_at
        FROM channel_events e
        JOIN channels c ON e.channel_id = c.id
        JOIN channel_groups cg ON c.group_id = cg.id
        WHERE cg.tenant_id = $1 ORDER BY e.created_at DESC LIMIT 50
      `, [ctx.tenantId]);
    } catch {}

    try { health = await AIEventEmitter.getHealthMetrics(ctx.tenantId); } catch {}

    try {
      const avgResponse = await ctx.db.executeSafe(`
        SELECT AVG(response_time_ms) as avg_response_ms, COUNT(*) as total_calls,
               COUNT(*) FILTER (WHERE response_time_ms > 20000) as slow_calls
        FROM ai_runtime_metrics WHERE tenant_id = $1 AND created_at > NOW() - INTERVAL '24 hours'
      `, [ctx.tenantId]);
      avgResponseMs = Math.round(parseFloat(avgResponse[0]?.avg_response_ms) || 0);
      totalCalls = parseInt(avgResponse[0]?.total_calls) || 0;
      slowCalls = parseInt(avgResponse[0]?.slow_calls) || 0;
    } catch {}

    try {
      const brainInfo = await ctx.db.executeSafe(`
        SELECT prompt_text as system_prompt FROM channel_prompts 
        WHERE tenant_id = $1 AND prompt_type = 'system' AND is_active = true
        ORDER BY updated_at DESC LIMIT 1
      `, [ctx.tenantId]);
      currentPrompt = brainInfo[0]?.system_prompt || null;
    } catch {}

    return { toolLogs, metrics, recentEvents, health, performance: { avgResponseMs, totalCalls, slowCalls }, currentPrompt };
  });
}

export async function getAiHealthCards() {
  return withActionGuard({ actionName: 'getAiHealthCards' }, async (ctx) => {
    try {
      const successRate = await ctx.db.executeSafe(`
        SELECT COUNT(*) FILTER (WHERE event_type = 'ai_response_generated') as successes,
               COUNT(*) FILTER (WHERE event_type IN ('ai_response_failed', 'ai_timeout')) as failures
        FROM channel_events e JOIN channels c ON e.channel_id = c.id JOIN channel_groups cg ON c.group_id = cg.id
        WHERE cg.tenant_id = $1 AND e.created_at > NOW() - INTERVAL '24 hours'
      `, [ctx.tenantId]);
      const s = parseInt(successRate[0]?.successes) || 0;
      const f = parseInt(successRate[0]?.failures) || 0;
      const aiSuccessRate = s + f > 0 ? Math.round((s / (s + f)) * 100) : 100;

      const identityRate = await ctx.db.executeSafe(`
        SELECT COUNT(*) FILTER (WHERE event_type = 'identity_resolved') as matched,
               COUNT(*) FILTER (WHERE event_type IN ('identity_resolved', 'identity_failed')) as total
        FROM channel_events e JOIN channels c ON e.channel_id = c.id JOIN channel_groups cg ON c.group_id = cg.id
        WHERE cg.tenant_id = $1 AND e.created_at > NOW() - INTERVAL '24 hours'
      `, [ctx.tenantId]);
      const im = parseInt(identityRate[0]?.matched) || 0;
      const it = parseInt(identityRate[0]?.total) || 1;

      const avgTime = await ctx.db.executeSafe(`
        SELECT AVG(response_time_ms) as avg_ms FROM ai_runtime_metrics
        WHERE tenant_id = $1 AND created_at > NOW() - INTERVAL '24 hours'
      `, [ctx.tenantId]);

      const toolRate = await ctx.db.executeSafe(`
        SELECT COUNT(*) FILTER (WHERE validation_passed = true) as passed, COUNT(*) as total
        FROM ai_audit_logs WHERE tenant_id = $1 AND created_at > NOW() - INTERVAL '24 hours'
      `, [ctx.tenantId]);
      const tp = parseInt(toolRate[0]?.passed) || 0;
      const tt = parseInt(toolRate[0]?.total) || 1;

      const memoryCoverage = await ctx.db.executeSafe(`
        SELECT (SELECT COUNT(*) FROM conversation_memory WHERE tenant_id = $1) as with_memory,
               (SELECT COUNT(*) FROM conversations WHERE tenant_id = $1) as total_conversations
      `, [ctx.tenantId]);
      const wm = parseInt(memoryCoverage[0]?.with_memory) || 0;
      const tc = parseInt(memoryCoverage[0]?.total_conversations) || 1;

      return {
        aiSuccessRate,
        identityMatchRate: Math.round((im / it) * 100),
        avgResponseMs: Math.round(parseFloat(avgTime[0]?.avg_ms) || 0),
        toolSuccessRate: tt > 0 ? Math.round((tp / tt) * 100) : 100,
        memoryCoverage: Math.round((wm / tc) * 100),
      };
    } catch {
      return null;
    }
  });
}

export async function getBrainVersions() {
  return withActionGuard({ actionName: 'getBrainVersions', roles: ['owner', 'admin'] }, async (ctx) => {
    return await BrainVersionService.getHistory(ctx.tenantId);
  });
}

export async function rollbackBrainVersion(versionNumber: number) {
  return withActionGuard({ actionName: 'rollbackBrainVersion', roles: ['owner', 'admin'] }, async (ctx) => {
    const prompt = await BrainVersionService.rollback(ctx.tenantId, versionNumber);
    if (!prompt) throw new Error('Version not found');
    return true;
  });
}

export async function getToolPermissions() {
  return withActionGuard({ actionName: 'getToolPermissions', roles: ['owner', 'admin'] }, async (ctx) => {
    try {
      return await ctx.db.executeSafe(`
        SELECT tool_name, is_enabled, config, updated_at FROM tool_permissions
        WHERE tenant_id = $1 ORDER BY tool_name
      `, [ctx.tenantId]);
    } catch {
      return [];
    }
  });
}

export async function toggleToolPermission(toolName: string, isEnabled: boolean) {
  return withActionGuard({ actionName: 'toggleToolPermission', roles: ['owner', 'admin'] }, async (ctx) => {
    await ctx.db.executeSafe(`
      INSERT INTO tool_permissions (tenant_id, tool_name, is_enabled)
      VALUES ($1, $2, $3)
      ON CONFLICT (tenant_id, tool_name) DO UPDATE SET is_enabled = $3, updated_at = NOW()
    `, [ctx.tenantId, toolName, isEnabled]);
    return true;
  });
}
