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

      case "social.status.received":
        await this.handleSocialStatus(tenantId, payload as any, metadata);
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
              WHERE channel_id = $1 AND tenant_id = $2
            `,
            values: [resolvedChannelId, tenantId]
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
   * Domain-specific handler for Messenger/Instagram Delivery & Read Receipts
   * 
   * Meta sends:
   * - delivery: { mids: ['mid.xxx'], watermark: 1527459824 }
   * - read: { watermark: 1527459824 }
   * 
   * Watermark = all messages sent before this timestamp are delivered/read
   */
  private async handleSocialStatus(tenantId: string, payload: {
    provider: string;
    deliveryStatus: string;
    watermark: number;
    mids: string[];
    senderId: string;
    recipientId: string;
    timestamp: number;
  }, metadata: WorkerMetadata) {
    const traceId = metadata.messageId;
    const { provider, deliveryStatus, watermark, mids, recipientId } = payload;
    
    this.log.info(`[WORKER_PROCESSING] [SOCIAL STATUS] ${provider} ${deliveryStatus}`, { 
      tenantId, traceId, watermark, midsCount: mids.length 
    });

    const db = withTenantDB(tenantId);

    try {
      let updatedCount = 0;

      if (mids && mids.length > 0) {
        // Strategy 1: Update specific message IDs (delivery receipts often include mids)
        for (const mid of mids) {
          const result = await db.executeSafe({
            text: `
              UPDATE messages 
              SET status = $1
              WHERE provider_message_id = $2 
                AND tenant_id = $3 
                AND direction = 'out'
                AND (status IS NULL OR status IN ('pending', 'sent', 'delivered'))
              RETURNING id, phone_number
            `,
            values: [deliveryStatus, mid, tenantId]
          }) as any[];
          
          if (result.length > 0) {
            updatedCount++;
            
            // Emit realtime status update for each message
            try {
              const { RealtimePublisher } = await import('@/lib/realtime/publisher');
              const validStatus = ['sent', 'delivered', 'read', 'failed'].includes(deliveryStatus) 
                ? deliveryStatus as 'sent' | 'delivered' | 'read' | 'failed'
                : 'sent';
              await RealtimePublisher.publishMessageStatusUpdated(
                tenantId,
                String(result[0].id),
                result[0].phone_number,
                validStatus,
                1,
                { traceId, spanId: mid }
              );
            } catch (rtErr) {
              // Non-fatal
            }
          }
        }
      } else if (watermark) {
        // Strategy 2: Watermark-based bulk update (read receipts)
        // Update all outbound messages sent before the watermark timestamp
        const watermarkDate = new Date(watermark * 1000).toISOString();
        
        const result = await db.executeSafe({
          text: `
            UPDATE messages 
            SET status = $1
            WHERE tenant_id = $2 
              AND direction = 'out'
              AND created_at <= $3
              AND (status IS NULL OR status IN ('pending', 'sent', 'delivered'))
              AND phone_number = $4
            RETURNING id, phone_number
          `,
          values: [deliveryStatus, tenantId, watermarkDate, recipientId]
        }) as any[];

        updatedCount = result.length;

        // Update conversation last_message_status
        if (recipientId) {
          await db.executeSafe({
            text: `
              UPDATE conversations 
              SET last_message_status = $1
              WHERE phone_number = $2 AND tenant_id = $3
            `,
            values: [deliveryStatus, recipientId, tenantId]
          });
        }

        // Emit bulk realtime update for the most recent message
        if (result.length > 0) {
          try {
            const { RealtimePublisher } = await import('@/lib/realtime/publisher');
            const validStatus = ['sent', 'delivered', 'read', 'failed'].includes(deliveryStatus) 
              ? deliveryStatus as 'sent' | 'delivered' | 'read' | 'failed'
              : 'sent';
            await RealtimePublisher.publishMessageStatusUpdated(
              tenantId,
              String(result[result.length - 1].id),
              result[result.length - 1].phone_number,
              validStatus,
              1,
              { traceId }
            );
          } catch (rtErr) {
            // Non-fatal
          }
        }
      }

      this.log.info(`[DB_COMMITTED] [SOCIAL STATUS] ${provider} ${deliveryStatus}: ${updatedCount} messages updated`, { traceId });

    } catch (e: any) {
      this.log.error(`[SOCIAL_STATUS_FAILED] Failed to process ${provider} delivery receipt`, e, { traceId });
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
    // Media extraction
    let mediaType: string | null = null;
    let mediaId: string | null = null;
    let mediaUrl: string | null = null;
    let mediaMetadata: Record<string, any> | null = null;

    if (channel === 'whatsapp') {
      const value = payload.entry?.[0]?.changes?.[0]?.value;
      const messages = value?.messages;
      if (!messages || messages.length === 0) {
        this.log.info(`[SKIP] No messages found in payload`, { traceId });
        return;
      }
      const incomingMsg = messages[0];
      phoneNumber = incomingMsg.from || '';
      providerMessageId = incomingMsg.id || '';
      profileName = value?.contacts?.[0]?.profile?.name;

      // ── MEDIA TYPE EXTRACTION ──
      const msgType = incomingMsg.type || 'text';

      switch (msgType) {
        case 'text':
          content = incomingMsg.text?.body || '';
          break;
        case 'image':
          mediaType = 'image';
          mediaId = incomingMsg.image?.id || null;
          mediaMetadata = {
            mime_type: incomingMsg.image?.mime_type,
            caption: incomingMsg.image?.caption,
          };
          content = incomingMsg.image?.caption || '';
          break;
        case 'document':
          mediaType = 'document';
          mediaId = incomingMsg.document?.id || null;
          mediaMetadata = {
            mime_type: incomingMsg.document?.mime_type,
            filename: incomingMsg.document?.filename,
          };
          content = '';
          break;
        case 'audio':
          mediaType = 'audio';
          mediaId = incomingMsg.audio?.id || null;
          mediaMetadata = {
            mime_type: incomingMsg.audio?.mime_type,
          };
          content = '';
          break;
        case 'video':
          mediaType = 'video';
          mediaId = incomingMsg.video?.id || null;
          mediaMetadata = {
            mime_type: incomingMsg.video?.mime_type,
            caption: incomingMsg.video?.caption,
          };
          content = incomingMsg.video?.caption || '';
          break;
        case 'location':
          mediaType = 'location';
          mediaMetadata = {
            latitude: incomingMsg.location?.latitude,
            longitude: incomingMsg.location?.longitude,
            name: incomingMsg.location?.name,
          };
          content = incomingMsg.location?.name || '';
          break;
        case 'sticker':
          mediaType = 'sticker';
          mediaId = incomingMsg.sticker?.id || null;
          mediaMetadata = { mime_type: 'image/webp' };
          content = '';
          break;
        case 'reaction':
          content = incomingMsg.reaction?.emoji || '👍';
          break;
        case 'button':
          content = incomingMsg.button?.text || incomingMsg.button?.payload || '';
          break;
        case 'interactive':
          content = incomingMsg.interactive?.button_reply?.title || incomingMsg.interactive?.list_reply?.title || '';
          break;
        default:
          content = '';
          break;
      }
    } else {
      // Messenger / Instagram
      const incomingMsg = payload.entry?.[0]?.messaging?.[0];
      if (!incomingMsg || !incomingMsg.message) {
        this.log.info(`[SKIP] No messages found in payload`, { traceId });
        return;
      }
      phoneNumber = incomingMsg.sender?.id || '';
      content = incomingMsg.message.text || '';
      providerMessageId = incomingMsg.message.mid || '';

      // Messenger/IG attachments
      const attachments = incomingMsg.message.attachments;
      if (attachments && attachments.length > 0) {
        const att = attachments[0];
        const attType = att.type || '';
        if (['image', 'video', 'audio', 'file'].includes(attType)) {
          mediaType = attType === 'file' ? 'document' : attType;
          mediaUrl = att.payload?.url || null; // Messenger/IG gives direct URL (no media_id resolve needed)
          mediaMetadata = { source_url: att.payload?.url };
        }
      }
    }

    // Generate fallback content for media messages (conversation list preview + AI context)
    if (mediaType && !content) {
      const { MediaStorageService } = await import('@/lib/services/media-storage.service');
      content = MediaStorageService.getMediaContentText(mediaType, mediaMetadata || undefined);
    }

    // Skip only if BOTH content AND media are empty
    if (!content && !mediaType) {
      this.log.info(`[SKIP] Message has no text content and no media`, { traceId });
      return;
    }

    const db = withTenantDB(tenantId);
    const msgService = new MessageService(db);
    const convService = new ConversationService(db);

    // ── DEBUG: Trace media extraction results ──
    if (mediaType) {
      this.log.info(`[MEDIA_EXTRACT] Media detected`, { 
        traceId, mediaType, mediaId: mediaId || 'NULL', 
        hasMediaUrl: !!mediaUrl, content: content?.substring(0, 50),
        rawImagePayload: channel === 'whatsapp' ? JSON.stringify(payload.entry?.[0]?.changes?.[0]?.value?.messages?.[0]?.image || payload.entry?.[0]?.changes?.[0]?.value?.messages?.[0]?.document || 'no-media-field').substring(0, 300) : 'non-whatsapp'
      });
    }

    // ── MEDIA DOWNLOAD & BLOB UPLOAD (tenant-isolated) ──
    if (mediaType && mediaId) {
      try {
        const mediaCreds = await CredentialsService.resolveCredentials(tenantId, channel === 'whatsapp' ? 'whatsapp' : channel as any);
        if (mediaCreds.accessToken) {
          const { MediaStorageService } = await import('@/lib/services/media-storage.service');
          const blobResult = await MediaStorageService.downloadAndStore(
            tenantId,
            mediaId,
            mediaCreds.accessToken,
            providerMessageId || `msg_${Date.now()}`,
            {
              mimeType: mediaMetadata?.mime_type,
              filename: mediaMetadata?.filename,
              mediaType,
            }
          );
          if (blobResult) {
            mediaUrl = blobResult.blobUrl;
            // Track storage usage for SaaS billing
            await MediaStorageService.trackUsage(db, tenantId, mediaType, blobResult.fileSize);
            this.log.info(`[MEDIA_OK] Media stored in blob`, { tenantId, mediaType, fileSize: blobResult.fileSize, traceId });
          }
        } else {
          this.log.warn(`[MEDIA_NO_CREDS] No access token for media download`, { tenantId, traceId });
        }
      } catch (mediaErr) {
        // Non-fatal: save message even if media download fails
        this.log.error(`[MEDIA_DOWNLOAD_FAILED] Non-fatal media error`, mediaErr instanceof Error ? mediaErr : new Error(String(mediaErr)), { tenantId, traceId });
      }
    }

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
      providerMessageId,
      mediaType,
      mediaUrl,
      mediaMetadata,
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
            status: 'delivered',
            created_at: new Date().toISOString(),
            media_type: mediaType || undefined,
            media_url: mediaUrl || undefined,
            media_metadata: mediaMetadata || undefined,
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

    // Profile Enrichment: Resolve Instagram IGSID / Messenger PSID to real name (fire-and-forget)
    if (conversationId && ['instagram', 'meta_instagram', 'messenger'].includes(channel)) {
      try {
        const { ProfileEnrichmentService } = await import('@/lib/services/profile-enrichment.service');
        const enrichCreds = await CredentialsService.resolveCredentials(tenantId, channel);
        if (enrichCreds.accessToken) {
          const enrichService = new ProfileEnrichmentService(db);
          // Non-blocking: don't await, fire and forget
          enrichService.enrichIfNeeded({
            tenantId,
            conversationId,
            phoneNumber,
            channel,
            accessToken: enrichCreds.accessToken,
            customerId
          }).catch(err => this.log.warn('[ENRICH_FAILED] Profile enrichment error (non-fatal)', { error: err.message }));
        }
      } catch (enrichErr) {
        // Completely non-fatal
        this.log.warn('[ENRICH_INIT_FAILED] Could not initialize enrichment (non-fatal)', { error: (enrichErr as Error).message });
      }
    }

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
    // IMPORTANT: skipBotReply flag allows CRM extraction to still run even when bot limit reached
    let skipBotReply = false;
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
        this.log.info(`[MAX_MESSAGES] Bot limit reached (${count}/${maxMsg}), auto-handover to human. CRM extraction will still run.`, { traceId });
        AIEventEmitter.emit({ tenantId, conversationId, customerId, type: 'max_messages_reached', category: 'escalation', payload: { count, maxMsg } });
        skipBotReply = true;
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

    // ── Bot Reply Pipeline (skipped when max messages reached) ──
    if (skipBotReply) {
      this.log.info(`[SKIP_BOT_REPLY] Max messages reached, skipping AI response generation. CRM extraction will still run.`, { traceId });
    } else {

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

    } // end skipBotReply else

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
      let crmData = await crmExtractorService.extract(aiMessages, tenantConfig, traceId);
      
      // Handle extraction error (extractor returns { _extractionError: {...} } on failure)
      let extractionError: any = null;
      if (crmData && (crmData as any)._extractionError) {
        extractionError = (crmData as any)._extractionError;
        crmData = null;
      }
      
      // ═══ P0-1: CRM_RAW_EXTRACTED — ai_events (reliable, nullable conversation_id) ═══
      await AIEventEmitter.emitSync({
        tenantId, conversationId, customerId,
        type: 'crm_raw_extracted',
        category: 'crm',
        payload: {
          traceId,
          phoneNumber,
          isNull: crmData === null,
          extractionFailed: !!extractionError,
          extractionErrorMessage: extractionError?.message || null,
          extractionErrorName: extractionError?.name || null,
          extractionIsTimeout: extractionError?.isTimeout || false,
          country: crmData?.country || null,
          department: crmData?.department || null,
          travelDate: crmData?.travel_date || null,
          requestedCallbackDatetime: crmData?.requested_callback_datetime || null,
          shouldCreateOpportunity: crmData?.should_create_opportunity ?? null,
          shouldUpdateExistingOpportunity: crmData?.should_update_existing_opportunity ?? null,
          intentType: crmData?.intent_type || null,
          priority: crmData?.opportunity_priority || null,
          patientName: crmData?.patient_name || null,
          pipelineStage: crmData?.pipeline_stage || null,
          reportStatus: crmData?.report_status || null,
          requiresHumanConfirmation: crmData?.requires_human_confirmation ?? null,
          rawUserMessage: String(content).substring(0, 200)
        }
      });

      // ═══ P1A-FIX3: Country priority — CRM > existing DB > phone prefix ═══
      // Medical tourism: patient with +90 phone may live in Germany
      // When LLM returns null country, we MUST preserve existing validated country
      // Phone-prefix is LAST RESORT only
      let beforeConv: any = null;
      try {
        const snap = await db.executeSafe({
          text: `SELECT country, department, lead_stage FROM conversations WHERE phone_number = $1 AND tenant_id = $2`,
          values: [phoneNumber, tenantId]
        }) as any[];
        beforeConv = snap[0] || null;
      } catch (_) { /* non-blocking */ }

      const existingConvCountry = beforeConv?.country || null;
      const resolvedCountryForConv = crmData?.country || existingConvCountry || deterministicCountry;

      // ═══ P0-1: CRM_RESOLVED_FOR_CONVERSATION ═══
      await AIEventEmitter.emitSync({
        tenantId, conversationId, customerId,
        type: 'crm_resolved_for_conversation',
        category: 'crm',
        payload: {
          traceId,
          deterministicCountry: deterministicCountry || null,
          crmCountry: crmData?.country || null,
          finalCountryForConversation: resolvedCountryForConv || null,
          crmDepartment: crmData?.department || null,
          previousConversationCountry: beforeConv?.country || null,
          previousConversationDepartment: beforeConv?.department || null,
          previousLeadStage: beforeConv?.lead_stage || null
        }
      });
      // ═══ P1A-FIX2: Multi-Layer Cancellation Detection ═══
      // Layer 1: LLM explicit boolean (new field — may not be set by older deployments)
      let explicitCancellation = crmData?.explicit_cancellation || false;
      let optOutRequested = crmData?.opt_out_requested || false;
      let cancellationReason = crmData?.cancellation_reason || null;
      let shouldStopFollowUp = crmData?.should_stop_follow_up || false;

      // Layer 2: LLM intent_type fallback — if LLM said intent is cancellation but missed the boolean
      if (!explicitCancellation && crmData?.intent_type === 'explicit_cancellation') {
        explicitCancellation = true;
        shouldStopFollowUp = true;
        cancellationReason = cancellationReason || `llm_intent_type: explicit_cancellation`;
        this.log.info(`[CANCELLATION_LAYER2] LLM intent_type fallback`, { traceId, phoneNumber });
      }

      // Layer 3: LLM pipeline_stage=lost + priority=cold heuristic
      if (!explicitCancellation && crmData?.pipeline_stage === 'lost' && crmData?.opportunity_priority === 'cold') {
        explicitCancellation = true;
        shouldStopFollowUp = true;
        cancellationReason = cancellationReason || `llm_stage_priority: lost+cold`;
        this.log.info(`[CANCELLATION_LAYER3] LLM lost+cold heuristic`, { traceId, phoneNumber });
      }

      // Layer 4: Deterministic intent safety net (runs even when crmData is null/failed)
      // Expanded from pure cancellation to full intent detection (P1A-FIX5)
      let dataDeletionRequest = false;
      let resetConversationRequested = false;
      let newIdentityDetected = false;
      let newTreatmentInterest = false;
      let detectedNewName: string | null = null;
      
      if (content) {
        try {
          const { detectCancellation } = await import('../services/ai/cancellation-detector');
          const detection = detectCancellation(content);
          
          // Cancellation override (existing behavior)
          if (detection.explicit_cancellation && !explicitCancellation) {
            explicitCancellation = true;
            optOutRequested = detection.opt_out_requested || optOutRequested;
            shouldStopFollowUp = true;
            cancellationReason = cancellationReason || `deterministic_match: ${detection.matched_phrases.join(', ')}`;
            this.log.info(`[CANCELLATION_LAYER4] Deterministic override`, {
              traceId, phoneNumber,
              matched_phrases: detection.matched_phrases,
              llm_missed: true,
              crmDataNull: !crmData
            });
          }
          
          // New intent signals (P1A-FIX5)
          dataDeletionRequest = detection.data_deletion_request;
          resetConversationRequested = detection.reset_conversation_requested;
          newIdentityDetected = detection.new_identity_detected;
          newTreatmentInterest = detection.new_treatment_interest;
          detectedNewName = detection.detected_name;
          
          if (dataDeletionRequest || resetConversationRequested || newIdentityDetected) {
            shouldStopFollowUp = dataDeletionRequest || shouldStopFollowUp;
            this.log.info(`[INTENT_LAYER4] New intent signals detected`, {
              traceId, phoneNumber,
              dataDeletionRequest, resetConversationRequested,
              newIdentityDetected, newTreatmentInterest,
              detectedNewName,
              matched_phrases: detection.matched_phrases
            });
          }
        } catch (_) { /* non-blocking */ }
      }

      // Override pipeline_stage to 'lost' if any cancellation layer triggered
      const effectivePipelineStage = explicitCancellation 
        ? 'lost' 
        : crmData?.pipeline_stage;

      if (explicitCancellation) {
        this.log.info(`[CANCELLATION_FINAL] Explicit cancellation confirmed`, {
          traceId, phoneNumber, optOutRequested, cancellationReason,
          effectivePipelineStage: 'lost',
          originalPipelineStage: crmData?.pipeline_stage || '(null)',
        });
      }
      
      await convService.updateCrmIntelligence(phoneNumber, {
        patientName: crmData?.patient_name,
        country: resolvedCountryForConv,
        department: crmData?.department,
        pipelineStage: effectivePipelineStage,
        tags: crmData?.tags,
        explicitCancellation,
        optOutRequested,
        cancellationReason: cancellationReason || undefined,
        shouldStopFollowUp,
      });

      // ═══ P0-4: CRM_CONVERSATION_UPDATE_RESULT — after-snapshot ═══
      let afterConv: any = null;
      try {
        const snap = await db.executeSafe({
          text: `SELECT country, department, lead_stage FROM conversations WHERE phone_number = $1 AND tenant_id = $2`,
          values: [phoneNumber, tenantId]
        }) as any[];
        afterConv = snap[0] || null;
      } catch (_) { /* non-blocking */ }

      await AIEventEmitter.emitSync({
        tenantId, conversationId, customerId,
        type: 'crm_conversation_update_result',
        category: 'crm',
        payload: {
          traceId,
          beforeCountry: beforeConv?.country || null,
          afterCountry: afterConv?.country || null,
          beforeDepartment: beforeConv?.department || null,
          afterDepartment: afterConv?.department || null,
          beforeLeadStage: beforeConv?.lead_stage || null,
          afterLeadStage: afterConv?.lead_stage || null,
          countryChanged: beforeConv?.country !== afterConv?.country,
          departmentChanged: beforeConv?.department !== afterConv?.department
        }
      });

      // ═══ P1A-FIX4: Cancellation Stage Guard ═══
      // Safety net: if explicitCancellation was detected but stage didn't change
      // (updateCrmIntelligence may have silently failed), force stage via direct call
      if (explicitCancellation && conversationId) {
        const currentStage = afterConv?.lead_stage || beforeConv?.lead_stage;
        const stageIsLost = currentStage === 'lost';
        
        if (!stageIsLost) {
          this.log.warn(`[CANCELLATION_STAGE_GUARD] Stage not lost after updateCrmIntelligence, forcing direct UnifiedStageService call`, {
            traceId, phoneNumber, currentStage, explicitCancellation, optOutRequested
          });
          
          try {
            const { UnifiedStageService } = await import('../services/unified-stage.service');
            const result = await UnifiedStageService.update({
              tenantId,
              source: 'ai',
              conversationId,
              phoneNumber,
              targetStage: 'lost',
              explicitCancellation: true,
              optOutRequested,
              reason: `explicit_customer_cancellation: ${cancellationReason || 'müşteri açıkça vazgeçti'}`,
            });
            
            await AIEventEmitter.emitSync({
              tenantId, conversationId, customerId,
              type: 'cancellation_stage_guard',
              category: 'stage',
              severity: result.blocked ? 'warning' : 'info',
              payload: {
                traceId, phoneNumber,
                guardTriggered: true,
                result: {
                  success: result.success,
                  blocked: result.blocked,
                  blockReason: result.blockReason,
                  previousOppStage: result.previousOppStage,
                  newOppStage: result.newOppStage,
                  mirrorLeadStage: result.mirrorLeadStage,
                },
                cancellationReason,
                optOutRequested,
              }
            });
            
            if (result.success && !result.blocked) {
              this.log.info(`[CANCELLATION_STAGE_GUARD_OK] Stage forced to lost`, {
                traceId, oppId: result.opportunityId, mirrorLeadStage: result.mirrorLeadStage
              });
            } else {
              this.log.warn(`[CANCELLATION_STAGE_GUARD_BLOCKED] Could not force stage`, {
                traceId, blocked: result.blocked, blockReason: result.blockReason
              });
            }
          } catch (guardErr) {
            this.log.error(`[CANCELLATION_STAGE_GUARD_ERROR] Non-fatal`, 
              guardErr instanceof Error ? guardErr : new Error(String(guardErr)), 
              { traceId, phoneNumber }
            );
          }
        } else {
          this.log.info(`[CANCELLATION_STAGE_GUARD_SKIP] Stage already lost`, { traceId, phoneNumber });
        }
      }

      this.log.info(`[WORKER_CRM_OK] CRM enriched`, { traceId, country: afterConv?.country, department: afterConv?.department });
      AIEventEmitter.emit({ tenantId, conversationId, customerId, type: 'crm_extraction_completed', category: 'crm', payload: { 
        patientName: crmData?.patient_name, country: resolvedCountryForConv, department: crmData?.department,
        travelDate: crmData?.travel_date, intentType: crmData?.intent_type, priority: crmData?.opportunity_priority,
        reportStatus: crmData?.report_status, requiresHumanConfirmation: crmData?.requires_human_confirmation,
        shouldCreateOpportunity: crmData?.should_create_opportunity, opportunityReason: crmData?.opportunity_reason
      }});

      // 10b. Opportunity Upsert / Enrichment (non-fatal, async-safe)
      if (crmData && conversationId) {
        try {
          const { OpportunityService } = await import('../services/opportunity.service');
          const oppService = new OpportunityService(db);

          // ═══ P0-5: Fetch opportunity before-snapshot ═══
          let beforeOpp: any = null;
          try {
            const oppSnap = await db.executeSafe({
              text: `SELECT id, country, department, travel_date, stage, priority FROM opportunities 
                     WHERE conversation_id = $1 AND tenant_id = $2 
                     AND stage NOT IN ('lost', 'not_qualified', 'arrived')
                     ORDER BY created_at DESC LIMIT 1`,
              values: [conversationId, tenantId]
            }) as any[];
            beforeOpp = oppSnap[0] || null;
          } catch (_) { /* non-blocking */ }

          // ═══ P1A-FIX3: Opp country priority — CRM > existingOpp > conv > phone prefix ═══
          const existingOppCountry = beforeOpp?.country || null;
          const resolvedCountryForOpp = crmData.country || existingOppCountry || existingConvCountry || deterministicCountry;

          // ═══ P1A-FIX5: Detect if this is a fundamentally different request ═══
          const isDifferentDepartment = !!(beforeOpp && crmData.department && 
            beforeOpp.department && crmData.department.toLowerCase() !== beforeOpp.department.toLowerCase());
          const isDifferentCountry = !!(beforeOpp && crmData.country && 
            beforeOpp.country && crmData.country.toLowerCase() !== beforeOpp.country.toLowerCase());
          const shouldCloseAndCreateNew = beforeOpp && (
            resetConversationRequested ||
            (newIdentityDetected && (isDifferentDepartment || isDifferentCountry)) ||
            (newTreatmentInterest && isDifferentDepartment) ||
            (dataDeletionRequest)
          );

          // ═══ P0-1: OPP_RESOLVED_FOR_UPDATE ═══
          await AIEventEmitter.emitSync({
            tenantId, conversationId, customerId,
            type: 'opp_resolved_for_update',
            category: 'crm',
            payload: {
              traceId,
              opportunityId: beforeOpp?.id || null,
              activeOpportunityExists: !!beforeOpp,
              crmCountry: crmData.country || null,
              deterministicCountry: deterministicCountry || null,
              existingOppCountry: existingOppCountry || null,
              finalCountryForOpportunity: resolvedCountryForOpp || null,
              crmDepartment: crmData.department || null,
              previousOpportunityCountry: beforeOpp?.country || null,
              previousOpportunityDepartment: beforeOpp?.department || null,
              shouldCreateOpportunity: crmData.should_create_opportunity,
              // P1A-FIX5 new fields
              shouldCloseAndCreateNew,
              isDifferentDepartment,
              isDifferentCountry,
              resetConversationRequested,
              newIdentityDetected,
              dataDeletionRequest,
            }
          });

          // ═══ P1A-FIX5: Data Deletion / Privacy Request handling ═══
          if (dataDeletionRequest && beforeOpp) {
            this.log.info(`[DATA_DELETION_REQUEST] Privacy request detected, closing opp + stopping automation`, {
              traceId, oppId: beforeOpp.id, phoneNumber
            });
            // Close old opportunity with privacy reason
            await db.executeSafe({
              text: `UPDATE opportunities SET 
                       stage = 'lost', 
                       closed_at = NOW(), 
                       closed_reason = 'data_deletion_request',
                       automation_status = 'stopped',
                       next_follow_up_at = NULL,
                       metadata = metadata || $1::jsonb,
                       updated_at = NOW()
                     WHERE id = $2 AND tenant_id = $3`,
              values: [
                JSON.stringify({ 
                  privacy_request_pending: true,
                  data_deletion_requested_at: new Date().toISOString(),
                  closed_by: 'system_privacy_request'
                }),
                beforeOpp.id, tenantId
              ]
            });
            // Mirror to conversation + lead
            await db.executeSafe({
              text: `UPDATE conversations SET lead_stage = 'lost', updated_at = NOW() WHERE id = $1 AND tenant_id = $2`,
              values: [conversationId, tenantId]
            });
            const cleanPhone = phoneNumber.replace(/\D/g, '');
            const last10 = cleanPhone.length > 10 ? cleanPhone.substring(cleanPhone.length - 10) : cleanPhone;
            await db.executeSafe({
              text: `UPDATE leads SET stage = 'lost' WHERE phone_number LIKE '%' || $1 || '%' AND tenant_id = $2`,
              values: [last10, tenantId]
            });
          }

          // ═══ P1A-FIX5: Close old + Create new opportunity on identity/dept change ═══
          if (shouldCloseAndCreateNew && !dataDeletionRequest) {
            this.log.info(`[OPP_CLOSE_AND_CREATE] Closing old opp, creating new for different request`, {
              traceId, oldOppId: beforeOpp.id,
              oldDept: beforeOpp.department, newDept: crmData.department,
              oldCountry: beforeOpp.country, newCountry: crmData.country,
              resetConversationRequested, newIdentityDetected, isDifferentDepartment
            });
            
            // Close old opportunity (superseded, not lost)
            const closeReason = resetConversationRequested ? 'user_requested_reset' 
              : newIdentityDetected ? 'new_identity_new_treatment'
              : 'new_treatment_interest';
            
            await db.executeSafe({
              text: `UPDATE opportunities SET 
                       stage = 'lost', 
                       closed_at = NOW(), 
                       closed_reason = $1,
                       metadata = metadata || $2::jsonb,
                       updated_at = NOW()
                     WHERE id = $3 AND tenant_id = $4`,
              values: [
                closeReason,
                JSON.stringify({ 
                  superseded_by: 'new_opportunity',
                  superseded_at: new Date().toISOString(),
                  superseded_reason: closeReason
                }),
                beforeOpp.id, tenantId
              ]
            });

            // Force create new opportunity (bypass existing check)
            const newOppCrmData = { ...crmData, should_create_opportunity: true };
            // Use new country for the new opp
            const newOppCountry = crmData.country || deterministicCountry;
            const newOppId = await oppService.upsertFromCrm({
              tenantId, conversationId, phoneNumber, channel,
              patientName: detectedNewName || crmData.patient_name,
              crmData: newOppCrmData, lastCustomerMessageAt: new Date().toISOString(),
              traceId, externalCountry: newOppCountry
            });
            
            if (newOppId) {
              this.log.info(`[OPP_CLOSE_AND_CREATE_OK] Old closed, new created`, {
                traceId, closedOppId: beforeOpp.id, newOppId, newDept: crmData.department, newCountry: crmData.country
              });
              
              // Mirror new stage to conversation
              const newOppStage = newOppId !== beforeOpp.id ? 'discovery' : null;
              if (newOppStage) {
                const { oppStageToLeadStage } = await import('../config/stage-mapping');
                const mirrorStage = oppStageToLeadStage(newOppStage);
                await db.executeSafe({
                  text: `UPDATE conversations SET lead_stage = $1, updated_at = NOW() WHERE id = $2 AND tenant_id = $3`,
                  values: [mirrorStage, conversationId, tenantId]
                });
              }
            }
          } else if (!shouldCloseAndCreateNew && !dataDeletionRequest) {
            // Normal upsert (existing behavior)
            if (crmData.should_create_opportunity) {
              const oppId = await oppService.upsertFromCrm({
                tenantId, conversationId, phoneNumber, channel,
                patientName: crmData.patient_name,
                crmData, lastCustomerMessageAt: new Date().toISOString(),
                traceId, externalCountry: resolvedCountryForOpp
              });
              if (oppId) {
                this.log.info(`[WORKER_OPP_OK] Opportunity upserted`, { traceId, oppId });
                
                // ═══ P1A-FIX5B: Mirror new opp stage to conversation ═══
                // When no active opp existed (beforeOpp=null) and we created a new one,
                // conversation.lead_stage is still 'lost' from previous cancellation.
                // Must update to match new opportunity stage.
                if (!beforeOpp) {
                  try {
                    const newOppRow = await db.executeSafe({
                      text: `SELECT stage FROM opportunities WHERE id = $1 AND tenant_id = $2`,
                      values: [oppId, tenantId]
                    }) as any[];
                    const newStage = newOppRow[0]?.stage;
                    if (newStage) {
                      const { oppStageToLeadStage } = await import('../config/stage-mapping');
                      const mirrorStage = oppStageToLeadStage(newStage);
                      await db.executeSafe({
                        text: `UPDATE conversations SET lead_stage = $1, updated_at = NOW() WHERE id = $2 AND tenant_id = $3`,
                        values: [mirrorStage, conversationId, tenantId]
                      });
                      // Also mirror to leads
                      const cleanPhone2 = phoneNumber.replace(/\D/g, '');
                      const last10_2 = cleanPhone2.length > 10 ? cleanPhone2.substring(cleanPhone2.length - 10) : cleanPhone2;
                      await db.executeSafe({
                        text: `UPDATE leads SET stage = $1 WHERE phone_number LIKE '%' || $2 || '%' AND tenant_id = $3`,
                        values: [mirrorStage, last10_2, tenantId]
                      });
                      this.log.info(`[OPP_NEW_STAGE_MIRROR] Mirrored new opp stage to conversation`, {
                        traceId, oppId, newStage, mirrorStage
                      });
                    }
                  } catch (mirrorErr) {
                    this.log.warn(`[OPP_NEW_STAGE_MIRROR_FAIL] Non-fatal`, { traceId, error: (mirrorErr as Error).message });
                  }
                }
              }
            } else {
              const enriched = await oppService.enrichExisting(tenantId, conversationId, crmData, resolvedCountryForOpp, traceId);
              this.log.info(`[WORKER_OPP_ENRICH] result=${enriched}`, { traceId });
            }
          }

          // ═══ P0-5: OPP_UPDATE_RESULT — after-snapshot ═══
          let afterOpp: any = null;
          try {
            const oppSnap = await db.executeSafe({
              text: `SELECT id, country, department, travel_date, stage, priority, updated_at FROM opportunities 
                     WHERE conversation_id = $1 AND tenant_id = $2 
                     AND stage NOT IN ('lost', 'not_qualified', 'arrived')
                     ORDER BY created_at DESC LIMIT 1`,
              values: [conversationId, tenantId]
            }) as any[];
            afterOpp = oppSnap[0] || null;
          } catch (_) { /* non-blocking */ }

          await AIEventEmitter.emitSync({
            tenantId, conversationId, customerId,
            type: 'opp_update_result',
            category: 'crm',
            payload: {
              traceId,
              opportunityId: afterOpp?.id || null,
              beforeCountry: beforeOpp?.country || null,
              afterCountry: afterOpp?.country || null,
              beforeDepartment: beforeOpp?.department || null,
              afterDepartment: afterOpp?.department || null,
              beforeTravelDate: beforeOpp?.travel_date || null,
              afterTravelDate: afterOpp?.travel_date || null,
              updatedAt: afterOpp?.updated_at || null,
              countryChanged: beforeOpp?.country !== afterOpp?.country,
              departmentChanged: beforeOpp?.department !== afterOpp?.department
            }
          });
          // ═══ P1A-FIX5 (FIX D): Tag cleanup on reset/new-identity/deletion ═══
          if (shouldCloseAndCreateNew || dataDeletionRequest || newIdentityDetected || (resetConversationRequested && newTreatmentInterest)) {
            try {
              const STALE_TAGS = [
                'iptal_edildi', 'vazgeçti', 'randevu_iptali', 'açık_iptal',
                'takip_durduruldu', 'opt_out_talebi', 'bilgi_silme_talebi',
                'randevu_onayı', 'telefon_gorusmesi_istiyor', 'karar_değişikliği',
                'seyahat_planlama', 'randevu_talebi', 'explicit_cancellation'
              ];
              // Fetch current tags, filter out stale ones
              const convRow = await db.executeSafe({
                text: `SELECT tags FROM conversations WHERE id = $1 AND tenant_id = $2`,
                values: [conversationId, tenantId]
              }) as any[];
              
              if (convRow[0]?.tags) {
                let tags: string[] = [];
                try {
                  tags = typeof convRow[0].tags === 'string' ? JSON.parse(convRow[0].tags) : convRow[0].tags;
                } catch { tags = []; }
                
                const cleanedTags = tags.filter((t: string) => !STALE_TAGS.includes(t));
                if (cleanedTags.length !== tags.length) {
                  await db.executeSafe({
                    text: `UPDATE conversations SET tags = $1::jsonb, updated_at = NOW() WHERE id = $2 AND tenant_id = $3`,
                    values: [JSON.stringify(cleanedTags), conversationId, tenantId]
                  });
                  this.log.info(`[TAG_CLEANUP] Removed ${tags.length - cleanedTags.length} stale tags`, {
                    traceId, removed: tags.filter((t: string) => STALE_TAGS.includes(t)), remaining: cleanedTags
                  });
                }
              }
            } catch (tagErr) {
              this.log.warn(`[TAG_CLEANUP_FAILED] Non-fatal`, { traceId, error: (tagErr as Error).message });
            }
          }

        } catch (oppErr) {
          this.log.error(`[WORKER_OPP_FAILED] Non-fatal opportunity error`, oppErr instanceof Error ? oppErr : new Error(String(oppErr)), { traceId });
        }
      }
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
