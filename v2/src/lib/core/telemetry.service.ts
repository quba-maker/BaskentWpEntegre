import { logger } from "./logger";
import { TenantDB } from "./tenant-db";

export interface AIExecutionMetrics {
  provider: string;
  modelId: string;
  latencyMs: number;
  inputTokens: number;
  outputTokens: number;
  isFallback: boolean;
  isTruncated: boolean;
  costEstimateUsd?: number;
}

export interface WorkflowMetrics {
  timeInQueueMs: number;
  totalExecutionTimeMs: number;
  isEscalated: boolean;
  isDuplicate: boolean;
}

/**
 * 📡 Telemetry & Health Monitor
 * Platformun sağlığını (Latency, Maliyet, Hatalar) tenant bazında ölçümleyip loglar.
 */
export class TelemetryService {
  private log = logger.withContext({ module: 'TelemetryService' });
  private db: TenantDB;

  constructor(db: TenantDB) {
    this.db = db;
  }

  /**
   * AI Katmanındaki ölçümleri kaydeder (Cost & Latency Tracking)
   */
  trackAIExecution(metrics: AIExecutionMetrics) {
    // Basit maliyet tahmini (Örn: Gemini Flash: $0.15/1M input, $0.60/1M output)
    let estimatedCost = 0;
    if (metrics.provider === 'gemini' && metrics.modelId.includes('flash')) {
      estimatedCost = (metrics.inputTokens / 1000000) * 0.15 + (metrics.outputTokens / 1000000) * 0.60;
    }

    metrics.costEstimateUsd = estimatedCost;

    this.log.info('AI Execution Telemetry', {
      telemetryType: 'ai_execution',
      ...metrics
    });

    // FIRE AND FORGET: Ana akışı bloklamadan background'da çalışır
    Promise.resolve().then(async () => {
      try {
        await this.db.executeSafe(`
          CREATE TABLE IF NOT EXISTS telemetry_ai (
            id SERIAL PRIMARY KEY,
            tenant_id UUID,
            trace_id VARCHAR(50),
            provider VARCHAR(50),
            model_id VARCHAR(50),
            latency_ms INT,
            input_tokens INT,
            output_tokens INT,
            estimated_cost_usd NUMERIC(10, 6),
            is_fallback BOOLEAN,
            created_at TIMESTAMP DEFAULT NOW()
          )
        `);

        await this.db.executeSafe(`
          INSERT INTO telemetry_ai (
            tenant_id, trace_id, provider, model_id, latency_ms, input_tokens, output_tokens, estimated_cost_usd, is_fallback
          ) VALUES (
            $1, $2, $3, $4, $5, $6, $7, $8, $9
          )
        `, [
          this.db.tenantId, 
          this.log.withContext({}).baseContext.traceId || null,
          metrics.provider, metrics.modelId, metrics.latencyMs, metrics.inputTokens, metrics.outputTokens, estimatedCost, metrics.isFallback
        ]);
      } catch (e) {
        // Sessizce hatayı yut (Production akışını bozmamak için)
        console.error('Failed to save AI telemetry in background', e);
      }
    });
  }

  /**
   * Sistem/Workflow gecikmelerini ve başarı/esc oranlarını kaydeder
   */
  trackWorkflowExecution(metrics: WorkflowMetrics) {
    this.log.info('Workflow Execution Telemetry', {
      telemetryType: 'workflow_execution',
      ...metrics
    });
  }
}
