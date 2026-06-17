import { TenantBrain } from '../../brain/tenant-brain';
import { ChatMessage, AIOrchestrator } from './orchestrator';
import { PromptBuilder } from './prompt-builder';
import { ContextAwareSafeFallbackResolver } from './context-aware-safe-fallback';
import { MultilingualQualityGate } from './multilingual-quality-gate';
import { TurkishMorphologyGuard } from './turkish-morphology-guard';
import { FinalOutboundGuard } from './final-outbound-guard';
import { ResponseFormattingPolicy } from './response-formatting-policy';
import { ConversationTurnAggregator } from './conversation-turn-aggregator';
import { ConversationTopicSwitchResolver } from './conversation-topic-switch-resolver';
import { DoctorDirectoryResolver } from './doctor-directory-resolver';
import { IdentityEngine } from './engines/identity';

export interface OrchestratorParams {
  tenantId: string;
  phoneNumber: string;
  inboundText: string;
  mediaType?: string | null;
  mediaMetadata?: any;
  brain: TenantBrain;
  channel: 'whatsapp' | 'instagram' | 'messenger' | string;
  channelId?: string;
  conversationId?: string;
  customerId?: string;
  sandbox?: boolean;
  history?: ChatMessage[]; // Optional: passed in sandbox/test mode
}

export interface OrchestratorResult {
  text: string;
  modelUsed: string;
  promptVersion?: string | number;
  latencyMs: number;
  bypassed: boolean;
  isRetry: boolean;
  qualityGateFailed: boolean;
  qualityGateReason?: string;
  inputTokens?: number;
  outputTokens?: number;
}

