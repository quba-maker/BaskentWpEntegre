import { logger } from "@/lib/core/logger";
import { withTenantDB } from "@/lib/core/tenant-db";
import { ConversationService } from "@/lib/services/conversation.service";
import { MessageService } from "@/lib/services/message.service";
import { WorkflowService, ConversationPhase } from "@/lib/services/workflow.service";
import { after } from "next/server";
import { AIOrchestrator, ChatMessage } from "@/lib/services/ai/orchestrator";
import { ResponsePolicy } from "@/lib/services/ai/response-policy";
import { PromptBuilder } from "@/lib/services/ai/prompt-builder";
import { detectLanguage } from "@/lib/utils/language-detector";
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
 * Helper to convert standard markdown formatting to WhatsApp friendly formatting:
 * - Bold: **text** -> *text*
 * - List items: '*' or '-' -> '•'
 * This completely avoids double-asterisk conflicts since WhatsApp uses * for bold.
 */
function formatForWhatsApp(text: string): string {
  if (!text) return text;
  
  let formatted = text;
  
  // 1. Convert standard markdown lists starting with * or - (with potential indent) to bullet points (•)
  formatted = formatted.replace(/^(\s*)[\*\-]\s+/gm, '$1• ');
  
  // 2. Convert standard markdown bold (**text**) to WhatsApp bold (*text*)
  formatted = formatted.replace(/\*\*([^*]+)\*\*/g, '*$1*');
  
  return formatted;
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

      case "media_batch.check":
        await this.handleMediaBatchCheck(tenantId, payload as any, metadata);
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
                AND channel_id IN (
                  SELECT c.id FROM channels c
                  JOIN channel_groups cg ON c.group_id = cg.id
                  WHERE cg.tenant_id = $2
                )
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
              { traceId, spanId: traceId }
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
   * Media Batch Check — Delayed processor for consolidated media response
   * Fires after MEDIA_BATCH_WINDOW_MS. Counts all media, sends single acknowledgment.
   */
  private async handleMediaBatchCheck(tenantId: string, payload: {
    phoneNumber: string;
    conversationId?: string;
    channel: string;
    customerId?: string;
    firstMediaAt: string;
  }, metadata: WorkerMetadata) {
    const traceId = metadata.messageId;
    const { phoneNumber, channel, customerId } = payload;
    this.log.info(`[MEDIA_BATCH_CHECK] Delayed batch check triggered`, { traceId, phoneNumber, tenantId });

    const db = withTenantDB(tenantId);
    const MEDIA_BATCH_WINDOW_MS = parseInt(process.env.MEDIA_BATCH_WINDOW_MS || '30000', 10);
    const batchWindowSec = Math.ceil(MEDIA_BATCH_WINDOW_MS / 1000) + 15; // window + buffer

    try {
      // Race condition guard: advisory lock on phone hash
      const lockKeyStr = `media_batch-${tenantId}-${phoneNumber}`;
      let hash = 0;
      for (let i = 0; i < lockKeyStr.length; i++) {
        hash = ((hash << 5) - hash) + lockKeyStr.charCodeAt(i);
        hash |= 0;
      }
      
      // Try to acquire lock — if another batch check is running, skip
      const lockResult = await db.executeSafe({
        text: `SELECT pg_try_advisory_xact_lock($1) as locked`,
        values: [hash]
      }) as any[];
      
      if (!lockResult[0]?.locked) {
        this.log.info(`[MEDIA_BATCH_LOCK_SKIP] Another batch check is processing`, { traceId, phoneNumber });
        AIEventEmitter.emit({ tenantId, type: 'media_batch_skipped_already_processed', category: 'pipeline', payload: { phoneNumber, reason: 'lock_contention' } });
        return;
      }

      // Check 1: has a batch response already been sent?
      const alreadyBatched = await db.executeSafe({
        text: `
          SELECT COUNT(*) as cnt FROM messages 
          WHERE phone_number = $1 AND tenant_id = $2 
            AND direction = 'out'
            AND model_used = 'media_batch_auto'
            AND created_at > NOW() - INTERVAL '${batchWindowSec + 30} seconds'
        `,
        values: [phoneNumber, tenantId]
      }) as any[];
      
      if (parseInt(alreadyBatched[0]?.cnt) > 0) {
        this.log.info(`[MEDIA_BATCH_ALREADY_PROCESSED] Batch already responded, skipping`, { traceId, phoneNumber });
        AIEventEmitter.emit({ tenantId, type: 'media_batch_skipped_already_processed', category: 'pipeline', payload: { phoneNumber, reason: 'already_responded' } });
        return;
      }

      // Check 2: did the user send a TEXT message after the photos, triggering a normal AI response?
      // If yes, AI already acknowledged the photos in context → batch response is redundant.
      const firstMediaAt = payload.firstMediaAt ? new Date(payload.firstMediaAt) : null;
      if (firstMediaAt) {
        const aiRespondedAfterMedia = await db.executeSafe({
          text: `
            SELECT COUNT(*) as cnt FROM messages 
            WHERE phone_number = $1 AND tenant_id = $2 
              AND direction = 'out'
              AND model_used IS NOT NULL
              AND model_used != 'media_batch_auto'
              AND model_used != 'privacy_pre_detector'
              AND created_at > $3
          `,
          values: [phoneNumber, tenantId, firstMediaAt.toISOString()]
        }) as any[];
        
        if (parseInt(aiRespondedAfterMedia[0]?.cnt) > 0) {
          this.log.info(`[MEDIA_BATCH_SKIP_TEXT_RESPONSE] AI already responded to a follow-up text after media`, { traceId, phoneNumber });
          AIEventEmitter.emit({ tenantId, type: 'media_batch_skipped_already_processed', category: 'pipeline', payload: { phoneNumber, reason: 'text_response_covers_media' } });
          return;
        }
      }

      // Count all media types in the batch window
      const batchStats = await db.executeSafe({
        text: `
          SELECT 
            COUNT(*) FILTER (WHERE media_type = 'image' OR media_type = 'sticker') as image_count,
            COUNT(*) FILTER (WHERE media_type = 'document') as doc_count,
            COUNT(*) FILTER (WHERE media_type = 'audio') as audio_count,
            COUNT(*) FILTER (WHERE media_type = 'video') as video_count,
            COUNT(*) as total_count
          FROM messages 
          WHERE phone_number = $1 AND tenant_id = $2 
            AND direction = 'in'
            AND media_type IS NOT NULL
            AND created_at > NOW() - INTERVAL '${batchWindowSec} seconds'
        `,
        values: [phoneNumber, tenantId]
      }) as any[];

      const stats = batchStats[0] || {};
      const imageCount = parseInt(stats.image_count) || 0;
      const docCount = parseInt(stats.doc_count) || 0;
      const audioCount = parseInt(stats.audio_count) || 0;
      const videoCount = parseInt(stats.video_count) || 0;
      const totalCount = parseInt(stats.total_count) || 0;

      if (totalCount === 0) {
        this.log.info(`[MEDIA_BATCH_EMPTY] No media found in window, skipping`, { traceId, phoneNumber });
        return;
      }

      // Build consolidated response text
      const parts: string[] = [];
      if (imageCount > 0) {
        parts.push(imageCount === 1 ? 'görseliniz' : `${imageCount} görseliniz`);
      }
      if (docCount > 0) {
        parts.push(docCount === 1 ? 'belgeniz' : `${docCount} belgeniz`);
      }
      if (audioCount > 0) {
        parts.push(audioCount === 1 ? 'ses mesajınız' : `${audioCount} ses mesajınız`);
      }
      if (videoCount > 0) {
        parts.push(videoCount === 1 ? 'videonuz' : `${videoCount} videonuz`);
      }

      let responseText: string;
      if (parts.length === 0) {
        responseText = 'Gönderdiğiniz dosya bize ulaştı. Notlarımıza ekledik.';
      } else {
        const joined = parts.length > 1 
          ? parts.slice(0, -1).join(', ') + ' ve ' + parts[parts.length - 1]
          : parts[0];
        responseText = `Gönderdiğiniz ${joined} bize ulaştı. Hepsini notlarımıza ekledik; doktor/ekibimiz değerlendirecek.`;
      }

      // Add audio disclaimer if applicable
      if (audioCount > 0) {
        responseText += ' Ses mesajı içeriği ayrıca değerlendirmeye alınacaktır.';
      }

      // Check conversation status — don't reply if human-handled
      const convStatus = await db.executeSafe({
        text: `SELECT status FROM conversations WHERE phone_number = $1 AND tenant_id = $2 LIMIT 1`,
        values: [phoneNumber, tenantId]
      }) as any[];

      if (convStatus[0]?.status === 'human') {
        this.log.info(`[MEDIA_BATCH_HUMAN] Conversation is human-handled, skipping batch response`, { traceId, phoneNumber });
        return;
      }

      // Send consolidated response via WhatsApp/Meta
      const { CredentialsService } = await import('../services/credentials.service');
      const provider = (channel === 'messenger' || channel === 'instagram' ? channel : 'whatsapp') as 'whatsapp' | 'messenger' | 'instagram';
      const credentials = await CredentialsService.resolveCredentials(tenantId, provider);
      
      if (!credentials.accessToken) {
        this.log.error(`[MEDIA_BATCH_NO_CREDS] No credentials for batch response`, undefined, { tenantId, channel });
        return;
      }

      const msgService = new MessageService(db);
      let outProviderMessageId: string | null = null;
      
      try {
        if (provider === 'whatsapp' && credentials.whatsappPhoneNumberId) {
          const isAutoReplyEnabled = await FeatureFlagService.isEnabled(tenantId, 'whatsapp_auto_reply', false);
          if (!isAutoReplyEnabled) {
            this.log.info(`[MEDIA_BATCH_AUTO_REPLY_DISABLED] whatsapp_auto_reply is false, skipping batch auto-reply`, { tenantId, traceId });
            return;
          }
          const res = await msgService.sendWhatsAppMessage(
            credentials.whatsappPhoneNumberId,
            credentials.accessToken,
            phoneNumber,
            responseText,
            credentials.provider
          );
          outProviderMessageId = res.providerMessageId || null;
        } else {
          const res = await msgService.sendSocialMessage(
            credentials.accessToken,
            phoneNumber,
            responseText,
            provider as 'messenger' | 'instagram'
          );
          outProviderMessageId = res.providerMessageId || null;
        }
      } catch (sendErr) {
        this.log.error(`[MEDIA_BATCH_SEND_FAILED] Failed to send batch response`, sendErr instanceof Error ? sendErr : new Error(String(sendErr)), { traceId });
        return;
      }

      // Save to DB
      const conversationId = payload.conversationId || (await db.executeSafe({
        text: `SELECT id FROM conversations WHERE phone_number = $1 AND tenant_id = $2 LIMIT 1`,
        values: [phoneNumber, tenantId]
      }) as any[])[0]?.id;

      const outMsg = await msgService.saveMessageIdempotent({
        phoneNumber,
        direction: 'out',
        content: responseText,
        channel,
        modelUsed: 'media_batch_auto',
        providerMessageId: outProviderMessageId,
        status: 'sent'
      });

      // Publish realtime event
      if (outMsg.messageId && conversationId) {
        try {
          const { RealtimePublisher } = await import('@/lib/realtime/publisher');
          await RealtimePublisher.publishMessageCreated(tenantId, {
            id: outMsg.messageId,
            conversation_id: conversationId,
            phone_number: phoneNumber,
            content: responseText,
            direction: 'out',
            status: 'sent',
            created_at: new Date().toISOString()
          }, { traceId, spanId: 'media_batch' });
        } catch (rtErr) {
          this.log.error(`[MEDIA_BATCH_REALTIME]`, rtErr instanceof Error ? rtErr : new Error(String(rtErr)), { traceId });
        }
      }

      AIEventEmitter.emit({ 
        tenantId, conversationId, customerId, 
        type: 'media_batch_processed', category: 'pipeline', 
        payload: { phoneNumber, imageCount, docCount, audioCount, videoCount, totalCount } 
      });

      this.log.info(`[MEDIA_BATCH_DONE] Consolidated response sent`, { 
        traceId, phoneNumber, totalCount, imageCount, docCount, audioCount 
      });

      // Trigger memory summarization (fire-and-forget)
      if (conversationId) {
        (async () => {
          try {
            const { FeatureFlagService } = await import('@/lib/services/feature-flag.service');
            const isMemoryEnabled = await FeatureFlagService.isEnabled(tenantId, 'memory_engine', true);
            if (isMemoryEnabled) {
              const { MemoryEngine } = await import('@/lib/services/ai/engines/memory');
              await MemoryEngine.summarizeConversation(tenantId, conversationId);
            }
          } catch (memErr) {
            this.log.error(`[MEDIA_BATCH_MEMORY]`, memErr instanceof Error ? memErr : new Error(String(memErr)), { traceId });
          }
        })();
      }

    } catch (e: any) {
      this.log.error(`[MEDIA_BATCH_CHECK_FAILED] Batch check handler failed`, e instanceof Error ? e : new Error(String(e)), { traceId, phoneNumber });
    }
  }

  /**
   * Domain-specific handler for Incoming Messages across Meta Channels (WhatsApp, Messenger, Instagram)
   */
  private async handleIncomingMessage(tenantId: string, payload: MetaWebhookPayload, metadata: WorkerMetadata, channel: 'whatsapp' | 'messenger' | 'instagram') {
    const traceId = metadata.messageId;
    this.log.info(`[WORKER_PROCESSING] [${channel.toUpperCase()}] Processing incoming message`, { tenantId, traceId });
    let skipBotReply = false;

    // 1. Resolve Hybrid Isolated Tenant Brain
    const { BrainResolver } = await import('../brain/brain-resolver');
    const { TenantFirewall } = await import('../security/tenant-firewall');
    
    let brain;
    try {
      brain = await BrainResolver.resolveTenantBrain(payload, channel, traceId, metadata.channelId);
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
      const dbTemp = withTenantDB(tenantId);
      const value = payload.entry?.[0]?.changes?.[0]?.value;
      const messages = value?.messages;
      if (!messages || messages.length === 0) {
        this.log.info(`[SKIP] No messages found in payload`, { traceId });
        return;
      }
      const incomingMsg = messages[0];

      // Echo Detection: If incomingMsg.from is the business display number, then it is an outbound app echo
      const isEchoFromField = incomingMsg.from === value?.metadata?.phone_number_id || 
                              incomingMsg.from === value?.metadata?.display_phone_number ||
                              incomingMsg.from === brain.context.config?.identifier;

      const isSmbEchoPayload = (incomingMsg as any).is_smb_echo === true;
      const isEcho = isEchoFromField || isSmbEchoPayload;

      // Extract the patient phone number
      phoneNumber = isEcho && (incomingMsg as any).to
        ? (incomingMsg as any).to
        : (incomingMsg.from || '');
      providerMessageId = incomingMsg.id || '';
      profileName = value?.contacts?.[0]?.profile?.name;
      
      const isHistoryImport = (incomingMsg as any).is_history_import === true;
      const providerTimestamp = incomingMsg.timestamp ? parseInt(incomingMsg.timestamp, 10) : undefined;

      // ── NATIVE METADATA BUILDING (P0) ──
      const msgType = incomingMsg.type || 'text';
      const native: any = {
        provider: '360dialog',
        message_type: msgType,
      };
      
      if (profileName) {
        native.whatsapp_profile_name = profileName;
      }

      if ((incomingMsg as any).context?.id) {
        native.reply_to_provider_message_id = (incomingMsg as any).context.id;
        try {
          const qRes = await dbTemp.executeSafe({
            text: `SELECT id, direction, content, media_type, status, created_at FROM messages WHERE provider_message_id = $1 AND tenant_id = $2 LIMIT 1`,
            values: [(incomingMsg as any).context.id, tenantId]
          }) as any[];
          if (qRes.length > 0) {
            const qMsg = qRes[0];
            native.reply_to_message_id = qMsg.id;
            native.quoted_message_snapshot = {
              direction: qMsg.direction,
              text: qMsg.content,
              type: qMsg.media_type || 'text',
              sender_label: qMsg.direction === 'in' ? 'Hasta' : 'Bot',
              created_at: qMsg.created_at
            };
            this.log.info(`[NATIVE_CONTEXT_DETECTED] type=reply hasContext=true hasQuotedSnapshot=true`, { traceId });
          } else {
            native.quoted_message_missing = true;
            this.log.info(`[NATIVE_CONTEXT_DETECTED] type=reply hasContext=true hasQuotedSnapshot=false`, { traceId });
          }
        } catch (err) {
          this.log.error(`[QUOTED_LOOKUP_ERROR]`, err as Error, { traceId });
        }
      }

      switch (msgType) {
        case 'text':
          content = incomingMsg.text?.body || '';
          break;
        case 'image':
          mediaType = 'image';
          mediaId = incomingMsg.image?.id || null;
          mediaUrl = (incomingMsg.image as any)?.url || null;
          mediaMetadata = {
            mime_type: incomingMsg.image?.mime_type,
            caption: incomingMsg.image?.caption,
          };
          content = incomingMsg.image?.caption || '';
          if (content) native.media_caption = content;
          break;
        case 'document':
          mediaType = 'document';
          mediaId = incomingMsg.document?.id || null;
          mediaUrl = (incomingMsg.document as any)?.url || null;
          mediaMetadata = {
            mime_type: incomingMsg.document?.mime_type,
            filename: incomingMsg.document?.filename,
          };
          content = (incomingMsg.document as any)?.caption || '';
          if (content) native.media_caption = content;
          if (incomingMsg.document?.filename) native.media_filename = incomingMsg.document.filename;
          break;
        case 'audio':
          mediaType = 'audio';
          mediaId = incomingMsg.audio?.id || null;
          mediaUrl = (incomingMsg.audio as any)?.url || null;
          mediaMetadata = {
            mime_type: incomingMsg.audio?.mime_type,
          };
          content = '';
          break;
        case 'video':
          mediaType = 'video';
          mediaId = incomingMsg.video?.id || null;
          mediaUrl = (incomingMsg.video as any)?.url || null;
          mediaMetadata = {
            mime_type: incomingMsg.video?.mime_type,
            caption: incomingMsg.video?.caption,
          };
          content = incomingMsg.video?.caption || '';
          if (content) native.media_caption = content;
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
          mediaId = (incomingMsg as any).sticker?.id || null;
          mediaMetadata = { mime_type: 'image/webp' };
          content = '';
          break;
        case 'reaction':
          content = incomingMsg.reaction?.emoji || '👍';
          native.reaction_payload = incomingMsg.reaction;
          skipBotReply = true; // Reactions don't trigger AI
          this.log.info(`[NATIVE_REACTION_DETECTED] type=reaction skipBotReply=true`, { traceId });
          break;
        case 'button':
          content = incomingMsg.button?.text || incomingMsg.button?.payload || '';
          break;
        case 'interactive':
          content = incomingMsg.interactive?.button_reply?.title || incomingMsg.interactive?.list_reply?.title || '';
          native.interactive_payload = incomingMsg.interactive;
          this.log.info(`[NATIVE_INTERACTIVE_DETECTED] type=${incomingMsg.interactive?.type || 'interactive'} id=${incomingMsg.interactive?.button_reply?.id || incomingMsg.interactive?.list_reply?.id || 'unknown'}`, { traceId });
          break;
        default:
          content = '';
          break;
      }
      
      // Inject native payload into mediaMetadata (which serves as our JSONB metadata column)
      if (!mediaMetadata) mediaMetadata = {};
      mediaMetadata.native = native;

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
    if (mediaType && (mediaId || mediaUrl)) {
      try {
        const mediaCreds = await CredentialsService.resolveCredentials(tenantId, channel === 'whatsapp' ? 'whatsapp' : channel as any);
        if (mediaCreds.accessToken) {
          const { MediaStorageService } = await import('@/lib/services/media-storage.service');
          const blobResult = await MediaStorageService.downloadAndStore(
            tenantId,
            mediaId || `media_${Date.now()}`,
            mediaCreds.accessToken,
            providerMessageId || `msg_${Date.now()}`,
            {
              mimeType: mediaMetadata?.mime_type,
              filename: mediaMetadata?.filename,
              mediaType,
              provider: ((payload as any).routingSource === '360dialog_channel_id' || process.env.ENABLE_360DIALOG_COEXISTENCE === 'true')
                ? '360dialog'
                : (mediaCreds.provider || undefined),
              directUrl: mediaUrl || undefined,
            }
          );
          if (blobResult) {
            mediaUrl = blobResult.blobUrl;
            // Track storage usage for SaaS billing
            await MediaStorageService.trackUsage(db, tenantId, mediaType, blobResult.fileSize);
            this.log.info(`[MEDIA_OK] Media stored in blob`, { tenantId, mediaType, fileSize: blobResult.fileSize, traceId });
          } else {
            mediaUrl = null; // Prevent storing raw lookaside URLs in database if download fails
          }
        } else {
          mediaUrl = null;
          this.log.warn(`[MEDIA_NO_CREDS] No access token for media download`, { tenantId, traceId });
        }
      } catch (mediaErr) {
        mediaUrl = null; // Ensure clean state on error
        // Fallback for UI if media couldn't be downloaded (especially for history imports)
        mediaMetadata = mediaMetadata || {};
        mediaMetadata.media_unavailable = true;
        mediaMetadata.media_unavailable_reason = "media_expired_or_unavailable";
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

    // ── APP ECHO DETECTION (360dialog Coexistence) ──
    const valueObj = channel === 'whatsapp' ? payload.entry?.[0]?.changes?.[0]?.value : null;
    const incomingMsgObj = channel === 'whatsapp'
      ? valueObj?.messages?.[0]
      : payload.entry?.[0]?.messaging?.[0];

    const isAppEcho = channel === 'whatsapp' && incomingMsgObj && 
      ((incomingMsgObj as any).from === valueObj?.metadata?.phone_number_id || 
       (incomingMsgObj as any).from === valueObj?.metadata?.display_phone_number ||
       (incomingMsgObj as any).from === brain.context.config?.identifier ||
       (incomingMsgObj as any).is_smb_echo === true);
       
    const isHistory = channel === 'whatsapp' && incomingMsgObj && (incomingMsgObj as any).is_history_import === true;
    const incomingTimestamp = channel === 'whatsapp' && incomingMsgObj ? parseInt((incomingMsgObj as any).timestamp, 10) : undefined;

    const direction = isAppEcho ? 'out' : (mediaMetadata?.native?.message_type === 'reaction' ? 'system' : 'in') as any;
    const modelUsed = isAppEcho ? null : undefined;
    const statusVal = isAppEcho ? 'sent' : (isHistory ? 'delivered' : 'delivered');

    // 3. Save Message (Idempotency and locking handled atomically in CTE)
    const { isDuplicate, conversationId, messageId } = await msgService.saveMessageIdempotent({
      phoneNumber,
      direction,
      content,
      channel: channel,
      channelId: metadata.channelId,
      groupId: metadata.groupId,
      providerMessageId,
      mediaType,
      mediaUrl,
      mediaMetadata: mediaMetadata ? { ...mediaMetadata, is_history_import: isHistory } : (isHistory ? { is_history_import: true } : null),
      modelUsed,
      status: statusVal,
      providerTimestamp: incomingTimestamp,
      isHistoryImport: isHistory
    });

    if (isDuplicate) {
      this.log.warn(`[DUPLICATE_DROPPED] Message already processed`, { providerMessageId, traceId });
      AIEventEmitter.emit({ tenantId, customerId, type: 'duplicate_message_dropped', category: 'pipeline', severity: 'warning', payload: { providerMessageId } });
      return;
    }

    if (isAppEcho) {
      this.log.info(`[APP_ECHO_DETECTED] Outbound echo from mobile WhatsApp App. Auto-handover to human and disabling autopilot.`, { phoneNumber, traceId });
      
      // Auto-handover: update conversation status to human and disable autopilot
      await db.executeSafe({
        text: `UPDATE conversations SET status = 'human', autopilot_enabled = false WHERE phone_number = $1 AND tenant_id = $2`,
        values: [phoneNumber, tenantId]
      });

      // Takeover/Cancel active bot directive on echo
      if (conversationId) {
        try {
          const activeTasks = await db.executeSafe({
            text: `SELECT id, metadata FROM follow_up_tasks
                   WHERE conversation_id = $1 AND tenant_id = $2 AND status IN ('pending', 'in_progress')
                   ORDER BY created_at DESC`,
            values: [conversationId, tenantId]
          }) as any[];
          if (activeTasks.length > 0) {
            const taskMeta = activeTasks[0].metadata || {};
            const directiveState = taskMeta.bot_directive_state;
            if (directiveState && ['pending', 'waiting_patient'].includes(directiveState.directive_status)) {
              const { PatientOperationsLifecycleService } = await import('../services/patient-operations-lifecycle');
              const lifecycleService = new PatientOperationsLifecycleService(db);
              await lifecycleService.completeBotDirective(activeTasks[0].id, tenantId, 'operator_takeover');
              this.log.info(`[APP_ECHO_DIRECTIVE_TAKEOVER] Cancelled bot directive for task ${activeTasks[0].id}`, { traceId });
            }
          }
        } catch (takeoverErr) {
          this.log.warn(`[ECHO_DIRECTIVE_TAKEOVER_FAILED] Non-fatal`, takeoverErr instanceof Error ? takeoverErr : new Error(String(takeoverErr)));
        }
      }

      // Get conversation details for audit log / realtime
      const convDetails = await db.executeSafe({
        text: `SELECT id, channel_id FROM conversations WHERE phone_number = $1 AND tenant_id = $2 LIMIT 1`,
        values: [phoneNumber, tenantId]
      }) as any[];
      const resolvedConvId = convDetails[0]?.id || conversationId;
      const resolvedChannelId = convDetails[0]?.channel_id || metadata.channelId;

      // Write structural audit log
      await db.executeSafe({
        text: `INSERT INTO ai_audit_logs (tenant_id, action, reasoning_summary, result_summary)
               VALUES ($1, $2, $3, $4)`,
        values: [
          tenantId,
          'autopilot_disabled',
          'Autopilot disabled by WhatsApp App Echo',
          JSON.stringify({
            conversation_id: resolvedConvId,
            phone: phoneNumber,
            channel_id: resolvedChannelId,
            tenant_id: tenantId,
            enabled: false,
            user_id: 'system_webhook',
            timestamp: new Date().toISOString(),
            reason: 'app_echo'
          })
        ]
      });

      // Broadcast autopilot updated realtime update
      try {
        const { RealtimeBus } = await import("@/lib/realtime/bus");
        await RealtimeBus.publish(tenantId, {
          eventId: require("uuid").v4(),
          traceId: "app-echo-trace-" + Date.now(),
          spanId: require("uuid").v4(),
          timestamp: Date.now() * 1000,
          entityVersion: 1,
          eventVersion: "1.0",
          schemaVersion: "1.0",
          tenantId: tenantId,
          type: "conversation.autopilot_updated" as any,
          payload: {
            conversationId: resolvedConvId,
            phone: phoneNumber,
            channelId: resolvedChannelId,
            enabled: false,
            status: 'human'
          }
        });
      } catch (realtimeErr) {
        this.log.error("Failed to publish autopilot echo realtime update:", realtimeErr instanceof Error ? realtimeErr : new Error(String(realtimeErr)));
      }

      // Realtime publish for the human outbound message
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
              direction: 'out',
              status: 'sent',
              created_at: new Date().toISOString()
            },
            { traceId, spanId: 'app_echo' }
          );
        } catch (realtimeErr) {
          this.log.error(`[APP_ECHO_REALTIME_FAILED]`, realtimeErr instanceof Error ? realtimeErr : new Error(String(realtimeErr)), { traceId });
        }
      }

      // Bypass any AI response or pipeline summary since human answered
      return;
    }

    if (isHistory) {
      this.log.info(`[HISTORY_IMPORT] Skipping AI/tasks for history message`, { traceId, phoneNumber });
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

    // 3. Conversation Load / State Check & Autopilot Gates
    const convQuery = await db.executeSafe({
      text: `SELECT id, status, autopilot_enabled, channel_id, lead_stage FROM conversations WHERE phone_number = $1 AND tenant_id = $2 LIMIT 1`,
      values: [phoneNumber, tenantId]
    }) as any[];
    
    const convRecord = convQuery[0] || null;
    const conversationIdVal = convRecord?.id || conversationId;
    const autopilotEnabled = convRecord?.autopilot_enabled || false;
    const currentStatus = convRecord?.status || 'human';
    const resolvedChannelId = convRecord?.channel_id || metadata.channelId;
    const leadStage = convRecord?.lead_stage || null;

    const isGlobalAutopilotEnabled = process.env.ENABLE_SELECTED_AUTOPILOT === 'true';
    let isAutopilotResponding = isGlobalAutopilotEnabled && autopilotEnabled;

    const disableAutopilot = async (reason: string, details?: string) => {
      this.log.info(`[AUTOPILOT_AUTO_DISABLE] Disabling autopilot. Reason: ${reason} | Details: ${details || 'none'}`);
      
      // Update DB
      await db.executeSafe({
        text: `UPDATE conversations 
               SET status = 'human', autopilot_enabled = false 
               WHERE id = $1 AND tenant_id = $2`,
        values: [conversationIdVal, tenantId]
      });

      // Write structural audit log
      await db.executeSafe({
        text: `INSERT INTO ai_audit_logs (tenant_id, action, reasoning_summary, result_summary)
               VALUES ($1, $2, $3, $4)`,
        values: [
          tenantId,
          'autopilot_disabled',
          `Autopilot automatically disabled. Reason: ${reason}. Details: ${details || ''}`,
          JSON.stringify({
            conversation_id: conversationIdVal,
            phone: phoneNumber,
            channel_id: resolvedChannelId,
            tenant_id: tenantId,
            enabled: false,
            user_id: 'system_worker',
            timestamp: new Date().toISOString(),
            reason: reason,
            details: details || null
          })
        ]
      });

      // Broadcast realtime update
      try {
        const { RealtimeBus } = await import("@/lib/realtime/bus");
        await RealtimeBus.publish(tenantId, {
          eventId: require("uuid").v4(),
          traceId: "worker-auto-disable-" + Date.now(),
          spanId: require("uuid").v4(),
          timestamp: Date.now() * 1000,
          entityVersion: 1,
          eventVersion: "1.0",
          schemaVersion: "1.0",
          tenantId: tenantId,
          type: "conversation.autopilot_updated" as any,
          payload: {
            conversationId: conversationIdVal,
            phone: phoneNumber,
            channelId: resolvedChannelId,
            enabled: false,
            status: 'human'
          }
        });
      } catch (realtimeErr) {
        this.log.error("Failed to publish autopilot auto-disable realtime update:", realtimeErr instanceof Error ? realtimeErr : new Error(String(realtimeErr)));
      }
    };

    // Check if we should proceed with bot response generation
    let shouldProceedWithBot = false;
    
    if (isAutopilotResponding) {
      shouldProceedWithBot = true;
    } else if (currentStatus !== 'human') {
      // Fallback: If not selected autopilot, check old global auto-reply setting
      const isAutoReplyEnabled = await FeatureFlagService.isEnabled(tenantId, 'whatsapp_auto_reply', false);
      if (isAutoReplyEnabled) {
        shouldProceedWithBot = true;
      }
    }

    if (!shouldProceedWithBot) {
      this.log.info(`[SKIP] Conversation is handled by human or autopilot/auto-reply is disabled`, { phoneNumber, traceId });
      if (conversationIdVal) {
        // Fire-and-forget memory summarization in human/inactive mode
        (async () => {
          try {
            const isMemoryEnabled = await FeatureFlagService.isEnabled(tenantId, 'memory_engine', true);
            if (isMemoryEnabled) {
              const { MemoryEngine } = await import('@/lib/services/ai/engines/memory');
              await MemoryEngine.summarizeConversation(tenantId, conversationIdVal);
            }
          } catch (memErr) {
            this.log.error(`[WORKER_HUMAN_MEMORY_FAILED] Human mode memory summarization error`, memErr instanceof Error ? memErr : new Error(String(memErr)), { traceId });
          }
        })();
      }
      return;
    }

    // Run active autopilot safety check gates
    if (isAutopilotResponding) {
      // 1. Whitelist Gate (Only checked if AUTOPILOT_ENFORCE_WHITELIST is 'true')
      if (process.env.AUTOPILOT_ENFORCE_WHITELIST === 'true') {
        const whitelistRaw = process.env.AUTOPILOT_WHITELIST;
        if (!whitelistRaw || whitelistRaw.trim() === "") {
          this.log.info(`[AUTOPILOT_GATE] Whitelist enforcement active but AUTOPILOT_WHITELIST is empty or undefined. Skipping bot response.`, { traceId });
          skipBotReply = true;
          isAutopilotResponding = false;
        } else {
          const whitelist = whitelistRaw.split(',').map(num => num.trim().replace(/\D/g, ''));
          const cleanPhone = phoneNumber.replace(/\D/g, '');
          const isWhitelisted = whitelist.some(whNum => cleanPhone.endsWith(whNum) || whNum === cleanPhone);
          if (!isWhitelisted) {
            this.log.info(`[AUTOPILOT_GATE] Phone number ${phoneNumber} is not whitelisted in AUTOPILOT_WHITELIST. Skipping bot response.`, { traceId });
            skipBotReply = true;
            isAutopilotResponding = false;
          }
        }
      }

      // 2. 24h Service Window Gate (tenant_id + channel_id + conversation_id)
      if (isAutopilotResponding && !skipBotReply) {
        const prevInboundQuery = await db.executeSafe({
          text: `SELECT created_at FROM messages 
                 WHERE tenant_id = $1 
                   AND conversation_id = $2 
                   AND channel_id = $3
                   AND direction = 'in'
                   AND id != $4
                 ORDER BY created_at DESC 
                 LIMIT 1`,
          values: [tenantId, conversationIdVal, resolvedChannelId, messageId]
        }) as any[];

        if (prevInboundQuery.length > 0) {
          const lastInboundTime = new Date(prevInboundQuery[0].created_at).getTime();
          const diffHours = (Date.now() - lastInboundTime) / (1000 * 60 * 60);
          if (diffHours > 24) {
            await disableAutopilot('24h_expired', `Last inbound was ${diffHours.toFixed(1)} hours ago`);
            skipBotReply = true;
            isAutopilotResponding = false;
          }
        }
      }

      // 3. Stop Rules Gate (Opt-Out and Terminal Opportunity Stages)
      if (isAutopilotResponding && !skipBotReply) {
        const optOutKeywords = ["opt-out", "istemiyorum", "rahatsız etmeyin", "listeden çıkar", "iptal", "stop", "mesaj atmayın", "üye olmak istemiyorum"];
        const hasOptOutKeyword = content && optOutKeywords.some(kw => content.toLowerCase().includes(kw));
        const isTerminalStage = leadStage && ['lost', 'not_interested', 'arrived', 'terminal'].includes(leadStage);

        if (hasOptOutKeyword) {
          await disableAutopilot('stop_rule', `Opt-out keyword detected: "${content}"`);
          skipBotReply = true;
          isAutopilotResponding = false;
        } else if (isTerminalStage) {
          await disableAutopilot('coordinator_takeover', `Terminal stage detected: "${leadStage}"`);
          skipBotReply = true;
          isAutopilotResponding = false;
        }
      }
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
        // Check if auto-reply is enabled for whatsapp (Listening Mode check)
        if (channel === 'whatsapp') {
          const isAutoReplyEnabled = await FeatureFlagService.isEnabled(tenantId, 'whatsapp_auto_reply', false);
          if (!isAutoReplyEnabled) {
            this.log.info(`[WORKING_HOURS_AUTO_REPLY_DISABLED] whatsapp_auto_reply is false, skipping working hours off-message outbound`, { tenantId, traceId });
            return;
          }
        }
        const offMsg = wh.offMessage || 'Mesai saatlerimiz dışındasınız. En kısa sürede dönüş yapılacaktır.';
        // V2 Credential Resolution — NO ENV FALLBACK
        const whCreds = await CredentialsService.resolveCredentials(tenantId, 'whatsapp');
        this.log.info(`[CREDENTIAL_SOURCE] Working hours off-message`, { tenantId, source: whCreds.source, traceId });
        const accessToken = whCreds.accessToken || '';
        const phoneId = whCreds.whatsappPhoneNumberId || '';
        if (phoneId && accessToken) {
          const outRes = await msgService.sendWhatsAppMessage(phoneId, accessToken, phoneNumber, offMsg, whCreds.provider);
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

    // 3.7 MEDIA BATCH WINDOW — Delay bot response for media messages
    // When media arrives, skip immediate bot reply. Schedule a delayed batch check.
    // After the window closes (default 30s), a single consolidated response is sent.
    // This prevents bot from replying to each photo individually.
    //
    // ARCHITECTURE: We schedule a delayed QStash event for EVERY media message.
    // handleMediaBatchCheck has an already-processed guard (model_used='media_batch_auto')
    // that ensures only the FIRST arriving check actually sends a response.
    // This eliminates race conditions where multiple webhooks arrive simultaneously.
    const MEDIA_BATCH_WINDOW_MS = parseInt(process.env.MEDIA_BATCH_WINDOW_MS || '30000', 10);
    
    if (mediaType && !skipBotReply) {
      skipBotReply = true; // Media messages NEVER get immediate bot reply
      
      try {
        const { QueueService } = await import('./queue.service');
        const queue = new QueueService();
        await queue.publish(tenantId, 'media_batch.check', {
          phoneNumber,
          conversationId,
          channel,
          customerId,
          firstMediaAt: new Date().toISOString(),
        }, { delayMs: MEDIA_BATCH_WINDOW_MS });
        
        AIEventEmitter.emit({ 
          tenantId, conversationId, customerId, 
          type: 'media_batch_started', category: 'pipeline', 
          payload: { phoneNumber, mediaType, batchWindowMs: MEDIA_BATCH_WINDOW_MS } 
        });
        this.log.info(`[MEDIA_BATCH] Delayed check scheduled for media message`, {
          traceId, phoneNumber, mediaType
        });
      } catch (batchErr) {
        // Non-fatal — if batch scheduling fails, media is still saved, just no batch response
        this.log.warn(`[MEDIA_BATCH_ERROR] Non-fatal batch scheduling error`, { traceId, error: String(batchErr) });
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

    // ══════════════════════════════════════════════════════════
    // P1B: PRIVACY PRE-DETECTOR — Runs BEFORE AI response
    // Catches "bilgilerimi sil", "beni unut", "verilerimi sil",
    // "kaydımı sil", "baştan başlayalım" BEFORE they reach
    // the sales AI prompt. Deterministic safe response.
    // ══════════════════════════════════════════════════════════
    if (content) {
      try {
        const { detectCancellation } = await import('../services/ai/cancellation-detector');
        const preDetection = detectCancellation(String(content));

        if (preDetection.data_deletion_request || preDetection.reset_conversation_requested) {
          this.log.info(`[P1B_PRIVACY_PRE] Privacy/reset detected BEFORE AI — bypassing AI response`, {
            traceId, phoneNumber,
            dataDeletion: preDetection.data_deletion_request,
            resetRequested: preDetection.reset_conversation_requested,
            matched: preDetection.matched_phrases,
          });

          // 1. Deterministic safe response
          const safeResponse = preDetection.data_deletion_request
            ? 'Talebinizi aldık. Kişisel verilerinizle ilgili silme/güncelleme talebiniz ilgili birime iletilecektir.'
            : 'Talebinizi aldık. Görüşme sıfırlanma talebiniz alınmıştır, size en kısa sürede dönüş yapılacaktır.';

          // 2. Update active opportunity (if exists)
          if (conversationId) {
            try {
              const { ActiveOpportunityResolver } = await import('../services/active-opportunity-resolver');
              const resolver = new ActiveOpportunityResolver(db);
              const resolved = await resolver.resolve({ tenantId, conversationId, phoneNumber });
              
              if (resolved.opportunity) {
                const updateFields: string[] = [];
                const updateValues: any[] = [];
                let idx = 1;

                if (preDetection.data_deletion_request) {
                  updateFields.push(`automation_status = 'stopped'`);
                  updateFields.push(`next_follow_up_at = NULL`);
                  updateFields.push(`metadata = metadata || $${idx++}::jsonb`);
                  updateValues.push(JSON.stringify({
                    privacy_request_pending: true,
                    data_deletion_requested_at: new Date().toISOString(),
                    admin_action_required: true,
                  }));
                }

                if (preDetection.reset_conversation_requested) {
                  // Clear active_opportunity_id — next message will create new opp
                  await resolver.clearActive(tenantId, conversationId);
                  this.log.info(`[P1B_PRIVACY_PRE] Cleared active_opportunity_id for reset`, { traceId, conversationId });
                }

                if (updateFields.length > 0) {
                  updateFields.push(`updated_at = NOW()`);
                  await db.executeSafe({
                    text: `UPDATE opportunities SET ${updateFields.join(', ')} WHERE id = $${idx++} AND tenant_id = $${idx++}`,
                    values: [...updateValues, resolved.opportunity.id, tenantId]
                  });
                }
              }
            } catch (privErr) {
              this.log.error(`[P1B_PRIVACY_PRE] Opportunity update failed (non-fatal)`, privErr instanceof Error ? privErr : new Error(String(privErr)), { traceId });
            }
          }

          // 3. Send deterministic response via channel
          const privCreds = await CredentialsService.resolveCredentials(tenantId, channel);
          const privAccessToken = privCreds.accessToken || '';
          const privPhoneId = privCreds.whatsappPhoneNumberId || '';

          if (privAccessToken && (channel !== 'whatsapp' || privPhoneId)) {
            try {
              let privOutResult;
              if (channel === 'whatsapp') {
                const isAutoReplyEnabled = await FeatureFlagService.isEnabled(tenantId, 'whatsapp_auto_reply', false);
                if (!isAutoReplyEnabled) {
                  this.log.info(`[PRIVACY_PRE_AUTO_REPLY_DISABLED] whatsapp_auto_reply is false, skipping privacy pre-detector auto-reply`, { tenantId, traceId });
                } else {
                  const outRes = await msgService.sendWhatsAppMessage(privPhoneId, privAccessToken, phoneNumber, safeResponse, privCreds.provider);
                  privOutResult = outRes;
                }
              } else {
                const outRes = await msgService.sendSocialMessage(privAccessToken, phoneNumber, safeResponse, channel);
                privOutResult = outRes;
              }

              // Save message to DB
              const saveMsgResult = await msgService.saveMessageIdempotent({
                phoneNumber, direction: 'out', content: safeResponse, channel,
                channelId: metadata.channelId, groupId: metadata.groupId,
                providerMessageId: privOutResult?.providerMessageId,
                status: 'sent', modelUsed: 'privacy_pre_detector',
              });

              // Realtime publish
              if (saveMsgResult.messageId && conversationId) {
                try {
                  const { RealtimePublisher } = await import('@/lib/realtime/publisher');
                  await RealtimePublisher.publishMessageCreated(tenantId, {
                    id: saveMsgResult.messageId,
                    conversation_id: conversationId,
                    phone_number: phoneNumber,
                    content: safeResponse,
                    direction: 'out',
                    status: 'sent',
                    created_at: new Date().toISOString(),
                  }, { traceId, spanId: privOutResult?.providerMessageId || traceId });
                } catch (realtimeErr) {
                  this.log.error(`[P1B_PRIVACY_REALTIME]`, realtimeErr instanceof Error ? realtimeErr : new Error(String(realtimeErr)), { traceId });
                }
              }
            } catch (sendErr) {
              this.log.error(`[P1B_PRIVACY_SEND]`, sendErr instanceof Error ? sendErr : new Error(String(sendErr)), { traceId });
            }
          }

          // 4. CRM extraction still runs (skip AI only)
          // Continue to CRM extraction section below but skip bot reply
          skipBotReply = true;
          this.log.info(`[P1B_PRIVACY_PRE_DONE] Privacy safe response sent, CRM extraction will still run`, { traceId });
        }
      } catch (preDetErr) {
        this.log.error(`[P1B_PRIVACY_PRE_ERROR] Non-fatal`, preDetErr instanceof Error ? preDetErr : new Error(String(preDetErr)), { traceId });
      }
    }

    // Fetch conversation history first so we can use it for language detection and AI orchestration
    const history = await convService.getHistory(phoneNumber, 10);

    // Run programmatic language detection
    let languageContext = null;
    try {
      languageContext = detectLanguage(content, history);
      
      // Safe metadata logging (no customer phone number or medical data)
      this.log.info(`[LANGUAGE_DETECTED] Ingestion language determined`, {
        detected_patient_language: languageContext.detected_patient_language,
        reply_language: languageContext.reply_language,
        language_confidence: languageContext.language_confidence,
        language_detection_source: languageContext.language_detection_source,
        traceId
      });

      if (unifiedContext) {
        unifiedContext.languageContext = languageContext;
      } else {
        unifiedContext = { languageContext };
      }
    } catch (langErr) {
      this.log.error(`[LANGUAGE_DETECTION_FAILED] Non-fatal language detection error`, langErr instanceof Error ? langErr : new Error(String(langErr)), { traceId });
    }

    if (content) {
      const lowerContent = content.toLowerCase().trim();
      const greetings = ['merhaba', 'merhabalar', 'selam', 'iyi günler', 'iyi akşamlar', 'iyi sabahlar', 'günaydın', 'kolay gelsin', 'iyi çalışmalar'];
      if (greetings.includes(lowerContent) || (lowerContent.length < 20 && greetings.some(g => lowerContent.includes(g)))) {
        if (!unifiedContext) unifiedContext = {};
        unifiedContext.isGreetingOnly = true;
        this.log.info(`[CONTEXT_COMPRESSION] Detected greeting_only mode for content: "${content}"`, { traceId });
      }
    }

    // 6. Build System Prompt & History strictly via TenantBrain
    let systemPromptText = PromptBuilder.buildSystemPrompt(brain, targetPhase, false, unifiedContext);
    
    // In future phases, history and AI Orchestrator will use brain.namespaces.memory()
    const aiMessages: ChatMessage[] = [
      { role: 'system' as const, content: String(systemPromptText) },
      ...history,
      { role: 'user' as const, content: String(content) } // Add current message explicitly if not in history
    ];

    this.log.info(`[PROMPT_BUILT] Prepared LLM payload`, { historyLength: history.length, traceId });

    // Check if auto-reply is disabled for whatsapp channel (Listening Mode)
    if (channel === 'whatsapp' && !skipBotReply && !isAutopilotResponding) {
      const isAutoReplyEnabled = await FeatureFlagService.isEnabled(tenantId, 'whatsapp_auto_reply', false);
      if (!isAutoReplyEnabled) {
        skipBotReply = true;
        this.log.info(`[AUTO_REPLY_DISABLED] whatsapp_auto_reply is false. Skipping AI bot reply generation.`, { tenantId, traceId });
      }
    }

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
    let aiResponse: any;
    let isRetry = false;
    let qualityGateFailed = false;
    let qualityGateReason = '';

    const executeLLM = async (messages: any[]) => {
      const aiPromise = this.aiOrchestrator.generateResponse(messages, aiConfig, tenantId, conversationId);
      const timeoutPromise = new Promise<never>((_, reject) => 
        setTimeout(() => reject(new Error("AI_TIMEOUT")), timeoutMs)
      );
      return Promise.race([aiPromise, timeoutPromise]);
    };

    try {
      try {
        aiResponse = await executeLLM(aiMessages);
        
        // Final heuristic validation (Layer 2)
        const completeness = this.responsePolicy.validateCompleteness(aiResponse.text, aiResponse.finishReason);
        if (!completeness.valid) {
          throw new Error(`INCOMPLETE_HEURISTIC: ${completeness.reason}`);
        }
      } catch (e: any) {
        if (e.name === 'IncompleteResponseError' || e.message?.startsWith('INCOMPLETE_HEURISTIC')) {
          this.log.warn(`[QUALITY_GATE_BLOCKED] AI response incomplete, attempting retry`, { reason: e.message, traceId });
          isRetry = true;
          
          const retryContextMessages = [...aiMessages];
          retryContextMessages.push({
            role: 'user',
            content: `DİKKAT: Önceki yanıt tamamlanmamış olabilir. Tek bir kısa, tamamlanmış WhatsApp mesajı üret. Yarım cümle bırakma. Hastanın son mesajı önceliklidir. Eski randevu/arama bağlamını sadece gerekiyorsa yumuşakça an.`
          });

          aiResponse = await executeLLM(retryContextMessages);
          
          const retryCompleteness = this.responsePolicy.validateCompleteness(aiResponse.text, aiResponse.finishReason);
          if (!retryCompleteness.valid) {
            throw new Error(`INCOMPLETE_RETRY_FAILED: ${retryCompleteness.reason}`);
          }
        } else {
          throw e; // throw timeout or other critical errors
        }
      }

      this.log.info(`[LLM_RESPONSE_OK] AI execution completed`, { latencyMs: aiResponse.latencyMs, isRetry, traceId });

      // Phase 6: Emit AI response event
      AIEventEmitter.emit({ tenantId, conversationId, customerId, type: 'ai_response_generated', category: 'pipeline', payload: { latencyMs: aiResponse.latencyMs, model: aiResponse.modelUsed, isRetry } });
    } catch (e: any) {
      if (e.message === "AI_TIMEOUT") {
        this.log.error(`[LLM_TIMEOUT] Execution exceeded 25s limit`, e, { traceId });
        AIEventEmitter.emit({ tenantId, conversationId, customerId, type: 'ai_timeout', category: 'pipeline', severity: 'error', payload: { timeoutMs } });
        AIEventEmitter.logHealth(tenantId, 'timeout', { traceId });
        throw e; // Let QStash retry on timeouts
      }
      if (e.message?.startsWith('INCOMPLETE_RETRY_FAILED') || e.name === 'IncompleteResponseError' || e.message?.startsWith('INCOMPLETE_HEURISTIC')) {
        this.log.error(`[LLM_QUALITY_GATE_FAILED] Retry failed, stopping execution`, e, { traceId });
        qualityGateFailed = true;
        qualityGateReason = e.message;
        // DO NOT THROW. We handle this cleanly so QStash doesn't spam retries.
      } else {
        this.log.error(`[LLM_FAILED] Orchestrator exception`, e, { traceId });
        throw e;
      }
    }

    if (qualityGateFailed) {
      this.log.warn(`[QUALITY_GATE_BLOCKED_FINAL] Cancelling send pipeline.`, { traceId, tenantId });
      
      // Update conversation to human and save metadata, don't overwrite opportunity or summary
      await db.executeSafe({
        text: `
          UPDATE conversations 
          SET status = 'human', 
              metadata = jsonb_set(
                           jsonb_set(
                             jsonb_set(COALESCE(metadata, '{}'::jsonb), '{ai_response_incomplete}', 'true'),
                             '{quality_gate_handled}', 'true'
                           ),
                           '{retry_attempted}', 'true'
                         )
          WHERE phone_number = $1 AND tenant_id = $2
        `,
        values: [phoneNumber, tenantId]
      });

      // Insert internal system note (visible_to_patient: false, send_to_whatsapp: false implicit because direction=system)
      await db.executeSafe({
        text: `
          INSERT INTO messages (tenant_id, phone_number, direction, content, channel, provider_message_id)
          VALUES ($1, $2, 'system', $3, $4, 'system_alert')
        `,
        values: [tenantId, phoneNumber, 'AI yanıtı tamamlanmadı, manuel kontrol gerekli. (Quality Gate Blocked)', channel]
      });

      return; // Exit worker successfully without sending any outbound message
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

    // Format for WhatsApp to translate Markdown (* -> bullets, ** -> *)
    if (channel === 'whatsapp' && finalResponseText) {
      finalResponseText = formatForWhatsApp(finalResponseText);
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
       const err = new Error(`CREDENTIAL_MISSING: No ${channel} credentials for tenant ${tenantId}`);
       if (isAutopilotResponding) {
         await disableAutopilot('error', err.message);
         return;
       }
       throw err;
    }

    let outProviderMessageId: string | null = null;
    let messageStatus = 'pending';
    try {
      if (channel === 'whatsapp') {
        const outRes = await msgService.sendWhatsAppMessage(
          phoneId,
          accessToken,
          phoneNumber,
          finalResponseText,
          outboundCreds.provider
        );
        if (!outRes.success) {
          throw new Error("WhatsApp message sending returned success=false");
        }
        outProviderMessageId = outRes.providerMessageId || null;
      } else {
        const outRes = await msgService.sendSocialMessage(
          accessToken,
          phoneNumber,
          finalResponseText,
          channel
        );
        if (!outRes.success) {
          throw new Error("Social message sending returned success=false");
        }
        outProviderMessageId = outRes.providerMessageId || null;
      }
      messageStatus = 'sent';
      this.log.info(`[SEND_OK] Message delivered to Meta via ${channel}`, { traceId, providerMessageId: outProviderMessageId, credentialSource: outboundCreds.source });
    } catch (e: any) {
       this.log.error(`[SEND_FAILED] Meta API rejection for ${channel}`, e, { traceId });
       if (isAutopilotResponding) {
         await disableAutopilot('error', e.message || String(e));
         
         // Save the failed outgoing message to the DB so the UI shows it failed
         try {
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
             providerMessageId: null,
             status: 'failed'
           });
           
           // Also broadcast to realtime so UI shows the failed message immediately
           if (outMsgResult.messageId) {
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
                 status: 'failed', 
                 created_at: new Date().toISOString()
               },
               { traceId, spanId: traceId }
             );
           }
         } catch (saveErr) {
           this.log.error(`[SAVE_FAILED_MSG_ERROR] Could not save failed message`, saveErr instanceof Error ? saveErr : new Error(String(saveErr)), { traceId });
         }
         return; // Exit cleanly on autopilot error to prevent QStash infinite retry loops
       }
       throw e; // Retry tetikle (non-autopilot/manual message error fallback)
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

    // Consume Bot Directive on successful outbound response
    if (unifiedContext?.active_task?.id && unifiedContext?.active_task?.active_bot_directive) {
      try {
        const { PatientOperationsLifecycleService } = await import('../services/patient-operations-lifecycle');
        const lifecycleService = new PatientOperationsLifecycleService(db);
        await lifecycleService.consumeBotDirective(unifiedContext.active_task.id, tenantId);
        this.log.info(`[BOT_DIRECTIVE_CONSUMED] Directive consumed for task ${unifiedContext.active_task.id}`, { traceId });
      } catch (consumeErr) {
        this.log.error(`[BOT_DIRECTIVE_CONSUME_FAILED] Non-fatal`, consumeErr instanceof Error ? consumeErr : new Error(String(consumeErr)), { traceId });
      }
    }

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

    // 10. CRM Intelligence Extraction (Async & Non-blocking — Feature Flag gated via next/server after)
    after(async () => {
      try {
        const isCrmEnabled = await FeatureFlagService.isEnabled(tenantId, 'crm_extraction', true);
        if (isCrmEnabled) {
          try {
            this.log.info(`[WORKER_CRM] Initiating CRM extraction in background`, { traceId });
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
      const resolvedCountryForConv = crmData?.country || existingConvCountry || null;

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
      let deterministicConfirmation = false;
      
      if (content) {
        try {
          const { detectCancellation, detectConfirmation } = await import('../services/ai/cancellation-detector');
          const detection = detectCancellation(content);
          
          deterministicConfirmation = detectConfirmation(content);
          if (deterministicConfirmation) {
            this.log.info(`[CONFIRMATION_LAYER4] Deterministic confirmation detected`, { traceId, phoneNumber });
          }
          
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
        patientName: crmData?.patient_name || crmData?.requester_name || detectedNewName || undefined,
        country: resolvedCountryForConv,
        department: crmData?.department,
        pipelineStage: effectivePipelineStage,
        tags: crmData?.tags,
        explicitCancellation,
        optOutRequested,
        cancellationReason: cancellationReason || undefined,
        shouldStopFollowUp,
        newIdentityDetected: newIdentityDetected || crmData?.new_identity_detected || false,
      });

      // ═══════════════════════════════════════════════════════════
      // Bot Appointment/Callback Confirmation Context Pre-Calculation (P0)
      // ═══════════════════════════════════════════════════════════
      let isConfirmed = false;
      let activeBotTasks: any[] = [];
      try {
        activeBotTasks = await db.executeSafe({
          text: `SELECT id, metadata, due_at, task_type, title, opportunity_id FROM follow_up_tasks
                 WHERE RIGHT(phone_number, 10) = RIGHT($1, 10) AND tenant_id = $2
                   AND status IN ('pending', 'in_progress')
                   AND task_type != 'appointment_reminder'
                 ORDER BY updated_at DESC`,
          values: [phoneNumber, tenantId]
        }) as any[];

        isConfirmed = !!((crmData as any)?.appointment_confirmed || deterministicConfirmation);
        if (isConfirmed && content) {
          const isGenericShortConfirmation = /^\s*(tamam|olur|uygunum|okey|ok|yes|evet)\s*$/i.test(content);
          if (isGenericShortConfirmation) {
            let hasContextTimeSuggestion = false;

            // Check active tasks for confirm directive
            const hasPendingConfirmDirective = activeBotTasks.some(t => {
              const tMeta = typeof t.metadata === 'string' ? JSON.parse(t.metadata) : (t.metadata || {});
              const ds = tMeta.bot_directive_state;
              return ds && 
                     ['confirm_callback_time', 'confirm_clinic_appointment'].includes(ds.directive_type) &&
                     ['pending', 'waiting_patient'].includes(ds.directive_status);
            });

            if (hasPendingConfirmDirective) {
              hasContextTimeSuggestion = true;
            } else {
              // Check last 3 assistant messages
              const assistantMessages = history
                .filter(m => m.role === 'assistant')
                .slice(-3);
              
              const timeSuggestRegex = /\b(saat|tarih|randevu|arama|uygun|pazartesi|salı|çarşamba|perşembe|cuma|cumartesi|pazar|ocak|şubat|mart|nisan|mayıs|haziran|temmuz|ağustos|eylül|ekim|kasım|aralık)\b|\d{1,2}[:.]\d{2}/i;
              
              for (const msg of assistantMessages) {
                if (timeSuggestRegex.test(msg.content)) {
                  hasContextTimeSuggestion = true;
                  break;
                }
              }
            }

            if (!hasContextTimeSuggestion) {
              this.log.info(`[CONFIRMATION_BYPASSED] Overriding confirmation for generic message "${content}" because no proposed date/time suggestion was found in context.`, { traceId });
              isConfirmed = false;
              if (crmData) {
                crmData.appointment_confirmed = false;
                crmData.time_confirmed_by_patient = false;
              }
            }
          }
        }
      } catch (confirmPreErr) {
        this.log.error('[BOT_CONFIRMATION_PRE_CALC_FAILED] Non-fatal pre-calculation error', confirmPreErr instanceof Error ? confirmPreErr : new Error(String(confirmPreErr)), { traceId });
      }

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

          // ═══ P1A-FIX3: Opp country priority — CRM > existingOpp > conv ═══
          const existingOppCountry = beforeOpp?.country || null;
          const resolvedCountryForOpp = crmData.country || existingOppCountry || existingConvCountry || null;

          // ═══ P1B: Non-Aggressive Boundary Detection ═══
          // Country correction = update existing, NOT new opp
          // Only strong signals trigger new opportunity:
          const isDifferentDepartment = !!(beforeOpp && crmData.department && 
            beforeOpp.department && crmData.department.toLowerCase() !== beforeOpp.department.toLowerCase());
          
          // Merge deterministic + LLM signals
          const effectiveNewIdentity = newIdentityDetected || crmData?.new_identity_detected || false;
          const effectiveReset = resetConversationRequested || crmData?.reset_conversation_requested || false;
          const effectiveDiffDept = isDifferentDepartment || crmData?.different_department_detected || false;
          
          const shouldCloseAndCreateNew = beforeOpp && (
            effectiveReset ||
            (effectiveNewIdentity && effectiveDiffDept) ||
            (newTreatmentInterest && effectiveDiffDept) ||
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
              // P1B boundary signals
              shouldCloseAndCreateNew,
              isDifferentDepartment,
              effectiveDiffDept,
              effectiveNewIdentity,
              effectiveReset,
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

            // Cancel tasks on superseded opportunity
            try {
              const { PatientOperationsLifecycleService } = await import('../services/patient-operations-lifecycle');
              const lifecycleService = new PatientOperationsLifecycleService(db);
              const cancelled = await lifecycleService.cancelTasksForOpp(beforeOpp.id, tenantId, 'superseded_by_new_opportunity');
              this.log.info(`[OPP_SUPERSEDED_TASK_CANCEL] Cancelled ${cancelled} tasks for old opportunity`, {
                oldOppId: beforeOpp.id, tenantId
              });
            } catch (taskErr) {
              this.log.error(`[OPP_SUPERSEDED_TASK_CANCEL_FAIL] Non-fatal`, taskErr instanceof Error ? taskErr : new Error(String(taskErr)));
            }

            // Force create new opportunity (bypass existing check)
            const newOppCrmData = { ...crmData, should_create_opportunity: true };
            // Use new country for the new opp
            const newOppCountry = crmData.country || undefined;
            const newOppId = await oppService.upsertFromCrm({
              tenantId, conversationId, phoneNumber, channel,
              patientName: detectedNewName || crmData.patient_name || crmData.requester_name || undefined,
              crmData: newOppCrmData, lastCustomerMessageAt: new Date().toISOString(),
              traceId, externalCountry: newOppCountry,
              newIdentityDetected: newIdentityDetected || crmData?.new_identity_detected || false
            });
            
            if (newOppId) {
              this.log.info(`[OPP_CLOSE_AND_CREATE_OK] Old closed, new created`, {
                traceId, closedOppId: beforeOpp.id, newOppId, newDept: crmData.department, newCountry: crmData.country
              });
              
              // P1B: Set active_opportunity_id
              try {
                const { ActiveOpportunityResolver } = await import('../services/active-opportunity-resolver');
                const resolver = new ActiveOpportunityResolver(db);
                await resolver.setActive(tenantId, conversationId, newOppId);
              } catch (setErr) {
                this.log.error(`[P1B_SET_ACTIVE] Non-fatal`, setErr instanceof Error ? setErr : new Error(String(setErr)), { traceId });
              }
              
              // P1B: Update identity fields + raw_department
              try {
                await db.executeSafe({
                  text: `UPDATE opportunities SET
                           requester_name = COALESCE(NULLIF($1, ''), requester_name),
                           patient_relation = COALESCE(NULLIF($2, ''), patient_relation),
                           metadata = metadata || $3::jsonb,
                           summary = COALESCE(NULLIF($4, ''), summary)
                         WHERE id = $5 AND tenant_id = $6`,
                  values: [
                    crmData.requester_name || detectedNewName || '',
                    crmData.patient_relation || '',
                    JSON.stringify({ raw_department: crmData.raw_department || crmData.department || null }),
                    crmData.opportunity_reason || '',
                    newOppId, tenantId
                  ]
                });
              } catch (_) { /* non-fatal */ }
              
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
                patientName: crmData.patient_name || crmData.requester_name || detectedNewName || undefined,
                crmData, lastCustomerMessageAt: new Date().toISOString(),
                traceId, externalCountry: resolvedCountryForOpp,
                newIdentityDetected: newIdentityDetected || crmData?.new_identity_detected || false
              });
              if (oppId) {
                this.log.info(`[WORKER_OPP_OK] Opportunity upserted`, { traceId, oppId });
                
                // P1B: Set active_opportunity_id (always — ensures consistency)
                try {
                  const { ActiveOpportunityResolver } = await import('../services/active-opportunity-resolver');
                  const resolver = new ActiveOpportunityResolver(db);
                  await resolver.setActive(tenantId, conversationId, oppId);
                } catch (setErr) {
                  this.log.error(`[P1B_SET_ACTIVE] Non-fatal`, setErr instanceof Error ? setErr : new Error(String(setErr)), { traceId });
                }
                
                // P1B: Update identity fields + raw_department + opp-specific summary
                try {
                  await db.executeSafe({
                    text: `UPDATE opportunities SET
                             requester_name = COALESCE(NULLIF($1, ''), requester_name),
                             patient_relation = COALESCE(NULLIF($2, ''), patient_relation),
                             metadata = metadata || $3::jsonb,
                             summary = COALESCE(NULLIF($4, ''), summary)
                           WHERE id = $5 AND tenant_id = $6`,
                    values: [
                      crmData.requester_name || crmData.patient_name || '',
                      crmData.patient_relation || '',
                      JSON.stringify({ raw_department: crmData.raw_department || crmData.department || null }),
                      crmData.opportunity_reason || '',
                      oppId, tenantId
                    ]
                  });
                } catch (_) { /* non-fatal */ }
                
                // ═══ P1A-FIX5B: Mirror new opp stage to conversation ═══
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

          // ═══ PHASE 2K-P1.1: Aggregated task + notification (single dispatch) ═══
          if (afterOpp?.id && crmData) {
            try {
              const { TaskService } = await import('../services/task.service');
              const { NotificationService } = await import('../services/notification.service');
              const { SignalAggregator } = await import('../services/signal-aggregator');
              const taskService = new TaskService(db);
              const notifService = new NotificationService(db);

              // Prevent duplicate task by cloning crmData and deleting requested_callback_datetime if confirmed
              const crmDataForTaskGeneration = { ...crmData };
              if (isConfirmed) {
                delete crmDataForTaskGeneration.requested_callback_datetime;
              }

              // 1. Generate aggregated task (internally uses SignalAggregator + group-based dedup)
              const taskIds = await taskService.generateFromCrm({
                tenantId,
                opportunityId: afterOpp.id,
                phoneNumber,
                conversationId,
                crmData: crmDataForTaskGeneration,
                patientName: crmDataForTaskGeneration.patient_name,
              });
              if (taskIds.length > 0) {
                this.log.info(`[TASK_AGGREGATED] Created/merged ${taskIds.length} tasks`, { traceId, oppId: afterOpp.id, taskIds });
              }
              // 2. Single aggregated notification dispatch
              const aggregator = new SignalAggregator();
              const aggregated = aggregator.aggregate(crmDataForTaskGeneration, {
                patientName: crmDataForTaskGeneration.patient_name,
                phoneNumber,
                department: crmDataForTaskGeneration.department,
                country: crmDataForTaskGeneration.country,
              });

              if (aggregated) {
                await notifService.send({
                  tenantId,
                  category: aggregated.primaryNotifCategory,
                  title: aggregated.notifTitle,
                  body: aggregated.notifBody,
                  priority: aggregated.priority,
                  opportunityId: afterOpp.id,
                  conversationId,
                  phoneNumber,
                  metadata: aggregated.metadata,
                });
                this.log.info(`[NOTIF_AGGREGATED] Sent single notification`, {
                  traceId,
                  category: aggregated.primaryNotifCategory,
                  signals: aggregated.signals,
                  mergedCount: aggregated.signals.length,
                });
              }

              // 3. Bot Date Rescheduling Suggestion (HITL Triage Interception)
              try {
                const activeBotTasks = await db.executeSafe({
                  text: `SELECT id, metadata FROM follow_up_tasks
                         WHERE RIGHT(phone_number, 10) = RIGHT($1, 10) AND tenant_id = $2
                           AND status IN ('pending', 'in_progress')
                           AND task_type != 'appointment_reminder'
                         ORDER BY updated_at DESC LIMIT 1`,
                  values: [phoneNumber, tenantId]
                }) as any[];

                if (activeBotTasks.length > 0) {
                  const targetTask = activeBotTasks[0];
                  const taskMeta = typeof targetTask.metadata === 'string' 
                    ? JSON.parse(targetTask.metadata) 
                    : (targetTask.metadata || {});

                  // Resolve safe previousSuggestedDate
                  let prevSuggestedDate: string | null = null;
                  if (taskMeta.bot_suggestion?.suggested_date) {
                    prevSuggestedDate = taskMeta.bot_suggestion.suggested_date;
                  } else if (taskMeta.bot_directive_state?.suggested_date) {
                    prevSuggestedDate = taskMeta.bot_directive_state.suggested_date;
                  } else if (taskMeta.last_offered_callback_date) {
                    prevSuggestedDate = taskMeta.last_offered_callback_date;
                  } else if (taskMeta.time_confirmed_by_patient === true && taskMeta.scheduled_for_utc) {
                    prevSuggestedDate = taskMeta.scheduled_for_utc.split('T')[0];
                  }

                  // Get last assistant message
                  const assistantMessages = history.filter(m => m.role === 'assistant').slice(-1);
                  const lastAssMsg = assistantMessages[0]?.content || null;

                  // Parse patient message deterministically
                  const { parseDeterministicSuggestion } = await import('../utils/date-parser');
                  const parsedSugg = parseDeterministicSuggestion(content || '', new Date(), prevSuggestedDate, lastAssMsg);

                  // If deterministic parser did not extract suggested_time, but LLM extracted requested_callback_datetime,
                  // we use the LLM extracted value as a fallback, as long as it's not midnight 00:00 (unless patient explicitly said 00:00).
                  if (!parsedSugg.suggested_time && crmData?.requested_callback_datetime) {
                    const dt = new Date(crmData.requested_callback_datetime);
                    if (!isNaN(dt.getTime())) {
                      const trHourStr = dt.toLocaleTimeString('tr-TR', { timeZone: 'Europe/Istanbul', hour: '2-digit', minute: '2-digit', hour12: false });
                      if (trHourStr !== '00:00' || /00:00|gece\s*(yarı|0)/i.test(content || '')) {
                        parsedSugg.suggested_time = trHourStr;
                        parsedSugg.suggested_date = crmData.requested_callback_datetime.split('T')[0];
                        parsedSugg.proposed_date = crmData.requested_callback_datetime;
                        
                        const [hh, mm] = trHourStr.split(':').map(Number);
                        parsedSugg.operation_window_valid = (hh * 60 + mm >= 9 * 60 && hh * 60 + mm <= 21 * 60);
                      }
                    }
                  }

                  // If we found a suggestion (time is extracted), save it
                  if (parsedSugg.suggested_time) {
                    // Strict validation: if suggested_date is null, proposed_date is null
                    if (!parsedSugg.suggested_date) {
                      parsedSugg.proposed_date = null;
                      parsedSugg.needs_date_clarification = true;
                    }

                    taskMeta.bot_suggestion = {
                      bot_suggestion_type: 'callback_time',
                      suggested_date: parsedSugg.suggested_date,
                      suggested_time: parsedSugg.suggested_time,
                      suggested_timezone_basis: parsedSugg.suggested_timezone_basis,
                      needs_date_clarification: parsedSugg.needs_date_clarification,
                      needs_timezone_clarification: parsedSugg.needs_timezone_clarification,
                      source_message_text: content || '',
                      source_message_id: null,
                      extraction_confidence: 'high',
                      proposed_date: parsedSugg.proposed_date, // Combined date & time ISO string or null
                      status: 'pending',
                      detected_at: new Date().toISOString(),
                      user_message: content || '',
                      operation_window_valid: parsedSugg.operation_window_valid
                    };

                    await db.executeSafe({
                      text: `UPDATE follow_up_tasks 
                             SET metadata = $1::jsonb, updated_at = NOW() 
                             WHERE id = $2 AND tenant_id = $3`,
                      values: [JSON.stringify(taskMeta), targetTask.id, tenantId]
                    });

                    this.log.info(`[BOT_TRIAGE_SUGGESTION_CAPTURED] Saved deterministic proposed suggestion to task ${targetTask.id}`, { 
                      traceId, 
                      suggested_date: parsedSugg.suggested_date,
                      suggested_time: parsedSugg.suggested_time,
                      proposed_date: parsedSugg.proposed_date 
                    });
                  }
                }
              } catch (triageErr) {
                this.log.error('[BOT_TRIAGE_SUGGESTION_FAILED] Non-fatal triage suggestion error', triageErr instanceof Error ? triageErr : new Error(String(triageErr)), { traceId });
              }

            } catch (taskErr) {
              this.log.error('[PHASE_2K_TASK_GEN] Non-fatal task/notification error', taskErr instanceof Error ? taskErr : new Error(String(taskErr)), { traceId });
            }
          }

        } catch (oppErr) {
          this.log.error(`[WORKER_OPP_FAILED] Non-fatal opportunity error`, oppErr instanceof Error ? oppErr : new Error(String(oppErr)), { traceId });
        }
      }

      // ═══════════════════════════════════════════════════════════
      // Bot Appointment/Callback Confirmation Auto-Detection (P0)
      // Already handled during top-level pre-calculation block to avoid double-writes
      // and ensure correct FSM directive transitions.
      // ═══════════════════════════════════════════════════════════

      // ═══════════════════════════════════════════════════════════
      // Bot Directive Completion Hook (Phase 2 & 5)
      // ═══════════════════════════════════════════════════════════
      if (conversationId) {
        try {
          const activeTasks = await db.executeSafe({
            text: `SELECT id, metadata FROM follow_up_tasks
                   WHERE conversation_id = $1 AND tenant_id = $2
                     AND status IN ('pending', 'in_progress')
                   ORDER BY created_at DESC`,
            values: [conversationId, tenantId]
          }) as any[];

          const { PatientOperationsLifecycleService } = await import('../services/patient-operations-lifecycle');
          const lifecycleService = new PatientOperationsLifecycleService(db);

          for (const targetTask of activeTasks) {
            const taskMeta = targetTask.metadata || {};
            const directiveState = taskMeta.bot_directive_state;
            if (directiveState && ['pending', 'waiting_patient'].includes(directiveState.directive_status)) {
              const directiveType = directiveState.directive_type;
              let resolvedResult: 'confirmed' | 'declined' | null = null;

              if (crmData?.explicit_cancellation || crmData?.should_stop_follow_up) {
                resolvedResult = 'declined';
              } else if (directiveType === 'ask_callback_time' && crmData?.requested_callback_datetime) {
                resolvedResult = 'confirmed';
              } else if (directiveType === 'confirm_callback_time' && (crmData?.time_confirmed_by_patient || crmData?.appointment_confirmed || isConfirmed)) {
                resolvedResult = 'confirmed';
              } else if (directiveType === 'request_documents' && (crmData?.report_status === 'sent' || crmData?.report_status === 'received' || ['document', 'image', 'video'].includes(mediaType || ''))) {
                resolvedResult = 'confirmed';
              }

              if (resolvedResult) {
                this.log.info(`[BOT_DIRECTIVE_COMPLETED] Completing directive ${directiveType} on task ${targetTask.id} with result: ${resolvedResult}`, { traceId });
                await lifecycleService.completeBotDirective(targetTask.id, tenantId, resolvedResult);
              }
            }
          }
        } catch (directiveErr) {
          this.log.error('[BOT_DIRECTIVE_COMPLETION_FAILED] Non-fatal directive completion error', directiveErr instanceof Error ? directiveErr : new Error(String(directiveErr)), { traceId });
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
      } catch (backgroundErr) {
        this.log.error(`[BACKGROUND_TASK_ERROR] Critical background pipeline failed`, backgroundErr instanceof Error ? backgroundErr : new Error(String(backgroundErr)), { traceId });
      }
    });

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
