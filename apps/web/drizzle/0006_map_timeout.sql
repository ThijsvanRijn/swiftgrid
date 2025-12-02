-- Add timeout_ms column to batch_operations for Map node timeout support
ALTER TABLE batch_operations ADD COLUMN IF NOT EXISTS timeout_ms INTEGER;

-- Allow timed_out status
COMMENT ON COLUMN batch_operations.status IS 'running, completed, failed, cancelled, timed_out';

