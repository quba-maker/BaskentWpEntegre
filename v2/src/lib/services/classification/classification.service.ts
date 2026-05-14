import { TenantRuleset, BaskentRuleset_V1, ClassificationRule } from "./rulesets";
import { logger } from "@/lib/core/logger";

export interface ClassificationResult {
  matchedRules: ClassificationRule[];
  detectedDepartments: string[];
  intents: string[];
  patientType: string;
  totalScoreContribution: number;
  isLost: boolean;
  appointmentRequested: boolean;
  needsEscalation: boolean;
  explainabilityLog: string;
}

/**
 * 🧠 Deterministic Classification Engine
 * AI'nin language katmanından bağımsız olarak, business logic ve regex ruleset'lerini işletir.
 * Veritabanına YAZMAZ (No Mutation). Sadece tavsiye (Recommendation) üretir.
 */
export class ClassificationService {
  private log = logger.withContext({ module: 'ClassificationService' });
  private ruleset: TenantRuleset;

  constructor(ruleset: TenantRuleset = BaskentRuleset_V1) {
    this.ruleset = ruleset;
  }

  /**
   * Metni analiz eder ve eşleşen tüm kural setlerini döner.
   */
  public analyze(text: string, phoneNumber?: string): ClassificationResult {
    const lowerText = text.toLowerCase().trim();
    
    const result: ClassificationResult = {
      matchedRules: [],
      detectedDepartments: [],
      intents: [],
      patientType: 'Yerli',
      totalScoreContribution: 0,
      isLost: false,
      appointmentRequested: false,
      needsEscalation: false,
      explainabilityLog: `[Classification Engine v${this.ruleset.version}]\n`
    };

    if (!lowerText) return result;

    let hasTerminalIntent = false;

    // 1. Kural Motorunu Çalıştır
    for (const rule of this.ruleset.rules) {
      if (hasTerminalIntent && rule.category === 'intent') {
        continue; // Eğer kesin niyet veya kayıp eşleştiyse diğer intent kurallarını atla
      }

      if (rule.pattern.test(lowerText)) {
        result.matchedRules.push(rule);
        result.totalScoreContribution += rule.scoreContribution;
        result.explainabilityLog += `✅ Matched Rule [${rule.category}]: ${rule.tag || rule.id} (Score: ${rule.scoreContribution > 0 ? '+' : ''}${rule.scoreContribution})\n`;

        switch (rule.category) {
          case 'department':
            if (rule.tag && !result.detectedDepartments.includes(rule.tag)) {
              result.detectedDepartments.push(rule.tag);
            }
            break;
          case 'patient_type':
            if (rule.tag) result.patientType = rule.tag;
            break;
          case 'intent':
            if (rule.tag) result.intents.push(rule.tag);
            if (rule.id === 'intent_lost_patient') {
              result.isLost = true;
            }
            if (rule.id === 'intent_appointment_confirm') {
              result.appointmentRequested = true;
              result.needsEscalation = true; // Otomatik handover recommendation
            }
            if (rule.isTerminal) {
              hasTerminalIntent = true;
            }
            break;
        }
      }
    }

    // 2. Yabancı Numara (Identity Logic) - Sadece regex değil, numara kodu üzerinden
    if (phoneNumber && !phoneNumber.startsWith('90') && !phoneNumber.startsWith('test') && !phoneNumber.match(/^[0-9]{13,}$/)) {
      if (result.patientType !== 'Gurbetçi') { // Gurbetçi regex'i ezdiyse dokunma
        result.patientType = 'Yabancı Turist';
        result.totalScoreContribution += 20;
        result.explainabilityLog += `🌍 Detected Foreign Phone Prefix -> PatientType: Yabancı Turist (Score: +20)\n`;
      }
    }

    this.log.info('Classification Complete', {
      score: result.totalScoreContribution,
      departments: result.detectedDepartments,
      intents: result.intents
    });

    return result;
  }
}
