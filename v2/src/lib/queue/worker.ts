import { logger } from "@/lib/core/logger";
import { withTenantDB } from "@/lib/core/tenant-db";
import { ConversationService } from "@/lib/services/conversation.service";
import { MessageService } from "@/lib/services/message.service";
import { WorkflowService, ConversationPhase } from "@/lib/services/workflow.service";
import { AIOrchestrator, ChatMessage } from "@/lib/services/ai/orchestrator";
import { ResponsePolicy } from "@/lib/services/ai/response-policy";
import { PromptBuilder } from "@/lib/services/ai/prompt-builder";
import { TenantResolverService } from "@/lib/services/meta/tenant-resolver.service";
import { assertTenant } from "@/lib/security/assertions";
import { AIEventEmitter } from "@/lib/services/ai/core/event-emitter";
import { FeatureFlagService } from "@/lib/services/feature-flag.service";
import { CredentialsService } from "@/lib/services/credentials.service";

// --- Worker Payload Types ---

/** Meta webhook payload envelope (WhatsApp/Messenger/Instagram) */
export interface MetaWebhookPayload {
  object?: string;
  entry?: Array<{
    id?: string;
    changes?: Array<{
      value?: {
        messaging_product?: string;
        metadata?: { display_phone_number?: string; phone_number_id?: string };
        contacts?: Array<{ profile?: { name?: string }; wa_id?: string }>;
        messages?: Array<{
          from?: string;
          id?: string;
          timestamp?: string;
          type?: string;
          text?: { body?: string };
          image?: { id?: string; mime_type?: string; caption?: string };
          document?: { id?: string; filename?: string; mime_type?: string };
          audio?: { id?: string; mime_type?: string };
          video?: { id?: string; mime_type?: string; caption?: string };
          location?: { latitude?: number; longitude?: number; name?: string };
          reaction?: { message_id?: string; emoji?: string };
          button?: { text?: string; payload?: string };
          interactive?: { type?: string; button_reply?: { id?: string; title?: string }; list_reply?: { id?: string; title?: string } };
        }>;
        statuses?: Array<{
          id?: string;
          status?: string;
          recipient_id?: string;
          timestamp?: string;
          errors?: Array<{ code?: number; title?: string }>;
        }>;
      };
      field?: string;
    }>;
    messaging?: Array<{
      sender?: { id?: string };
      recipient?: { id?: string };
      timestamp?: number;
      message?: { mid?: string; text?: string; attachments?: Array<{ type?: string; payload?: { url?: string } }> };
    }>;
  }>;
}

