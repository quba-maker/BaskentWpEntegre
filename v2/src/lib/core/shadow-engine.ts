import { logger } from "./logger";

export interface ShadowCompareResult {
  match: boolean;
  legacyValue: any;
  v2Value: any;
  mismatches: string[];
}

/**
 * 🕵️ Shadow Execution Engine
 * Legacy runtime ile V2 runtime arasındaki davranış farklarını (drift) tespit eder.
 */
export class ShadowEngine {
  private static log = logger.withContext({ module: 'ShadowEngine' });

  /**
   * İki obje arasındaki farkları (DB mutation veya State) hesaplar.
   */
  static compareState(componentName: string, legacyState: any, v2State: any): ShadowCompareResult {
    const mismatches: string[] = [];
    
    // Basit obje diff
    for (const key in legacyState) {
      if (JSON.stringify(legacyState[key]) !== JSON.stringify(v2State[key])) {
        mismatches.push(key);
      }
    }
    for (const key in v2State) {
      if (!(key in legacyState)) {
        mismatches.push(`missing_in_legacy_${key}`);
      }
    }

    const match = mismatches.length === 0;

    if (!match) {
      this.log.warn(`🚨 State Drift Detected in [${componentName}]`, {
        mismatches,
        legacy: legacyState,
        v2: v2State
      });
    }

    return { match, legacyValue: legacyState, v2Value: v2State, mismatches };
  }

  /**
   * Async Execution'ları parallel çalıştırır ve süre/hata farklarını yakalar.
   */
  static async executeParallel<T>(
    name: string,
    legacyFn: () => Promise<T>,
    v2Fn: () => Promise<T>
  ): Promise<{ result: T, match: boolean }> {
    try {
      const [legacyResult, v2Result] = await Promise.allSettled([legacyFn(), v2Fn()]);

      if (legacyResult.status === 'rejected' && v2Result.status === 'fulfilled') {
        this.log.warn(`⚠️ Execution Drift: Legacy failed, V2 succeeded in [${name}]`, { error: legacyResult.reason });
        return { result: v2Result.value, match: false };
      }

      if (legacyResult.status === 'fulfilled' && v2Result.status === 'rejected') {
        this.log.error(`🔥 FATAL Drift: Legacy succeeded, V2 failed in [${name}]`, { error: v2Result.reason });
        return { result: legacyResult.value, match: false };
      }

      if (legacyResult.status === 'rejected' && v2Result.status === 'rejected') {
        return { result: null as any, match: true }; // İkisi de aynı şekilde patladıysa sorun yok
      }

      // İkisi de başarılıysa sonucu compare et
      const val1 = (legacyResult as PromiseFulfilledResult<T>).value;
      const val2 = (v2Result as PromiseFulfilledResult<T>).value;
      const diff = this.compareState(name, val1, val2);

      return { result: val1, match: diff.match };

    } catch (e) {
      this.log.error(`Shadow Engine crashed inside [${name}]`, e);
      // Fallback to legacy
      return { result: await legacyFn(), match: false };
    }
  }
}
