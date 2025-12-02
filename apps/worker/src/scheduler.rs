//! Scheduler for delayed jobs, expired suspensions, and cron workflows.
//!
//! Runs in a background loop, polling for:
//! - Redis delayed jobs ready to execute (every 1s)
//! - PostgreSQL expired webhook suspensions (every 10s)
//! - PostgreSQL scheduled workflows due to run (every 10s)

use chrono::{DateTime, Utc};
use chrono_tz::Tz;
use cron::Schedule;
use redis::{AsyncCommands, RedisResult};
use sqlx::PgPool;
use std::str::FromStr;
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use uuid::Uuid;

/// Redis sorted set for delayed jobs
const DELAYED_JOBS_KEY: &str = "swiftgrid_delayed";
/// Redis stream for active jobs
const ACTIVE_JOBS_KEY: &str = "swiftgrid_stream";

/// Run the scheduler loop.
///
/// This function runs forever, checking for:
/// - Delayed jobs ready to execute (every 1s)
/// - Expired webhook suspensions (every 10s)
/// - Scheduled workflows due to run (every 10s)
pub async fn run(redis_client: redis::Client, db_pool: PgPool) {
    println!("Scheduler started (polling every 1s)");
    println!("  - Delayed jobs: every 1s");
    println!("  - Expired suspensions: every 10s");
    println!("  - Cron workflows: every 10s");

    let poll_interval = Duration::from_secs(1);
    let mut slow_check_counter = 0u32;

    loop {
        // Check delayed jobs every iteration (1s)
        process_delayed_jobs(&redis_client).await;

        // Check for slow tasks every 10 seconds
        slow_check_counter += 1;
        if slow_check_counter >= 10 {
            slow_check_counter = 0;
            
            // Run these in parallel
            tokio::join!(
                check_expired_suspensions(&db_pool),
                check_subflow_timeouts(&db_pool, &redis_client),
                check_batch_timeouts(&db_pool, &redis_client),
                check_stale_batches(&db_pool, &redis_client),
                check_scheduled_workflows(&db_pool, &redis_client)
            );
        }

        tokio::time::sleep(poll_interval).await;
    }
}

/// Process delayed jobs that are ready to execute.
async fn process_delayed_jobs(redis_client: &redis::Client) {
    let Ok(mut con) = redis_client.get_multiplexed_async_connection().await else {
        return;
    };

    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_millis() as f64;

    // Get all jobs that are ready (score <= now)
    let ready_jobs: Vec<String> = match con
        .zrangebyscore_limit(DELAYED_JOBS_KEY, "-inf", now, 0, 10)
        .await
    {
        Ok(jobs) => jobs,
        Err(e) => {
            eprintln!("Scheduler: Failed to query delayed jobs: {}", e);
            return;
        }
    };

    if ready_jobs.is_empty() {
        return;
    }

    println!(
        "Scheduler: Found {} delayed job(s) ready to run",
        ready_jobs.len()
    );

    for job_json in &ready_jobs {
        let _: RedisResult<()> = con.zrem(DELAYED_JOBS_KEY, job_json).await;
        let _: RedisResult<String> = con
            .xadd(ACTIVE_JOBS_KEY, "*", &[("payload", job_json.as_str())])
            .await;
    }
}

