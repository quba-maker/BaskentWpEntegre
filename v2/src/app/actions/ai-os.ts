"use server";

import { sql } from "@/lib/db";
import { getSession } from "@/lib/auth/session";
import { AIEventEmitter } from "@/lib/services/ai/core/event-emitter";
import { BrainVersionService } from "@/lib/services/brain-version.service";

// =============================================
// AI OS — Server Actions (Phase 6)
// =============================================

async function getCurrentTenantId(): Promise<string | null> {
  const session = await getSession();
  return session?.tenantId || null;
}

/**
 * Get AI event timeline for a phone number (via conversation lookup)
 */
export async function getAiTimeline(phoneNumber: string, limit = 30) {
  const tenantId = await getCurrentTenantId();
  if (!tenantId || !phoneNumber) return [];

  try {
    // Find conversation_id for this phone number
    const convs = await sql`
      SELECT id::text as id FROM conversations
      WHERE phone_number = ${phoneNumber} AND tenant_id = ${tenantId}
      LIMIT 1
    `;
    const conversationId = convs[0]?.id;
    if (!conversationId) return [];

    return await AIEventEmitter.getTimelineForConversation(tenantId, conversationId, limit);
  } catch (e) {
    console.error('[getAiTimeline]', e);
    return [];
  }
}

/**
 * Get auto-generated AI summary for a lead's conversation.
 * Sources: conversation_memory + customer_profiles
 */
export async function getAiSummary(phoneNumber: string) {
  const tenantId = await getCurrentTenantId();
  if (!tenantId || !phoneNumber) return null;

  try {
    // Find conversation + memory for this phone
    const results = await sql`
      SELECT 
        cm.summary_text,
        cm.buying_intent,
        cm.sentiment,
        cm.objections,
        cm.updated_at as memory_updated_at,
        cp.first_name,
        cp.last_name,
        cp.primary_email
      FROM conversations c
      LEFT JOIN conversation_memory cm ON cm.conversation_id::text = c.id::text
      LEFT JOIN customer_profiles cp ON cp.id = c.customer_id
      WHERE c.phone_number = ${phoneNumber} AND c.tenant_id = ${tenantId}
      LIMIT 1
    `;

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
  } catch (e) {
    console.error('[getAiSummary]', e);
    return null;
  }
}

/**
 * Get AI debug data: final prompt, context, tool calls, runtime metrics
 */
export async function getAiDebugData() {
  const tenantId = await getCurrentTenantId();
  if (!tenantId) return null;

  // Each query is independently fault-tolerant
  let toolLogs: any[] = [];
  let metrics: any[] = [];
  let recentEvents: any[] = [];
  let health: any = null;
  let avgResponseMs = 0;
  let totalCalls = 0;
  let slowCalls = 0;
  let currentPrompt: string | null = null;

  try {
    toolLogs = await sql`
      SELECT tool_name, tool_arguments, validation_passed, execution_mode,
             execution_duration_ms, error_message, result_summary, created_at
      FROM ai_audit_logs
      WHERE tenant_id = ${tenantId}
      ORDER BY created_at DESC
      LIMIT 20
    `;
  } catch { /* table may not exist yet */ }

  try {
    metrics = await sql`
      SELECT model_name, response_time_ms, tool_calls_count, 
             total_tokens, estimated_cost_usd, created_at
      FROM ai_runtime_metrics
      WHERE tenant_id = ${tenantId}
      ORDER BY created_at DESC
      LIMIT 30
    `;
  } catch { /* table may not exist yet */ }

  try {
    recentEvents = await sql`
      SELECT 
        e.event_type, 
        'orchestration' as event_category, 
        CASE WHEN e.status = 'error' THEN 'error' ELSE 'info' END as severity, 
        e.payload, 
        e.created_at
      FROM channel_events e
      JOIN channels c ON e.channel_id = c.id
      JOIN channel_groups cg ON c.group_id = cg.id
      WHERE cg.tenant_id = ${tenantId}
      ORDER BY e.created_at DESC
      LIMIT 50
    `;
  } catch { /* table may not exist yet */ }

  try {
    health = await AIEventEmitter.getHealthMetrics(tenantId);
  } catch { /* graceful */ }

  try {
    const avgResponse = await sql`
      SELECT 
        AVG(response_time_ms) as avg_response_ms,
        COUNT(*) as total_calls,
        COUNT(*) FILTER (WHERE response_time_ms > 20000) as slow_calls
      FROM ai_runtime_metrics
      WHERE tenant_id = ${tenantId} AND created_at > NOW() - INTERVAL '24 hours'
    `;
    avgResponseMs = Math.round(parseFloat(avgResponse[0]?.avg_response_ms) || 0);
    totalCalls = parseInt(avgResponse[0]?.total_calls) || 0;
    slowCalls = parseInt(avgResponse[0]?.slow_calls) || 0;
  } catch { /* table may not exist yet */ }

  try {
    const brainInfo = await sql`
      SELECT value as system_prompt
      FROM settings
      WHERE tenant_id = ${tenantId} AND key = 'system_prompt_whatsapp'
      LIMIT 1
    `;
    currentPrompt = brainInfo[0]?.system_prompt || null;
  } catch { /* graceful */ }

  return {
    toolLogs,
    metrics,
    recentEvents,
    health,
    performance: {
      avgResponseMs,
      totalCalls,
      slowCalls,
    },
    currentPrompt,
  };
}

