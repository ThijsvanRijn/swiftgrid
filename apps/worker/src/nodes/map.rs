//! Map/Iterator Node Handler
//!
//! Executes a workflow for each item in an array with configurable concurrency.
//! Uses the suspension pattern similar to SubFlow, but manages multiple children.

use crate::types::{MapNodeData, MapStepData, MapChildCompleteData, ExecutionResult};
use crate::events::{log_event_with_retry, EventType};
use chrono;
use serde_json::json;
use sqlx::PgPool;
use uuid::Uuid;

/// Error type for map operations
#[derive(Debug)]
pub enum MapError {
    DepthLimitExceeded { current: u32, limit: u32 },
    DatabaseError(String),
    ExecutionError(String),
    Cancelled(String),
}

impl std::fmt::Display for MapError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            MapError::DepthLimitExceeded { current, limit } => {
                write!(f, "Map depth limit exceeded: {} >= {}", current, limit)
            }
            MapError::DatabaseError(msg) => write!(f, "Database error: {}", msg),
            MapError::ExecutionError(msg) => write!(f, "Execution error: {}", msg),
            MapError::Cancelled(msg) => write!(f, "Cancelled: {}", msg),
    }
    }
}

/// Check if a run has been cancelled
async fn is_run_cancelled(pool: &PgPool, run_id: &Uuid) -> bool {
    let result: Option<(String,)> = sqlx::query_as(
        "SELECT status FROM workflow_runs WHERE id = $1"
    )
    .bind(run_id)
    .fetch_optional(pool)
    .await
    .ok()
    .flatten();
    
    matches!(result, Some((status,)) if status == "cancelled")
}

/// Cancel a batch operation and mark it as cancelled
async fn cancel_batch(pool: &PgPool, batch_id: &Uuid) -> Result<(), MapError> {
    sqlx::query(
        "UPDATE batch_operations SET status = 'cancelled', completed_at = NOW() WHERE id = $1 AND status = 'running'"
    )
    .bind(batch_id)
    .execute(pool)
    .await
    .map_err(|e| MapError::DatabaseError(e.to_string()))?;
    
    Ok(())
}

impl std::error::Error for MapError {}

