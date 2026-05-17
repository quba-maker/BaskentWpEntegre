import { logger } from "@/lib/core/logger";
import { telemetry } from "@/lib/observability/telemetry";

const redisUrl = process.env.UPSTASH_REDIS_REST_URL;
const redisToken = process.env.UPSTASH_REDIS_REST_TOKEN;

// Lightweight Redis REST wrapper (Zero dependency)
export const redis = (redisUrl && redisToken) ? {
  async get<T>(key: string): Promise<T | null> {
    const res = await fetch(`${redisUrl}/get/${key}`, { headers: { Authorization: `Bearer ${redisToken}` } });
    const data = await res.json();
    return data.result;
  },
  async set(key: string, value: string, opts?: { px?: number }): Promise<void> {
    const url = opts?.px ? `${redisUrl}/set/${key}/${value}/px/${opts.px}` : `${redisUrl}/set/${key}/${value}`;
    await fetch(url, { headers: { Authorization: `Bearer ${redisToken}` } });
  },
  async incr(key: string): Promise<number> {
    const res = await fetch(`${redisUrl}/incr/${key}`, { headers: { Authorization: `Bearer ${redisToken}` } });
    const data = await res.json();
    return data.result;
  },
  async expire(key: string, seconds: number): Promise<void> {
    await fetch(`${redisUrl}/expire/${key}/${seconds}`, { headers: { Authorization: `Bearer ${redisToken}` } });
  },
  async del(key: string): Promise<void> {
    await fetch(`${redisUrl}/del/${key}`, { headers: { Authorization: `Bearer ${redisToken}` } });
  }
} : null;

export interface CircuitBreakerOptions {
  failureThreshold: number;   // Number of failures before tripping
  resetTimeoutMs: number;     // Time in MS before moving to HALF-OPEN
}

/**
 * 🛡️ Enterprise AI Circuit Breaker
 * Upstash Redis tabanlı distributed devre kesici.
 * Eğer LLM provider çökerse (Timeout/500) tüm sistemi cascading failure'dan korur.
 */
export class CircuitBreaker {
  private log = logger.withContext({ module: 'CircuitBreaker' });

  constructor(
    private serviceName: string,
    private options: CircuitBreakerOptions = { failureThreshold: 5, resetTimeoutMs: 180000 }
  ) {}

  private get redisKey() {
    return `circuit_breaker:${this.serviceName}:failures`;
  }

  private get stateKey() {
    return `circuit_breaker:${this.serviceName}:state`;
  }

  /**
   * LLM çağrısından önce çalışır. Eğer devre AÇIK ise hata fırlatır.
   */
  public async assertClosed(): Promise<void> {
    if (!redis) return; // Redis yoksa fail-open (izin ver)

    try {
      const state = await redis.get<string>(this.stateKey);
      
      if (state === 'OPEN') {
        this.log.warn(`[CIRCUIT_OPEN] ${this.serviceName} is currently failing. Execution blocked.`);
        
        telemetry.track(
          'AI_CIRCUIT_OPEN',
          'warn',
          {
            severity: 'critical',
            reason: `Circuit breaker tripped for ${this.serviceName}`
          }
        );

        throw new Error(`CIRCUIT_OPEN: ${this.serviceName}`);
      }
    } catch (e: any) {
      if (e.message.startsWith('CIRCUIT_OPEN')) throw e;
      this.log.error('Circuit breaker assertion failed', e);
    }
  }

  /**
   * Başarılı bir LLM çağrısından sonra çalışır. Hatayı sıfırlar.
   */
  public async recordSuccess(): Promise<void> {
    if (!redis) return;

    try {
      const state = await redis.get<string>(this.stateKey);
      
      if (state === 'HALF_OPEN' || state === 'OPEN') {
         await redis.set(this.stateKey, 'CLOSED');
         this.log.info(`[CIRCUIT_RECOVERED] ${this.serviceName} is back online.`);
      }

      await redis.del(this.redisKey);
    } catch (e: any) {
      this.log.error('Failed to record success', e);
    }
  }

  /**
   * Hatalı bir LLM çağrısından (Timeout, 500) sonra çalışır. 
   * Eşik aşılırsa devreyi kırar.
   */
  public async recordFailure(): Promise<void> {
    if (!redis) return;

    try {
      const failures = await redis.incr(this.redisKey);
      
      // İlk hatada TTL başlat (örn: 1 dk içinde 5 hata)
      if (failures === 1) {
        await redis.expire(this.redisKey, 60); 
      }

      if (failures >= this.options.failureThreshold) {
        // Devreyi kır
        await redis.set(this.stateKey, 'OPEN', { px: this.options.resetTimeoutMs });
        
        this.log.error(`[CIRCUIT_TRIPPED] ${this.serviceName} failure threshold reached (${failures}). Circuit is OPEN.`);
        
        telemetry.track(
          'AI_CIRCUIT_OPEN',
          'warn',
          {
            severity: 'critical',
            reason: `Failure threshold reached (${failures}) for ${this.serviceName}`
          }
        );
      }
    } catch (e: any) {
      this.log.error('Failed to record failure', e);
    }
  }

  /**
   * Wraps an async function with the circuit breaker logic
   */
  public async execute<T>(fn: () => Promise<T>): Promise<T> {
    await this.assertClosed();

    try {
      const result = await fn();
      await this.recordSuccess();
      return result;
    } catch (error: any) {
      await this.recordFailure();
      throw error;
    }
  }
}
