-- =============================================================================
-- BATCH OPERATIONS - Control state for Map/Iterator nodes
-- =============================================================================
-- Small, frequently updated table with atomic counters
-- Separate from data to avoid write contention

CREATE TABLE batch_operations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id UUID NOT NULL REFERENCES workflow_runs(id) ON DELETE CASCADE,
  node_id TEXT NOT NULL,
  
  -- Configuration (immutable after creation)
  total_items INTEGER NOT NULL,
  concurrency_limit INTEGER NOT NULL DEFAULT 5,
  fail_fast BOOLEAN NOT NULL DEFAULT false,
  
  -- The input array (stored for reference)
  input_items JSONB NOT NULL,
  
  -- Child workflow reference
  child_workflow_id INTEGER NOT NULL,
  child_version_id UUID,  -- Pinned version (null = use active)
  
  -- State (updated atomically)
  current_index INTEGER NOT NULL DEFAULT 0,  -- Cursor for spawning next batch
  active_count INTEGER NOT NULL DEFAULT 0,   -- Currently running children
  completed_count INTEGER NOT NULL DEFAULT 0,
  failed_count INTEGER NOT NULL DEFAULT 0,
  
  -- Status: 'running', 'completed', 'failed', 'cancelled'
  status TEXT NOT NULL DEFAULT 'running',
  
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  completed_at TIMESTAMP WITH TIME ZONE
);

-- Index for finding batch by run+node (used when child completes)
CREATE INDEX idx_batch_operations_run_node ON batch_operations(run_id, node_id);

-- Index for finding active batches (for monitoring/cleanup)
CREATE INDEX idx_batch_operations_status ON batch_operations(status) WHERE status = 'running';


-- =============================================================================
-- BATCH RESULTS - Append-only results storage
-- =============================================================================
-- High throughput: each child completion is an INSERT, never UPDATE
-- No locking contention even with high concurrency

CREATE TABLE batch_results (
  batch_id UUID NOT NULL REFERENCES batch_operations(id) ON DELETE CASCADE,
  item_index INTEGER NOT NULL,  -- Original position in input array (for ordering)
  
  -- Child run reference
  child_run_id UUID REFERENCES workflow_runs(id) ON DELETE SET NULL,
  
  -- Result status: 'completed', 'failed'
  status TEXT NOT NULL,
  
  -- Output data from child run (or error details)
  output JSONB,
  error_message TEXT,
  
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  
  PRIMARY KEY (batch_id, item_index)
);

-- Index for aggregating results in order
CREATE INDEX idx_batch_results_batch ON batch_results(batch_id, item_index);