/// Check for expired suspensions and fail them.
async fn check_expired_suspensions(pool: &PgPool) {
    let expired: Vec<(Uuid, String, Uuid)> = match sqlx::query_as(
        r#"
        SELECT id, node_id, run_id FROM suspensions 
        WHERE resumed_at IS NULL 
          AND expires_at IS NOT NULL 
          AND expires_at < NOW()
        LIMIT 10
        "#,
    )
    .fetch_all(pool)
    .await
    {
        Ok(rows) => rows,
        Err(e) => {
            eprintln!("Scheduler: Failed to query expired suspensions: {}", e);
            return;
        }
    };

    for (suspension_id, node_id, run_id) in expired {
        println!(
            "Scheduler: Expiring suspension for node {} in run {}",
            node_id, run_id
        );

        let _ = sqlx::query(
            r#"
            INSERT INTO run_events (run_id, node_id, event_type, payload)
            VALUES ($1, $2, 'NODE_FAILED', $3)
            "#,
        )
        .bind(&run_id)
        .bind(&node_id)
        .bind(serde_json::json!({
            "error": "Suspension timeout expired",
            "fatal": true,
        }))
        .execute(pool)
        .await;

        let _ = sqlx::query(
            r#"
            UPDATE suspensions 
            SET resumed_at = NOW(), 
                resumed_by = 'scheduler:timeout',
                resume_payload = $1
            WHERE id = $2
            "#,
        )
        .bind(serde_json::json!({"timeout": true}))
        .bind(&suspension_id)
        .execute(pool)
        .await;
    }
}

/// Check for sub-flow timeouts and fail the parent node.
async fn check_subflow_timeouts(pool: &PgPool, redis_client: &redis::Client) {
    // Find sub-flow suspensions that have timed out
    let timed_out: Vec<(Uuid, String, Uuid, serde_json::Value)> = match sqlx::query_as(
        r#"
        SELECT id, node_id, run_id, execution_context FROM suspensions 
        WHERE resumed_at IS NULL 
          AND suspension_type = 'subflow'
          AND resume_after IS NOT NULL 
          AND resume_after < NOW()
        LIMIT 10
        "#,
    )
    .fetch_all(pool)
    .await
    {
        Ok(rows) => rows,
        Err(e) => {
            eprintln!("Scheduler: Failed to query sub-flow timeouts: {}", e);
            return;
        }
    };

    if timed_out.is_empty() {
        return;
    }

    println!(
        "Scheduler: Found {} sub-flow timeout(s) to process",
        timed_out.len()
    );

    let Ok(mut con) = redis_client.get_multiplexed_async_connection().await else {
        eprintln!("Scheduler: Failed to connect to Redis for sub-flow timeouts");
        return;
    };

    for (suspension_id, node_id, parent_run_id, context) in timed_out {
        let child_run_id = context.get("child_run_id").and_then(|v| v.as_str()).unwrap_or("");
        let _fail_on_error = context.get("fail_on_error").and_then(|v| v.as_bool()).unwrap_or(false);

        println!(
            "Scheduler: Sub-flow timeout for node {} in run {} (child: {})",
            node_id, parent_run_id, child_run_id
        );

        // Check if child run has already completed
        let child_status: Option<(String,)> = sqlx::query_as(
            "SELECT status FROM workflow_runs WHERE id = $1"
        )
        .bind(Uuid::parse_str(child_run_id).ok())
        .fetch_optional(pool)
        .await
        .ok()
        .flatten();

        if let Some((status,)) = child_status {
            if status == "completed" || status == "failed" || status == "cancelled" {
                // Child already finished, just mark suspension as resolved
                let _ = sqlx::query(
                    "UPDATE suspensions SET resumed_at = NOW(), resumed_by = 'scheduler:child_finished' WHERE id = $1"
                )
                .bind(&suspension_id)
                .execute(pool)
                .await;
                continue;
            }
        }

        // Cancel the child run
        if let Ok(child_uuid) = Uuid::parse_str(child_run_id) {
            let _ = sqlx::query(
                "UPDATE workflow_runs SET status = 'cancelled', completed_at = NOW() WHERE id = $1"
            )
            .bind(&child_uuid)
            .execute(pool)
            .await;

            // Publish cancellation signal
            let _: RedisResult<i32> = con.publish(format!("cancel:{}", child_run_id), "timeout").await;
        }

        // Resume the parent with timeout error
        let resume_job = serde_json::json!({
            "id": node_id,
            "run_id": parent_run_id.to_string(),
            "node": {
                "type": "SUBFLOWRESUME",
                "data": {
                    "child_run_id": child_run_id,
                    "output": null,
                    "success": false,
                    "error": "Sub-flow timed out"
                }
            },
            "retry_count": 0,
            "max_retries": 0
        });

        let _: RedisResult<String> = con
            .xadd(ACTIVE_JOBS_KEY, "*", &[("payload", resume_job.to_string())])
            .await;

        // Mark suspension as resolved
        let _ = sqlx::query(
            r#"
            UPDATE suspensions 
            SET resumed_at = NOW(), 
                resumed_by = 'scheduler:timeout',
                resume_payload = $1
            WHERE id = $2
            "#,
        )
        .bind(serde_json::json!({"timeout": true, "child_run_id": child_run_id}))
        .bind(&suspension_id)
        .execute(pool)
        .await;

        // Update parent run status back to running
        let _ = sqlx::query(
            "UPDATE workflow_runs SET status = 'running' WHERE id = $1"
        )
        .bind(&parent_run_id)
        .execute(pool)
        .await;
    }
}

