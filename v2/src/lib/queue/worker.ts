import { logger } from "@/lib/core/logger";
import { withTenantDB } from "@/lib/core/tenant-db";
import { ConversationService } from "@/lib/services/conversation.service";
import { MessageService } from "@/lib/services/message.service";
import { WorkflowService, ConversationPhase } from "@/lib/services/workflow.service";
import { AIOrchestrator, ChatMessage } from "@/lib/services/ai/orchestrator";
import { ResponsePolicy } from "@/lib/services/ai/response-policy";
import { PromptBuilder } from "@/lib/services/ai/prompt-builder";
import { TenantResolverService } from "@/lib/services/meta/tenant-resolver.service";

/**
 * Enterprise Queue Worker Engine
 * Abstracted worker logic to keep API routes clean and testable.
 */
export class QueueWorkerEngine {
  private log = logger.withContext({ module: 'QueueWorkerEngine' });
  private aiOrchestrator = new AIOrchestrator();
  private responsePolicy = new ResponsePolicy();
  private workflowService = new WorkflowService();

  /**
   * Processes incoming events from QStash or generic message queues.
   */
  public async processEvent(
    topic: string, 
    tenantId: string, 
    payload: any, 
    metadata: { messageId: string, isRetry: boolean, retriedCount: number }
  ) {
    this.log.info(`[WORKER] Initiating execution for topic: ${topic}`, metadata);

    switch (topic) {
      case "whatsapp.message.received":
        await this.handleWhatsAppMessage(tenantId, payload, metadata);
        break;
      
      case "meta.webhook.fallback":
        this.log.info("Handling meta.webhook.fallback", { tenantId, payload });
        break;

      default:
        this.log.warn(`[WORKER] Unknown topic received, skipping execution. Topic: ${topic}`);
    }
  }

