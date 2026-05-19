import { v4 as uuidv4 } from "uuid";
import { ChatMessageCreatedEvent, ChatMessageStatusUpdatedEvent } from "./contracts";

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
    internalMessage: any, 
    traceContext: { traceId: string; spanId: string; parentSpanId?: string }
  ): ChatMessageCreatedEvent {
    
    // Convert logic (e.g. sender identification)
    let senderType: "agent" | "bot" | "user" = "user";
    if (internalMessage.direction === "out") {
      senderType = internalMessage.model_used ? "bot" : "agent";
    } else if (internalMessage.direction === "system") {
      senderType = "bot";
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
        conversationId: String(internalMessage.phone_number || internalMessage.conversation_id),
        content: internalMessage.content,
        sender: senderType,
        status: internalMessage.status,
        createdAt: new Date(internalMessage.created_at).toISOString()
      }
    };
  }

  static toMessageStatusUpdated(
    tenantId: string, 
    messageId: string, 
    conversationId: string, 
    status: "sent" | "delivered" | "read" | "failed",
    entityVersion: number,
    traceContext: { traceId: string; spanId: string; parentSpanId?: string }
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
}
