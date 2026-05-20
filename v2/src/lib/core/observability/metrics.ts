export interface PipelineMetric {
  pipelineRunId: string;
  tenantId: string;
  metricName: string;
  value: number;
  tags?: Record<string, string>;
  timestamp: string;
}

/**
 * Enterprise Metrics Aggregator for the Pipeline Orchestrator.
 * Sends metrics to the backend logging or analytics provider.
 */
export class PipelineMetrics {
  static async log(metric: PipelineMetric) {
    if (process.env.NODE_ENV !== 'production') {
      console.log(`[METRICS] ${metric.metricName}: ${metric.value}`, metric.tags || {});
    }
    
    // In production, this would be pushed to DataDog, NewRelic, or a custom DB table
    // await db.insert(metricsTable).values(metric);
  }

  static async recordLatency(pipelineRunId: string, tenantId: string, stage: string, latencyMs: number) {
    await this.log({
      pipelineRunId,
      tenantId,
      metricName: 'pipeline.stage.latency',
      value: latencyMs,
      tags: { stage },
      timestamp: new Date().toISOString()
    });
  }

  static async recordPayloadSize(pipelineRunId: string, tenantId: string, sizeBytes: number) {
    await this.log({
      pipelineRunId,
      tenantId,
      metricName: 'pipeline.payload.size',
      value: sizeBytes,
      timestamp: new Date().toISOString()
    });
  }
}