/// Check for stale/stuck batch operations that may have lost their worker.
/// A batch is considered stale if:
/// - Status is 'running'
/// - Created more than 60 seconds ago  
/// - No batch_results created in the last 30 seconds
/// - Items remaining to process but no active children (active_count = 0)
async fn check_stale_batches(pool: &PgPool, redis_client: &redis::Client) {
    // Find running batches that appear stuck
    let stale: Vec<(Uuid, String, Uuid, i32, i32, i32, i32, i32)> = match sqlx::query_as(
        r#"
        SELECT bo.id, bo.node_id, bo.run_id, bo.total_items, bo.completed_count, 
               bo.failed_count, bo.active_count, bo.current_index
        FROM batch_operations bo
        WHERE bo.status = 'running'
          AND bo.created_at < NOW() - INTERVAL '60 seconds'
          AND bo.active_count = 0
          AND (bo.completed_count + bo.failed_count) < bo.total_items
          AND NOT EXISTS (
              SELECT 1 FROM batch_results br 
              WHERE br.batch_id = bo.id 
              AND br.created_at > NOW() - INTERVAL '30 seconds'
          )
        LIMIT 5
        "#,
    )
    .fetch_all(pool)
    .await
    {
        Ok(rows) => rows,
        Err(e) => {
            eprintln!("Scheduler: Failed to query stale batches: {}", e);
            return;
        }
    };

    if stale.is_empty() {
        return;
    }

    println!(
        "Scheduler: Found {} stale batch(es) to recover",
        stale.len()
    );

    let Ok(mut con) = redis_client.get_multiplexed_async_connection().await else {
        eprintln!("Scheduler: Failed to connect to Redis for batch recovery");
        return;
    };

    for (batch_id, node_id, run_id, total_items, completed_count, failed_count, _active_count, current_index) in stale {
        let finished = completed_count + failed_count;
        
        if finished >= total_items {
            // All items processed but batch not marked complete - push completion job
            println!(
                "Scheduler: Batch {} has all results ({}/{}), triggering completion",
                batch_id, finished, total_items
            );
            
            // Send a special completion trigger
            let complete_job = serde_json::json!({
                "id": node_id,
                "run_id": run_id.to_string(),
                "node": {
                    "type": "MAPCHILDCOMPLETE",
                    "data": {
                        "batch_id": batch_id.to_string(),
                        "child_run_id": "00000000-0000-0000-0000-000000000000",
                        "item_index": -1,  // Trigger completion check
                        "success": true,
                        "output": null,
                        "error": null
                    }
                },
                "retry_count": 0,
                "max_retries": 0,
                "isolated": false
            });
            
            let _: RedisResult<String> = con
                .xadd(ACTIVE_JOBS_KEY, "*", &[("payload", complete_job.to_string())])
                .await;
        } else if current_index < total_items {
            // More items to process - push a MAPSTEP to resume spawning
            println!(
                "Scheduler: Recovering stale batch {} for node {} ({}/{} completed, spawning more)",
                batch_id, node_id, finished, total_items
            );
            
            let step_job = serde_json::json!({
                "id": node_id,
                "run_id": run_id.to_string(),
                "node": {
                    "type": "MAPSTEP",
                    "data": {
                        "batch_id": batch_id.to_string()
                    }
                },
                "retry_count": 0,
                "max_retries": 0,
                "isolated": false
            });
            
            let _: RedisResult<String> = con
                .xadd(ACTIVE_JOBS_KEY, "*", &[("payload", step_job.to_string())])
                .await;
        } else {
            // All items spawned but not all completed - children may be stuck
            // Check for orphaned child runs
            let orphaned: i64 = sqlx::query_scalar(
                r#"
                SELECT COUNT(*) FROM workflow_runs 
                WHERE parent_run_id = $1 
                AND status IN ('pending', 'running')
                AND created_at < NOW() - INTERVAL '120 seconds'
                "#
            )
            .bind(&run_id)
            .fetch_one(pool)
            .await
            .unwrap_or(0);
            
            if orphaned > 0 {
                println!(
                    "Scheduler: Batch {} has {} orphaned children, marking as failed",
                    batch_id, orphaned
                );
                
                // Mark orphaned children as failed
                let _ = sqlx::query(
                    r#"
                    UPDATE workflow_runs 
                    SET status = 'failed', completed_at = NOW()
                    WHERE parent_run_id = $1 
                    AND status IN ('pending', 'running')
                    AND created_at < NOW() - INTERVAL '120 seconds'
                    "#
                )
                .bind(&run_id)
                .execute(pool)
                .await;
                
                // Push completion job to finalize batch with partial results
                let complete_job = serde_json::json!({
                    "id": node_id,
                    "run_id": run_id.to_string(),
                    "node": {
                        "type": "MAPCHILDCOMPLETE", 
                        "data": {
                            "batch_id": batch_id.to_string(),
                            "child_run_id": "00000000-0000-0000-0000-000000000000",
                            "item_index": -1,
                            "success": false,
                            "output": null,
                            "error": "Child runs orphaned/stuck"
                        }
                    },
                    "retry_count": 0,
                    "max_retries": 0,
                    "isolated": false
                });
                
                let _: RedisResult<String> = con
                    .xadd(ACTIVE_JOBS_KEY, "*", &[("payload", complete_job.to_string())])
                    .await;
            }
        }
    }
}

