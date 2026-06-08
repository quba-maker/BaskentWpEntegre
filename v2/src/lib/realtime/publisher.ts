import { RealtimeTranslator, InternalMessagePayload } from "./translator";
import { RealtimeBus } from "./bus";
import { v4 as uuidv4 } from "uuid";

/**
 * Realtime Projection Publisher
 * 
 * Orchestrates the conversion of Internal Domain Events to Public Projections
 * and pushes them to the Realtime Bus.
 * Business logic / Workers should ONLY call this layer, NEVER Ably directly.
 */
export class RealtimePublisher {
  
  /**
   * Translates and publishes a new chat message to the realtime bus.
   */
  static async publishMessageCreated(
    tenantId: string,
    internalMessage: InternalMessagePayload,
    traceContext?: { traceId: string; spanId: string; parentSpanId?: string }
  ) {
    // Generate trace context if not provided (fallback)
    const context = traceContext || {
      traceId: uuidv4(),
      spanId: uuidv4()
    };

    // 1. Translate Domain Entity -> Projection Event
    const event = RealtimeTranslator.toMessageCreated(tenantId, internalMessage, context);

    // 2. Publish via Bus Abstraction
    await RealtimeBus.publish(tenantId, event);
  }

  /**
   * Translates and publishes a message status update.
   */
  static async publishMessageStatusUpdated(
    tenantId: string,
    messageId: string,
    conversationId: string,
    status: "sent" | "delivered" | "read" | "failed",
    entityVersion: number,
    traceContext?: { traceId: string; spanId: string; parentSpanId?: string }
  ) {
    const context = traceContext || {
      traceId: uuidv4(),
      spanId: uuidv4()
    };

    const event = RealtimeTranslator.toMessageStatusUpdated(
      tenantId, 
      messageId, 
      conversationId, 
      status, 
      entityVersion, 
      context
    );

    await RealtimeBus.publish(tenantId, event);
  }

  /**
   * Translates and publishes a conversation memory / AI summary update.
   */
  static async publishMemoryUpdated(
    tenantId: string,
    conversationId: string,
    memoryPayload: {
      aiSummary: string;
      aiBuyingIntent?: "HOT" | "WARM" | "COLD";
      aiSentiment?: "POSITIVE" | "NEUTRAL" | "NEGATIVE";
      objections?: string[];
    },
    traceContext?: { traceId: string; spanId: string; parentSpanId?: string }
  ) {
    const context = traceContext || {
      traceId: uuidv4(),
      spanId: uuidv4()
    };

    const event = RealtimeTranslator.toMemoryUpdated(
      tenantId, 
      conversationId, 
      memoryPayload, 
      context
    );

    await RealtimeBus.publish(tenantId, event);
  }

  /**
   * Translates and publishes conversation metadata updates.
   */
  static async publishMetadataUpdated(
    tenantId: string,
    payload: {
      conversationId: string;
      userId?: string;
      unreadCount?: number;
      isPinned?: boolean;
      isFavorite?: boolean;
      isArchived?: boolean;
      isBotActive?: boolean;
      status?: "bot" | "human" | "open";
      lastMessageContent?: string;
      lastMessageDirection?: "in" | "out" | "system";
      lastMessageStatus?: "sent" | "delivered" | "read" | "failed";
      lastMessageAt?: string;
    },
    traceContext?: { traceId: string; spanId: string; parentSpanId?: string }
  ) {
    const context = traceContext || {
      traceId: uuidv4(),
      spanId: uuidv4()
    };

    console.log(`[REALTIME_PUBLISH_TRACE] publishMetadataUpdated | tenantId=${tenantId} | payload=${JSON.stringify(payload)}`);

    const event = RealtimeTranslator.toMetadataUpdated(
      tenantId,
      payload,
      context
    );

    await RealtimeBus.publish(tenantId, event);
  }
}
