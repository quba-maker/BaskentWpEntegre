import { logger } from "@/lib/core/logger";
import { telemetry } from "@/lib/observability/telemetry";
import { redis } from "./circuit-breaker";

export interface CostLimiterOptions {
  maxRequests: number; // e.g. 50 requests
  windowSeconds: number; // e.g. 3600 (1 hour)
}

/**
 * 💸 Enterprise Cost Anomaly Protection
 * Her tenant için saatlik/günlük aşırı kullanımı sınırlandırır.
 */
export class CostLimiter {
  private log = logger.withContext({ module: 'CostLimiter' });

  constructor(
    private options: CostLimiterOptions = { maxRequests: 100, windowSeconds: 3600 }
  ) {}

  private getRedisKey(tenantId: string) {
    return `cost_limiter:tenant:${tenantId}:window`;
  }

  /**
   * İstek atmadan önce limit kontrolü yapar.
   * Eğer limit aşıldıysa hata fırlatır.
   */
  public async consume(tenantId: string): Promise<void> {
    if (!redis) return;

    try {
      const key = this.getRedisKey(tenantId);
      
      // Token Bucket / Sliding Window basit bir yaklaşım
      const requests = await redis.incr(key);
      
      if (requests === 1) {
        await redis.expire(key, this.options.windowSeconds);
      }

      if (requests > this.options.maxRequests) {
        this.log.warn(`[COST_LIMIT_EXCEEDED] Tenant ${tenantId} exceeded usage limit (${this.options.maxRequests} req / ${this.options.windowSeconds}s).`);
        
        telemetry.track(
          'AI_COST_THRESHOLD',
          'warn',
          {
            severity: 'high',
            reason: `Usage limit exceeded: ${requests} > ${this.options.maxRequests}`,
            tenantId
          }
        );

        throw new Error(`COST_LIMIT_EXCEEDED: Tenant ${tenantId}`);
      }
    } catch (e: any) {
      if (e.message.startsWith('COST_LIMIT_EXCEEDED')) throw e;
      this.log.error('Cost limiter check failed, allowing request (fail-open)', e);
    }
  }
}
