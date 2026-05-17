export interface TenantBrainContext {
  tenantId: string;
  channel: string;
  webhookPayloadId: string; // for tracing and strict isolation
  config?: any; // The full tenant config resolved
}

export interface TenantBrainNamespaces {
  memory: (key: string) => string;
  vector: () => string;
  cache: (key: string) => string;
}

export interface TenantBrainPrompts {
  systemPrompt: string | null;
  getFormattedPrompt: (phase: string, context?: Record<string, any>) => string;
}

export interface TenantBrain {
  readonly id: string; // strict unique instance id for the execution run
  readonly context: TenantBrainContext;
  readonly namespaces: TenantBrainNamespaces;
  readonly prompts: TenantBrainPrompts;
  
  // Future expansions: FSM registry, Policy registry, Telemetry
  // readonly fsm: FSMRegistry;
  // readonly policies: PolicyRegistry;
}

function deepFreeze<T>(obj: T): T {
  if (obj === null || typeof obj !== "object") {
    return obj;
  }
  Object.keys(obj).forEach((prop) => {
    const value = (obj as any)[prop];
    if (typeof value === "object" && value !== null && !Object.isFrozen(value)) {
      deepFreeze(value);
    }
  });
  return Object.freeze(obj);
}

/**
 * PHASE 1 - TENANT BRAIN CONTAINER
 * Creates an immutable, request-scoped TenantBrain.
 * This MUST be re-instantiated on every webhook/request.
 * NEVER store this globally.
 */
export function createTenantBrain(
  tenantId: string, 
  channel: string, 
  webhookPayloadId: string,
  rawSystemPrompt: string | null,
  config?: any
): TenantBrain {
  
  const instanceId = `brain_${tenantId}_${Date.now()}_${Math.random().toString(36).substring(7)}`;

  // Namespace generators mathematically bind the tenantId to the keys
  const namespaces: TenantBrainNamespaces = {
    memory: (key: string) => `tenant:${tenantId}:memory:${key}`,
    vector: () => `tenant:${tenantId}:vectors`,
    cache: (key: string) => `tenant:${tenantId}:cache:${key}`,
  };

  const prompts: TenantBrainPrompts = {
    systemPrompt: rawSystemPrompt,
    getFormattedPrompt: (phase: string, context?: Record<string, any>) => {
      // Basic formatting, to be expanded in PromptBuilder refactor
      const base = rawSystemPrompt || "Sen kibar ve yardımcı bir asistansın.";
      return `${base}\n\n[Sistem Direktifi] Şu anki evre: ${phase.toUpperCase()}`;
    }
  };

  const brain = {
    id: instanceId,
    context: {
      tenantId,
      channel,
      webhookPayloadId,
      config
    },
    namespaces,
    prompts
  };

  return deepFreeze(brain) as unknown as TenantBrain;
}
