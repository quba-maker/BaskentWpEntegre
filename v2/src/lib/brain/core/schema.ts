export type QubaBrainVersion = 'quba_brain_v1';

export type QubaIndustry =
  | 'general'
  | 'healthcare'
  | 'construction'
  | 'fitness';

export type QubaBrainSource =
  | 'compiled_from_v2_channel_prompt'
  | 'compiled_from_legacy_settings'
  | 'manual_setup'
  | 'sector_default';

export type QubaTonePreset =
  | 'warm_corporate'
  | 'calm_professional'
  | 'direct_sales'
  | 'friendly_support'
  | 'luxury_consultant';

export type QubaGoalType =
  | 'answer_questions'
  | 'qualify_lead'
  | 'book_appointment'
  | 'schedule_callback'
  | 'handoff_to_human'
  | 'collect_missing_info'
  | 'build_trust'
  | 'recover_objection';

export type QubaPolicySeverity = 'hard' | 'soft' | 'guide';

export interface QubaIdentityProfile {
  organizationName: string;
  organizationShortName?: string;
  assistantName?: string;
  revealBotIdentity: boolean;
  defaultLanguage: string;
  supportedLanguages: string[];
}

export interface QubaToneProfile {
  preset: QubaTonePreset;
  addressStyle: 'neutral_you' | 'first_name_allowed' | 'formal';
  maxQuestionCountPerReply: number;
  avoidPhrases: string[];
  preferredClosers: string[];
}

export interface QubaGoal {
  type: QubaGoalType;
  priority: number;
  description: string;
}

export interface QubaServiceCatalogItem {
  id: string;
  name: string;
  aliases: string[];
  category?: string;
  routeTo?: string;
  verifiedFacts: string[];
  requiredInfo: string[];
  safeAnswerHints: string[];
}

export interface QubaPolicyRule {
  id: string;
  title: string;
  severity: QubaPolicySeverity;
  appliesWhen: string[];
  instruction: string;
  safeResponse?: string;
  forbiddenClaims?: string[];
}

export interface QubaActionPolicy {
  id: string;
  action:
    | 'schedule_callback'
    | 'create_appointment'
    | 'handoff_human'
    | 'send_link'
    | 'answer_only'
    | 'collect_info';
  triggerSignals: string[];
  requiredBeforeAction: string[];
  forbiddenBeforeAction: string[];
  confirmationRequired: boolean;
  humanFacingInstruction: string;
}

export interface QubaKnowledgeProfile {
  prices?: string;
  rules?: string;
  verifiedArchive?: string;
  doctorDirectoryAvailable?: boolean;
  serviceCatalogAvailable?: boolean;
}

export interface QubaSetupQuestion {
  id: string;
  label: string;
  question: string;
  required: boolean;
  mapsTo: string;
}

export interface QubaRuntimeProfile {
  model: string;
  responseStyle: string;
  responseDelaySeconds: number;
  maxResponseTokens: number;
  timezone: string;
  workingHours?: {
    enabled: boolean;
    start?: string;
    end?: string;
    days?: string[];
  };
}

export interface QubaBrainDiagnostics {
  warnings: string[];
  missingSetup: string[];
  capabilities: string[];
}

export interface QubaBrainProfile {
  version: QubaBrainVersion;
  source: QubaBrainSource;
  tenantId: string;
  channel: string;
  industry: QubaIndustry;
  identity: QubaIdentityProfile;
  tone: QubaToneProfile;
  goals: QubaGoal[];
  serviceCatalog: QubaServiceCatalogItem[];
  policies: QubaPolicyRule[];
  actions: QubaActionPolicy[];
  knowledge: QubaKnowledgeProfile;
  setupQuestions: QubaSetupQuestion[];
  runtime: QubaRuntimeProfile;
  diagnostics: QubaBrainDiagnostics;
}
