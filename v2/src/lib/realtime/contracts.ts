import { z } from "zod";

// --- Base Realtime Event Schema ---
// Defines the strict envelope for all messages passing through Ably
// SECURITY: No .passthrough() — unknown top-level fields are dropped during parse.
// `payload` is declared here so it survives the parse step.
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
    "conversation.memory_updated",
    "conversation.autopilot_updated",
    "ai.stream.delta",
    "ai.stream.completed"
  ]),
  
  // Payload envelope — base accepts any record, specific schemas refine it
  payload: z.record(z.string(), z.any()),
});

// --- Specific Projection Payloads ---
// Frontend ONLY sees these, never internal DB structures.

export const ChatMessageProjectionSchema = z.object({
  id: z.string(),
  conversationId: z.string(),
  content: z.string(),
  sender: z.enum(["agent", "bot", "user"]),
  status: z.enum(["sent", "delivered", "read", "failed"]).optional(),
  createdAt: z.string(), // ISO Date string
  // Media fields
  mediaType: z.string().optional(),
  mediaUrl: z.string().optional(),
  mediaMetadata: z.record(z.string(), z.any()).optional(),
});

export const ChatMessageStatusProjectionSchema = z.object({
  id: z.string(),
  conversationId: z.string(),
  status: z.enum(["sent", "delivered", "read", "failed"]),
  updatedAt: z.string()
});

export const ConversationMemoryProjectionSchema = z.object({
  conversationId: z.string(),
  aiSummary: z.string(),
  aiBuyingIntent: z.enum(["HOT", "WARM", "COLD"]).optional(),
  aiSentiment: z.enum(["POSITIVE", "NEUTRAL", "NEGATIVE"]).optional(),
  objections: z.array(z.string()).optional()
});

export const ConversationAutopilotProjectionSchema = z.object({
  conversationId: z.string(),
  phone: z.string(),
  channelId: z.string().nullable().optional(),
  enabled: z.boolean(),
  status: z.enum(["bot", "human", "open"])
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

export const ConversationMemoryUpdatedEventSchema = BaseRealtimeEventSchema.extend({
  type: z.literal("conversation.memory_updated"),
  payload: ConversationMemoryProjectionSchema
});

export const ConversationAutopilotUpdatedEventSchema = BaseRealtimeEventSchema.extend({
  type: z.literal("conversation.autopilot_updated"),
  payload: ConversationAutopilotProjectionSchema
});

export type RealtimeEventBase = z.infer<typeof BaseRealtimeEventSchema>;
export type ChatMessageCreatedEvent = z.infer<typeof ChatMessageCreatedEventSchema>;
export type ChatMessageStatusUpdatedEvent = z.infer<typeof ChatMessageStatusUpdatedEventSchema>;
export type ConversationMemoryUpdatedEvent = z.infer<typeof ConversationMemoryUpdatedEventSchema>;
export type ConversationAutopilotUpdatedEvent = z.infer<typeof ConversationAutopilotUpdatedEventSchema>;

// Union of all supported projection events
export type ProjectionEvent = 
  | ChatMessageCreatedEvent 
  | ChatMessageStatusUpdatedEvent
  | ConversationMemoryUpdatedEvent
  | ConversationAutopilotUpdatedEvent;
