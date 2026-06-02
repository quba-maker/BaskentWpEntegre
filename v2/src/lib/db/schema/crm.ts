import { pgTable, text, timestamp, uuid, integer, numeric, jsonb, boolean } from 'drizzle-orm/pg-core';
import { tenants, users } from './tenants';
import { channels } from './channels';

export const customerProfiles = pgTable('customer_profiles', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').references(() => tenants.id, { onDelete: 'cascade' }).notNull(),
  primaryPhone: text('primary_phone').notNull(),
  primaryEmail: text('primary_email'),
  firstName: text('first_name'),
  lastName: text('last_name'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
});

export const leads = pgTable('leads', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').references(() => tenants.id, { onDelete: 'cascade' }).notNull(),
  customerId: uuid('customer_id').references(() => customerProfiles.id, { onDelete: 'set null' }),
  channelId: uuid('channel_id').references(() => channels.id, { onDelete: 'set null' }),
  phoneNumber: text('phone_number').notNull(),
  department: text('department'),
  message: text('message'),
  source: text('source'), // e.g. 'google_sheets'
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
});

export const conversations = pgTable('conversations', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').references(() => tenants.id, { onDelete: 'cascade' }).notNull(),
  customerId: uuid('customer_id').references(() => customerProfiles.id, { onDelete: 'set null' }),
  channelId: uuid('channel_id').references(() => channels.id, { onDelete: 'set null' }),
  /** @deprecated channel is deprecated and replaced by channelId. Do not use for new features. */
  channel: text('channel'),
  /** @deprecated phoneNumber is deprecated for legacy direct lookup; routing is handled via customerProfiles and channelId. */
  phoneNumber: text('phone_number'),
  status: text('status').default('open'),
  
  // Backward Compatibility Fields
  patientName: text('patient_name'),
  department: text('department'),
  country: text('country'),
  leadStage: text('lead_stage'),
  phase: text('phase'),
  tags: text('tags'),
  notes: text('notes'),
  leadScore: integer('lead_score'),
  temperature: integer('temperature'),
  lastMessageContent: text('last_message_content'),
  lastMessageStatus: text('last_message_status'),
  lastMessageDirection: text('last_message_direction'),
  messageCount: integer('message_count').default(0),
  lastMessageChannel: text('last_message_channel'),
  realPhone: text('real_phone'),

  // Stateful Orchestration Fields
  activeWorkflowRunId: uuid('active_workflow_run_id'),
  workflowLockExpiresAt: timestamp('workflow_lock_expires_at', { withTimezone: true }),
  handedOffBy: uuid('handed_off_by').references(() => users.id, { onDelete: 'set null' }),
  handedOffAt: timestamp('handed_off_at', { withTimezone: true }),
  handoffReason: text('handoff_reason'),
  aiDisabledUntil: timestamp('ai_disabled_until', { withTimezone: true }),
  autopilotEnabled: boolean('autopilot_enabled').default(false).notNull(),

  lastMessageAt: timestamp('last_message_at', { withTimezone: true }).defaultNow(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
});

export const messages = pgTable('messages', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').references(() => tenants.id, { onDelete: 'cascade' }).notNull(),
  conversationId: uuid('conversation_id').references(() => conversations.id, { onDelete: 'cascade' }).notNull(),
  direction: text('direction').notNull(),
  content: text('content').notNull(),
  /** @deprecated channel is deprecated and replaced by channelId. Do not use for new features. */
  channel: text('channel'), // Legacy string fallback
  channelId: uuid('channel_id').references(() => channels.id, { onDelete: 'set null' }),
  groupId: uuid('group_id'), // We can use plain uuid since channelGroups might cause circular deps or just loosely coupled
  workflowRunId: uuid('workflow_run_id'),
  promptBindingId: uuid('prompt_binding_id'),
  status: text('status'),
  providerMessageId: text('provider_message_id'),
  modelUsed: text('model_used'),
  /** @deprecated phoneNumber is deprecated for legacy direct lookup; routing is handled via customerProfiles and channelId. */
  phoneNumber: text('phone_number'),
  
  // Delivery & Reliability
  retryAttempt: integer('retry_attempt').default(0),
  deliveryStatus: text('delivery_status'),
  deliveryError: text('delivery_error'),
  
  // AI Response Safety Ledger & Tracing
  latencyMs: integer('latency_ms'),
  estimatedCost: numeric('estimated_cost', { precision: 10, scale: 6 }),
  temperature: numeric('temperature', { precision: 3, scale: 2 }),
  moderationResult: text('moderation_result'),
  correlationId: text('correlation_id'),
  
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
});

export const settings = pgTable('settings', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').references(() => tenants.id, { onDelete: 'cascade' }).notNull(),
  key: text('key').notNull(),
  value: text('value'),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
});

export const conversationMemory = pgTable('conversation_memory', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').references(() => tenants.id, { onDelete: 'cascade' }).notNull(),
  conversationId: uuid('conversation_id').references(() => conversations.id, { onDelete: 'cascade' }).notNull(),
  summaryText: text('summary_text'),
  buyingIntent: text('buying_intent'),
  sentiment: text('sentiment'),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
});

export const conversationSnapshots = pgTable('conversation_snapshots', {
  id: uuid('id').primaryKey().defaultRandom(),
  conversationId: uuid('conversation_id').references(() => conversations.id, { onDelete: 'cascade' }).notNull(),
  workflowRunId: uuid('workflow_run_id'), // Optional link to the run that created it
  snapshotData: jsonb('snapshot_data').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
});

export const aiUsageLedger = pgTable('ai_usage_ledger', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').references(() => tenants.id, { onDelete: 'cascade' }).notNull(),
  conversationId: uuid('conversation_id').references(() => conversations.id, { onDelete: 'set null' }),
  workflowRunId: uuid('workflow_run_id'), // optional cross-reference
  messageId: uuid('message_id').references(() => messages.id, { onDelete: 'set null' }),
  model: text('model'),
  promptTokens: integer('prompt_tokens'),
  completionTokens: integer('completion_tokens'),
  totalTokens: integer('total_tokens'),
  estimatedCost: numeric('estimated_cost', { precision: 10, scale: 6 }),
  latencyMs: integer('latency_ms'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
});
