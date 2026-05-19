import * as Ably from "ably";
import { ProjectionEvent, BaseRealtimeEventSchema } from "./contracts";

/**
 * Realtime Bus Infrastructure Adapter
 * 
 * Abstraction layer over Ably (or any future Pub/Sub like NATS/Kafka).
 * Ensures business logic never interacts directly with transport SDKs.
 */
export class RealtimeBus {
  private static instance: Ably.Rest;

  private static getClient(): Ably.Rest {
    if (!this.instance) {
      const apiKey = process.env.ABLY_API_KEY;
      if (!apiKey) {
        console.warn("ABLY_API_KEY is not set. RealtimeBus will fail silently or throw in prod.");
      }
      this.instance = new Ably.Rest({ key: apiKey });
    }
    return this.instance;
  }

  /**
   * Publishes a fully formed Projection Event to a specific tenant's private channel.
   * This should ONLY be called by the Projection Publisher.
   */
  static async publish(tenantId: string, event: ProjectionEvent): Promise<void> {
    try {
      // 1. Strict Validation at the Edge
      // Prevent any malformed events from entering the realtime system
      const validatedEvent = BaseRealtimeEventSchema.parse(event);
      
      const channelName = `private:tenant:${tenantId}`;
      const channel = this.getClient().channels.get(channelName);
      
      console.log(`[PUBLISH_TRIGGERED] Preparing to publish ${event.type} to ${channelName} [Trace: ${event.traceId}]`);
      
      await channel.publish(validatedEvent.type, event);
      
      console.log(`[ABLY_PUBLISHED] Successfully published ${event.type} to ${channelName} [Trace: ${event.traceId}]`);
      
    } catch (error) {
      console.error("[RealtimeBus] Publish Error:", error);
      // Sentry capture placeholder
      // In a robust DLQ architecture, failed publishes should be routed to a retry queue
      throw error;
    }
  }
}
