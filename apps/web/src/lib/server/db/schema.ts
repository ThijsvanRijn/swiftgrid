import { pgTable, serial, text, jsonb, timestamp, uuid, integer, bigserial, index, boolean, unique, primaryKey } from 'drizzle-orm/pg-core';

// =============================================================================
// WORKFLOWS - The flow definitions (nodes + edges)
// =============================================================================
export const workflows = pgTable('workflows', {
  id: serial('id').primaryKey(),
  name: text('name').notNull(),
  graph: jsonb('graph').notNull(),  // Current draft (editable)
  
  // Versioning: pointer to the active published version
  activeVersionId: uuid('active_version_id'),  // References workflow_versions.id (no FK to avoid circular)
  
  // Webhook configuration
  webhookEnabled: boolean('webhook_enabled').default(false),
  webhookSecret: text('webhook_secret'),  // HMAC secret for signature validation
  
  // Cron scheduling configuration
  scheduleEnabled: boolean('schedule_enabled').default(false),
  scheduleCron: text('schedule_cron'),           // Cron expression: "0 9 * * 1-5"
  scheduleTimezone: text('schedule_timezone').default('UTC'),
  scheduleInputData: jsonb('schedule_input_data'),  // Static input for scheduled runs
  scheduleNextRun: timestamp('schedule_next_run', { withTimezone: true }),  // Pre-computed next run time
  scheduleOverlapMode: text('schedule_overlap_mode').default('skip'),  // 'skip', 'queue_one', 'parallel'
  
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),

  // Share link revocation version (kill switch)
  shareVersion: integer('share_version').notNull().default(1)
}, (table) => [
  index('idx_workflows_schedule').on(table.scheduleNextRun),
  index('idx_workflows_active_version').on(table.activeVersionId)
]);

