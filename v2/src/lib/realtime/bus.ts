import * as Ably from "ably";
import { ProjectionEvent, BaseRealtimeEventSchema } from "./contracts";

/**
 * Realtime Bus Infrastructure Adapter
 * 
 * SECURITY HARDENING (Phase 7):
 * 1. Strict schema validation at publish edge
 * 2. Payload size enforcement (anti-abuse)
 * 3. Channel namespace normalization (anti-injection)
 * 4. Production-safe logging (no verbose output)
 */

const MAX_PAYLOAD_SIZE = 16_384; // 16KB — Ably limit is 64KB, we enforce tighter

export class RealtimeBus {
  private static instance: Ably.Rest;

  private static getClient(): Ably.Rest | null {
    if (!this.instance) {
      const apiKey = process.env.ABLY_API_KEY;
      if (!apiKey) {
        console.warn("[RealtimeBus] ABLY_API_KEY is not configured. Realtime publisher will skip Ably broadcast.");
        return null;
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
      // ─── 1. Strict Schema Validation at the Edge ───
      const validatedEvent = BaseRealtimeEventSchema.parse(event);

      // ─── 2. Payload Size Enforcement ───
      const serialized = JSON.stringify(event);
      if (serialized.length > MAX_PAYLOAD_SIZE) {
        throw new Error(
          `[RealtimeBus] Payload too large: ${serialized.length} bytes (max: ${MAX_PAYLOAD_SIZE})`
        );
      }

      // ─── 3. Channel Namespace Normalization ───
      // Prevent injection via tenantId — only UUID format allowed
      if (!/^[a-f0-9-]{36}$/i.test(tenantId)) {
        throw new Error(`[RealtimeBus] Invalid tenantId format: ${tenantId}`);
      }

      const channelName = `private:tenant:${tenantId}`;
      const client = this.getClient();
      if (!client) {
        return;
      }
      const channel = client.channels.get(channelName);
      
      await channel.publish(validatedEvent.type, event);
      
    } catch (error) {
      console.error("[RealtimeBus] Publish Error:", error);
      // In a robust DLQ architecture, failed publishes should be routed to a retry queue
      throw error;
    }
  }
}
