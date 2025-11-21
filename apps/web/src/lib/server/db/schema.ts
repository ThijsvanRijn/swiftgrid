import { pgTable, serial, text, jsonb, timestamp } from 'drizzle-orm/pg-core';

export const workflows = pgTable('workflows', {
  id: serial('id').primaryKey(),
  name: text('name').notNull(),
  
  graph: jsonb('graph').notNull(), 
  
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow()
});

export const secrets = pgTable('secrets', {
  // The Key Name (e.g. "OPENAI_KEY") is the primary identifier
  key: text('key').primaryKey(),
  
  // The Secret Value (e.g. "sk-...")
  // In a 10/10 Production app, we would encrypt this string before saving.
  // For this milestone, we store it as text so we can prove the concept.
  value: text('value').notNull(),
  
  createdAt: timestamp('created_at').defaultNow()
});