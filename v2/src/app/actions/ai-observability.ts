"use server";

import { sql } from "@/lib/db";
import { withActionGuard } from "@/lib/core/action-guard";

// ==========================================
// QUBA AI — AI Observability Actions (Phase 6A)
// ==========================================

export async function getConversationTraces(conversationId: string) {
  if (!conversationId) return [];
  
  return withActionGuard(
    { actionName: 'getConversationTraces' },
    async (ctx) => {
      // Find the conversation's UUID if conversationId is a phone number
      const convRows = await ctx.db.executeSafe(sql`
        SELECT id FROM conversations 
        WHERE (id::text = ${conversationId} OR phone_number = ${conversationId}) 
          AND tenant_id = ${ctx.tenantId}
        LIMIT 1
      `);
      
      if (convRows.length === 0) return [];
      const convUuid = convRows[0].id;

      const rows = await ctx.db.executeSafe(sql`
        SELECT 
          id,
          tool_name,
          tool_arguments,
          validation_passed,
          execution_mode,
          execution_duration_ms,
          input_tokens,
          output_tokens,
          cost_usd,
          reasoning_summary,
          error_message,
          EXTRACT(EPOCH FROM created_at) * 1000 as created_at_ms
        FROM ai_audit_logs
        WHERE conversation_id::text = ${convUuid}::text AND tenant_id = ${ctx.tenantId}
        ORDER BY created_at ASC
        LIMIT 100
      `);

      return rows.map((r: any) => ({
        ...r,
        created_at_ms: parseFloat(r.created_at_ms)
      }));
    }
  ).then(res => res.data || []);
}

/**
 * Get the latest AI status for a conversation (used by chat header badge).
 * Returns the most recent event type, timestamp, and severity.
 */
export async function getAiStatusForConversation(phoneNumber: string) {
  if (!phoneNumber) return null;

  return withActionGuard(
    { actionName: 'getAiStatusForConversation' },
    async (ctx) => {
      const rows = await ctx.db.executeSafe(sql`
        SELECT ae.event_type, ae.event_category, ae.severity, ae.created_at
        FROM ai_events ae
        JOIN conversations c ON ae.conversation_id = c.id::text AND c.tenant_id = ${ctx.tenantId}
        WHERE c.phone_number = ${phoneNumber} AND ae.tenant_id = ${ctx.tenantId}
        ORDER BY ae.created_at DESC
        LIMIT 1
      `);

      if (rows.length === 0) return null;
      
      const row = rows[0];
      return {
        lastEvent: row.event_type,
        category: row.event_category,
        severity: row.severity,
        timestamp: row.created_at,
        isRecent: new Date(row.created_at).getTime() > Date.now() - 5 * 60 * 1000 // Within last 5 min
      };
    }
  ).then(res => res.data || null);
}

export async function getCustomerAiBrain(phone: string) {
  if (!phone) return null;
  
  return withActionGuard(
    { actionName: 'getCustomerAiBrain' },
    async (ctx) => {
      const convRows = await ctx.db.executeSafe(sql`
        SELECT 
          c.id, c.lead_stage, c.department, c.status,
          mem.buying_intent, mem.sentiment, mem.summary_text,
          (
            SELECT count(*) FROM ai_audit_logs aal 
            WHERE aal.conversation_id::text = c.id::text
          ) as total_tool_calls
        FROM conversations c
        LEFT JOIN conversation_memory mem ON c.id::text = mem.conversation_id::text
        WHERE c.phone_number = ${phone} AND c.tenant_id = ${ctx.tenantId}
        LIMIT 1
      `);
      
      if (convRows.length === 0) return null;
      return convRows[0];
    }
  ).then(res => res.data || null);
}
