import { pgTable, text, timestamp, uuid, integer } from 'drizzle-orm/pg-core';
import { tenants } from './tenants';
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
  channel: text('channel'), // Legacy
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
  channel: text('channel'), // Legacy string fallback
  channelId: uuid('channel_id').references(() => channels.id, { onDelete: 'set null' }),
  groupId: uuid('group_id'), // We can use plain uuid since channelGroups might cause circular deps or just loosely coupled
  workflowRunId: uuid('workflow_run_id'),
  promptBindingId: uuid('prompt_binding_id'),
  status: text('status'),
  providerMessageId: text('provider_message_id'),
  modelUsed: text('model_used'),
  phoneNumber: text('phone_number'),
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
