export interface TenantBrainSettings {
  aiModel: string;
  maxMessages: number;
  maxResponseTokens: number;
  workingHours: { enabled: boolean; start?: string; end?: string; offMessage?: string };
  aggressionLevel: string;
}

export interface TenantBrainContext {
  tenantId: string;
  channel: string;
  webhookPayloadId: string; // for tracing and strict isolation
  brainSource?: 'v1_settings' | 'v2_channel_prompts'; // V2 observability — which resolution path was used
  config?: any; // The full tenant config resolved
  knowledge?: {
    prices?: string;
    rules?: string;
  };
  settings: TenantBrainSettings;
}

export interface TenantBrainNamespaces {
  memory: (key: string) => string;
  vector: () => string;
  cache: (key: string) => string;
}

export interface TenantBrainPrompts {
  systemPrompt: string | null;
  promptHash: string | null;
  metadata?: any;
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
  config?: any,
  promptHash?: string | null,
  knowledge?: TenantBrainContext['knowledge'],
  settings?: TenantBrainSettings,
  brainSource?: 'v1_settings' | 'v2_channel_prompts',
  promptMetadata?: any
): TenantBrain {
  
  const instanceId = `brain_${tenantId}_${Date.now()}_${Math.random().toString(36).substring(7)}`;

  const namespaces: TenantBrainNamespaces = {
    memory: (key: string) => `tenant:${tenantId}:memory:${key}`,
    vector: () => `tenant:${tenantId}:vectors`,
    cache: (key: string) => `tenant:${tenantId}:cache:${key}`,
  };

  const prompts: TenantBrainPrompts = {
    systemPrompt: rawSystemPrompt,
    promptHash: promptHash || null,
    metadata: promptMetadata || null,
    getFormattedPrompt: (phase: string, context?: Record<string, any>) => {
      const base = rawSystemPrompt || "Sen kibar ve yardımcı bir asistansın.";
      return `${base}\n\n[Sistem Direktifi] Şu anki evre: ${phase.toUpperCase()}`;
    }
  };

  // Default settings fallback
  const resolvedSettings: TenantBrainSettings = settings || {
    aiModel: 'gemini-2.5-flash',
    maxMessages: 20,
    maxResponseTokens: 2000,
    workingHours: { enabled: false },
    aggressionLevel: 'medium'
  };

  const brain = {
    id: instanceId,
    context: {
      tenantId,
      channel,
      webhookPayloadId,
      brainSource: brainSource || 'v1_settings',
      config,
      knowledge,
      settings: resolvedSettings
    },
    namespaces,
    prompts
  };

  return deepFreeze(brain) as unknown as TenantBrain;
}
