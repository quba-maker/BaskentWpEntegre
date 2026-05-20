import { pgTable, text, timestamp, uuid, boolean, integer, jsonb, numeric } from 'drizzle-orm/pg-core';

export const tenants = pgTable('tenants', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  slug: text('slug').notNull().unique(),
  industry: text('industry').default('general').notNull(),
  logoUrl: text('logo_url'),
  primaryColor: text('primary_color').default('#007AFF'),
  aiModel: text('ai_model').default('gemini-2.5-flash'),
  status: text('status').default('active'),
  plan: text('plan').default('starter'),
  monthlyMessageLimit: integer('monthly_message_limit').default(500),
  timezone: text('timezone').default('Europe/Istanbul'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
});

export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').references(() => tenants.id, { onDelete: 'cascade' }),
  email: text('email').notNull().unique(),
  passwordHash: text('password_hash').notNull(),
  name: text('name').notNull(),
  role: text('role').default('agent'),
  isActive: boolean('is_active').default(true),
  mustChangePassword: boolean('must_change_password').default(false),
  lastLoginAt: timestamp('last_login_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
});