/// Check for batch operations that have timed out.
/// A batch times out if it has a timeout_ms set and created_at + timeout_ms < NOW()
async fn check_batch_timeouts(pool: &PgPool, redis_client: &redis::Client) {
    // Find running batches that have exceeded their timeout
    let timed_out: Vec<(Uuid, String, Uuid, i32, i32, i32, i32)> = match sqlx::query_as(
        r#"
        SELECT id, node_id, run_id, total_items, completed_count, failed_count, active_count
        FROM batch_operations 
        WHERE status = 'running'
          AND timeout_ms IS NOT NULL 
          AND created_at + (timeout_ms || ' milliseconds')::interval < NOW()
        LIMIT 10
        "#,
    )
    .fetch_all(pool)
    .await
    {
        Ok(rows) => rows,
        Err(e) => {
            eprintln!("Scheduler: Failed to query batch timeouts: {}", e);
            return;
        }
    };

    if timed_out.is_empty() {
        return;
    }

    println!(
        "Scheduler: Found {} batch timeout(s) to process",
        timed_out.len()
    );

    let Ok(mut con) = redis_client.get_multiplexed_async_connection().await else {
        eprintln!("Scheduler: Failed to connect to Redis for batch timeouts");
        return;
    };

    for (batch_id, node_id, run_id, total_items, completed_count, failed_count, active_count) in timed_out {
        println!(
            "Scheduler: Batch timeout for node {} in run {} ({}/{} completed, {} active)",
            node_id, run_id, completed_count, total_items, active_count
        );

        // Mark batch as timed_out
        let _ = sqlx::query(
            "UPDATE batch_operations SET status = 'timed_out', completed_at = NOW() WHERE id = $1"
        )
        .bind(&batch_id)
        .execute(pool)
        .await;

        // Cancel active child runs
        let _ = sqlx::query(
            r#"
            UPDATE workflow_runs 
            SET status = 'cancelled', completed_at = NOW() 
            WHERE parent_run_id = $1 
              AND status IN ('pending', 'running')
            "#
        )
        .bind(&run_id)
        .execute(pool)
        .await;

        // Create a MAPCHILDCOMPLETE event to finalize the batch with timeout error
        // This will aggregate partial results and route appropriately
        let timeout_job = serde_json::json!({
            "id": node_id,
            "run_id": run_id.to_string(),
            "node": {
                "type": "MAPCHILDCOMPLETE",
                "data": {
                    "batch_id": batch_id.to_string(),
                    "child_run_id": "00000000-0000-0000-0000-000000000000",
                    "item_index": -1,  // Special marker for timeout
                    "success": false,
                    "output": null,
                    "error": "Batch operation timed out"
                }
            },
            "retry_count": 0,
            "max_retries": 0,
            "isolated": false
        });

        // Log the timeout event
        let _ = sqlx::query(
            r#"
            INSERT INTO run_events (run_id, node_id, event_type, payload)
            VALUES ($1, $2, 'NODE_FAILED', $3)
            "#,
        )
        .bind(&run_id)
        .bind(&node_id)
        .bind(serde_json::json!({
            "error": "Batch operation timed out",
            "batch_id": batch_id.to_string(),
            "completed": completed_count,
            "failed": failed_count,
            "total": total_items
        }))
        .execute(pool)
        .await;

        // Push the completion job to finalize results
        let _: RedisResult<String> = con
            .xadd(ACTIVE_JOBS_KEY, "*", &[("payload", timeout_job.to_string())])
            .await;
    }
}

