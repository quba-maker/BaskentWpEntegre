export const CONVERSATION_STATES = {
  OPEN: 'open', // New or active but without AI orchestration locking it strictly
  AI_ACTIVE: 'ai_active', // Under strict orchestration control
  WAITING_USER: 'waiting_user', // AI prompted user, awaiting reply
  WAITING_HUMAN: 'waiting_human', // User requested agent, or AI escalated
  ESCALATED: 'escalated', // High-priority human intervention
  CLOSED: 'closed', // Resolved
  ARCHIVED: 'archived', // Historical
  FAILED: 'failed', // Terminal error state
} as const;

export type ConversationState = typeof CONVERSATION_STATES[keyof typeof CONVERSATION_STATES];

// Define valid state transitions (DAG)
const VALID_TRANSITIONS: Record<ConversationState, ConversationState[]> = {
  [CONVERSATION_STATES.OPEN]: [
    CONVERSATION_STATES.AI_ACTIVE, 
    CONVERSATION_STATES.WAITING_USER, 
    CONVERSATION_STATES.WAITING_HUMAN,
    CONVERSATION_STATES.CLOSED
  ],
  [CONVERSATION_STATES.AI_ACTIVE]: [
    CONVERSATION_STATES.WAITING_USER, 
    CONVERSATION_STATES.WAITING_HUMAN, 
    CONVERSATION_STATES.ESCALATED, 
    CONVERSATION_STATES.FAILED,
    CONVERSATION_STATES.CLOSED
  ],
  [CONVERSATION_STATES.WAITING_USER]: [
    CONVERSATION_STATES.AI_ACTIVE, 
    CONVERSATION_STATES.WAITING_HUMAN, 
    CONVERSATION_STATES.CLOSED,
    CONVERSATION_STATES.ARCHIVED
  ],
  [CONVERSATION_STATES.WAITING_HUMAN]: [
    CONVERSATION_STATES.OPEN, // Human takes over and sets to open
    CONVERSATION_STATES.ESCALATED, 
    CONVERSATION_STATES.CLOSED
  ],
  [CONVERSATION_STATES.ESCALATED]: [
    CONVERSATION_STATES.OPEN, 
    CONVERSATION_STATES.CLOSED
  ],
  [CONVERSATION_STATES.FAILED]: [
    CONVERSATION_STATES.OPEN, // Manual retry
    CONVERSATION_STATES.CLOSED
  ],
  [CONVERSATION_STATES.CLOSED]: [
    CONVERSATION_STATES.OPEN, // Re-opened by new message
    CONVERSATION_STATES.ARCHIVED
  ],
  [CONVERSATION_STATES.ARCHIVED]: [
    CONVERSATION_STATES.OPEN // Rarely re-opened
  ]
};

export function isValidTransition(from: ConversationState, to: ConversationState): boolean {
  if (from === to) return true; // Idempotent updates are allowed
  return VALID_TRANSITIONS[from]?.includes(to) ?? false;
}
