-- Migration: Add sub-flow parent linking to workflow_runs
-- Purpose: Enable nested workflow execution with parent-child relationships

-- Add parent linking columns
ALTER TABLE "workflow_runs" ADD COLUMN "parent_run_id" uuid;
ALTER TABLE "workflow_runs" ADD COLUMN "parent_node_id" text;
ALTER TABLE "workflow_runs" ADD COLUMN "depth" integer DEFAULT 0;

-- Index for fast child completion lookups (when child finishes, find parent to resume)
CREATE INDEX "idx_workflow_runs_parent" ON "workflow_runs" ("parent_run_id");

