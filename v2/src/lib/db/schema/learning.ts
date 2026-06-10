import { pgTable, text, timestamp, uuid, jsonb, numeric } from 'drizzle-orm/pg-core';
import { tenants } from './tenants';
import { channels } from './channels';
import { conversations, messages } from './crm';

export const tenantLearningEvents = pgTable('tenant_learning_events', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').references(() => tenants.id, { onDelete: 'cascade' }).notNull(),
  organizationId: uuid('organization_id'),
  channelId: uuid('channel_id').references(() => channels.id, { onDelete: 'set null' }),
  conversationId: uuid('conversation_id').references(() => conversations.id, { onDelete: 'cascade' }),
  messageId: uuid('message_id').references(() => messages.id, { onDelete: 'set null' }),
  sourceType: text('source_type').notNull(), // 'autopilot_reply', 'smart_draft', 'manual_reply', 'human_edited_ai_draft', 'human_takeover', 'patient_reaction'
  patientMessageText: text('patient_message_text'),
  aiGeneratedText: text('ai_generated_text'),
  humanFinalText: text('human_final_text'),
  diffSummary: jsonb('diff_summary'),
  changedRatio: numeric('changed_ratio', { precision: 5, scale: 4 }),
  removedPhrases: jsonb('removed_phrases'),
  addedPhrases: jsonb('added_phrases'),
  riskTags: jsonb('risk_tags'),
  outcomeSignal: text('outcome_signal').default('unknown'), // 'unknown', 'patient_replied', 'patient_positive', 'patient_angry', 'conversation_silent', 'human_takeover'
  status: text('status').default('captured'), // 'captured', 'ignored', 'processed_later'
  idempotencyKey: text('idempotency_key').unique(),
  metadata: jsonb('metadata').default({}),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
});