/// Check for scheduled workflows that are due to run.
/// Uses the active published version if available, otherwise falls back to draft.
async fn check_scheduled_workflows(pool: &PgPool, redis_client: &redis::Client) {
    // Query for workflows that are due to run
    // Use FOR UPDATE SKIP LOCKED to prevent multiple workers from picking up the same workflow
    // Join with workflow_versions to get the active version's graph if available
    let due_workflows: Vec<(i32, String, serde_json::Value, String, String, Option<serde_json::Value>, String, Option<Uuid>)> = 
        match sqlx::query_as(
            r#"
            SELECT 
                w.id, 
                w.name, 
                COALESCE(wv.graph, w.graph) as graph,
                w.schedule_cron, 
                COALESCE(w.schedule_timezone, 'UTC') as timezone,
                w.schedule_input_data,
                COALESCE(w.schedule_overlap_mode, 'skip') as overlap_mode,
                w.active_version_id
            FROM workflows w
            LEFT JOIN workflow_versions wv ON w.active_version_id = wv.id
            WHERE w.schedule_enabled = true
              AND w.schedule_next_run IS NOT NULL
              AND w.schedule_next_run <= NOW()
            FOR UPDATE OF w SKIP LOCKED
            LIMIT 10
            "#,
        )
        .fetch_all(pool)
        .await
    {
        Ok(rows) => rows,
        Err(e) => {
            eprintln!("Scheduler: Failed to query scheduled workflows: {}", e);
            return;
        }
    };

    if due_workflows.is_empty() {
        return;
    }

    println!(
        "Scheduler: Found {} scheduled workflow(s) due to run",
        due_workflows.len()
    );

    let Ok(mut con) = redis_client.get_multiplexed_async_connection().await else {
        eprintln!("Scheduler: Failed to connect to Redis");
        return;
    };

    for (workflow_id, name, graph, cron_expr, timezone, input_data, overlap_mode, active_version_id) in due_workflows {
        // Check overlap mode
        if overlap_mode == "skip" {
            // Check if there's already a running instance
            let running_count: (i64,) = match sqlx::query_as(
                r#"
                SELECT COUNT(*) FROM workflow_runs 
                WHERE workflow_id = $1 
                  AND status IN ('pending', 'running')
                  AND trigger = 'cron'
                "#,
            )
            .bind(workflow_id)
            .fetch_one(pool)
            .await
            {
                Ok(count) => count,
                Err(_) => (0,),
            };

            if running_count.0 > 0 {
                // Update next_run time to prevent constant re-checking
                if let Some(next_run) = calculate_next_cron_run(&cron_expr, &timezone) {
                    match sqlx::query(
                        "UPDATE workflows SET schedule_next_run = $1 WHERE id = $2",
                    )
                    .bind(next_run)
                    .bind(workflow_id)
                    .execute(pool)
                    .await
                    {
                        Ok(result) => {
                            if result.rows_affected() > 0 {
                                println!(
                                    "Scheduler: Skipping '{}' - {} pending/running cron run(s). Next check at {} UTC",
                                    name,
                                    running_count.0,
                                    next_run.format("%Y-%m-%d %H:%M:%S")
                                );
                            }
                        }
                        Err(e) => {
                            eprintln!("Scheduler: Failed to update next_run for '{}': {}", name, e);
                        }
                    }
                }
                continue;
            }
        }

        // Create a new run
        let run_id = Uuid::new_v4();

        if active_version_id.is_some() {
            println!(
                "Scheduler: Starting cron run for '{}' (run_id: {}, using published version)",
                name,
                &run_id.to_string()[..8]
            );
        } else {
            // Warn when running unpublished workflow - this shouldn't happen after migration
            eprintln!(
                "Scheduler: Starting cron run for '{}' (run_id: {}) using DRAFT - no published version exists!",
            name,
                &run_id.to_string()[..8]
        );
        }

        // Insert the workflow run (with version ID if using published version)
        let insert_result = sqlx::query(
            r#"
            INSERT INTO workflow_runs (id, workflow_id, workflow_version_id, snapshot_graph, status, trigger, input_data)
            VALUES ($1, $2, $3, $4, 'pending', 'cron', $5)
            "#,
        )
        .bind(&run_id)
        .bind(workflow_id)
        .bind(&active_version_id)
        .bind(&graph)
        .bind(&input_data)
        .execute(pool)
        .await;

        if let Err(e) = insert_result {
            eprintln!("Scheduler: Failed to create run for '{}': {}", name, e);
            continue;
        }

        // Log RUN_CREATED event
        let _ = sqlx::query(
            r#"
            INSERT INTO run_events (run_id, event_type, payload)
            VALUES ($1, 'RUN_CREATED', $2)
            "#,
        )
        .bind(&run_id)
        .bind(serde_json::json!({
            "trigger": "cron",
            "schedule": cron_expr,
            "workflow_name": name,
        }))
        .execute(pool)
        .await;

        // Find and schedule starting nodes
        if let Some(nodes) = graph.get("nodes").and_then(|n| n.as_array()) {
            if let Some(edges) = graph.get("edges").and_then(|e| e.as_array()) {
                // Find nodes with no incoming edges (starting nodes)
                let target_ids: Vec<&str> = edges
                    .iter()
                    .filter_map(|e| e.get("target").and_then(|t| t.as_str()))
                    .collect();

                for node in nodes {
                    let node_id = node.get("id").and_then(|id| id.as_str()).unwrap_or("");
                    
                    // Skip if this node has incoming edges
                    if target_ids.contains(&node_id) {
                        continue;
                    }

                    // Build job payload based on node type
                    if let Some(job_payload) = build_job_payload(node, &run_id, &input_data) {
                        let _: RedisResult<String> = con
                            .xadd(ACTIVE_JOBS_KEY, "*", &[("payload", job_payload)])
                            .await;
                        
                        // Log NODE_SCHEDULED event
                        let _ = sqlx::query(
                            r#"
                            INSERT INTO run_events (run_id, node_id, event_type, payload)
                            VALUES ($1, $2, 'NODE_SCHEDULED', $3)
                            "#,
                        )
                        .bind(&run_id)
                        .bind(node_id)
                        .bind(serde_json::json!({"source": "cron_scheduler"}))
                        .execute(pool)
                        .await;
                    }
                }
            }
        }

        // Calculate and update next run time
        if let Some(next_run) = calculate_next_cron_run(&cron_expr, &timezone) {
            let _ = sqlx::query(
                "UPDATE workflows SET schedule_next_run = $1 WHERE id = $2",
            )
            .bind(next_run)
            .bind(workflow_id)
            .execute(pool)
            .await;

            println!(
                "Scheduler: Next run for '{}' scheduled at {}",
                name,
                next_run.format("%Y-%m-%d %H:%M:%S %Z")
            );
        }
    }
}