// =============================================================================
// WORKFLOW VERSIONS - Immutable snapshots of published workflows
// =============================================================================
// Each version is a frozen snapshot created when user clicks "Publish"
// Scheduled runs use the active version, not the draft
export const workflowVersions = pgTable('workflow_versions', {
  id: uuid('id').primaryKey().defaultRandom(),
  workflowId: integer('workflow_id').references(() => workflows.id, { onDelete: 'cascade' }).notNull(),
  
  // Version number (auto-incremented per workflow)
  versionNumber: integer('version_number').notNull(),
  
  // Immutable snapshot of the graph at publish time
  graph: jsonb('graph').notNull(),
  
  // Optional: input/output schemas for sub-flow usage
  inputSchema: jsonb('input_schema'),
  outputSchema: jsonb('output_schema'),
  
  // Human-readable description of changes
  changeSummary: text('change_summary'),
  
  // Who published this version (for audit)
  createdBy: text('created_by'),
  
  createdAt: timestamp('created_at').defaultNow().notNull()
}, (table) => [
  index('idx_workflow_versions_workflow').on(table.workflowId),
  unique('workflow_versions_workflow_version').on(table.workflowId, table.versionNumber)
]);

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
  
  // Which version was used for this run (null for draft runs or legacy runs)
  workflowVersionId: uuid('workflow_version_id').references(() => workflowVersions.id),
  
  // Immutable snapshot of the graph at run time (flow versioning!)
  snapshotGraph: jsonb('snapshot_graph').notNull(),
  
  // Run status: pending → running → completed | failed | cancelled | suspended
  status: text('status').notNull().default('pending'),
  
  // Trigger source: 'manual', 'webhook', 'schedule', 'subflow'
  trigger: text('trigger').default('manual'),
  
  // Initial input data (e.g., webhook payload)
  inputData: jsonb('input_data'),
  
  // Final output (optional, for quick access)
  outputData: jsonb('output_data'),
  
  // === Sub-Flow Parent Linking ===
  // If this run was spawned by a SubFlowNode, these link back to the parent
  parentRunId: uuid('parent_run_id'),  // The parent run waiting for us
  parentNodeId: text('parent_node_id'), // The specific SubFlowNode in parent that's suspended
  
  // Recursion depth (0 = top-level, increments for each nested sub-flow)
  // Hard limit of 10 to prevent infinite recursion
  depth: integer('depth').default(0),
  
  // Pinned runs are exempt from TTL cleanup
  pinned: boolean('pinned').default(false),
  
  createdAt: timestamp('created_at').defaultNow(),
  startedAt: timestamp('started_at'),
  completedAt: timestamp('completed_at')
}, (table) => [
  index('idx_workflow_runs_status').on(table.status),
  index('idx_workflow_runs_workflow_id').on(table.workflowId),
  index('idx_workflow_runs_created').on(table.createdAt),
  index('idx_workflow_runs_version').on(table.workflowVersionId),
  index('idx_workflow_runs_parent').on(table.parentRunId)  // Fast lookup for child completion
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
  
  // Retry attempt number (0-indexed, null for non-node events)
  // Used for idempotency: run_id + node_id + retry_count uniquely identifies an execution attempt
  retryCount: integer('retry_count'),
  
  // Event-specific data (error messages, results, retry info, etc.)
  payload: jsonb('payload'),
  
  // Immutable timestamp
  createdAt: timestamp('created_at').defaultNow().notNull()
}, (table) => [
  index('idx_run_events_run_id').on(table.runId),
  index('idx_run_events_type').on(table.eventType),
  index('idx_run_events_node_id').on(table.nodeId),
  // Idempotency index: fast lookup for "did this specific retry attempt complete?"
  index('idx_run_events_idempotency').on(table.runId, table.nodeId, table.retryCount, table.eventType)
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

// =============================================================================
// RUN STREAM CHUNKS - Real-time streaming output (for LLMs, progress, etc.)
// =============================================================================
// Chunk types:
//   'progress' - Status updates ("Connecting...", "Processing...")
//   'data' - Partial response data (HTTP chunks)
//   'token' - LLM tokens (for AI streaming)
//   'error' - Error messages during streaming
export const runStreamChunks = pgTable('run_stream_chunks', {
  id: bigserial('id', { mode: 'number' }).primaryKey(),
  runId: uuid('run_id').references(() => workflowRuns.id).notNull(),
  nodeId: text('node_id').notNull(),
  
  // Sequential index for ordering chunks
  chunkIndex: integer('chunk_index').notNull(),
  
  // Type of chunk (progress, data, token, error)
  chunkType: text('chunk_type').notNull(),
  
  // The actual content
  content: text('content').notNull(),
  
  // Timestamp for replay
  createdAt: timestamp('created_at').defaultNow().notNull()
}, (table) => [
  index('idx_stream_chunks_run_node').on(table.runId, table.nodeId),
  index('idx_stream_chunks_order').on(table.runId, table.nodeId, table.chunkIndex)
]);

// =============================================================================
// WEBHOOK DELIVERIES - For idempotency and audit trail
// =============================================================================
export const webhookDeliveries = pgTable('webhook_deliveries', {
  id: uuid('id').primaryKey().defaultRandom(),
  workflowId: integer('workflow_id').references(() => workflows.id).notNull(),
  
  // Idempotency key (hash of request body or X-Idempotency-Key header)
  idempotencyKey: text('idempotency_key').notNull(),
  
  // Request details (for debugging)
  requestBody: jsonb('request_body'),
  requestHeaders: jsonb('request_headers'),
  sourceIp: text('source_ip'),
  
  // Response we returned (for idempotent replay)
  responseStatus: integer('response_status').notNull(),
  responseBody: jsonb('response_body'),
  
  // Link to the run we created (if successful)
  runId: uuid('run_id').references(() => workflowRuns.id),
  
  createdAt: timestamp('created_at').defaultNow()
}, (table) => [
  index('idx_webhook_deliveries_idempotency').on(table.workflowId, table.idempotencyKey),
  index('idx_webhook_deliveries_workflow').on(table.workflowId)
]);

// =============================================================================
// BATCH OPERATIONS - Control state for Map/Iterator nodes
// =============================================================================
// Small, frequently updated table with atomic counters
// Separate from data to avoid write contention
export const batchOperations = pgTable('batch_operations', {
  id: uuid('id').primaryKey().defaultRandom(),
  runId: uuid('run_id').references(() => workflowRuns.id, { onDelete: 'cascade' }).notNull(),
  nodeId: text('node_id').notNull(),
  
  // Configuration (immutable after creation)
  totalItems: integer('total_items').notNull(),
  concurrencyLimit: integer('concurrency_limit').notNull().default(5),
  failFast: boolean('fail_fast').notNull().default(false),
  timeoutMs: integer('timeout_ms'),  // Per-item timeout in milliseconds (null = no timeout)
  
  // The input array (stored for reference)
  inputItems: jsonb('input_items').notNull(),
  
  // Child workflow reference
  childWorkflowId: integer('child_workflow_id').notNull(),
  childVersionId: uuid('child_version_id'),  // Pinned version (null = use active)
  
  // Cached metadata (populated once at batch creation to avoid repeated queries)
  childGraph: jsonb('child_graph'),          // The workflow graph JSON (cached)
  childDepth: integer('child_depth'),        // Parent depth + 1 (cached)
  
  // State (updated atomically)
  currentIndex: integer('current_index').notNull().default(0),  // Cursor for spawning next batch
  activeCount: integer('active_count').notNull().default(0),    // Currently running children
  completedCount: integer('completed_count').notNull().default(0),
  failedCount: integer('failed_count').notNull().default(0),
  
  // Status: 'running', 'completed', 'failed', 'cancelled'
  status: text('status').notNull().default('running'),
  
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  completedAt: timestamp('completed_at', { withTimezone: true })
}, (table) => [
  index('idx_batch_operations_run_node').on(table.runId, table.nodeId),
  index('idx_batch_operations_status').on(table.status)
]);

// =============================================================================
// BATCH RESULTS - Append-only results storage
// =============================================================================
// High throughput: each child completion is an INSERT, never UPDATE
// No locking contention even with high concurrency
export const batchResults = pgTable('batch_results', {
  batchId: uuid('batch_id').references(() => batchOperations.id, { onDelete: 'cascade' }).notNull(),
  itemIndex: integer('item_index').notNull(),  // Original position in input array (for ordering)
  
  // Child run reference
  childRunId: uuid('child_run_id').references(() => workflowRuns.id, { onDelete: 'set null' }),
  
  // Result status: 'completed', 'failed'
  status: text('status').notNull(),
  
  // Output data from child run (or error details)
  output: jsonb('output'),
  errorMessage: text('error_message'),
  
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow()
}, (table) => [
  // Composite primary key for ON CONFLICT support
  primaryKey({ columns: [table.batchId, table.itemIndex] })
]);

// =============================================================================
// RUN AUDIT LOG - Tracks deletions and other audit events
// =============================================================================
// This table preserves audit trail even when runs are hard-deleted
export const runAuditLog = pgTable('run_audit_log', {
  id: bigserial('id', { mode: 'number' }).primaryKey(),
  
  // Run that was affected (no FK - run may be deleted)
  runId: uuid('run_id').notNull(),
  workflowId: integer('workflow_id').notNull(),
  
  // Action type: 'DELETED', 'CANCELLED', etc.
  action: text('action').notNull(),
  
  // Who performed the action (user ID or 'system')
  actor: text('actor'),
  
  // Additional context (reason, original status, etc.)
  metadata: jsonb('metadata'),
  
  createdAt: timestamp('created_at').defaultNow().notNull()
}, (table) => [
  index('idx_audit_log_run').on(table.runId),
  index('idx_audit_log_workflow').on(table.workflowId),
  index('idx_audit_log_action').on(table.action)
]);