/// Initialize a Map operation: create batch record and spawn initial children
pub async fn handle_map_init(
    pool: &PgPool,
    run_id: &Uuid,
    node_id: &str,
    data: &MapNodeData,
    retry_count: u32,
) -> Result<ExecutionResult, MapError> {
    let start = std::time::Instant::now();
    
    // Check if run has been cancelled
    if is_run_cancelled(pool, run_id).await {
        return Err(MapError::Cancelled("Parent run was cancelled".to_string()));
    }
    
    // Check depth limit
    if data.current_depth >= data.depth_limit {
        return Err(MapError::DepthLimitExceeded {
            current: data.current_depth,
            limit: data.depth_limit,
        });
    }
    
    let total_items = data.items.len() as i32;
    if total_items == 0 {
        // Empty array - complete immediately with empty results
        return Ok(ExecutionResult {
            node_id: node_id.to_string(),
            run_id: Some(run_id.to_string()),
            status_code: 200,
            body: Some(json!({
                "results": [],
                "errors": [],
                "stats": {
                    "total": 0,
                    "completed": 0,
                    "failed": 0
                }
            })),
            timestamp: std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_millis() as u64,
            duration_ms: start.elapsed().as_millis() as u64,
            isolated: false,
        });
    }
    
    // Create batch_operations record
    let batch_id = Uuid::new_v4();
    let concurrency = data.concurrency.min(200).max(1) as i32; // Raised from 50 to 200
    
    // Convert version_id string to UUID
    let version_uuid = data.version_id.as_ref().and_then(|v| Uuid::parse_str(v).ok());
    
    // OPTIMIZATION: Fetch graph and depth ONCE here, cache in batch_operations
    // This eliminates ~3 queries per spawn_children call later
    let parent_depth: i32 = sqlx::query_scalar("SELECT COALESCE(depth, 0) FROM workflow_runs WHERE id = $1")
        .bind(run_id)
        .fetch_one(pool)
        .await
        .map_err(|e| MapError::DatabaseError(e.to_string()))?;
    
    let child_depth = parent_depth + 1;
    
    // Fetch the workflow graph ONCE
    let child_graph: serde_json::Value = if let Some(version_id) = &data.version_id {
        let vid = Uuid::parse_str(version_id)
            .map_err(|e| MapError::ExecutionError(format!("Invalid version_id: {}", e)))?;
        sqlx::query_scalar("SELECT graph FROM workflow_versions WHERE id = $1")
            .bind(vid)
            .fetch_one(pool)
            .await
            .map_err(|e| MapError::DatabaseError(e.to_string()))?
    } else {
        let active_version_id: Option<Uuid> = sqlx::query_scalar(
            "SELECT active_version_id FROM workflows WHERE id = $1"
        )
        .bind(data.workflow_id)
        .fetch_one(pool)
        .await
        .map_err(|e| MapError::DatabaseError(e.to_string()))?;
        
        if let Some(vid) = active_version_id {
            sqlx::query_scalar("SELECT graph FROM workflow_versions WHERE id = $1")
                .bind(vid)
                .fetch_one(pool)
                .await
                .map_err(|e| MapError::DatabaseError(e.to_string()))?
        } else {
            sqlx::query_scalar("SELECT graph FROM workflows WHERE id = $1")
                .bind(data.workflow_id)
                .fetch_one(pool)
                .await
                .map_err(|e| MapError::DatabaseError(e.to_string()))?
        }
    };
    
    // Insert batch_operations with cached metadata
    sqlx::query(
        r#"
        INSERT INTO batch_operations (
            id, run_id, node_id, total_items, concurrency_limit, fail_fast, timeout_ms,
            input_items, child_workflow_id, child_version_id, child_graph, child_depth, status
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, 'running')
        "#
    )
    .bind(batch_id)
    .bind(run_id)
    .bind(node_id)
    .bind(total_items)
    .bind(concurrency)
    .bind(data.fail_fast)
    .bind(data.timeout_ms.map(|t| t as i32))
    .bind(json!(data.items))
    .bind(data.workflow_id)
    .bind(version_uuid)
    .bind(&child_graph)  // Cached graph
    .bind(child_depth)   // Cached depth
    .execute(pool)
    .await
    .map_err(|e| MapError::DatabaseError(e.to_string()))?;
    
    // Log node suspended event
    let _ = log_event_with_retry(
        pool,
        run_id,
        node_id,
        EventType::NodeSuspended,
        Some(retry_count),
        json!({
            "batch_id": batch_id.to_string(),
            "total_items": total_items,
            "concurrency": concurrency
        }),
    ).await;
    
    // Spawn initial batch of children
    let initial_count = (concurrency as usize).min(data.items.len());
    spawn_children(pool, &batch_id, run_id, data, 0, initial_count).await?;
    
    // Update current_index
    sqlx::query("UPDATE batch_operations SET current_index = $1, active_count = $2 WHERE id = $3")
        .bind(initial_count as i32)
        .bind(initial_count as i32)
        .bind(batch_id)
        .execute(pool)
        .await
        .map_err(|e| MapError::DatabaseError(e.to_string()))?;
    
    // Return suspended status (202)
    Ok(ExecutionResult {
        node_id: node_id.to_string(),
        run_id: Some(run_id.to_string()),
        status_code: 202,
        body: Some(json!({
            "batch_id": batch_id.to_string(),
            "status": "running",
            "total": total_items,
            "spawned": initial_count
        })),
        timestamp: std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_millis() as u64,
        duration_ms: start.elapsed().as_millis() as u64,
        isolated: false,
    })
}

