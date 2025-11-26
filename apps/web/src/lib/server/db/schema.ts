import { pgTable, serial, text, jsonb, timestamp, uuid, integer, bigserial, index } from 'drizzle-orm/pg-core';

// =============================================================================
// WORKFLOWS - The flow definitions (nodes + edges)
// =============================================================================
export const workflows = pgTable('workflows', {
  id: serial('id').primaryKey(),
  name: text('name').notNull(),
  graph: jsonb('graph').notNull(), 
  webhookEnabled: text('webhook_enabled').default('false'), // For future webhook triggers
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow()
});

// =============================================================================
// SECRETS - Encrypted environment variables
// =============================================================================
export const secrets = pgTable('secrets', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
  createdAt: timestamp('created_at').defaultNow()
});

// =============================================================================
// WORKFLOW RUNS - Each execution of a workflow
// =============================================================================
export const workflowRuns = pgTable('workflow_runs', {
  id: uuid('id').primaryKey().defaultRandom(),
  workflowId: integer('workflow_id').references(() => workflows.id),
  
  // Immutable snapshot of the graph at run time (flow versioning!)
  snapshotGraph: jsonb('snapshot_graph').notNull(),
  
  // Run status: pending → running → completed | failed | cancelled
  status: text('status').notNull().default('pending'),
  
  // Trigger source: 'manual', 'webhook', 'schedule'
  trigger: text('trigger').default('manual'),
  
  // Initial input data (e.g., webhook payload)
  inputData: jsonb('input_data'),
  
  // Final output (optional, for quick access)
  outputData: jsonb('output_data'),
  
  createdAt: timestamp('created_at').defaultNow(),
  startedAt: timestamp('started_at'),
  completedAt: timestamp('completed_at')
}, (table) => [
  index('idx_workflow_runs_status').on(table.status),
  index('idx_workflow_runs_workflow_id').on(table.workflowId)
]);

// =============================================================================
// RUN EVENTS - Append-only event log (the heart of durability)
// =============================================================================
// Event types:
//   RUN_CREATED, RUN_STARTED, RUN_COMPLETED, RUN_FAILED, RUN_CANCELLED
//   NODE_SCHEDULED, NODE_STARTED, NODE_COMPLETED, NODE_FAILED
//   NODE_RETRY_SCHEDULED, NODE_SUSPENDED, NODE_RESUMED
export const runEvents = pgTable('run_events', {
  id: bigserial('id', { mode: 'number' }).primaryKey(),
  runId: uuid('run_id').references(() => workflowRuns.id).notNull(),
  
  // Which node this event is about (null for run-level events)
  nodeId: text('node_id'),
  
  // Event type (see list above)
  eventType: text('event_type').notNull(),
  
  // Event-specific data (error messages, results, retry info, etc.)
  payload: jsonb('payload'),
  
  // Immutable timestamp
  createdAt: timestamp('created_at').defaultNow().notNull()
}, (table) => [
  index('idx_run_events_run_id').on(table.runId),
  index('idx_run_events_type').on(table.eventType),
  index('idx_run_events_node_id').on(table.nodeId)
]);

// =============================================================================
// SCHEDULED JOBS - For delayed execution (sleep, schedules)
// =============================================================================
export const scheduledJobs = pgTable('scheduled_jobs', {
  id: uuid('id').primaryKey().defaultRandom(),
  runId: uuid('run_id').references(() => workflowRuns.id).notNull(),
  nodeId: text('node_id').notNull(),
  
  // When to execute
  scheduledFor: timestamp('scheduled_for').notNull(),
  
  // Job payload to push to Redis when ready
  payload: jsonb('payload').notNull(),
  
  createdAt: timestamp('created_at').defaultNow(),
  processedAt: timestamp('processed_at') // Set when moved to Redis
}, (table) => [
  index('idx_scheduled_jobs_due').on(table.scheduledFor)
]);

// =============================================================================
// SUSPENSIONS - For webhook waits, approvals, external events
// =============================================================================
export const suspensions = pgTable('suspensions', {
  id: uuid('id').primaryKey().defaultRandom(),
  runId: uuid('run_id').references(() => workflowRuns.id).notNull(),
  nodeId: text('node_id').notNull(),
  
  // Type: 'webhook', 'approval', 'sleep'
  suspensionType: text('suspension_type').notNull(),
  
  // Unique token for resuming (used in webhook URLs)
  resumeToken: text('resume_token').unique(),
  
  // For approval UIs
  approvalMessage: text('approval_message'),
  approvalOptions: jsonb('approval_options'),
  
  // For timed waits (sleep until)
  resumeAfter: timestamp('resume_after'),
  
  // Saved execution context (node inputs, partial state)
  executionContext: jsonb('execution_context').notNull(),
  
  // Resolution
  resumedAt: timestamp('resumed_at'),
  resumedBy: text('resumed_by'),
  resumePayload: jsonb('resume_payload'),
  
  createdAt: timestamp('created_at').defaultNow(),
  expiresAt: timestamp('expires_at')
}, (table) => [
  index('idx_suspensions_token').on(table.resumeToken),
  index('idx_suspensions_expires').on(table.expiresAt)
]);