/// Calculate the next run time for a cron expression in a given timezone.
/// 
/// Note: The cron crate uses 6-field expressions (with seconds):
/// - Standard cron (5 fields): "0 9 * * 1-5" (minute hour day month weekday)
/// - Extended cron (6 fields): "0 0 9 * * 1-5" (second minute hour day month weekday)
/// 
/// This function automatically converts 5-field expressions to 6-field by prepending "0 ".
fn calculate_next_cron_run(cron_expr: &str, timezone: &str) -> Option<DateTime<Utc>> {
    // Convert 5-field cron to 6-field by prepending "0 " for seconds
    let extended_expr = normalize_cron_expression(cron_expr);
    
    // Parse the cron expression
    let schedule = Schedule::from_str(&extended_expr).ok()?;
    
    // Parse the timezone
    let tz: Tz = timezone.parse().unwrap_or(chrono_tz::UTC);
    
    // Get current time in the target timezone
    let now = Utc::now().with_timezone(&tz);
    
    // Find the next occurrence
    schedule
        .after(&now)
        .next()
        .map(|dt| dt.with_timezone(&Utc))
}

/// Normalize a cron expression to 6-field format.
/// 
/// If the expression has 5 fields (standard cron), prepend "0 " for seconds.
/// If the expression has 6 fields, use as-is.
fn normalize_cron_expression(expr: &str) -> String {
    let fields: Vec<&str> = expr.split_whitespace().collect();
    
    if fields.len() == 5 {
        // Standard 5-field cron: minute hour day month weekday
        // Convert to 6-field: second minute hour day month weekday
        format!("0 {}", expr)
    } else {
        // Already 6-field or invalid (let the parser handle it)
        expr.to_string()
    }
}

