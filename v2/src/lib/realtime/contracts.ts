import { z } from "zod";

// --- Base Realtime Event Schema ---
// Defines the strict envelope for all messages passing through Ably
export const BaseRealtimeEventSchema = z.object({
  eventId: z.string().uuid(), // Unique ID for idempotency checks
  
  // Observability & Tracing
  traceId: z.string(), 
  spanId: z.string(),
  parentSpanId: z.string().optional(),
  
  // Causal Ordering & State Protection
  timestamp: z.number(), // Microsecond precision
  entityVersion: z.number(), // Entity sequence for race condition prevention
  
  // Versioning
  eventVersion: z.literal("1.0"),
  schemaVersion: z.literal("1.0"),

  tenantId: z.string(),
  type: z.enum([
    "chat.message.created",
    "chat.message.status_updated",
    "ai.stream.delta",
    "ai.stream.completed"
  ]),
});

// --- Specific Projection Payloads ---
// Frontend ONLY sees these, never internal DB structures.

export const ChatMessageProjectionSchema = z.object({
  id: z.string(),
  conversationId: z.string(),
  content: z.string(),
  sender: z.enum(["agent", "bot", "user"]),
  status: z.enum(["sent", "delivered", "read", "failed"]).optional(),
  createdAt: z.string() // ISO Date string
});

export const ChatMessageStatusProjectionSchema = z.object({
  id: z.string(),
  conversationId: z.string(),
  status: z.enum(["sent", "delivered", "read", "failed"]),
  updatedAt: z.string()
});

// --- Final Event Types ---

export const ChatMessageCreatedEventSchema = BaseRealtimeEventSchema.extend({
  type: z.literal("chat.message.created"),
  payload: ChatMessageProjectionSchema
});

export const ChatMessageStatusUpdatedEventSchema = BaseRealtimeEventSchema.extend({
  type: z.literal("chat.message.status_updated"),
  payload: ChatMessageStatusProjectionSchema
});

export type RealtimeEventBase = z.infer<typeof BaseRealtimeEventSchema>;
export type ChatMessageCreatedEvent = z.infer<typeof ChatMessageCreatedEventSchema>;
export type ChatMessageStatusUpdatedEvent = z.infer<typeof ChatMessageStatusUpdatedEventSchema>;

// Union of all supported projection events
export type ProjectionEvent = ChatMessageCreatedEvent | ChatMessageStatusUpdatedEvent;