/**
 * Get AI Health monitoring cards data for dashboard
 */
export async function getAiHealthCards() {
  const tenantId = await getCurrentTenantId();
  if (!tenantId) return null;

  try {
    // AI Success Rate — based on responses vs failures
    const successRate = await sql`
      SELECT 
        COUNT(*) FILTER (WHERE event_type = 'ai_response_generated') as successes,
        COUNT(*) FILTER (WHERE event_type IN ('ai_response_failed', 'ai_timeout')) as failures
      FROM channel_events e
      JOIN channels c ON e.channel_id = c.id
      JOIN channel_groups cg ON c.group_id = cg.id
      WHERE cg.tenant_id = ${tenantId} AND e.created_at > NOW() - INTERVAL '24 hours'
    `;
    const s = parseInt(successRate[0]?.successes) || 0;
    const f = parseInt(successRate[0]?.failures) || 0;
    const aiSuccessRate = s + f > 0 ? Math.round((s / (s + f)) * 100) : 100;

    // Identity Match Rate
    const identityRate = await sql`
      SELECT 
        COUNT(*) FILTER (WHERE event_type = 'identity_resolved') as matched,
        COUNT(*) FILTER (WHERE event_type IN ('identity_resolved', 'identity_failed')) as total
      FROM channel_events e
      JOIN channels c ON e.channel_id = c.id
      JOIN channel_groups cg ON c.group_id = cg.id
      WHERE cg.tenant_id = ${tenantId} AND e.created_at > NOW() - INTERVAL '24 hours'
    `;
    const im = parseInt(identityRate[0]?.matched) || 0;
    const it = parseInt(identityRate[0]?.total) || 1;
    const identityMatchRate = Math.round((im / it) * 100);

    // Average Response Time
    const avgTime = await sql`
      SELECT AVG(response_time_ms) as avg_ms
      FROM ai_runtime_metrics
      WHERE tenant_id = ${tenantId} AND created_at > NOW() - INTERVAL '24 hours'
    `;

    // Tool Success Rate
    const toolRate = await sql`
      SELECT 
        COUNT(*) FILTER (WHERE validation_passed = true) as passed,
        COUNT(*) as total
      FROM ai_audit_logs
      WHERE tenant_id = ${tenantId} AND created_at > NOW() - INTERVAL '24 hours'
    `;
    const tp = parseInt(toolRate[0]?.passed) || 0;
    const tt = parseInt(toolRate[0]?.total) || 1;

    // Memory Coverage
    const memoryCoverage = await sql`
      SELECT 
        (SELECT COUNT(*) FROM conversation_memory WHERE tenant_id = ${tenantId}) as with_memory,
        (SELECT COUNT(*) FROM conversations WHERE tenant_id = ${tenantId}) as total_conversations
    `;
    const wm = parseInt(memoryCoverage[0]?.with_memory) || 0;
    const tc = parseInt(memoryCoverage[0]?.total_conversations) || 1;

    return {
      aiSuccessRate,
      identityMatchRate,
      avgResponseMs: Math.round(parseFloat(avgTime[0]?.avg_ms) || 0),
      toolSuccessRate: tt > 0 ? Math.round((tp / tt) * 100) : 100,
      memoryCoverage: Math.round((wm / tc) * 100),
    };
  } catch (e) {
    console.error('[getAiHealthCards]', e);
    return null;
  }
}

/**
 * Get brain version history
 */
export async function getBrainVersions() {
  const tenantId = await getCurrentTenantId();
  if (!tenantId) return [];
  return await BrainVersionService.getHistory(tenantId);
}

/**
 * Rollback to a specific brain version
 */
export async function rollbackBrainVersion(versionNumber: number) {
  const tenantId = await getCurrentTenantId();
  if (!tenantId) return { success: false, error: 'No tenant' };

  try {
    const prompt = await BrainVersionService.rollback(tenantId, versionNumber);
    if (!prompt) return { success: false, error: 'Version not found' };
    return { success: true };
  } catch (e: any) {
    return { success: false, error: e.message };
  }
}

/**
 * Get tool permissions for the tenant
 */
export async function getToolPermissions() {
  const tenantId = await getCurrentTenantId();
  if (!tenantId) return [];

  try {
    return await sql`
      SELECT tool_name, is_enabled, config, updated_at
      FROM tool_permissions
      WHERE tenant_id = ${tenantId}
      ORDER BY tool_name
    `;
  } catch {
    return [];
  }
}

/**
 * Toggle a tool's permission
 */
export async function toggleToolPermission(toolName: string, isEnabled: boolean) {
  const tenantId = await getCurrentTenantId();
  if (!tenantId) return { success: false };

  try {
    await sql`
      INSERT INTO tool_permissions (tenant_id, tool_name, is_enabled)
      VALUES (${tenantId}, ${toolName}, ${isEnabled})
      ON CONFLICT (tenant_id, tool_name) DO UPDATE SET
        is_enabled = ${isEnabled}, updated_at = NOW()
    `;
    return { success: true };
  } catch (e: any) {
    return { success: false, error: e.message };
  }
}
