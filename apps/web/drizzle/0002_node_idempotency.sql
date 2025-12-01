-- Migration: Add retry_count column and idempotency index to run_events
-- Purpose: Enable fast idempotency checks to prevent duplicate node executions

-- Add retry_count column (nullable for backwards compatibility with existing events)
ALTER TABLE "run_events" ADD COLUMN "retry_count" integer;

-- Create composite index for idempotency lookups
-- Query pattern: SELECT 1 FROM run_events WHERE run_id = ? AND node_id = ? AND retry_count = ? AND event_type IN ('NODE_COMPLETED', 'NODE_FAILED')
CREATE INDEX "idx_run_events_idempotency" ON "run_events" ("run_id", "node_id", "retry_count", "event_type");

