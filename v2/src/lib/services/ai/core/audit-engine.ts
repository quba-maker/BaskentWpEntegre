import { logger } from "@/lib/core/logger";
import { sql } from "@/lib/db";

export interface AuditLogData {
  tenantId: string;
  conversationId?: string;
  customerId?: string;
  toolName: string;
  toolArguments: any;
  validationPassed: boolean;
  executionMode: 'sandbox' | 'production';
  executionDurationMs?: number;
  inputTokens?: number;
  outputTokens?: number;
  costUsd?: number;
  aiConfidence?: number;
  reasoningSummary?: string;
  resultSummary?: any;
  errorMessage?: string;
}

export interface RuntimeMetricsData {
  tenantId: string;
  totalTokens?: number;
  promptTokens?: number;
  completionTokens?: number;
  estimatedCostUsd?: number;
  modelName: string;
  responseTimeMs: number;
  toolCallsCount: number;
}

/**
 * 📊 AI Audit Engine (Phase 5C)
 * Log every decision, tool intent, and execution trace to ensure total observability.
 * Asynchronous, non-blocking operations.
 */
export class AIAuditEngine {
  private log = logger.withContext({ module: 'AIAuditEngine' });

  /**
   * Log an individual tool execution attempt.
   */
  public async logToolExecution(data: AuditLogData): Promise<void> {
    try {
      // Execute asynchronously, don't block the main flow
      setImmediate(async () => {
        try {
          await sql`
            INSERT INTO ai_audit_logs (
              tenant_id, customer_id, conversation_id, tool_name, tool_arguments, 
              validation_passed, execution_mode, execution_duration_ms, 
              input_tokens, output_tokens, cost_usd,
              ai_confidence, reasoning_summary, result_summary, error_message
            ) VALUES (
              ${data.tenantId}, ${data.customerId || null}, ${data.conversationId || null}, 
              ${data.toolName}, ${JSON.stringify(data.toolArguments)}::jsonb, 
              ${data.validationPassed}, ${data.executionMode}, ${data.executionDurationMs || null}, 
              ${data.inputTokens || null}, ${data.outputTokens || null}, ${data.costUsd || null},
              ${data.aiConfidence || null}, ${data.reasoningSummary || null}, 
              ${data.resultSummary ? JSON.stringify(data.resultSummary) : null}::jsonb, ${data.errorMessage || null}
            )
          `;
        } catch (dbErr: any) {
          this.log.error('Failed to insert tool execution log into database', dbErr);
        }
      });
    } catch (e: any) {
      this.log.error('Failed to enqueue tool execution log', e);
    }
  }

  /**
   * Log metrics for the overall AI Orchestration request.
   */
  public async logRuntimeMetrics(data: RuntimeMetricsData): Promise<void> {
    try {
      setImmediate(async () => {
        try {
          await sql`
            INSERT INTO ai_runtime_metrics (
              tenant_id, total_tokens, prompt_tokens, completion_tokens, 
              estimated_cost_usd, model_name, response_time_ms, tool_calls_count
            ) VALUES (
              ${data.tenantId}, ${data.totalTokens || null}, ${data.promptTokens || null}, 
              ${data.completionTokens || null}, ${data.estimatedCostUsd || null}, 
              ${data.modelName}, ${data.responseTimeMs}, ${data.toolCallsCount}
            )
          `;
        } catch (dbErr: any) {
          this.log.error('Failed to insert runtime metrics into database', dbErr);
        }
      });
    } catch (e: any) {
      this.log.error('Failed to enqueue runtime metrics log', e);
    }
  }
}

export const auditEngine = new AIAuditEngine();
