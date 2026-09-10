// Intentionally empty by default.
// Add Drizzle tables here when the site actually needs a database.
// See examples/d1/db/schema.ts for an opt-in example.
import { sqliteTable, text, index } from 'drizzle-orm/sqlite-core';
export const leads = sqliteTable('leads', {
 id:text('id').primaryKey(),owner:text('owner').notNull(),name:text('name').notNull(),phone:text('phone').notNull(),propertyId:text('property_id').notNull(),stage:text('stage').notNull().default('new'),notes:text('notes').notNull().default(''),followUp:text('follow_up').notNull().default(''),createdAt:text('created_at').notNull(),updatedAt:text('updated_at').notNull()
},t=>[index('leads_owner_created_idx').on(t.owner,t.createdAt)]);
