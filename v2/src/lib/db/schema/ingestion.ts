import { pgTable, text, timestamp, uuid, jsonb, numeric } from 'drizzle-orm/pg-core';
import { tenants } from './tenants';
import { users } from './tenants';

export const ingestionPipelines = pgTable('ingestion_pipelines', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').references(() => tenants.id, { onDelete: 'cascade' }).notNull(),
  name: text('name').notNull(),
  provider: text('provider').notNull(), // e.g., 'google_sheets'
  config: jsonb('config').notNull().default({}),
  isActive: text('is_active').default('true'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
});

export const pipelineEvents = pgTable('pipeline_events', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').references(() => tenants.id, { onDelete: 'cascade' }).notNull(),
  pipelineId: uuid('pipeline_id').references(() => ingestionPipelines.id, { onDelete: 'cascade' }),
  eventType: text('event_type').notNull(), // 'LeadImported', 'SemanticAnalysisCompleted'
  sourceId: text('source_id'), // e.g. sheet_row_id
  entityId: uuid('entity_id'), 
  payload: jsonb('payload').notNull(),
  aiConfidence: numeric('ai_confidence', { precision: 3, scale: 2 }),
  operatorId: uuid('operator_id').references(() => users.id, { onDelete: 'set null' }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow()
});

export const rollbackSnapshots = pgTable('rollback_snapshots', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').references(() => tenants.id, { onDelete: 'cascade' }).notNull(),
  syncEventId: uuid('sync_event_id').references(() => pipelineEvents.id, { onDelete: 'cascade' }),
  previousState: jsonb('previous_state').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
});

export const humanReviewSessions = pgTable('human_review_sessions', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').references(() => tenants.id, { onDelete: 'cascade' }).notNull(),
  pipelineRunId: uuid('pipeline_run_id').notNull(),
  confidenceScore: numeric('confidence_score', { precision: 3, scale: 2 }).notNull(),
  aiReasoning: text('ai_reasoning').notNull(),
  suggestedResolution: jsonb('suggested_resolution').default({}),
  operatorDecision: jsonb('operator_decision'),
  resolutionTime: timestamp('resolution_time', { withTimezone: true }),
  status: text('status').notNull().default('pending'), // pending, resolved, dismissed
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
});

export const webhookEvents = pgTable('webhook_events', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').references(() => tenants.id, { onDelete: 'cascade' }).notNull(),
  provider: text('provider').notNull(),
  providerMessageId: text('provider_message_id').notNull(),
  senderId: text('sender_id'),
  eventTimestamp: numeric('event_timestamp', { precision: 20, scale: 0 }),
  processedAt: timestamp('processed_at', { withTimezone: true }).defaultNow(),
});

export const deadLetterJobs = pgTable('dead_letter_jobs', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').references(() => tenants.id, { onDelete: 'cascade' }).notNull(),
  topic: text('topic').notNull(),
  payload: jsonb('payload'),
  errorMessage: text('error_message'),
  errorStack: text('error_stack'),
  status: text('status').default('unresolved'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
});
