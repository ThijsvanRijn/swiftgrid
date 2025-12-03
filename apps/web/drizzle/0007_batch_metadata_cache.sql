-- Add cached metadata columns to batch_operations
-- This eliminates repeated queries for static data during child spawning

ALTER TABLE batch_operations 
ADD COLUMN child_graph JSONB,
ADD COLUMN child_depth INTEGER;

-- Add comment explaining the purpose
COMMENT ON COLUMN batch_operations.child_graph IS 'Cached workflow graph JSON - populated once at batch creation';
COMMENT ON COLUMN batch_operations.child_depth IS 'Cached child depth (parent depth + 1) - populated once at batch creation';