/// Handle child completion: record result, update counters, spawn next or complete
pub async fn handle_child_complete(
    pool: &PgPool,
    _redis: &redis::Client, // No longer used - children spawned directly, not via MAPSTEP
    run_id: &Uuid,
    node_id: &str,
    data: &MapChildCompleteData,
) -> Result<ExecutionResult, MapError> {
    let start = std::time::Instant::now();
    let batch_id = Uuid::parse_str(&data.batch_id)
        .map_err(|e| MapError::ExecutionError(format!("Invalid batch_id: {}", e)))?;
    
    // Check if this is a timeout marker from the scheduler (item_index = -1)
    if data.item_index == -1 {
        // Batch timed out - complete it with whatever results we have
        return complete_batch(pool, run_id, node_id, &batch_id, true, start).await;
    }
    
    // Check cancellation periodically (every ~10 completions) to reduce DB queries
    // Use item_index % 10 as a cheap way to sample
    let run_cancelled = if data.item_index % 10 == 0 {
        is_run_cancelled(pool, run_id).await
    } else {
        false
    };
    
    // Insert result into batch_results (append-only, no locking)
    // ON CONFLICT DO NOTHING means duplicates are silently ignored
    let insert_result = sqlx::query(
        r#"
        INSERT INTO batch_results (batch_id, item_index, child_run_id, status, output, error_message)
        VALUES ($1, $2, $3, $4, $5, $6)
        ON CONFLICT (batch_id, item_index) DO NOTHING
        "#
    )
    .bind(batch_id)
    .bind(data.item_index as i32)
    .bind(Uuid::parse_str(&data.child_run_id).ok())
    .bind(if data.success { "completed" } else { "failed" })
    .bind(&data.output)
    .bind(&data.error)
    .execute(pool)
    .await
    .map_err(|e| MapError::DatabaseError(e.to_string()))?;
    
    // Check if this was a duplicate (no row inserted)
    // If rows_affected() == 0, the ON CONFLICT triggered and we should skip counter updates
    if insert_result.rows_affected() == 0 {
        // This is a duplicate MAPCHILDCOMPLETE - fetch current state
        let (completed_count, failed_count, total_items, status): (i32, i32, i32, String) = sqlx::query_as(
            "SELECT completed_count, failed_count, total_items, status FROM batch_operations WHERE id = $1"
        )
        .bind(batch_id)
        .fetch_one(pool)
        .await
        .map_err(|e| MapError::DatabaseError(e.to_string()))?;
        
        let total_finished = completed_count + failed_count;
        
        // BUG FIX: Check if batch should be completed (might have been missed due to race)
        if status == "running" && total_finished >= total_items {
            // Batch is actually done but wasn't marked complete - fix it now
            return complete_batch(pool, run_id, node_id, &batch_id, false, start).await;
        }
        
        // Return current progress (idempotent response)
        return Ok(ExecutionResult {
            node_id: node_id.to_string(),
            run_id: Some(run_id.to_string()),
            status_code: 202,
            body: Some(json!({
                "batch_id": batch_id.to_string(),
                "status": status,
                "completed": completed_count,
                "failed": failed_count,
                "total": total_items,
                "progress": (total_finished as f64) / (total_items as f64),
                "duplicate": true
            })),
            timestamp: std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_millis() as u64,
            duration_ms: start.elapsed().as_millis() as u64,
            isolated: true,
        });
    }
    
    // Atomically update counters AND get all fields needed for spawning (eliminates ALL extra queries)
    let (completed_count, failed_count, active_count, total_items, fail_fast, current_index, concurrency, 
         workflow_id, version_id_str, input_items, child_graph, child_depth, batch_node_id): 
        (i32, i32, i32, i32, bool, i32, i32, i32, String, serde_json::Value, serde_json::Value, i32, String) = if data.success {
        sqlx::query_as(
            r#"
            UPDATE batch_operations 
            SET completed_count = completed_count + 1, active_count = active_count - 1
            WHERE id = $1
            RETURNING completed_count, failed_count, active_count, total_items, fail_fast, current_index, 
                      concurrency_limit, child_workflow_id, COALESCE(child_version_id::text, ''), input_items,
                      COALESCE(child_graph, '{}'), COALESCE(child_depth, 1), node_id
            "#
        )
        .bind(batch_id)
        .fetch_one(pool)
        .await
        .map_err(|e| MapError::DatabaseError(e.to_string()))?
    } else {
        sqlx::query_as(
            r#"
            UPDATE batch_operations 
            SET failed_count = failed_count + 1, active_count = active_count - 1
            WHERE id = $1
            RETURNING completed_count, failed_count, active_count, total_items, fail_fast, current_index, 
                      concurrency_limit, child_workflow_id, COALESCE(child_version_id::text, ''), input_items,
                      COALESCE(child_graph, '{}'), COALESCE(child_depth, 1), node_id
            "#
        )
        .bind(batch_id)
        .fetch_one(pool)
        .await
        .map_err(|e| MapError::DatabaseError(e.to_string()))?
    };
    
    let version_id = if version_id_str.is_empty() { None } else { Some(version_id_str) };
    let _ = batch_node_id; // Used for reference, node_id comes from function param
    
    let total_finished = completed_count + failed_count;
    
    // Check if fail_fast triggered
    if fail_fast && failed_count > 0 {
        return complete_batch(pool, run_id, node_id, &batch_id, true, start).await;
    }
    
    // Check if all done
    if total_finished >= total_items {
        return complete_batch(pool, run_id, node_id, &batch_id, false, start).await;
    }
    
    // Spawn more children DIRECTLY using CACHED metadata (0 extra queries!)
    if !run_cancelled && active_count < concurrency && current_index < total_items {
        // Calculate how many to spawn
        let slots_available = (concurrency - active_count).max(0) as usize;
        let items_remaining = (total_items - current_index).max(0) as usize;
        let to_spawn = slots_available.min(items_remaining);
        
        if to_spawn > 0 {
            // Parse input items
            let items: Vec<serde_json::Value> = serde_json::from_value(input_items.clone())
                .map_err(|e| MapError::ExecutionError(format!("Invalid input_items: {}", e)))?;
            
            let version_uuid = version_id.as_ref().and_then(|v| Uuid::parse_str(v).ok());
            
            // Spawn using CACHED graph/depth (no DB queries!)
            spawn_children_cached(
                pool,
                &batch_id,
                run_id,
                node_id,
                workflow_id,
                version_uuid,
                &child_graph,
                child_depth,
                &items,
                current_index as usize,
                to_spawn,
            ).await?;
            
            // Update batch state atomically
            sqlx::query(
                "UPDATE batch_operations SET current_index = $1, active_count = $2 WHERE id = $3"
            )
            .bind(current_index + to_spawn as i32)
            .bind(active_count + to_spawn as i32)
            .bind(batch_id)
            .execute(pool)
            .await
            .map_err(|e| MapError::DatabaseError(e.to_string()))?;
        }
    } else if run_cancelled {
        // Mark batch as cancelled if we detected cancellation
        cancel_batch(pool, &batch_id).await?;
    }
    
    // Return progress update (still running)
    Ok(ExecutionResult {
        node_id: node_id.to_string(),
        run_id: Some(run_id.to_string()),
        status_code: 202,
        body: Some(json!({
            "batch_id": batch_id.to_string(),
            "status": "running",
            "completed": completed_count,
            "failed": failed_count,
            "total": total_items,
            "progress": (total_finished as f64) / (total_items as f64)
        })),
        timestamp: std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_millis() as u64,
        duration_ms: start.elapsed().as_millis() as u64,
        isolated: true,  // Don't trigger downstream yet
    })
}