export class AIResponseOrchestrator {
  public static async run(params: OrchestratorParams): Promise<OrchestratorResult> {
    const {
      tenantId,
      phoneNumber,
      inboundText,
      mediaType = null,
      brain,
      channelId,
      conversationId,
      customerId,
      sandbox = false,
      history: passedHistory
    } = params;

    const startTime = Date.now();

    // 1. Fetch CRM / Identity Context
    let unifiedContext: any = null;
    if (conversationId && customerId && !sandbox) {
      try {
        unifiedContext = await IdentityEngine.getContext(tenantId, customerId, conversationId);
      } catch (e) {
        console.error('[AIResponseOrchestrator] Error fetching identity context:', e);
      }
    }

    if (!unifiedContext) {
      unifiedContext = {};
    }

    // 2. Resolve Language Response Policy
    try {
      const { detectLanguage } = await import('@/lib/utils/language-detector');
      const languageContext = detectLanguage(inboundText, (passedHistory || []) as any);
      unifiedContext.languageContext = languageContext;
    } catch (langErr) {
      console.warn('[AIResponseOrchestrator] Language detection failed:', langErr);
    }

    // 3. Debounce & Turn Aggregation
    const history = await ConversationTurnAggregator.aggregate(
      tenantId,
      phoneNumber,
      passedHistory,
      10
    );
    unifiedContext.history = history;
    unifiedContext.currentMessageText = inboundText;
    unifiedContext.currentMessageMediaType = mediaType;

    // 4. Topic / Department Switch Detection
    const currentDept = unifiedContext.opportunity?.department || unifiedContext.conversation?.department || null;
    const topicSwitch = ConversationTopicSwitchResolver.resolve(inboundText, currentDept, unifiedContext.conversation?.metadata);
    if (topicSwitch.hasSwitched && topicSwitch.activeTopic) {
      if (!unifiedContext.conversation) unifiedContext.conversation = {};
      unifiedContext.conversation.department = topicSwitch.activeTopic;
      if (unifiedContext.opportunity) {
        unifiedContext.opportunity.department = topicSwitch.activeTopic;
      }
      
      // Inject previous topics as facts/context
      if (topicSwitch.previousTopics.length > 0) {
        if (!unifiedContext.patient_known_facts) unifiedContext.patient_known_facts = [];
        unifiedContext.patient_known_facts.push(`Geçmiş İlgilenilen Branşlar: ${topicSwitch.previousTopics.join(', ')}.`);
      }
    }

    // 5. Approved Learning hints injection
    try {
      const { TenantLearningRuntimeResolver } = await import('@/lib/services/ai/tenant-learning-runtime-resolver');
      if (channelId) {
        unifiedContext.approvedLearningHints = await TenantLearningRuntimeResolver.resolveHints(brain, channelId);
      } else {
        unifiedContext.approvedLearningHints = [];
      }
    } catch {
      unifiedContext.approvedLearningHints = [];
    }

    // 6. Build Prompt
    const phase = unifiedContext.opportunity?.stage || 'lead';
    const systemPromptText = PromptBuilder.buildSystemPrompt(brain, phase, false, unifiedContext);

    // 7. Check for LLM Bypass/Challenge cases
    const cleanInbound = inboundText.toLowerCase().trim();
    const isBotAccusation = ['bot musun', 'sen bot musun', 'are you a bot', 'botsun', 'robot musun', 'yapay zeka mısın', 'yapay zeka misin', 'insan mısın', 'insan misin'].some(kw => cleanInbound.includes(kw));
    const isAiAccusation = ['yapay zeka', 'yapayzeka', 'gpt', 'gemini', 'openai', 'claude', 'dil modeli', 'hangi model'].some(kw => cleanInbound.includes(kw));
    const isPromptChallenge = ['prompt', 'promt', 'sistem prompt', 'system prompt', 'talimatların', 'sistem talimati', 'kuralın ne', 'direktifin ne', 'uydurma'].some(kw => cleanInbound.includes(kw));
    const isAngryPromptChallenge = isPromptChallenge && ['şikayet', 'sikayet', 'rezalet', 'berbat', 'kötü', 'sinir', 'bıktım', 'yeter', 'dalga'].some(kw => cleanInbound.includes(kw));

    // Resolve doctor directory matching
    const doctorsList = DoctorDirectoryResolver.getDoctors(brain, topicSwitch.activeTopic || undefined);
    const doctorNames = doctorsList.map(d => d.name);
    const hasDoctorDirectory = doctorsList.length > 0;
    
    // Doctor lookup check
    const isDoctorLookup = ['doktor', 'hekim', 'uzman', 'cerrah', 'hoca'].some(kw => cleanInbound.includes(kw));
    const shouldBypassDoctorLookup = isDoctorLookup && !hasDoctorDirectory;

    const isLlmBypassChallenge = isPromptChallenge || isBotAccusation || isAiAccusation || isAngryPromptChallenge || shouldBypassDoctorLookup;

    let text = '';
    let bypassed = false;
    let modelUsed = 'gemini-2.5-flash';
    let inputTokens = 0;
    let outputTokens = 0;

    if (isLlmBypassChallenge) {
      const fallbackResult = ContextAwareSafeFallbackResolver.resolve({
        inboundText,
        brain,
        identityConfig: brain.prompts.metadata?.identity || brain.context.config?.identity || {},
        unifiedContext,
        channelId,
        systemPromptText
      });
      text = fallbackResult.text;
      bypassed = true;
      modelUsed = 'bypass';
    } else {
      // Run LLM Response generation
      const formattedMessages: ChatMessage[] = [
        { role: 'system' as const, content: systemPromptText },
        ...history,
        { role: 'user' as const, content: inboundText }
      ];

      const llmModel = brain.context.settings.aiModel || 'gemini-2.5-flash';
      const apiKey = brain.context.config?.raw?.gemini_api_key || process.env.GEMINI_API_KEY || '';

      const aiConfig = {
        provider: 'gemini' as const,
        modelId: llmModel,
        apiKey,
        temperature: 0.7,
        maxTokens: brain.context.settings.maxResponseTokens || 1000
      };

      const orchestrator = new AIOrchestrator();
      
      const response = await orchestrator.generateResponse(
        formattedMessages,
        aiConfig,
        tenantId,
        conversationId || 'sandbox_test_conversation',
        { sandbox }
      );
      
      text = response.text || '';
      modelUsed = response.modelUsed || llmModel;
      inputTokens = response.inputTokens || 0;
      outputTokens = response.outputTokens || 0;
    }

    // 8. Quality Gate & Retry Loop
    const assistantHistory = history.filter((m: any) => m.role === 'assistant');
    const isFirstAssistantTurn = assistantHistory.length === 0;

    let ctaOfferedRecently = false;
    if (Array.isArray(history)) {
      const last3Assistant = assistantHistory.slice(-3);
      ctaOfferedRecently = last3Assistant.some((m: any) => {
        const textLower = (m.content || '').toLowerCase();
        return ['randevu', 'görüşme', 'gorusme', 'arayalım', 'arayalim', 'arayabiliriz', 'arama', 'telefon'].some(kw => textLower.includes(kw));
      });
    }

    const qgOptions = {
      ctaOfferedRecently,
      angryPatientMode: isAngryPromptChallenge,
      personaName: brain.prompts.metadata?.identity?.personaName || brain.context.config?.identity?.personaName,
      organizationName: brain.prompts.metadata?.identity?.organizationName || brain.context.config?.identity?.organizationName,
      organizationShortName: brain.prompts.metadata?.identity?.organizationShortName || brain.context.config?.identity?.organizationShortName,
      identityAlreadyIntroduced: !isFirstAssistantTurn,
      asksIdentity: isBotAccusation,
      asksName: isBotAccusation,
      patientClaimsBot: isBotAccusation || isAiAccusation,
      patientProvidedAvailability: false
    };

    let replyLanguage = 'tr';
    if (unifiedContext.languageContext) {
      replyLanguage = unifiedContext.languageContext.reply_language || 'tr';
    }

    // Run Turkish Quality Gate check on LLM response
    let qualityGateValid = true;
    let qualityGateReason = '';
    
    if (!bypassed) {
      const qualityGate = MultilingualQualityGate.validate({
        responseText: text,
        replyLanguage: replyLanguage === 'tr' ? 'Türkçe' : 'İngilizce',
        qualityGateLocale: replyLanguage,
        qgOptions
      });
      
      if (qualityGate.valid) {
        text = qualityGate.morphologyCorrectedText || text;
      } else {
        qualityGateValid = false;
        qualityGateReason = qualityGate.reason || 'quality_gate_failed';
      }
    }

    // 9. Morphology Guard Checks with proper noun protections
    const morphology = TurkishMorphologyGuard.check(text, true, doctorNames);
    if (morphology.hasMorphologyError && morphology.correctedText) {
      text = morphology.correctedText;
    }

    // 10. Outbound Guard Checks
    text = FinalOutboundGuard.process(text, {
      tenantId,
      channelId,
      conversationId: conversationId || 'unknown',
      inboundText,
      unifiedContext,
      industry: brain.context.config?.industry || (brain.prompts.metadata as any)?.industry || '',
      systemPromptText,
      promptVersion: brain.prompts.metadata?.version || undefined
    });

    // 11. WhatsApp formatting policy applied
    text = ResponseFormattingPolicy.format(text);

    return {
      text,
      modelUsed,
      promptVersion: brain.prompts.metadata?.version,
      latencyMs: Date.now() - startTime,
      bypassed,
      isRetry: false,
      qualityGateFailed: !qualityGateValid,
      qualityGateReason: qualityGateReason || undefined,
      inputTokens,
      outputTokens
    };
  }
}