/// Build a job payload for a node to be scheduled.
fn build_job_payload(
    node: &serde_json::Value,
    run_id: &Uuid,
    input_data: &Option<serde_json::Value>,
) -> Option<String> {
    let node_id = node.get("id")?.as_str()?;
    let node_type = node.get("type")?.as_str()?;
    let node_data = node.get("data")?;

    // Map SvelteFlow node types to worker job types
    // Note: SvelteFlow uses "http-request", "code-execution", etc.
    let job = match node_type {
        "http" | "http-request" => {
            serde_json::json!({
                "id": node_id,
                "run_id": run_id.to_string(),
                "node": {
                    "type": "HTTP",
                    "data": {
                        "url": node_data.get("url").and_then(|v| v.as_str()).unwrap_or(""),
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
        "code" | "code-execution" => {
            serde_json::json!({
                "id": node_id,
                "run_id": run_id.to_string(),
                "node": {
                    "type": "CODE",
                    "data": {
                        "code": node_data.get("code").and_then(|v| v.as_str()).unwrap_or("return {};"),
                        "inputs": input_data
                    }
                },
                "retry_count": 0,
                "max_retries": 3,
                "isolated": false
            })
        }
        "llm" => {
            serde_json::json!({
                "id": node_id,
                "run_id": run_id.to_string(),
                "node": {
                    "type": "LLM",
                    "data": {
                        "base_url": node_data.get("baseUrl").and_then(|v| v.as_str()).unwrap_or("https://api.openai.com/v1"),
                        "api_key": node_data.get("apiKey").and_then(|v| v.as_str()).unwrap_or(""),
                        "model": node_data.get("model").and_then(|v| v.as_str()).unwrap_or("gpt-4o"),
                        "messages": node_data.get("messages").unwrap_or(&serde_json::json!([])),
                        "temperature": node_data.get("temperature"),
                        "max_tokens": node_data.get("maxTokens"),
                        "stream": node_data.get("stream").and_then(|v| v.as_bool()).unwrap_or(true)
                    }
                },
                "retry_count": 0,
                "max_retries": 1,
                "isolated": false
            })
        }
        "router" => {
            serde_json::json!({
                "id": node_id,
                "run_id": run_id.to_string(),
                "node": {
                    "type": "ROUTER",
                    "data": {
                        "route_by": node_data.get("routeBy").and_then(|v| v.as_str()).unwrap_or(""),
                        "conditions": node_data.get("conditions").unwrap_or(&serde_json::json!([])),
                        "default_output": node_data.get("defaultOutput").and_then(|v| v.as_str()).unwrap_or("default"),
                        "mode": node_data.get("routerMode").and_then(|v| v.as_str()).unwrap_or("first_match")
                    }
                },
                "retry_count": 0,
                "max_retries": 0,
                "isolated": false
            })
        }
        "delay" => {
            serde_json::json!({
                "id": node_id,
                "run_id": run_id.to_string(),
                "node": {
                    "type": "DELAY",
                    "data": {
                        "duration_ms": node_data.get("durationMs").and_then(|v| v.as_u64()).unwrap_or(1000),
                        "duration_str": node_data.get("durationStr")
                    }
                },
                "retry_count": 0,
                "max_retries": 0,
                "isolated": false
            })
        }
        "webhookWait" | "webhook-wait" => {
            serde_json::json!({
                "id": node_id,
                "run_id": run_id.to_string(),
                "node": {
                    "type": "WEBHOOKWAIT",
                    "data": {
                        "description": node_data.get("description"),
                        "timeout_ms": node_data.get("timeoutMs").and_then(|v| v.as_u64()).unwrap_or(604800000)
                    }
                },
                "retry_count": 0,
                "max_retries": 0,
                "isolated": false
            })
        }
        _ => return None,
    };

    serde_json::to_string(&job).ok()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_cron_normalization() {
        // 5-field should become 6-field
        assert_eq!(normalize_cron_expression("* * * * *"), "0 * * * * *");
        assert_eq!(normalize_cron_expression("0 9 * * 1-5"), "0 0 9 * * 1-5");
        
        // 6-field should stay as-is
        assert_eq!(normalize_cron_expression("0 0 9 * * 1-5"), "0 0 9 * * 1-5");
    }

    #[test]
    fn test_cron_parsing() {
        // Every minute (5-field standard cron)
        let next = calculate_next_cron_run("* * * * *", "UTC");
        assert!(next.is_some(), "Every minute should parse");

        // Every day at 9am (5-field)
        let next = calculate_next_cron_run("0 9 * * *", "UTC");
        assert!(next.is_some(), "Daily at 9am should parse");

        // Weekdays at 9am (5-field)
        let next = calculate_next_cron_run("0 9 * * 1-5", "UTC");
        assert!(next.is_some(), "Weekdays at 9am should parse");

        // Every 15 minutes (5-field)
        let next = calculate_next_cron_run("*/15 * * * *", "UTC");
        assert!(next.is_some(), "Every 15 minutes should parse");

        // Invalid expression
        let next = calculate_next_cron_run("invalid", "UTC");
        assert!(next.is_none(), "Invalid expression should fail");
    }

    #[test]
    fn test_timezone_parsing() {
        // Valid timezone
        let next = calculate_next_cron_run("0 9 * * *", "America/New_York");
        assert!(next.is_some(), "New York timezone should work");

        // Another valid timezone
        let next = calculate_next_cron_run("0 9 * * *", "Europe/Amsterdam");
        assert!(next.is_some(), "Amsterdam timezone should work");

        // Invalid timezone falls back to UTC
        let next = calculate_next_cron_run("0 9 * * *", "Invalid/Zone");
        assert!(next.is_some(), "Invalid timezone should fall back to UTC");
    }
}
