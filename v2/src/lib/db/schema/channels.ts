import { pgTable, text, timestamp, uuid, boolean, integer, jsonb, numeric } from 'drizzle-orm/pg-core';
import { tenants } from './tenants';

export const channelGroups = pgTable('channel_groups', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  description: text('description'),
  status: text('status').default('active'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
});

export const channels = pgTable('channels', {
  id: uuid('id').primaryKey().defaultRandom(),
  groupId: uuid('group_id').notNull().references(() => channelGroups.id, { onDelete: 'cascade' }),
  provider: text('provider').notNull(),
  identifier: text('identifier').notNull(),
  name: text('name'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
});

export const channelIntegrations = pgTable('channel_integrations', {
  id: uuid('id').primaryKey().defaultRandom(),
  channelId: uuid('channel_id').notNull().references(() => channels.id, { onDelete: 'cascade' }),
  provider: text('provider').notNull(),
  credentialsEncrypted: text('credentials_encrypted').notNull(),
  healthStatus: text('health_status').default('healthy'),
  lastSyncAt: timestamp('last_sync_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
});

export const channelAiProfiles = pgTable('channel_ai_profiles', {
  id: uuid('id').primaryKey().defaultRandom(),
  groupId: uuid('group_id').notNull().references(() => channelGroups.id, { onDelete: 'cascade' }).unique(),
  aiModel: text('ai_model').default('gemini-2.5-flash'),
  temperature: numeric('temperature', { precision: 3, scale: 2 }).default('0.7'),
  aggressionLevel: text('aggression_level').default('medium'),
  languageProfile: text('language_profile').default('tr-TR'),
  businessHoursJson: jsonb('business_hours_json').default({}),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
});

export const channelPrompts = pgTable('channel_prompts', {
  id: uuid('id').primaryKey().defaultRandom(),
  groupId: uuid('group_id').references(() => channelGroups.id, { onDelete: 'cascade' }),
  tenantId: uuid('tenant_id').references(() => tenants.id, { onDelete: 'cascade' }),
  name: text('name'),
  promptType: text('prompt_type').notNull().default('system'),
  promptText: text('prompt_text').notNull(),
  version: integer('version').default(1),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
});

export const channelPromptBindings = pgTable('channel_prompt_bindings', {
  id: uuid('id').primaryKey().defaultRandom(),
  channelId: uuid('channel_id').notNull().references(() => channels.id, { onDelete: 'cascade' }),
  promptId: uuid('prompt_id').notNull().references(() => channelPrompts.id, { onDelete: 'cascade' }),
  priority: integer('priority').default(100),
  isActive: boolean('is_active').default(true),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
});

export const workflowRuns = pgTable('workflow_runs', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  channelId: uuid('channel_id').references(() => channels.id, { onDelete: 'cascade' }),
  conversationId: uuid('conversation_id'), // Will be linked to conversations table loosely to avoid circular dependency in ORM
  status: text('status').default('queued'),
  triggeredBy: text('triggered_by'),
  promptBindingVersions: jsonb('prompt_binding_versions'),
  errorDetails: jsonb('error_details'),
  correlationId: text('correlation_id'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
});

export const workflowSteps = pgTable('workflow_steps', {
  id: uuid('id').primaryKey().defaultRandom(),
  runId: uuid('run_id').notNull().references(() => workflowRuns.id, { onDelete: 'cascade' }),
  stepType: text('step_type').notNull(),
  status: text('status').default('pending'),
  payload: jsonb('payload'),
  errorLog: text('error_log'),
  retryCount: integer('retry_count').default(0),
  maxRetries: integer('max_retries').default(3),
  dependencies: jsonb('dependencies'), // For DAG logic (e.g., ["step1", "step2"])
  startedAt: timestamp('started_at', { withTimezone: true }),
  completedAt: timestamp('completed_at', { withTimezone: true }),
});

export const channelEvents = pgTable('channel_events', {
  id: uuid('id').primaryKey().defaultRandom(),
  channelId: uuid('channel_id').notNull().references(() => channels.id, { onDelete: 'cascade' }),
  eventType: text('event_type').notNull(),
  payload: jsonb('payload'),
  status: text('status').default('success'),
  correlationId: text('correlation_id'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
});