/// Handle MAP_STEP: spawn next batch of children
/// 
/// Uses atomic claim-and-update to prevent race conditions when multiple
/// MAPSTEP jobs arrive simultaneously.
pub async fn handle_map_step(
    pool: &PgPool,
    run_id: &Uuid,
    node_id: &str,
    data: &MapStepData,
) -> Result<ExecutionResult, MapError> {
    let start = std::time::Instant::now();
    let batch_id = Uuid::parse_str(&data.batch_id)
        .map_err(|e| MapError::ExecutionError(format!("Invalid batch_id: {}", e)))?;
    
    // Check if run has been cancelled - don't spawn more children
    if is_run_cancelled(pool, run_id).await {
        // Mark batch as cancelled
        cancel_batch(pool, &batch_id).await?;
        return Ok(ExecutionResult {
            node_id: node_id.to_string(),
            run_id: Some(run_id.to_string()),
            status_code: 202,
            body: Some(json!({ "status": "cancelled", "batch_id": batch_id.to_string() })),
            timestamp: std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_millis() as u64,
            duration_ms: start.elapsed().as_millis() as u64,
            isolated: true,
        });
    }
    
    // Use a transaction with SELECT FOR UPDATE to prevent race conditions.
    // This ensures only one MAPSTEP can claim slots at a time for this batch.
    let mut tx = pool.begin().await
        .map_err(|e| MapError::DatabaseError(format!("Failed to start transaction: {}", e)))?;
    
    // Lock the row and read current state
    let batch_opt: Option<(i32, i32, i32, i32, i32, serde_json::Value, String, String)> = sqlx::query_as(
        r#"
        SELECT current_index, active_count, concurrency_limit, total_items, child_workflow_id, 
               input_items, COALESCE(child_version_id::text, ''), status
        FROM batch_operations 
        WHERE id = $1
        FOR UPDATE
        "#
    )
    .bind(batch_id)
    .fetch_optional(&mut *tx)
    .await
    .map_err(|e| MapError::DatabaseError(e.to_string()))?;
    
    let batch = match batch_opt {
        Some(b) => b,
        None => {
            tx.rollback().await.ok();
            return Err(MapError::ExecutionError(format!("Batch {} not found", batch_id)));
        }
    };
    
    let (current_index, active_count, concurrency, total_items, workflow_id, input_items, version_id, status) = batch;
    let version_id = if version_id.is_empty() { None } else { Some(version_id) };
    
    // Check if batch is still running
    if status != "running" {
        tx.rollback().await.ok();
        return Ok(ExecutionResult {
            node_id: node_id.to_string(),
            run_id: Some(run_id.to_string()),
            status_code: 202,
            body: Some(json!({ "status": "batch_not_running", "batch_status": status })),
            timestamp: std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_millis() as u64,
            duration_ms: start.elapsed().as_millis() as u64,
            isolated: true,
        });
    }
    
    // Calculate how many to spawn
    let slots_available = (concurrency - active_count).max(0) as usize;
    let items_remaining = (total_items - current_index).max(0) as usize;
    let to_spawn = slots_available.min(items_remaining);
    
    if to_spawn == 0 {
        tx.rollback().await.ok();
        return Ok(ExecutionResult {
            node_id: node_id.to_string(),
            run_id: Some(run_id.to_string()),
            status_code: 202,
            body: Some(json!({ 
                "status": "no_slots", 
                "batch_id": batch_id.to_string(),
                "current_index": current_index,
                "active_count": active_count,
                "concurrency": concurrency
            })),
            timestamp: std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_millis() as u64,
            duration_ms: start.elapsed().as_millis() as u64,
            isolated: true,
        });
    }
    
    // Atomically claim the slots by updating current_index and active_count
    sqlx::query(
        "UPDATE batch_operations SET current_index = $1, active_count = $2 WHERE id = $3"
    )
    .bind(current_index + to_spawn as i32)
    .bind(active_count + to_spawn as i32)
    .bind(batch_id)
    .execute(&mut *tx)
    .await
    .map_err(|e| MapError::DatabaseError(e.to_string()))?;
    
    // Commit the transaction - this releases the lock and makes our claim visible
    tx.commit().await
        .map_err(|e| MapError::DatabaseError(format!("Failed to commit transaction: {}", e)))?;
    
    // Now spawn the children (outside transaction, so other workers can proceed)
    let items: Vec<serde_json::Value> = serde_json::from_value(input_items)
        .map_err(|e| MapError::ExecutionError(format!("Invalid input_items: {}", e)))?;
    
    let map_data = MapNodeData {
        workflow_id,
        version_id,
        items,
        concurrency: concurrency as u32,
        fail_fast: false,
        timeout_ms: None,  // Timeout is checked at batch level, not per-spawn
        current_depth: 0,
        depth_limit: 10,
    };
    
    // Spawn children starting from current_index (the slots we claimed)
    spawn_children(pool, &batch_id, run_id, &map_data, current_index as usize, to_spawn).await?;
    
    // Note: counters were already updated in the transaction above
    
    Ok(ExecutionResult {
        node_id: node_id.to_string(),
        run_id: Some(run_id.to_string()),
        status_code: 202,
        body: Some(json!({
            "status": "spawned",
            "batch_id": batch_id.to_string(),
            "spawned": to_spawn
        })),
        timestamp: std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_millis() as u64,
        duration_ms: start.elapsed().as_millis() as u64,
        isolated: true,
    })
}

