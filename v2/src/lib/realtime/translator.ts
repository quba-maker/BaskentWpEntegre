import { v4 as uuidv4 } from "uuid";
import { ChatMessageCreatedEvent, ChatMessageStatusUpdatedEvent, ConversationMemoryUpdatedEvent, ConversationAutopilotUpdatedEvent } from "./contracts";

/**
 * Internal message payload from DB/worker.
 * This replaces all `any` usage in the realtime pipeline.
 */
export interface InternalMessagePayload {
  id: string;
  conversation_id?: string;
  phone_number?: string;
  content: string;
  direction: "in" | "out" | "system";
  status?: string;
  model_used?: string;
  created_at: string; // ISO date string
  // Media fields
  media_type?: string;    // 'image' | 'document' | 'audio' | 'video' | 'location' | 'sticker'
  media_url?: string;     // Vercel Blob permanent URL
  media_metadata?: Record<string, any>;  // { filename, mime_type, caption, ... }
  provider_message_id?: string;
}

interface TraceContext {
  traceId: string;
  spanId: string;
  parentSpanId?: string;
}

/**
 * Event Translator Layer
 * Converts internal domain entities (e.g. DB Row) into Public Realtime Projections.
 */
export class RealtimeTranslator {
  /**
   * Translates an internal database message into a projection event.
   */
  static toMessageCreated(
    tenantId: string, 
    internalMessage: InternalMessagePayload, 
    traceContext: TraceContext
  ): ChatMessageCreatedEvent {
    
    // Convert logic (e.g. sender identification)
    let senderType: "agent" | "bot" | "user" | "system" = "user";
    if (internalMessage.direction === "out") {
      senderType = internalMessage.model_used ? "bot" : "agent";
    } else if (internalMessage.direction === "system") {
      senderType = "system";
    }

    return {
      eventId: uuidv4(),
      traceId: traceContext.traceId,
      spanId: traceContext.spanId,
      parentSpanId: traceContext.parentSpanId,
      timestamp: Date.now() * 1000, // microsecond simulation
      entityVersion: 1, // Simplified for v1
      eventVersion: "1.0",
      schemaVersion: "1.0",
      tenantId,
      type: "chat.message.created",
      payload: {
        id: String(internalMessage.id),
        // Frontend uses phone_number as activePhone for ["messages", activePhone] query key!
        conversationId: String(internalMessage.phone_number || internalMessage.conversation_id || ""),
        content: internalMessage.content,
        sender: senderType,
        status: (internalMessage.status as "sent" | "delivered" | "read" | "failed") || undefined,
        createdAt: new Date(internalMessage.created_at).toISOString(),
        // Media fields
        mediaType: internalMessage.media_type,
        mediaUrl: internalMessage.media_url,
        mediaMetadata: internalMessage.media_metadata,
        providerMessageId: internalMessage.provider_message_id,
      }
    };
  }

  static toMessageStatusUpdated(
    tenantId: string, 
    messageId: string, 
    conversationId: string, 
    status: "sent" | "delivered" | "read" | "failed",
    entityVersion: number,
    traceContext: TraceContext
  ): ChatMessageStatusUpdatedEvent {
    
    return {
      eventId: uuidv4(),
      traceId: traceContext.traceId,
      spanId: traceContext.spanId,
      parentSpanId: traceContext.parentSpanId,
      timestamp: Date.now() * 1000,
      entityVersion, 
      eventVersion: "1.0",
      schemaVersion: "1.0",
      tenantId,
      type: "chat.message.status_updated",
      payload: {
        id: String(messageId),
        conversationId: String(conversationId),
        status,
        updatedAt: new Date().toISOString()
      }
    };
  }

  static toMemoryUpdated(
    tenantId: string,
    conversationId: string,
    memoryPayload: {
      aiSummary: string;
      aiBuyingIntent?: "HOT" | "WARM" | "COLD";
      aiSentiment?: "POSITIVE" | "NEUTRAL" | "NEGATIVE";
      objections?: string[];
    },
    traceContext: TraceContext
  ): ConversationMemoryUpdatedEvent {
    return {
      eventId: uuidv4(),
      traceId: traceContext.traceId,
      spanId: traceContext.spanId,
      parentSpanId: traceContext.parentSpanId,
      timestamp: Date.now() * 1000,
      entityVersion: 1,
      eventVersion: "1.0",
      schemaVersion: "1.0",
      tenantId,
      type: "conversation.memory_updated",
      payload: {
        conversationId,
        aiSummary: memoryPayload.aiSummary,
        aiBuyingIntent: memoryPayload.aiBuyingIntent,
        aiSentiment: memoryPayload.aiSentiment,
        objections: memoryPayload.objections
      }
    };
  }

  static toAutopilotUpdated(
    tenantId: string,
    conversationId: string,
    phone: string,
    channelId: string | null,
    enabled: boolean,
    status: "bot" | "human" | "open",
    traceContext: TraceContext
  ): ConversationAutopilotUpdatedEvent {
    return {
      eventId: uuidv4(),
      traceId: traceContext.traceId,
      spanId: traceContext.spanId,
      parentSpanId: traceContext.parentSpanId,
      timestamp: Date.now() * 1000,
      entityVersion: 1,
      eventVersion: "1.0",
      schemaVersion: "1.0",
      tenantId,
      type: "conversation.autopilot_updated",
      payload: {
        conversationId,
        phone,
        channelId,
        enabled,
        status
      }
    };
  }
}
