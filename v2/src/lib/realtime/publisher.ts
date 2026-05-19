import { RealtimeTranslator } from "./translator";
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
    internalMessage: any,
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
}