/// Spawn child runs for items [start_idx..start_idx+count]
/// 
/// PERFORMANCE OPTIMIZED:
/// - Single batched DB insert for all child runs
/// - Direct Redis push (skip HTTP orchestrator)
/// - Redis pipelining for all job pushes
async fn spawn_children(
    pool: &PgPool,
    batch_id: &Uuid,
    parent_run_id: &Uuid,
    data: &MapNodeData,
    start_idx: usize,
    count: usize,
) -> Result<(), MapError> {
    if count == 0 {
        return Ok(());
    }
    
    // Get parent run's depth (single query, cached for all children)
    let parent_depth: i32 = sqlx::query_scalar("SELECT depth FROM workflow_runs WHERE id = $1")
        .bind(parent_run_id)
        .fetch_one(pool)
        .await
        .map_err(|e| MapError::DatabaseError(e.to_string()))?;
    
    let child_depth = parent_depth + 1;
    
    // Get the workflow graph ONCE (from version or draft)
    let graph: serde_json::Value = if let Some(version_id) = &data.version_id {
        let version_uuid = Uuid::parse_str(version_id)
            .map_err(|e| MapError::ExecutionError(format!("Invalid version_id: {}", e)))?;
        sqlx::query_scalar("SELECT graph FROM workflow_versions WHERE id = $1")
            .bind(version_uuid)
            .fetch_one(pool)
            .await
            .map_err(|e| MapError::DatabaseError(e.to_string()))?
    } else {
        let active_version_id: Option<Uuid> = sqlx::query_scalar(
            "SELECT active_version_id FROM workflows WHERE id = $1"
        )
        .bind(data.workflow_id)
        .fetch_one(pool)
        .await
        .map_err(|e| MapError::DatabaseError(e.to_string()))?;
        
        if let Some(vid) = active_version_id {
            sqlx::query_scalar("SELECT graph FROM workflow_versions WHERE id = $1")
                .bind(vid)
                .fetch_one(pool)
                .await
                .map_err(|e| MapError::DatabaseError(e.to_string()))?
        } else {
            sqlx::query_scalar("SELECT graph FROM workflows WHERE id = $1")
                .bind(data.workflow_id)
                .fetch_one(pool)
                .await
                .map_err(|e| MapError::DatabaseError(e.to_string()))?
        }
    };
    
    // Get the node_id from batch_operations ONCE
    let node_id: String = sqlx::query_scalar("SELECT node_id FROM batch_operations WHERE id = $1")
        .bind(batch_id)
        .fetch_one(pool)
        .await
        .map_err(|e| MapError::DatabaseError(e.to_string()))?;
    
    // Find starting nodes in the graph (nodes with no incoming edges)
    let starting_nodes = find_starting_nodes(&graph);
    
    // Prepare all children data
    let version_uuid = data.version_id.as_ref().and_then(|v| Uuid::parse_str(v).ok());
    let mut child_runs: Vec<(Uuid, usize, &serde_json::Value)> = Vec::with_capacity(count);
    
    for i in start_idx..(start_idx + count) {
        if i >= data.items.len() {
            break;
        }
        child_runs.push((Uuid::new_v4(), i, &data.items[i]));
    }
    
    // BATCH INSERT: Insert all child runs in a single query using UNNEST
    // This is ~10x faster than individual inserts
    let ids: Vec<Uuid> = child_runs.iter().map(|(id, _, _)| *id).collect();
    let workflow_ids: Vec<i32> = vec![data.workflow_id; child_runs.len()];
    let version_ids: Vec<Option<Uuid>> = vec![version_uuid; child_runs.len()];
    let graphs: Vec<serde_json::Value> = vec![graph.clone(); child_runs.len()];
    let input_datas: Vec<serde_json::Value> = child_runs.iter()
        .map(|(_, i, item)| json!({
            "item": item,
            "index": i,
            "batch_id": batch_id.to_string()
        }))
        .collect();
    let parent_run_ids: Vec<Uuid> = vec![*parent_run_id; child_runs.len()];
    let parent_node_ids: Vec<String> = vec![node_id.clone(); child_runs.len()];
    let depths: Vec<i32> = vec![child_depth; child_runs.len()];
    
    sqlx::query(
        r#"
        INSERT INTO workflow_runs (id, workflow_id, workflow_version_id, snapshot_graph, status, trigger, input_data, parent_run_id, parent_node_id, depth)
        SELECT * FROM UNNEST($1::uuid[], $2::int[], $3::uuid[], $4::jsonb[], 
                            ARRAY_FILL('running'::text, ARRAY[$9]), 
                            ARRAY_FILL('map'::text, ARRAY[$9]),
                            $5::jsonb[], $6::uuid[], $7::text[], $8::int[])
        "#
    )
    .bind(&ids)
    .bind(&workflow_ids)
    .bind(&version_ids)
    .bind(&graphs)
    .bind(&input_datas)
    .bind(&parent_run_ids)
    .bind(&parent_node_ids)
    .bind(&depths)
    .bind(child_runs.len() as i32)
        .execute(pool)
        .await
        .map_err(|e| MapError::DatabaseError(e.to_string()))?;
        
    // Build jobs for each starting node of each child run
    // DIRECT REDIS PUSH: Skip HTTP orchestrator entirely
    let redis_client = redis::Client::open(
        std::env::var("REDIS_URL").unwrap_or_else(|_| "redis://127.0.0.1:6379".to_string())
    ).map_err(|e| MapError::ExecutionError(format!("Redis client error: {}", e)))?;
    
    let mut conn = redis_client.get_multiplexed_async_connection().await
        .map_err(|e| MapError::ExecutionError(format!("Redis connection error: {}", e)))?;
    
    // REDIS PIPELINING: Push all jobs in a single network round-trip
    let mut pipe = redis::pipe();
    
    for (child_run_id, item_idx, item) in &child_runs {
        let input_data = json!({
            "item": item,
            "index": item_idx,
            "batch_id": batch_id.to_string()
        });
        
        for start_node in &starting_nodes {
            if let Some(job) = build_child_job(start_node, child_run_id, &input_data) {
                pipe.cmd("XADD")
                    .arg("swiftgrid_stream")
                    .arg("*")
                    .arg("payload")
                    .arg(job);
            }
        }
    }
    
    // Execute all job pushes in ONE network call
    pipe.query_async::<()>(&mut conn).await
        .map_err(|e| MapError::ExecutionError(format!("Redis pipeline error: {}", e)))?;
    
    Ok(())
}

