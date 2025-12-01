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
