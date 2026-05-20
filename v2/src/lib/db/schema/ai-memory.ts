import { pgTable, text, timestamp, uuid, boolean, jsonb, numeric } from 'drizzle-orm/pg-core';
import { tenants } from './tenants';

export const aiContextMemory = pgTable('ai_context_memory', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').references(() => tenants.id, { onDelete: 'cascade' }).notNull(),
  entityType: text('entity_type').notNull(),
  contextKey: text('context_key').notNull(),
  contextValue: jsonb('context_value').notNull(),
  lastUsedAt: timestamp('last_used_at', { withTimezone: true }).defaultNow(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow()
});

export const tenantSemanticRules = pgTable('tenant_semantic_rules', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').references(() => tenants.id, { onDelete: 'cascade' }).notNull(),
  sourceField: text('source_field').notNull(),
  resolvedEntity: text('resolved_entity').notNull(),
  confidenceThreshold: numeric('confidence_threshold', { precision: 3, scale: 2 }).default('0.85'),
  isOperatorEnforced: boolean('is_operator_enforced').default(false),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow()
});

export const aiAuditLogs = pgTable('ai_audit_logs', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').references(() => tenants.id, { onDelete: 'cascade' }).notNull(),
  action: text('action').notNull(), // 'SemanticMapping', 'DuplicateResolution'
  aiConfidence: numeric('ai_confidence', { precision: 3, scale: 2 }),
  reasoningSummary: text('reasoning_summary'),
  sourceText: text('source_text'),
  resultSummary: jsonb('result_summary'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow()
});