/// Spawn child runs using CACHED metadata (0 DB queries for metadata!)
/// 
/// This is the optimized version called from handle_child_complete.
/// All metadata (graph, depth, node_id) comes from the UPDATE RETURNING,
/// eliminating 3-4 SELECT queries per spawn batch.
async fn spawn_children_cached(
    pool: &PgPool,
    batch_id: &Uuid,
    parent_run_id: &Uuid,
    parent_node_id: &str,
    workflow_id: i32,
    version_uuid: Option<Uuid>,
    graph: &serde_json::Value,
    child_depth: i32,
    items: &[serde_json::Value],
    start_idx: usize,
    count: usize,
) -> Result<(), MapError> {
    if count == 0 {
        return Ok(());
    }
    
    // Find starting nodes in the graph (computed, no DB query)
    let starting_nodes = find_starting_nodes(graph);
    
    // Prepare all children data
    let mut child_runs: Vec<(Uuid, usize, &serde_json::Value)> = Vec::with_capacity(count);
    
    for i in start_idx..(start_idx + count) {
        if i >= items.len() {
            break;
        }
        child_runs.push((Uuid::new_v4(), i, &items[i]));
    }
    
    if child_runs.is_empty() {
        return Ok(());
    }
    
    // BATCH INSERT: Insert all child runs in a single query using UNNEST
    let ids: Vec<Uuid> = child_runs.iter().map(|(id, _, _)| *id).collect();
    let workflow_ids: Vec<i32> = vec![workflow_id; child_runs.len()];
    let version_ids: Vec<Option<Uuid>> = vec![version_uuid; child_runs.len()];
    let graphs: Vec<serde_json::Value> = vec![graph.clone(); child_runs.len()];
    let input_datas: Vec<serde_json::Value> = child_runs.iter()
        .map(|(_, i, item)| json!({
            "item": item,
            "index": i,
            "batch_id": batch_id.to_string()
        }))
        .collect();
    let parent_run_ids: Vec<Uuid> = vec![*parent_run_id; child_runs.len()];
    let parent_node_ids: Vec<String> = vec![parent_node_id.to_string(); child_runs.len()];
    let depths: Vec<i32> = vec![child_depth; child_runs.len()];
    
    sqlx::query(
        r#"
        INSERT INTO workflow_runs (id, workflow_id, workflow_version_id, snapshot_graph, status, trigger, input_data, parent_run_id, parent_node_id, depth)
        SELECT * FROM UNNEST($1::uuid[], $2::int[], $3::uuid[], $4::jsonb[], 
                            ARRAY_FILL('running'::text, ARRAY[$9]), 
                            ARRAY_FILL('map'::text, ARRAY[$9]),
                            $5::jsonb[], $6::uuid[], $7::text[], $8::int[])
        "#
    )
    .bind(&ids)
    .bind(&workflow_ids)
    .bind(&version_ids)
    .bind(&graphs)
    .bind(&input_datas)
    .bind(&parent_run_ids)
    .bind(&parent_node_ids)
    .bind(&depths)
    .bind(child_runs.len() as i32)
    .execute(pool)
    .await
    .map_err(|e| MapError::DatabaseError(e.to_string()))?;
    
    // DIRECT REDIS PUSH with pipelining
    let redis_client = redis::Client::open(
        std::env::var("REDIS_URL").unwrap_or_else(|_| "redis://127.0.0.1:6379".to_string())
    ).map_err(|e| MapError::ExecutionError(format!("Redis client error: {}", e)))?;
    
    let mut conn = redis_client.get_multiplexed_async_connection().await
        .map_err(|e| MapError::ExecutionError(format!("Redis connection error: {}", e)))?;
    
    let mut pipe = redis::pipe();
    
    for (child_run_id, item_idx, item) in &child_runs {
        let input_data = json!({
            "item": item,
            "index": item_idx,
            "batch_id": batch_id.to_string()
        });
        
        for start_node in &starting_nodes {
            if let Some(job) = build_child_job(start_node, child_run_id, &input_data) {
                pipe.cmd("XADD")
                    .arg("swiftgrid_stream")
                    .arg("*")
                    .arg("payload")
                    .arg(job);
            }
        }
    }
    
    pipe.query_async::<()>(&mut conn).await
        .map_err(|e| MapError::ExecutionError(format!("Redis pipeline error: {}", e)))?;
    
    Ok(())
}