  /**
   * Domain-specific handler for WhatsApp Messages
   */
  private async handleWhatsAppMessage(tenantId: string, payload: any, metadata: any) {
    const traceId = metadata.messageId;
    this.log.info(`[QUEUE_RECEIVED] Processing WhatsApp message`, { tenantId, traceId });

    // 1. Resolve Tenant Config
    const resolver = new TenantResolverService();
    const tenantConfig = await resolver.resolve(payload);
    
    if (!tenantConfig) {
      this.log.error(`[TENANT_RESOLUTION_FAILED] Could not resolve tenant config`, undefined, { tenantId, traceId });
      throw new Error(`Tenant resolution failed for ${tenantId}`);
    }
    
    this.log.info(`[TENANT_RESOLVED] Config loaded`, { tenantSlug: tenantConfig.tenantSlug, traceId });

    // Extract Message Data
    const value = payload.entry?.[0]?.changes?.[0]?.value;
    const messages = value?.messages;
    if (!messages || messages.length === 0) {
      this.log.info(`[SKIP] No messages found in payload`, { traceId });
      return;
    }

    const incomingMsg = messages[0];
    const phoneNumber = incomingMsg.from;
    const content = incomingMsg.text?.body;
    const providerMessageId = incomingMsg.id;

    if (!content) {
      this.log.info(`[SKIP] Message has no text content`, { traceId });
      return;
    }

    const db = withTenantDB(tenantId);
    const msgService = new MessageService(db);
    const convService = new ConversationService(db);

    // 2. Lock Conversation & Save Incoming Message (Idempotency)
    await convService.acquireLock(phoneNumber);
    
    const { isDuplicate } = await msgService.saveMessageIdempotent({
      phoneNumber,
      direction: 'in',
      content,
      channel: 'whatsapp',
      providerMessageId
    });

    if (isDuplicate) {
      this.log.warn(`[DUPLICATE_DROPPED] Message already processed`, { providerMessageId, traceId });
      return;
    }

    this.log.info(`[CONVERSATION_READY] Incoming message saved`, { traceId });

    // 3. Conversation Load / State Check
    const status = await convService.getStatus(phoneNumber);
    if (status === 'human') {
      this.log.info(`[SKIP] Conversation is handled by human`, { phoneNumber, traceId });
      return;
    }

    // 4. State & FSM Transition
    const state = await convService.getState(phoneNumber);
    const currentPhase = state.phase as ConversationPhase;
    
    // Basit FSM geçişi (Şimdilik intent analizi olmadan mevcut fazda kalıyoruz, 
    // gerçek sistemde classification servisinden gelen intent'e göre targetPhase hesaplanır)
    const targetPhase = currentPhase; 
    
    if (this.workflowService.canTransition(currentPhase, targetPhase)) {
      if (currentPhase !== targetPhase) {
         await convService.updateState(phoneNumber, targetPhase);
         this.log.info(`[FSM_TRANSITION] Phase changed: ${currentPhase} -> ${targetPhase}`, { traceId });
      } else {
         this.log.info(`[CLASSIFICATION_DONE] Phase remains: ${currentPhase}`, { traceId });
      }
    }

    // 5. Build System Prompt & History
    const tenantPrompt = tenantConfig.raw?.prompt || tenantConfig.raw?.system_prompt || null;
    const { defaultPrompts } = await import('../domain/conversation/prompts');
    const systemPromptText = PromptBuilder.buildSystemPrompt(tenantPrompt, targetPhase, false, defaultPrompts.whatsapp);
    
    const history = await convService.getHistory(phoneNumber, 10);
    const aiMessages: ChatMessage[] = [
      { role: 'system' as const, content: String(systemPromptText) },
      ...history,
      { role: 'user' as const, content: String(content) } // Add current message explicitly if not in history
    ];

    this.log.info(`[PROMPT_BUILT] Prepared LLM payload`, { historyLength: history.length, traceId });

    // 6. AI Orchestrator Call (with Timeout Safety)
    const llmProvider = tenantConfig.raw?.llm_provider || 'gemini';
    const llmModel = tenantConfig.raw?.llm_model || 'gemini-2.5-flash';
    // Fallback to global env keys if tenant doesn't have custom keys configured
    const apiKey = tenantConfig.raw?.gemini_api_key || process.env.GEMINI_API_KEY || '';

    const aiConfig = {
      provider: llmProvider as 'gemini' | 'openai',
      modelId: llmModel,
      apiKey: apiKey,
      temperature: 0.7,
      maxTokens: 500
    };

    this.log.info(`[LLM_STARTED] Requesting AI response`, { provider: aiConfig.provider, traceId });
    
    const timeoutMs = 25000; // 25s timeout
    const aiPromise = this.aiOrchestrator.generateResponse(aiMessages, aiConfig);
    const timeoutPromise = new Promise<never>((_, reject) => 
      setTimeout(() => reject(new Error("AI_TIMEOUT")), timeoutMs)
    );

    let aiResponse;
    try {
      aiResponse = await Promise.race([aiPromise, timeoutPromise]);
      this.log.info(`[LLM_RESPONSE_OK] AI execution completed`, { latencyMs: aiResponse.latencyMs, traceId });
    } catch (e: any) {
      if (e.message === "AI_TIMEOUT") {
        this.log.error(`[LLM_TIMEOUT] Execution exceeded 25s limit`, e, { traceId });
        throw e; // Yönlendir ve DLQ/Retry tetikle
      }
      this.log.error(`[LLM_FAILED] Orchestrator exception`, e, { traceId });
      throw e;
    }

    // 7. Response Policy Check
    const validation = this.responsePolicy.validate(aiResponse.text);
    let finalResponseText = aiResponse.text;

    if (!validation.valid) {
      this.log.warn(`[POLICY_FAILED] ${validation.reason}`, { traceId });
      finalResponseText = validation.fallbackMessage || "Üzgünüm, şu an size yanıt veremiyorum.";
      // TODO: Escalate status
    }

    // 8. WhatsApp Send
    const accessToken = tenantConfig.accessToken || process.env.WHATSAPP_TOKEN || process.env.META_ACCESS_TOKEN || '';
    const phoneId = tenantConfig.whatsappPhoneNumberId || process.env.PHONE_NUMBER_ID || '';

    if (!phoneId || !accessToken) {
       this.log.error(`[WHATSAPP_FAILED] Missing Meta credentials for tenant`, undefined, { tenantId, traceId });
       throw new Error("Missing Meta credentials");
    }

    try {
      await msgService.sendWhatsAppMessage(
        phoneId,
        accessToken,
        phoneNumber,
        finalResponseText
      );
      this.log.info(`[WHATSAPP_SENT] Message delivered to Meta`, { traceId });
    } catch (e: any) {
       this.log.error(`[WHATSAPP_FAILED] Meta API rejection`, e, { traceId });
       throw e; // Retry tetikle
    }

    // 9. Save Outgoing Message
    await msgService.saveMessageIdempotent({
      phoneNumber,
      direction: 'out',
      content: finalResponseText,
      channel: 'whatsapp',
      modelUsed: aiResponse.modelUsed
    });

    this.log.info(`[WORKER_COMPLETED] End-to-end pipeline finished successfully`, { traceId });
  }

  /**
   * Manual DLQ Logging mechanism for when Upstash auto-retries are exhausted.
   * Ensures no message is ever silently dropped.
   */
  public async moveToDLQ(topic: string, tenantId: string, payload: any, error: any) {
    const errObj = error instanceof Error ? error : new Error(String(error));
    this.log.error(`[DLQ] Moving failed event to Dead Letter Queue`, errObj, {
      topic,
      tenantId,
      payload
    });
    // TODO: In Phase 2, persist this to a `dead_letter_jobs` table in Postgres for Observability Dashboard
  }
}

export const queueWorkerEngine = new QueueWorkerEngine();
