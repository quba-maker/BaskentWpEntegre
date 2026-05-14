import { ClassificationResult } from "./classification.service";
import { logger } from "@/lib/core/logger";

export interface MessageStats {
  patientMsgCount: number;
  hasSharedImage: boolean;
  hasSharedDocument: boolean;
  messageLength: number;
}

export interface ScoreRecommendation {
  finalDelta: number;
  reasons: string[];
  newStageSuggestion: string | null;
  needsEscalation: boolean;
  auditLog: any[];
}

/**
 * 🎯 Dedicated Scoring Engine
 * Engagement (Mesaj Sayısı, Uzunluk, Dosya) ve Intent tabanlı puanlamayı birleştirir.
 */
export class ScoringEngine {
  private log = logger.withContext({ module: 'ScoringEngine' });

  public evaluate(
    classification: ClassificationResult,
    stats: MessageStats
  ): ScoreRecommendation {
    let delta = 0;
    const reasons: string[] = [];
    const auditLog: any[] = [];
    
    // 1. Intent Base Score
    if (classification.totalScoreContribution !== 0) {
      delta += classification.totalScoreContribution;
      reasons.push(`Classification Engine Contribution: ${classification.totalScoreContribution}`);
      auditLog.push({ type: 'classification', val: classification.totalScoreContribution });
    }

    // 2. Engagement Scoring (Volume)
    if (stats.patientMsgCount >= 10) { delta += 15; reasons.push('High Volume (10+ msgs): +15'); auditLog.push({ type: 'volume', val: 15 }); }
    else if (stats.patientMsgCount >= 6) { delta += 10; reasons.push('Medium Volume (6+ msgs): +10'); auditLog.push({ type: 'volume', val: 10 }); }
    else if (stats.patientMsgCount >= 3) { delta += 5; reasons.push('Low Volume (3+ msgs): +5'); auditLog.push({ type: 'volume', val: 5 }); }

    // 3. Document/Image Scoring
    if (stats.hasSharedImage) { delta += 20; reasons.push('Shared Image (MR/XRay): +20'); auditLog.push({ type: 'media', val: 20 }); }
    if (stats.hasSharedDocument) { delta += 20; reasons.push('Shared Document (Lab): +20'); auditLog.push({ type: 'media', val: 20 }); }

    // 4. Length Scoring (High Intent)
    if (stats.messageLength > 200) { delta += 10; reasons.push('Long Message (>200 chars): +10'); auditLog.push({ type: 'length', val: 10 }); }
    else if (stats.messageLength > 100) { delta += 5; reasons.push('Medium Message (>100 chars): +5'); auditLog.push({ type: 'length', val: 5 }); }

    // 5. Negative Scoring & Overrides
    let suggestedStage = null;
    if (classification.isLost) {
      delta = -50; // Ağır negatif skor (Lost override)
      suggestedStage = 'lost';
      reasons.push('Lost Patient Intent: -50 (Override)');
      auditLog.push({ type: 'override_lost', val: -50 });
    } else if (classification.appointmentRequested) {
      suggestedStage = 'hot_lead'; // Appointed değil! İnsan atayana kadar hot lead.
    } else if (delta >= 25 || classification.intents.includes('Randevu İlgisi')) {
      suggestedStage = 'hot_lead';
    } else if (delta > 0) {
      suggestedStage = 'discovery';
    }

    const rec: ScoreRecommendation = {
      finalDelta: delta,
      reasons,
      newStageSuggestion: suggestedStage,
      needsEscalation: classification.needsEscalation || (delta >= 50 && !classification.isLost),
      auditLog
    };

    this.log.info('Scoring Evaluated', { rec });
    return rec;
  }
}