/// Find nodes with no incoming edges (starting nodes)
fn find_starting_nodes(graph: &serde_json::Value) -> Vec<serde_json::Value> {
    let nodes = graph.get("nodes").and_then(|n| n.as_array()).cloned().unwrap_or_default();
    let edges = graph.get("edges").and_then(|e| e.as_array()).cloned().unwrap_or_default();
    
    let target_ids: std::collections::HashSet<&str> = edges.iter()
        .filter_map(|e| e.get("target").and_then(|t| t.as_str()))
        .collect();
    
    nodes.into_iter()
        .filter(|n| {
            let id = n.get("id").and_then(|id| id.as_str()).unwrap_or("");
            !target_ids.contains(id)
        })
        .collect()
}

/// Build a job payload for a child workflow node
fn build_child_job(node: &serde_json::Value, run_id: &Uuid, input_data: &serde_json::Value) -> Option<String> {
    let node_id = node.get("id")?.as_str()?;
    let node_type = node.get("type")?.as_str()?;
    let node_data = node.get("data")?;
    
    // Simple template interpolation for {{$trigger.X}} patterns
    let process_string = |s: &str| -> String {
        let mut result = s.to_string();
        if let Some(obj) = input_data.as_object() {
            for (key, value) in obj {
                let pattern = format!("{{{{$trigger.{}}}}}", key);
                let replacement = match value {
                    serde_json::Value::String(s) => s.clone(),
                    _ => value.to_string(),
                };
                result = result.replace(&pattern, &replacement);
            }
        }
        result
    };
    
    let job = match node_type {
        "code" | "code-execution" => {
            // Process inputs template
            let inputs_str = node_data.get("inputs").and_then(|v| v.as_str()).unwrap_or("{}");
            let processed_inputs = process_string(inputs_str);
            let inputs: serde_json::Value = serde_json::from_str(&processed_inputs).unwrap_or(json!({}));
            
            json!({
                "id": node_id,
                "run_id": run_id.to_string(),
                "node": {
                    "type": "CODE",
                    "data": {
                        "code": node_data.get("code").and_then(|v| v.as_str()).unwrap_or("return {};"),
                        "inputs": inputs
                    }
                },
                "retry_count": 0,
                "max_retries": 3,
                "isolated": false
            })
        }
        "http" | "http-request" => {
            json!({
                "id": node_id,
                "run_id": run_id.to_string(),
                "node": {
                    "type": "HTTP",
                    "data": {
                        "url": process_string(node_data.get("url").and_then(|v| v.as_str()).unwrap_or("")),
                        "method": node_data.get("method").and_then(|v| v.as_str()).unwrap_or("GET"),
                        "headers": node_data.get("headers"),
                        "body": node_data.get("body")
                    }
                },
                "retry_count": 0,
                "max_retries": 3,
                "isolated": false
            })
        }
        _ => return None, // Skip unsupported node types for now
    };
    
    serde_json::to_string(&job).ok()
}

