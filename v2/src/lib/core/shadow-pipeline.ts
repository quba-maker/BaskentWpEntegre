import { TenantDB } from "./tenant-db";
import { logger } from "./logger";
import { sql } from "@/lib/db";

export interface ShadowExecutionResult {
  legacy: any;
  v2: any;
}

export interface DriftReport {
  tenantId: string;
  phoneNumber: string;
  traceId: string;
  responseMismatch: boolean;
  scoreDeltaMismatch: boolean;
  escalationMismatch: boolean;
  latencyDiff: number;
  hallucinationFlag: boolean;
  complianceViolation: boolean;
  details: string;
}

/**
 * 🕵️‍♂️ Dual Execution & Drift Analysis Engine
 * Legacy ve V2'yi parallel çalıştırır, diffleri veritabanına loglar.
 */
export class ShadowPipeline {
  private db: TenantDB;
  private log = logger.withContext({ module: 'ShadowPipeline' });

  constructor(db: TenantDB) {
    this.db = db;
  }

  /**
   * Drift Report'u DB'ye yazar (İnsan review dashboard'u için).
   */
  async saveDriftLog(report: DriftReport) {
    try {
      await this.db.executeSafe(sql`
        CREATE TABLE IF NOT EXISTS shadow_drift_logs (
          id SERIAL PRIMARY KEY,
          tenant_id UUID,
          phone_number VARCHAR(20),
          trace_id VARCHAR(50),
          response_mismatch BOOLEAN,
          score_delta_mismatch BOOLEAN,
          escalation_mismatch BOOLEAN,
          latency_diff INT,
          hallucination_flag BOOLEAN,
          compliance_violation BOOLEAN,
          details JSONB,
          created_at TIMESTAMP DEFAULT NOW()
        )
      `);

      await this.db.executeSafe(sql`
        INSERT INTO shadow_drift_logs (
          tenant_id, phone_number, trace_id, response_mismatch, 
          score_delta_mismatch, escalation_mismatch, latency_diff, 
          hallucination_flag, compliance_violation, details
        ) VALUES (
          ${this.db.tenantId}, ${report.phoneNumber}, ${report.traceId},
          ${report.responseMismatch}, ${report.scoreDeltaMismatch},
          ${report.escalationMismatch}, ${report.latencyDiff},
          ${report.hallucinationFlag}, ${report.complianceViolation},
          ${report.details}
        )
      `);
    } catch (e: any) {
      this.log.error('Failed to save drift log', e);
    }
  }

  /**
   * Paralel Execution ve Drift Analizi
   */
  async executeShadow(
    phoneNumber: string,
    traceId: string,
    legacyFn: () => Promise<any>,
    v2Fn: () => Promise<any>
  ): Promise<any> {
    const t0 = Date.now();
    
    // Paralel çalıştır, V2 asla hata fırlatıp Legacy'yi bozmasın
    const [legacyRes, v2Res] = await Promise.allSettled([
      legacyFn(),
      v2Fn()
    ]);

    const latencyLegacy = Date.now() - t0;
    const latencyV2 = Date.now() - t0; // V2'nin süresini bağımsız ölçmek daha iyi ama basitçe burada t0 üzerinden alıyoruz. (İdeali içerde ölçmek)

    if (legacyRes.status === 'rejected') {
      this.log.error(`🔥 Legacy Runtime Crashed!`, legacyRes.reason);
      throw legacyRes.reason; // Legacy çökerse asıl hata
    }

    const legacyOutput = legacyRes.value;

    if (v2Res.status === 'rejected') {
      this.log.warn(`⚠️ V2 Shadow Execution Crashed`, v2Res.reason);
      // V2'deki çöküş Legacy'yi etkilemez!
      return legacyOutput;
    }

    const v2Output = v2Res.value;

    // --- DRIFT ANALYSIS ---
    let responseMismatch = false;
    let scoreDeltaMismatch = false;
    let escalationMismatch = false;
    const details: any = { legacy: {}, v2: {} };

    // Response Parity
    if (legacyOutput.response !== v2Output.response) {
      // Promptlar tam aynı cümleyi kurmayabilir. Tone ve Length analizi daha mantıklı ama şimdilik strict equality kontrolü yapıp "mismatch" flag'i atıyoruz.
      // Gerçek dashboard'da metin diff'i gösterilir.
      responseMismatch = true;
      details.legacy.response = legacyOutput.response;
      details.v2.response = v2Output.response;
    }

    // Score Parity
    if (legacyOutput.score !== v2Output.scoreDelta) {
      scoreDeltaMismatch = true;
      details.legacy.score = legacyOutput.score;
      details.v2.score = v2Output.scoreDelta;
    }

    // Escalation Parity (Handover)
    if (legacyOutput.appointmentRequested !== v2Output.needsEscalation) {
      escalationMismatch = true;
      details.legacy.handover = legacyOutput.appointmentRequested;
      details.v2.handover = v2Output.needsEscalation;
    }

    // Compliance / Hallucination
    const complianceViolation = v2Output.isApproved === false;

    const hasDrift = responseMismatch || scoreDeltaMismatch || escalationMismatch || complianceViolation;

    if (hasDrift) {
      this.log.info(`🚨 Behavioral Drift Detected [Trace: ${traceId}]`);
      await this.saveDriftLog({
        tenantId: this.db.tenantId,
        phoneNumber,
        traceId,
        responseMismatch,
        scoreDeltaMismatch,
        escalationMismatch,
        latencyDiff: latencyV2 - latencyLegacy,
        hallucinationFlag: false, // Length kontrolü vs.
        complianceViolation,
        details: JSON.stringify(details)
      });
    }

    // SONUÇ: Kullanıcıya HER ZAMAN Legacy sonucu dönülür (Canary kapalıysa).
    return legacyOutput;
  }
}
