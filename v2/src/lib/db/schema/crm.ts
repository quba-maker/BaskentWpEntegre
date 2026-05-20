import { pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { tenants } from './tenants';

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
  phoneNumber: text('phone_number').notNull(),
  department: text('department'),
  message: text('message'),
  source: text('source'), // e.g. 'google_sheets'
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
});