/** Metadata attached to each queue job */
export interface WorkerMetadata {
  messageId: string;
  isRetry: boolean;
  retriedCount: number;
  channelId?: string;
  groupId?: string;
}

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
    payload: MetaWebhookPayload, 
    metadata: WorkerMetadata
  ) {
    // SECURITY: Fail-closed tenant assertion at pipeline boundary
    assertTenant(tenantId, `worker:${topic}`);
    
    this.log.info(`[WORKER] Initiating execution for topic: ${topic}`, metadata);

    switch (topic) {
      case "whatsapp.message.received":
        await this.handleIncomingMessage(tenantId, payload, metadata, 'whatsapp');
        break;
        
      case "whatsapp.status.received":
        await this.handleWhatsAppStatus(tenantId, payload, metadata);
        break;
      
      case "messenger.message.received":
        await this.handleIncomingMessage(tenantId, payload, metadata, 'messenger');
        break;

      case "instagram.message.received":
        await this.handleIncomingMessage(tenantId, payload, metadata, 'instagram');
        break;

      case "meta.lead.received":
        this.log.info(`[LEAD_RECEIVED] Lead event processed`, { tenantId, traceId: metadata.messageId });
        break;

      case "meta.webhook.fallback":
        this.log.info("Handling meta.webhook.fallback", { tenantId, payload });
        break;

      default:
        // FAIL-VISIBLE: Unknown topics are routed to DLQ, never silently dropped
        this.log.error(`[UNKNOWN_TOPIC] Unhandled topic routed to DLQ`, undefined, { topic, tenantId });
        await this.moveToDLQ(topic, tenantId, payload, new Error(`UNKNOWN_TOPIC: ${topic}`));
    }
  }

  /**
   * Domain-specific handler for WhatsApp Status (Delivery Receipts)
   */
  private async handleWhatsAppStatus(tenantId: string, payload: MetaWebhookPayload, metadata: WorkerMetadata) {
    const traceId = metadata.messageId;
    this.log.info(`[WORKER_PROCESSING] [WA STATUS] Processing WhatsApp status receipt`, { tenantId, traceId });

    const statusObj = payload.entry?.[0]?.changes?.[0]?.value?.statuses?.[0];
    if (!statusObj || !statusObj.id || !statusObj.status) {
      this.log.info(`[SKIP] No valid status object in payload`, { traceId });
      return;
    }

    const providerMessageId = statusObj.id;
    const deliveryStatus = statusObj.status; // 'sent', 'delivered', 'read'
    const phoneNumber = statusObj.recipient_id || '';

    const db = withTenantDB(tenantId);
    
    try {
      // Update message status and get the internal ID
      const msgResult = await db.executeSafe({
        text: `
          UPDATE messages 
          SET status = $1
          WHERE provider_message_id = $2 AND tenant_id = $3
          RETURNING id
        `,
        values: [deliveryStatus, providerMessageId, tenantId]
      }) as any[];
      const internalMessageId = msgResult[0]?.id;

      let conversationId: string | undefined;

      // Update conversation last_message_status to reflect real-time UI
      if (phoneNumber) {
        const convResult = await db.executeSafe({
          text: `
            UPDATE conversations 
            SET last_message_status = $1
            WHERE phone_number = $2 AND tenant_id = $3
            RETURNING id
          `,
          values: [deliveryStatus, phoneNumber, tenantId]
        }) as any[];
        conversationId = convResult[0]?.id;
      }
      
      this.log.info(`[DB_COMMITTED] [WA STATUS] Message ${providerMessageId} marked as ${deliveryStatus} in DB`, { traceId, internalMessageId });
      
      // Emit event for real-time socket/UI updates
      AIEventEmitter.emit({ 
        tenantId, 
        type: 'message_status_updated', 
        category: 'pipeline', 
        payload: { providerMessageId, status: deliveryStatus, phoneNumber } 
      });

      // [NEW] Realtime Event: Message Status Updated
      if (internalMessageId && conversationId) {
        try {
          const { RealtimePublisher } = await import('@/lib/realtime/publisher');
          const validStatus = ['sent', 'delivered', 'read', 'failed'].includes(deliveryStatus) 
            ? deliveryStatus as 'sent' | 'delivered' | 'read' | 'failed'
            : 'sent';
          await RealtimePublisher.publishMessageStatusUpdated(
            tenantId,
            String(internalMessageId),
            phoneNumber,
            validStatus,
            1, // entityVersion placeholder
            { traceId, spanId: providerMessageId }
          );
          this.log.info(`[REALTIME_PUBLISH] chat.message.status_updated emitted`, { traceId, messageId: internalMessageId });
        } catch (realtimeErr) {
          this.log.error(`[REALTIME_PUBLISH_FAILED]`, realtimeErr instanceof Error ? realtimeErr : new Error(String(realtimeErr)), { traceId });
        }
      }

      // [NEW] Update integration health telemetry
      let resolvedChannelId = metadata.channelId;
      if (!resolvedChannelId) {
        const phoneId = payload.entry?.[0]?.changes?.[0]?.value?.metadata?.phone_number_id;
        if (phoneId) {
          try {
            const chRow = await db.executeSafe({
              text: `SELECT id FROM channels WHERE identifier = $1 LIMIT 1`,
              values: [phoneId]
            }) as any[];
            resolvedChannelId = chRow[0]?.id;
          } catch (err) {}
        }
      }

      if (resolvedChannelId && resolvedChannelId !== 'legacy_unmapped') {
        try {
          await db.executeSafe({
            text: `
              UPDATE channel_integrations 
              SET last_sync_at = NOW(), health_status = 'healthy' 
              WHERE channel_id = $1
            `,
            values: [resolvedChannelId]
          });
          this.log.info(`[TELEMETRY_UPDATED] Channel ${resolvedChannelId} marked healthy and last_sync_at updated via status receipt`);
        } catch (telErr) {
          this.log.error(`[TELEMETRY_UPDATE_FAILED] Non-fatal integration telemetry update failure`, telErr instanceof Error ? telErr : new Error(String(telErr)), { traceId });
        }
      }
      
    } catch (e: any) {
      this.log.error(`[STATUS_UPDATE_FAILED] Failed to update delivery receipt`, e, { traceId });
    }
  }

  /**
   * Domain-specific handler for Incoming Messages across Meta Channels (WhatsApp, Messenger, Instagram)
   */
  private async handleIncomingMessage(tenantId: string, payload: MetaWebhookPayload, metadata: WorkerMetadata, channel: 'whatsapp' | 'messenger' | 'instagram') {
    const traceId = metadata.messageId;
    this.log.info(`[WORKER_PROCESSING] [${channel.toUpperCase()}] Processing incoming message`, { tenantId, traceId });

    // 1. Resolve Hybrid Isolated Tenant Brain
    const { BrainResolver } = await import('../brain/brain-resolver');
    const { TenantFirewall } = await import('../security/tenant-firewall');
    
    let brain;
    try {
      brain = await BrainResolver.resolveTenantBrain(payload, channel, traceId);
    } catch (e) {
      this.log.error(`[TENANT_RESOLUTION_FAILED] Could not resolve brain`, undefined, { tenantId, traceId });
      throw e;
    }

    // Security Assertion
    TenantFirewall.assertTenantIsolation(brain, { 
      resourceType: 'webhook', 
      resourceTenantId: tenantId 
    });
    
    this.log.info(`[TENANT_BRAIN_BOUND] Brain ${brain.id} locked to context`, { tenantSlug: brain.context.tenantId, traceId });

    // Phase 6: Emit brain resolution event
    AIEventEmitter.emit({ tenantId, type: 'brain_resolved', category: 'pipeline', payload: { brainId: brain.id, channel, brainSource: brain.context.brainSource || 'v1_settings' } });

    // Extract Message Data based on channel
    let phoneNumber: string;
    let content: string;
    let providerMessageId: string;
    let profileName: string | undefined;

    if (channel === 'whatsapp') {
      const value = payload.entry?.[0]?.changes?.[0]?.value;
      const messages = value?.messages;
      if (!messages || messages.length === 0) {
        this.log.info(`[SKIP] No messages found in payload`, { traceId });
        return;
      }
      const incomingMsg = messages[0];
      phoneNumber = incomingMsg.from || '';
      content = incomingMsg.text?.body || '';
      providerMessageId = incomingMsg.id || '';
      profileName = value?.contacts?.[0]?.profile?.name;
    } else {
      const incomingMsg = payload.entry?.[0]?.messaging?.[0];
      if (!incomingMsg || !incomingMsg.message) {
        this.log.info(`[SKIP] No messages found in payload`, { traceId });
        return;
      }
      phoneNumber = incomingMsg.sender?.id || '';
      content = incomingMsg.message.text || '';
      providerMessageId = incomingMsg.message.mid || '';
    }

    if (!content) {
      this.log.info(`[SKIP] Message has no text content`, { traceId });
      return;
    }

    const db = withTenantDB(tenantId);
    const msgService = new MessageService(db);
    const convService = new ConversationService(db);

    // 2. Resolve Unified Identity
    const { IdentityEngine } = await import('@/lib/services/ai/engines/identity');
    const customerId = await IdentityEngine.resolveIdentity({
      tenantId: tenantId,
      phoneNumber: phoneNumber,
      firstName: profileName
    });
    this.log.info(`[IDENTITY_RESOLVED] Master Customer ID mapped`, { customerId, traceId });

    // Phase 6: Emit identity resolution event
    AIEventEmitter.emit({ tenantId, customerId, type: 'identity_resolved', category: 'identity', payload: { phoneNumber, source: channel } });

    // 3. Save Incoming Message (Idempotency and locking handled atomically in CTE)
    const { isDuplicate, conversationId, messageId } = await msgService.saveMessageIdempotent({
      phoneNumber,
      direction: 'in',
      content,
      channel: channel,
      channelId: metadata.channelId,
      groupId: metadata.groupId,
      providerMessageId
    });

    if (isDuplicate) {
      this.log.warn(`[DUPLICATE_DROPPED] Message already processed`, { providerMessageId, traceId });
      AIEventEmitter.emit({ tenantId, customerId, type: 'duplicate_message_dropped', category: 'pipeline', severity: 'warning', payload: { providerMessageId } });
      return;
    }

    this.log.info(`[DB_COMMITTED] [INCOMING MESSAGE] Saved to DB. MsgId: ${messageId}`, { traceId, providerMessageId });

    // [NEW] Update integration health telemetry immediately upon successful event ingestion
    const telemetryChannelId = brain.context.config?.channelId && brain.context.config?.channelId !== 'legacy_unmapped'
      ? brain.context.config.channelId
      : metadata.channelId;
    if (telemetryChannelId && telemetryChannelId !== 'legacy_unmapped') {
      try {
        await db.executeSafe({
          text: `
            UPDATE channel_integrations 
            SET last_sync_at = NOW(), health_status = 'healthy' 
            WHERE channel_id = $1
              AND channel_id IN (
                SELECT c.id FROM channels c
                JOIN channel_groups cg ON c.group_id = cg.id
                WHERE cg.tenant_id = $2
              )
          `,
          values: [telemetryChannelId, tenantId]
        });
        this.log.info(`[TELEMETRY_UPDATED] Ingestion telemetry updated for channel ${telemetryChannelId}`);
      } catch (telErr) {
        this.log.error(`[TELEMETRY_UPDATE_FAILED] Inbound integration telemetry update failed`, telErr instanceof Error ? telErr : new Error(String(telErr)), { traceId });
      }
    }

    // [NEW] Realtime Event: Message Created (Incoming)
    if (messageId && conversationId) {
      try {
        const { RealtimePublisher } = await import('@/lib/realtime/publisher');
        await RealtimePublisher.publishMessageCreated(
          tenantId,
          {
            id: messageId,
            conversation_id: conversationId,
            phone_number: phoneNumber,
            content,
            direction: 'in',
            status: 'delivered', // Incoming messages don't have sent status, they are just there
            created_at: new Date().toISOString()
          },
          { traceId, spanId: providerMessageId }
        );
        this.log.info(`[REALTIME_PUBLISH] chat.message.created emitted for incoming`, { traceId, messageId });
      } catch (realtimeErr) {
        this.log.error(`[REALTIME_PUBLISH_FAILED]`, realtimeErr instanceof Error ? realtimeErr : new Error(String(realtimeErr)), { traceId });
      }
    }

    // Link Conversation to Customer Profile
    if (conversationId) {
       await IdentityEngine.linkConversation(tenantId, conversationId, customerId);
    }

    this.log.info(`[CONVERSATION_READY] Incoming message processed & identity linked`, { traceId });

    // 3. Conversation Load / State Check
    const status = await convService.getStatus(phoneNumber);
    if (status === 'human') {
      this.log.info(`[SKIP] Conversation is handled by human, triggering memory summarization asynchronously`, { phoneNumber, traceId });
      if (conversationId) {
        // Fire-and-forget memory summarization in human mode so it doesn't block the worker execution
        (async () => {
          try {
            const isMemoryEnabled = await FeatureFlagService.isEnabled(tenantId, 'memory_engine', true);
            if (isMemoryEnabled) {
              const { MemoryEngine } = await import('@/lib/services/ai/engines/memory');
              await MemoryEngine.summarizeConversation(tenantId, conversationId);
            }
          } catch (memErr) {
            this.log.error(`[WORKER_HUMAN_MEMORY_FAILED] Human mode memory summarization error`, memErr instanceof Error ? memErr : new Error(String(memErr)), { traceId });
          }
        })();
      }
      return;
    }

    // 3.5 WORKING HOURS GATE — Tenant settings'den okunan mesai kontrolü
    const wh = brain.context.settings.workingHours;
    if (wh && wh.enabled && wh.start && wh.end) {
      const now = new Date();
      const currentTime = `${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}`;
      const isInRange = wh.start <= wh.end 
        ? (currentTime >= wh.start && currentTime <= wh.end)
        : (currentTime >= wh.start || currentTime <= wh.end);
      if (!isInRange) {
        const offMsg = wh.offMessage || 'Mesai saatlerimiz dışındasınız. En kısa sürede dönüş yapılacaktır.';
        // V2 Credential Resolution — NO ENV FALLBACK
        const whCreds = await CredentialsService.resolveCredentials(tenantId, 'whatsapp');
        this.log.info(`[CREDENTIAL_SOURCE] Working hours off-message`, { tenantId, source: whCreds.source, traceId });
        const accessToken = whCreds.accessToken || '';
        const phoneId = whCreds.whatsappPhoneNumberId || '';
        if (phoneId && accessToken) {
          const outRes = await msgService.sendWhatsAppMessage(phoneId, accessToken, phoneNumber, offMsg);
          const offMsgResult = await msgService.saveMessageIdempotent({ 
            phoneNumber, 
            direction: 'out', 
            content: offMsg, 
            channel: 'whatsapp',
            channelId: metadata.channelId,
            groupId: metadata.groupId,
            providerMessageId: outRes.providerMessageId,
            status: 'sent'
          });

          if (offMsgResult.messageId) {
            try {
              const { RealtimePublisher } = await import('@/lib/realtime/publisher');
              await RealtimePublisher.publishMessageCreated(
                tenantId,
                {
                  id: offMsgResult.messageId,
                  conversation_id: offMsgResult.conversationId || conversationId,
                  phone_number: phoneNumber,
                  content: offMsg,
                  direction: 'out',
                  status: 'sent', 
                  created_at: new Date().toISOString()
                },
                { traceId, spanId: outRes.providerMessageId || traceId }
              );
            } catch (realtimeErr) {
              this.log.error(`[REALTIME_PUBLISH_FAILED]`, realtimeErr instanceof Error ? realtimeErr : new Error(String(realtimeErr)), { traceId });
            }
          }
        } else {
          this.log.error(`[CREDENTIAL_MISSING] Cannot send working hours message — no credentials`, undefined, { tenantId, traceId });
        }
        this.log.info(`[WORKING_HOURS] Outside hours, sent off-message`, { traceId });
        AIEventEmitter.emit({ tenantId, conversationId, customerId, type: 'working_hours_blocked', category: 'pipeline', payload: { currentTime } });
        return;
      }
    }

    // 3.6 MAX MESSAGES GATE — Auto handover after limit
    // Only counts BOT-generated messages (model_used IS NOT NULL) since bot_activated_at
    // This prevents human agent messages from counting and allows admin to re-enable bot
    const maxMsg = brain.context.settings.maxMessages;
    if (maxMsg > 0) {
      const botMsgCount = await db.executeSafe({
        text: `
          SELECT COUNT(*) as c FROM messages 
          WHERE phone_number = $1 AND tenant_id = $2 
            AND direction = 'out' 
            AND model_used IS NOT NULL
            AND created_at > COALESCE(
              (SELECT bot_activated_at FROM conversations WHERE phone_number = $1 AND tenant_id = $2),
              '1970-01-01'::timestamptz
            )
        `,
        values: [phoneNumber, tenantId]
      }) as any[];
      const count = parseInt(botMsgCount[0]?.c) || 0;
      if (count >= maxMsg) {
        await db.executeSafe({
          text: `UPDATE conversations SET status = 'human' WHERE phone_number = $1 AND tenant_id = $2`,
          values: [phoneNumber, tenantId]
        });
        this.log.info(`[MAX_MESSAGES] Bot limit reached (${count}/${maxMsg}), auto-handover to human`, { traceId });
        AIEventEmitter.emit({ tenantId, conversationId, customerId, type: 'max_messages_reached', category: 'escalation', payload: { count, maxMsg } });
        return;
      }
    }

    // 4. State & FSM Transition
    const state = await convService.getState(phoneNumber);
    const currentPhase = state.phase as ConversationPhase;
    const targetPhase = currentPhase;
    
    if (this.workflowService.canTransition(currentPhase, targetPhase)) {
      if (currentPhase !== targetPhase) {
         await convService.updateState(phoneNumber, targetPhase);
         this.log.info(`[FSM_TRANSITION] Phase changed: ${currentPhase} -> ${targetPhase}`, { traceId });
      }
    }

    // 5. Fetch Unified CRM Context
    let unifiedContext: any = null;
    try {
      if (customerId && conversationId) {
        unifiedContext = await IdentityEngine.getContext(tenantId, customerId, conversationId);
      }
    } catch (e) {
      this.log.error('[WORKER_CONTEXT_FETCH] Error fetching identity context', e instanceof Error ? e : new Error(String(e)), { traceId });
    }

    // 6. Build System Prompt & History strictly via TenantBrain
    let systemPromptText = PromptBuilder.buildSystemPrompt(brain, targetPhase, false, unifiedContext);
    
    // In future phases, history and AI Orchestrator will use brain.namespaces.memory()
    const history = await convService.getHistory(phoneNumber, 10);
    const aiMessages: ChatMessage[] = [
      { role: 'system' as const, content: String(systemPromptText) },
      ...history,
      { role: 'user' as const, content: String(content) } // Add current message explicitly if not in history
    ];

    this.log.info(`[PROMPT_BUILT] Prepared LLM payload`, { historyLength: history.length, traceId });

    // 6. AI Orchestrator Call (with Timeout Safety)
    const tenantConfig = brain.context.config;
    const llmModel = brain.context.settings.aiModel || 'gemini-2.5-flash';
    const apiKey = tenantConfig?.raw?.gemini_api_key || process.env.GEMINI_API_KEY || '';

    const aiConfig = {
      provider: 'gemini' as 'gemini' | 'openai',
      modelId: llmModel,
      apiKey: apiKey,
      temperature: 0.7,
      maxTokens: brain.context.settings.maxResponseTokens || 1000
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

      // Phase 6: Emit AI response event
      AIEventEmitter.emit({ tenantId, conversationId, customerId, type: 'ai_response_generated', category: 'pipeline', payload: { latencyMs: aiResponse.latencyMs, model: aiResponse.modelUsed } });
    } catch (e: any) {
      if (e.message === "AI_TIMEOUT") {
        this.log.error(`[LLM_TIMEOUT] Execution exceeded 25s limit`, e, { traceId });
        AIEventEmitter.emit({ tenantId, conversationId, customerId, type: 'ai_timeout', category: 'pipeline', severity: 'error', payload: { timeoutMs } });
        AIEventEmitter.logHealth(tenantId, 'timeout', { traceId });
        throw e;
      }
      this.log.error(`[LLM_FAILED] Orchestrator exception`, e, { traceId });
      throw e;
    }

    // 7. Response Policy Check (Egress DLP)
    const validation = this.responsePolicy.validate(aiResponse.text, brain);
    let finalResponseText = aiResponse.text;

    if (!validation.valid) {
      this.log.error(`[POLICY_FAILED] ${validation.reason}`, undefined, { traceId, tenantId: brain.context.tenantId });
      finalResponseText = validation.fallbackMessage || "Üzgünüm, şu an size yanıt veremiyorum.";
      
      // Phase 6: Emit policy block + escalation events (SYNC — compliance-critical, must not be lost)
      await AIEventEmitter.emitSync({ tenantId, conversationId, customerId, type: 'policy_blocked', category: 'policy', severity: 'error', payload: { reason: validation.reason } });
      await AIEventEmitter.emitSync({ tenantId, conversationId, customerId, type: 'human_escalation', category: 'escalation', severity: 'warning', payload: { trigger: 'policy_violation', reason: validation.reason } });
      AIEventEmitter.logHealth(tenantId, 'policy_blocked', { reason: validation.reason, traceId });

      // Save a system alert message to alert the agent
      const sysMsgRes = await db.executeSafe({
        text: `
          INSERT INTO messages (tenant_id, phone_number, direction, content, channel, provider_message_id)
          VALUES ($1, $2, 'system', $3, $4, 'system_alert')
          RETURNING id
        `,
        values: [tenantId, phoneNumber, 'Güvenlik Politikası Devrede: ' + validation.reason, channel]
      }) as any[];
      
      const sysMsgId = sysMsgRes[0]?.id;
      if (sysMsgId && conversationId) {
        try {
          const { RealtimePublisher } = await import('@/lib/realtime/publisher');
          await RealtimePublisher.publishMessageCreated(
            tenantId,
            {
              id: sysMsgId,
              conversation_id: conversationId,
              phone_number: phoneNumber,
              content: 'Güvenlik Politikası Devrede: ' + validation.reason,
              direction: 'system', // Handled as bot/system in translator
              status: 'delivered', 
              created_at: new Date().toISOString()
            },
            { traceId, spanId: 'system_alert' }
          );
        } catch (realtimeErr) {
          this.log.error(`[REALTIME_PUBLISH_FAILED]`, realtimeErr instanceof Error ? realtimeErr : new Error(String(realtimeErr)), { traceId });
        }
      }

      // Escalate to human automatically
      await db.executeSafe({
        text: `UPDATE conversations SET status = 'human' WHERE phone_number = $1 AND tenant_id = $2`,
        values: [phoneNumber, tenantId]
      });
    }

    // 8. Meta Channel Send — V2 Credential Isolation (NO ENV FALLBACK)
    const outboundCreds = await CredentialsService.resolveCredentials(tenantId, channel);
    this.log.info(`[CREDENTIAL_SOURCE] Outbound send`, {
      tenantId, channel, source: outboundCreds.source, 
      hasToken: !!outboundCreds.accessToken, 
      hasPhoneId: !!outboundCreds.whatsappPhoneNumberId,
      traceId
    });

    const accessToken = outboundCreds.accessToken || '';
    const phoneId = outboundCreds.whatsappPhoneNumberId || '';

    if (!accessToken || (channel === 'whatsapp' && !phoneId)) {
       this.log.error(`[CREDENTIAL_MISSING] Cannot send — no credentials resolved for tenant`, undefined, {
         tenantId, traceId, channel, source: outboundCreds.source,
         hasToken: !!accessToken, hasPhoneId: !!phoneId
       });
       throw new Error(`CREDENTIAL_MISSING: No ${channel} credentials for tenant ${tenantId}`);
    }

    let outProviderMessageId: string | null = null;
    let messageStatus = 'pending';
    try {
      if (channel === 'whatsapp') {
        const outRes = await msgService.sendWhatsAppMessage(
          phoneId,
          accessToken,
          phoneNumber,
          finalResponseText
        );
        outProviderMessageId = outRes.providerMessageId || null;
      } else {
        const outRes = await msgService.sendSocialMessage(
          accessToken,
          phoneNumber,
          finalResponseText,
          channel
        );
        outProviderMessageId = outRes.providerMessageId || null;
      }
      messageStatus = 'sent';
      this.log.info(`[SEND_OK] Message delivered to Meta via ${channel}`, { traceId, providerMessageId: outProviderMessageId, credentialSource: outboundCreds.source });
    } catch (e: any) {
       this.log.error(`[SEND_FAILED] Meta API rejection for ${channel}`, e, { traceId });
       throw e; // Retry tetikle
    }

    const outMsgResult = await msgService.saveMessageIdempotent({
      phoneNumber,
      direction: 'out',
      content: finalResponseText,
      channel: channel,
      channelId: metadata.channelId,
      groupId: metadata.groupId,
      modelUsed: aiResponse.modelUsed || llmModel,
      promptTokens: aiResponse.inputTokens || 0,
      completionTokens: aiResponse.outputTokens || 0,
      providerMessageId: outProviderMessageId,
      status: messageStatus
    });

    this.log.info(`[DB_COMMITTED] [OUTGOING MESSAGE] Saved to DB. MsgId: ${outMsgResult.messageId}`, { traceId, outProviderMessageId });

    // [NEW] Realtime Event: Message Created (Outgoing)
    if (outMsgResult.messageId) {
      try {
        const outConvId = outMsgResult.conversationId || conversationId;
        const { RealtimePublisher } = await import('@/lib/realtime/publisher');
        await RealtimePublisher.publishMessageCreated(
          tenantId,
          {
            id: outMsgResult.messageId,
            conversation_id: outConvId,
            phone_number: phoneNumber,
            content: finalResponseText,
            direction: 'out',
            model_used: aiResponse.modelUsed || llmModel,
            status: messageStatus, 
            created_at: new Date().toISOString()
          },
          { traceId, spanId: outProviderMessageId || traceId }
        );
        this.log.info(`[REALTIME_PUBLISH] chat.message.created emitted for outgoing`, { traceId, messageId: outMsgResult.messageId });
      } catch (realtimeErr) {
        this.log.error(`[REALTIME_PUBLISH_FAILED]`, realtimeErr instanceof Error ? realtimeErr : new Error(String(realtimeErr)), { traceId });
      }
    }

    // 10. CRM Intelligence Extraction (Async & Non-blocking — Feature Flag gated)
    const isCrmEnabled = await FeatureFlagService.isEnabled(tenantId, 'crm_extraction', true);
    if (isCrmEnabled) {
    try {
      this.log.info(`[WORKER_CRM] Initiating CRM extraction`, { traceId });
      const { crmExtractorService } = await import('../services/ai/crm-extractor');
      
      // Deterministik Ülke (Layer 1)
      let deterministicCountry = undefined;
      if (phoneNumber.startsWith("90")) deterministicCountry = "Türkiye";
      else if (phoneNumber.startsWith("49")) deterministicCountry = "Almanya";
      else if (phoneNumber.startsWith("44")) deterministicCountry = "İngiltere";
      else if (phoneNumber.startsWith("33")) deterministicCountry = "Fransa";
      else if (phoneNumber.startsWith("31")) deterministicCountry = "Hollanda";
      else if (phoneNumber.startsWith("32")) deterministicCountry = "Belçika";
      else if (phoneNumber.startsWith("998")) deterministicCountry = "Özbekistan";
      else if (phoneNumber.startsWith("994")) deterministicCountry = "Azerbaycan";
      else if (phoneNumber.startsWith("7")) deterministicCountry = "Rusya";
      else if (phoneNumber.startsWith("1")) deterministicCountry = "ABD";

      // AI Inference (Layer 2-4)
      const crmData = await crmExtractorService.extract(aiMessages, tenantConfig, traceId);
      
      // Update DB safely
      await convService.updateCrmIntelligence(phoneNumber, {
        country: deterministicCountry || crmData?.country,
        department: crmData?.department,
        pipelineStage: crmData?.pipeline_stage,
        tags: crmData?.tags
      });

      this.log.info(`[WORKER_CRM_OK] CRM successfully enriched`, { traceId });
      AIEventEmitter.emit({ tenantId, conversationId, customerId, type: 'crm_extraction_completed', category: 'crm', payload: { country: deterministicCountry || crmData?.country, department: crmData?.department } });
    } catch (crmErr) {
      this.log.error(`[WORKER_CRM_FAILED] Non-fatal CRM extraction error`, crmErr instanceof Error ? crmErr : new Error(String(crmErr)), { traceId });
      AIEventEmitter.emit({ tenantId, conversationId, customerId, type: 'crm_extraction_failed', category: 'crm', severity: 'warning' });
      AIEventEmitter.logHealth(tenantId, 'crm_failure', { traceId });
    }
    } else {
      this.log.info(`[WORKER_CRM_SKIPPED] CRM extraction disabled via feature flag`, { traceId });
    }

    // 11. Async Memory & Summarization Sync (Feature Flag gated - Awaited for Serverless durability)
    const isMemoryEnabled = await FeatureFlagService.isEnabled(tenantId, 'memory_engine', true);
    if (conversationId && isMemoryEnabled) {
      try {
        const { MemoryEngine } = await import('@/lib/services/ai/engines/memory');
        this.log.info(`[WORKER_MEMORY] Starting memory summarization`, { traceId, conversationId });
        await MemoryEngine.summarizeConversation(tenantId, conversationId);
        AIEventEmitter.emit({ tenantId, conversationId, customerId, type: 'memory_updated', category: 'memory', payload: { conversationId } });
        this.log.info(`[WORKER_MEMORY_OK] Memory summarization completed successfully`, { traceId, conversationId });
      } catch (err) {
        this.log.error(`[WORKER_MEMORY_FAILED] Non-fatal summary error`, err instanceof Error ? err : new Error(String(err)), { traceId });
        AIEventEmitter.emit({ tenantId, conversationId, customerId, type: 'memory_failed', category: 'memory', severity: 'warning', payload: { error: err instanceof Error ? err.message : String(err) } });
        AIEventEmitter.logHealth(tenantId, 'memory_failure', { traceId });
      }
    }

    // Telemetry updated immediately upon ingestion above

    this.log.info(`[WORKER_COMPLETED] End-to-end pipeline finished successfully`, { traceId });
  }

  /**
   * Persists failed events to the dead_letter_jobs table.
   * Ensures no message is ever silently dropped.
   * Events can be replayed/resolved via admin dashboard.
   *
   * NOTE: dead_letter_jobs table must exist via setup migrations.
   */
  public async moveToDLQ(topic: string, tenantId: string, payload: MetaWebhookPayload | Record<string, unknown>, error: Error | unknown) {
    const errObj = error instanceof Error ? error : new Error(String(error));
    this.log.error(`[DLQ] Moving failed event to Dead Letter Queue`, errObj, {
      topic,
      tenantId,
    });

    try {
      const db = withTenantDB(tenantId, false);
      await db.executeSafe({
        text: `
          INSERT INTO dead_letter_jobs (tenant_id, topic, payload, error_message, error_stack, status)
          VALUES ($1, $2, $3::jsonb, $4, $5, 'unresolved')
        `,
        values: [
          tenantId, 
          topic, 
          JSON.stringify(payload), 
          errObj.message.substring(0, 1000), 
          errObj.stack?.substring(0, 2000) || null
        ]
      });
      this.log.info(`[DLQ] Event persisted to dead_letter_jobs`, { topic, tenantId });
    } catch (dlqError: any) {
      // DLQ yazamıyorsak bile asla sessizce yutmuyoruz — log ile kalıyor
      this.log.error(`[DLQ_CRITICAL] Failed to persist to DLQ table`, 
        dlqError instanceof Error ? dlqError : new Error(String(dlqError)), 
        { topic, tenantId }
      );
    }
  }
}

export const queueWorkerEngine = new QueueWorkerEngine();
