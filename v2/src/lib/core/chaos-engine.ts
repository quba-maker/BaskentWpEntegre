import { logger } from "./logger";

export interface ChaosConfig {
  simulateProviderTimeout: boolean;
  simulateDbOutage: boolean;
  simulateDuplicateStorm: boolean;
  simulateOutOfOrderDelivery: boolean;
}

/**
 * 🌪️ Chaos Engine
 * Production validation aşamasında V2 Runtime'ın dayanıklılığını test eder.
 * SADECE Shadow Mode aktifken veya test ortamında çalışır.
 */
export class ChaosEngine {
  private log = logger.withContext({ module: 'ChaosEngine' });
  private config: ChaosConfig;

  constructor(config?: Partial<ChaosConfig>) {
    this.config = {
      simulateProviderTimeout: false,
      simulateDbOutage: false,
      simulateDuplicateStorm: false,
      simulateOutOfOrderDelivery: false,
      ...config
    };
  }

  /**
   * LLM Provider Timeout simülasyonu
   */
  async interceptProviderCall<T>(call: () => Promise<T>): Promise<T> {
    if (this.config.simulateProviderTimeout && Math.random() < 0.1) {
      this.log.error("💥 CHAOS: Injecting LLM Provider Timeout");
      await new Promise(r => setTimeout(r, 15000));
      throw new Error("Provider Timeout (Chaos Simulation)");
    }
    return call();
  }

  /**
   * Webhook Duplicate Storm simülasyonu
   */
  async interceptWebhook(payload: any, next: (p: any) => Promise<void>) {
    if (this.config.simulateDuplicateStorm && Math.random() < 0.05) {
      this.log.warn("🌪️ CHAOS: Injecting Duplicate Webhook Storm (5x parallel)");
      const promises = [];
      for (let i = 0; i < 5; i++) {
        promises.push(next(payload));
      }
      await Promise.allSettled(promises);
      return;
    }
    await next(payload);
  }
}
