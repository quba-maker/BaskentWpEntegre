import { logger } from "@/lib/core/logger";

export type ConversationPhase = 'greeting' | 'discovery' | 'trust' | 'negotiation' | 'handover';

export interface PhaseTransition {
  from: ConversationPhase;
  to: ConversationPhase;
  trigger: string;
  condition?: (context: any) => boolean;
}

/**
 * 🚦 Workflow Engine (Finite State Machine)
 * AI'nin faz geçişlerini (Phase Transitions) denetler.
 * Geriye doğru geçişleri veya izinsiz atlamaları engeller.
 */
export class WorkflowService {
  private log = logger.withContext({ module: 'WorkflowEngine' });

  // İzin verilen geçiş kuralları (Formal Transitions)
  private static readonly TRANSITIONS: PhaseTransition[] = [
    { from: 'greeting', to: 'discovery', trigger: 'has_intent' },
    { from: 'discovery', to: 'trust', trigger: 'needs_info' },
    { from: 'discovery', to: 'negotiation', trigger: 'price_asked' },
    { from: 'trust', to: 'negotiation', trigger: 'price_asked' },
    { from: 'greeting', to: 'handover', trigger: 'emergency_or_complaint' },
    { from: 'discovery', to: 'handover', trigger: 'appointment_requested' },
    { from: 'trust', to: 'handover', trigger: 'appointment_requested' },
    { from: 'negotiation', to: 'handover', trigger: 'appointment_requested' }
  ];

  /**
   * Yeni faza geçişin yasal (valid) olup olmadığını kontrol eder.
   */
  public canTransition(currentPhase: ConversationPhase, targetPhase: ConversationPhase): boolean {
    if (currentPhase === targetPhase) return true; // Aynı fazda kalmak serbest
    
    // Handover terminal state'tir (Geri dönülmez)
    if (currentPhase === 'handover') {
      this.log.warn(`🛑 Invalid Transition: Cannot transition out of terminal state 'handover'.`);
      return false;
    }

    const validTransition = WorkflowService.TRANSITIONS.some(
      t => t.from === currentPhase && t.to === targetPhase
    );

    if (!validTransition) {
      this.log.warn(`⚠️ Illegal Phase Transition Attempt: ${currentPhase} -> ${targetPhase}`);
    }

    return validTransition;
  }

  /**
   * Terminal state kontrolü
   */
  public isTerminal(phase: ConversationPhase): boolean {
    return phase === 'handover';
  }
}