/// Complete the batch: aggregate results and return final output
async fn complete_batch(
    pool: &PgPool,
    run_id: &Uuid,
    node_id: &str,
    batch_id: &Uuid,
    failed_early: bool,
    start: std::time::Instant,
) -> Result<ExecutionResult, MapError> {
    // Mark batch as completed
    let status = if failed_early { "failed" } else { "completed" };
    sqlx::query("UPDATE batch_operations SET status = $1, completed_at = NOW() WHERE id = $2")
        .bind(status)
        .bind(batch_id)
        .execute(pool)
        .await
        .map_err(|e| MapError::DatabaseError(e.to_string()))?;
    
    // Fetch all results in order
    let results: Vec<(i32, String, Option<serde_json::Value>, Option<String>)> = sqlx::query_as(
        r#"
        SELECT item_index, status, output, error_message
        FROM batch_results
        WHERE batch_id = $1
        ORDER BY item_index
        "#
    )
    .bind(batch_id)
    .fetch_all(pool)
    .await
    .map_err(|e| MapError::DatabaseError(e.to_string()))?;
    
    // Get batch stats and created_at for total duration calculation
    let (total_items, completed_count, failed_count, created_at): (i32, i32, i32, chrono::DateTime<chrono::Utc>) = sqlx::query_as(
        "SELECT total_items, completed_count, failed_count, created_at FROM batch_operations WHERE id = $1"
    )
    .bind(batch_id)
    .fetch_one(pool)
    .await
    .map_err(|e| MapError::DatabaseError(e.to_string()))?;
    
    // Calculate total execution time
    let total_duration_ms = (chrono::Utc::now() - created_at).num_milliseconds().max(0) as u64;
    let total_duration_secs = total_duration_ms as f64 / 1000.0;
    
    // Build results arrays
    let mut outputs: Vec<Option<serde_json::Value>> = vec![None; total_items as usize];
    let mut errors: Vec<serde_json::Value> = Vec::new();
    
    for (idx, status, output, error) in results {
        if idx >= 0 && (idx as usize) < outputs.len() {
            if status == "completed" {
                outputs[idx as usize] = output;
            } else {
                errors.push(json!({
                    "index": idx,
                    "error": error.unwrap_or_else(|| "Unknown error".to_string())
                }));
            }
        }
    }
    
    // Log completion
    let _ = log_event_with_retry(
        pool,
        run_id,
        node_id,
        if failed_early { EventType::NodeFailed } else { EventType::NodeCompleted },
        Some(0),
        json!({
            "batch_id": batch_id.to_string(),
            "total": total_items,
            "completed": completed_count,
            "failed": failed_count
        }),
    ).await;
    
    // Determine status code
    let status_code = if failed_early || failed_count == total_items {
        500
    } else {
        200
    };
    
    // Calculate throughput and latency metrics
    let items_per_sec = if total_duration_secs > 0.0 {
        (total_items as f64 / total_duration_secs).round()
    } else {
        0.0
    };
    
    // Get configured concurrency for the batch
    let concurrency: i32 = sqlx::query_scalar("SELECT concurrency_limit FROM batch_operations WHERE id = $1")
        .bind(batch_id)
        .fetch_one(pool)
        .await
        .unwrap_or(50);
    
    // Calculate effective latency per item (Little's Law: Latency = Concurrency / Throughput)
    let avg_latency_ms = if items_per_sec > 0.0 {
        ((concurrency as f64 / items_per_sec) * 1000.0).round() as u64
    } else {
        0
    };
    
    // Suggest optimal concurrency based on current throughput
    let suggested_concurrency = if avg_latency_ms > 0 {
        // If latency is high (>500ms), suggest doubling concurrency
        // If latency is low (<100ms), current concurrency is fine
        if avg_latency_ms > 1000 {
            (concurrency * 2).min(200)
        } else {
            concurrency
        }
    } else {
        concurrency
    };
    
    Ok(ExecutionResult {
        node_id: node_id.to_string(),
        run_id: Some(run_id.to_string()),
        status_code,
        body: Some(json!({
            "results": outputs,
            "errors": errors,
            "stats": {
                "total": total_items,
                "completed": completed_count,
                "failed": failed_count,
                "duration_ms": total_duration_ms,
                "duration_secs": total_duration_secs,
                "items_per_sec": items_per_sec,
                "avg_latency_ms": avg_latency_ms,
                "concurrency_used": concurrency,
                "suggested_concurrency": suggested_concurrency
            },
            "route_to": if failed_early || failed_count == total_items { "error" } else { "success" }
        })),
        timestamp: std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_millis() as u64,
        duration_ms: start.elapsed().as_millis() as u64,
        isolated: false,
    })
}
