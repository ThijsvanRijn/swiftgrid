//! SwiftGrid Worker - High-performance workflow execution engine.
//!
//! This worker consumes jobs from Redis streams and executes workflow nodes.

use redis::{AsyncCommands, RedisResult, streams::{StreamReadOptions, StreamReadReply}};
use rquickjs::{AsyncContext, AsyncRuntime};
use sqlx::postgres::PgPoolOptions;
use sqlx::PgPool;
use std::error::Error;
use std::sync::atomic::{AtomicU64, AtomicUsize, Ordering};
use std::sync::Arc;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};
use once_cell::sync::Lazy;
use tokio::sync::mpsc;
use tokio::sync::oneshot;
use uuid::Uuid;

// Import from library modules
use swiftgrid_worker::{
    cancellation::{self, CancellationRegistry},
    events::{has_node_completed, log_event, log_event_with_retry, EventType},
    nodes::{self, code::run_js_safely, JsTask},
    retry::{calculate_backoff, is_retryable_error},
    scheduler,
    streaming::StreamContext,
    types::{ExecutionResult, NodeType, WorkerJob},
};
use tokio_util::sync::CancellationToken;

// =============================================================================
// CONSTANTS
// =============================================================================

const STREAM_JOBS: &str = "swiftgrid_stream";
const STREAM_RESULTS: &str = "swiftgrid_results";

// Worker statistics for heartbeat
static JOBS_PROCESSED: AtomicU64 = AtomicU64::new(0);
static START_TIME: Lazy<Instant> = Lazy::new(Instant::now);

// Performance: Set WORKER_VERBOSE=1 to enable debug logging in hot paths
// Default is OFF for maximum performance
fn is_verbose() -> bool {
    std::env::var("WORKER_VERBOSE").map(|v| v == "1" || v == "true").unwrap_or(false)
}

macro_rules! verbose_log {
    ($($arg:tt)*) => {
        if is_verbose() {
            println!($($arg)*);
        }
    };
}

// =============================================================================
// MAIN
// =============================================================================

#[tokio::main]
async fn main() -> Result<(), Box<dyn Error>> {
    println!("SwiftGrid Worker initializing...");

    // Database connection pool
    let database_url = std::env::var("DATABASE_URL")
        .unwrap_or_else(|_| "postgres://dev:dev123@localhost:5432/swiftgrid".to_string());

    // Cap pool to protect Postgres during local/dev spikes
    // Each worker needs: (concurrency × ~3 queries per child) + overhead
    // Default 20 per worker (override with DB_POOL_SIZE)
    let pool_size = std::env::var("DB_POOL_SIZE")
        .ok()
        .and_then(|v| v.parse().ok())
        .unwrap_or(20);

    let db_pool = PgPoolOptions::new()
        .max_connections(pool_size)
        .acquire_timeout(Duration::from_secs(30)) // Wait up to 30s for a connection
        .connect(&database_url)
        .await?;

    println!("✓ Connected to PostgreSQL");

    // Redis connection
    let redis_url =
        std::env::var("REDIS_URL").unwrap_or_else(|_| "redis://127.0.0.1/".to_string());
    let redis_client = redis::Client::open(redis_url)?;
    let mut con = redis_client.get_multiplexed_async_connection().await?;

    println!("✓ Connected to Redis");

    // HTTP client (reused for all requests)
    static APP_USER_AGENT: &str =
        concat!(env!("CARGO_PKG_NAME"), "/", env!("CARGO_PKG_VERSION"));
    let http_client = reqwest::Client::builder()
        .user_agent(APP_USER_AGENT)
        .timeout(Duration::from_secs(30))
        .build()?;

    // JS runtime thread
    let (js_sender, mut js_receiver) = mpsc::channel::<JsTask>(100);

    std::thread::spawn(move || {
        let rt = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .unwrap();

        rt.block_on(async move {
            let js_runtime = AsyncRuntime::new().unwrap();
            
            // Set memory limit (16MB default, configurable via JS_MEMORY_LIMIT)
            let memory_limit: usize = std::env::var("JS_MEMORY_LIMIT")
                .ok()
                .and_then(|v| v.parse().ok())
                .unwrap_or(16 * 1024 * 1024);
            js_runtime.set_memory_limit(memory_limit).await;
            
            // Set max stack size (256KB - prevents stack overflow attacks)
            js_runtime.set_max_stack_size(256 * 1024).await;
            
            let js_context = AsyncContext::full(&js_runtime).await.unwrap();

            println!("✓ JS Sandbox Ready (memory limit: {}MB)", memory_limit / 1024 / 1024);

            // Timeout in ms (default 5 seconds)
            let timeout_ms: u64 = std::env::var("JS_TIMEOUT_MS")
                .ok()
                .and_then(|v| v.parse().ok())
                .unwrap_or(5000);

            while let Some(task) = js_receiver.recv().await {
                // Set up interrupt handler with deadline for THIS execution
                let deadline = std::time::Instant::now() + std::time::Duration::from_millis(timeout_ms);
                
                // The interrupt handler is called periodically during JS execution
                // Return true to abort, false to continue
                js_runtime.set_interrupt_handler(Some(Box::new(move || {
                    std::time::Instant::now() > deadline
                }))).await;
                
                let result = run_js_safely(&js_context, task.code, task.inputs).await;
                
                // Clear interrupt handler after execution
                js_runtime.set_interrupt_handler(None::<Box<dyn FnMut() -> bool>>).await;
                
                let _ = task.responder.send(result);
            }
        });
    });

    // Redis consumer group setup
    let group_name = "workers_group";
    let consumer_name = format!("worker_{}", &Uuid::new_v4().to_string()[..8]);
    let _: RedisResult<()> = con
        .xgroup_create_mkstream(STREAM_JOBS, group_name, "$")
        .await;

    println!(
        "Worker '{}' listening for jobs... (Ctrl+C to stop)",
        consumer_name
    );

    let in_flight = Arc::new(AtomicUsize::new(0));

    // Cancellation registry (shared across all jobs)
    let cancel_registry = Arc::new(CancellationRegistry::new());

    // Spawn the cancellation listener (Redis pub/sub)
    let cancel_redis = redis_client.clone();
    let cancel_registry_listener = cancel_registry.clone();
    tokio::spawn(async move {
        cancellation::listen_for_cancellations(cancel_redis, cancel_registry_listener).await;
    });

    // Spawn the scheduler loop
    let scheduler_redis = redis_client.clone();
    let scheduler_db = db_pool.clone();
    tokio::spawn(async move {
        scheduler::run(scheduler_redis, scheduler_db).await;
    });

    // Spawn the heartbeat loop
    let heartbeat_redis = redis_client.clone();
    let heartbeat_worker_id = consumer_name.clone();
    let heartbeat_in_flight = Arc::clone(&in_flight);
    tokio::spawn(async move {
        heartbeat_loop(heartbeat_redis, heartbeat_worker_id, heartbeat_in_flight).await;
    });

    // Main job processing loop
    loop {
        tokio::select! {
            _ = tokio::signal::ctrl_c() => {
                println!("\nShutdown signal received, stopping...");
                break;
            }
            result = read_next_job(&mut con, group_name, &consumer_name) => {
                if let Some((msg_id, job)) = result {
                    verbose_log!(
                        "Processing Node: {} (run: {:?}, attempt: {})",
                        job.id,
                        job.run_id,
                        job.retry_count + 1
                    );

                    let h_client = http_client.clone();
                    let r_client = redis_client.clone();
                    let pool = db_pool.clone();
                    let j_sender = js_sender.clone();
                    let in_flight_clone = Arc::clone(&in_flight);
                    let cancel_reg = cancel_registry.clone();
                    let group = group_name.to_string();

                    in_flight.fetch_add(1, Ordering::SeqCst);

                    tokio::spawn(async move {
                        process_job(job, h_client, r_client, pool, j_sender, msg_id, group, cancel_reg).await;
                        in_flight_clone.fetch_sub(1, Ordering::SeqCst);
                        JOBS_PROCESSED.fetch_add(1, Ordering::Relaxed);
                    });
                }
            }
        }
    }

    // Wait for in-flight jobs
    let pending = in_flight.load(Ordering::SeqCst);
    if pending > 0 {
        println!("Waiting for {} in-flight job(s) to complete...", pending);
        while in_flight.load(Ordering::SeqCst) > 0 {
            tokio::time::sleep(Duration::from_millis(100)).await;
        }
    }

    println!("Worker '{}' shut down gracefully.", consumer_name);
    Ok(())
}

// =============================================================================
// JOB READING
// =============================================================================

async fn read_next_job(
    con: &mut redis::aio::MultiplexedConnection,
    group_name: &str,
    consumer_name: &str,
) -> Option<(String, WorkerJob)> {
    let opts = StreamReadOptions::default()
        .group(group_name, consumer_name)
        .count(1)
        .block(1000);

    let reply: StreamReadReply = con
        .xread_options::<&str, &str, StreamReadReply>(&[STREAM_JOBS], &[">"], &opts)
        .await
        .ok()?;

    for stream_key_result in reply.keys {
        for message in stream_key_result.ids {
            let msg_id = message.id.clone();

            if let Some(payload_str) = message.map.get("payload") {
                let payload_string: String = redis::from_redis_value(payload_str).ok()?;

                match serde_json::from_str::<WorkerJob>(&payload_string) {
                    Ok(job) => return Some((msg_id, job)),
                    Err(e) => {
                        eprintln!("Failed to parse WorkerJob: {}", e);
                        eprintln!("  Raw payload: {}", &payload_string[..payload_string.len().min(500)]);
                    }
                }
            }
        }
    }

    None
}

// =============================================================================
// JOB PROCESSING
// =============================================================================

/// Check if a node type is a "lifecycle event" that should bypass idempotency checks.
/// 
/// Lifecycle events update state of existing operations (resume, complete, step).
/// They are inherently idempotent at the DB level (ON CONFLICT, atomic counters).
/// 
/// Execution events start new operations and MUST check idempotency to prevent
/// duplicate HTTP calls, code execution, etc.
fn is_lifecycle_event(node: &NodeType) -> bool {
    matches!(
        node,
        NodeType::MapChildComplete(_)  // Updates batch counters
            | NodeType::MapStep(_)     // Spawns more children (cursor-based, safe to retry)
            | NodeType::SubFlowResume(_) // Resumes parent after child completes
            | NodeType::DelayResume(_)   // Resumes after delay expires
            | NodeType::WebhookResume(_) // Resumes after webhook received
    )
}

async fn process_job(
    job: WorkerJob,
    http_client: reqwest::Client,
    redis_client: redis::Client,
    db_pool: PgPool,
    js_sender: mpsc::Sender<JsTask>,
    msg_id: String,
    group_name: String,
    cancel_registry: Arc<CancellationRegistry>,
) {
    let start = Instant::now();
    let job_id = job.id.clone();
    let job_isolated = job.isolated;
    let run_id = job.run_id.as_ref().and_then(|s| Uuid::parse_str(s).ok());
    
    // Check if this is a lifecycle event (bypasses idempotency)
    let is_lifecycle = is_lifecycle_event(&job.node);
    
    if is_lifecycle {
        verbose_log!("Processing Lifecycle Event: {} (run: {:?})", job_id, job.run_id);
    }

    // Get or create cancellation token for this run
    let cancel_token = if let Some(ref rid) = run_id {
        cancel_registry.get_or_create(*rid).await
    } else {
        CancellationToken::new() // Isolated jobs get their own token (never cancelled)
    };

    // Check if run is still active before processing
    if let Some(ref rid) = run_id {
        // Check if already cancelled via token (fast path)
        if cancel_token.is_cancelled() {
            verbose_log!("  -> Skipping {} - run {} is cancelled (token)", job_id, rid);
            ack_message(&redis_client, &group_name, &msg_id).await;
            return;
        }

        // Check DB status (handles cancellations that happened before we subscribed)
        let status_result: Result<Option<(String,)>, _> = sqlx::query_as(
            "SELECT status FROM workflow_runs WHERE id = $1"
        )
        .bind(rid)
        .fetch_optional(&db_pool)
        .await;
        
        match status_result {
            Ok(Some((status,))) if status == "cancelled" || status == "failed" => {
                verbose_log!("  -> Skipping {} - run {} is {}", job_id, rid, status);
                ack_message(&redis_client, &group_name, &msg_id).await;
                return;
            }
            Err(e) => {
                // TRANSIENT ERROR: Can't check status, don't ACK
                eprintln!("  -> TRANSIENT ERROR: status check failed for {}: {}", job_id, e);
                eprintln!("  -> NOT acknowledging - message will be redelivered");
                return;
            }
            _ => {} // Status is ok or not cancelled - continue
        }

        // Idempotency check: skip if this exact attempt already completed
        // ONLY for execution events - lifecycle events bypass this check
        // (they are inherently idempotent at the DB level)
        if !is_lifecycle {
            match has_node_completed(&db_pool, rid, &job_id, job.retry_count).await {
                Ok(true) => {
                    verbose_log!(
                        "  -> Skipping node {} (attempt {}) - already executed (idempotency)",
                        job_id,
                        job.retry_count + 1
                    );
                    ack_message(&redis_client, &group_name, &msg_id).await;
                    return;
                }
                Err(e) => {
                    // CRITICAL: Pool timeout = transient error
                    // Do NOT ACK - let Redis consumer group redeliver this message
                    // This gives us at-least-once semantics instead of at-most-once
                    eprintln!(
                        "  -> TRANSIENT ERROR: idempotency check failed for {}: {}",
                        job_id, e
                    );
                    eprintln!("  -> NOT acknowledging - message will be redelivered");
                    return; // Exit WITHOUT ack_message - Redis will redeliver after visibility timeout
                }
                Ok(false) => {} // Normal case: proceed with execution
            }
        }
    }

    // Log NODE_STARTED event
    if let Some(ref rid) = run_id {
        let _ = log_event(&db_pool, rid, &job_id, EventType::NodeStarted, serde_json::json!({})).await;
    }

    // Create streaming context for real-time output
    let stream_ctx = run_id.as_ref().map(|rid| {
        StreamContext::new(redis_client.clone(), db_pool.clone(), *rid, job_id.clone())
    });

    // Clone node for potential retry (before moving into execute_node)
    let node_clone = job.node.clone();

    // Execute the node with cancellation support
    let (status, body, was_cancelled) = execute_node(
        node_clone.clone(),
        &job_id,
        &job.run_id,
        http_client.clone(),
        &redis_client,
        &db_pool,
        &js_sender,
        stream_ctx.as_ref(),
        &cancel_token,
    )
    .await;

    let duration_ms = start.elapsed().as_millis() as u64;
    let is_success = status >= 200 && status < 300;
    
    // Lifecycle events (MapChildComplete, MapStep, etc.) should NOT be treated as suspended
    // They are internal state updates that return 202 but should just be ACKed and done
    // Only actual "start of suspension" events (Map init, SubFlow spawn) should suspend
    let is_suspended = !is_lifecycle && status == 202
        && body
            .as_ref()
            .map(|b| b.get("suspended").is_some() || b.get("batch_id").is_some())
            .unwrap_or(false);

    // Handle lifecycle events (MapChildComplete, MapStep, Resume, etc.)
    // These are internal state updates - just publish progress to SSE and ACK
    if is_lifecycle {
        // Publish progress update to SSE (so UI can update progress bar)
        let receipt = ExecutionResult {
            node_id: job_id.clone(),
            run_id: job.run_id.clone(),
            status_code: status,
            body: body.clone(),
            timestamp: SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_millis() as u64,
            duration_ms,
            isolated: true, // Don't trigger downstream from frontend
        };

        if let Ok(mut con) = redis_client.get_multiplexed_async_connection().await {
            if let Ok(receipt_json) = serde_json::to_string(&receipt) {
                let _: RedisResult<String> = con
                    .xadd(STREAM_RESULTS, "*", &[("payload", receipt_json)])
                    .await;
            }
        }
        
        // Check if this lifecycle event succeeded or failed
        if status == 500 {
            // TRANSIENT ERROR: Lifecycle event failed (likely pool timeout)
            // Do NOT ACK - let scheduler recovery pick it up for retry
            eprintln!(
                "  -> TRANSIENT ERROR: Lifecycle event {} failed with status 500",
                job_id
            );
            eprintln!("  -> NOT acknowledging - message will be redelivered");
            return; // Exit WITHOUT ack_message
        } else if status == 200 {
            // Success case - batch completed, notify orchestrator to schedule downstream
            verbose_log!("  -> Lifecycle event: batch completed, notifying orchestrator");
            if let Some(ref rid) = run_id {
                notify_orchestrator(rid, &job_id, true).await;
            }
        } else {
            // Progress update (202) - just ACK (silent for performance)
        }
        
        ack_message(&redis_client, &group_name, &msg_id).await;
        return;
    }

    // Handle cancelled nodes
    if was_cancelled {
        verbose_log!("  -> Node {} cancelled", job_id);
        if let Some(ref rid) = run_id {
            let _ = log_event_with_retry(
                &db_pool,
                rid,
                &job_id,
                EventType::NodeCancelled,
                Some(job.retry_count),
                serde_json::json!({
                    "duration_ms": duration_ms,
                    "message": "Execution cancelled by user"
                }),
            )
            .await;
        }
        
        // Publish cancelled result to SSE stream so UI updates
        let receipt = ExecutionResult {
            node_id: job_id.clone(),
            run_id: job.run_id.clone(),
            status_code: 499, // Client Closed Request - indicates cancellation
            body: Some(serde_json::json!({ "error": "Cancelled by user" })),
            timestamp: SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_millis() as u64,
            duration_ms,
            isolated: job_isolated,
        };

        if let Ok(mut con) = redis_client.get_multiplexed_async_connection().await {
            if let Ok(receipt_json) = serde_json::to_string(&receipt) {
                let _: RedisResult<String> = con
                    .xadd(STREAM_RESULTS, "*", &[("payload", receipt_json)])
                    .await;
            }
        }
        
        ack_message(&redis_client, &group_name, &msg_id).await;
        // Cleanup token if this was the last job for this run
        if let Some(ref rid) = run_id {
            cancel_registry.remove(rid).await;
        }
        return;
    }

    // Handle suspended nodes (e.g., sub-flow waiting for child, map waiting for iterations)
    if is_suspended {
        verbose_log!("  -> Node suspended, waiting for external trigger");
        
        // Log NODE_SUSPENDED event so orchestrator knows not to re-schedule this node
        if let Some(ref rid) = run_id {
            let _ = log_event_with_retry(
                &db_pool,
                rid,
                &job_id,
                EventType::NodeSuspended,
                Some(job.retry_count),
                serde_json::json!({
                    "duration_ms": duration_ms,
                    "suspended_body": body
                }),
            )
            .await;
        }
        
        // Publish suspended result to SSE so UI shows "Waiting" badge
        let receipt = ExecutionResult {
            node_id: job_id.clone(),
            run_id: job.run_id.clone(),
            status_code: 202,
            body: body.clone(),
            timestamp: SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_millis() as u64,
            duration_ms,
            isolated: job_isolated,
        };

        if let Ok(mut con) = redis_client.get_multiplexed_async_connection().await {
            if let Ok(receipt_json) = serde_json::to_string(&receipt) {
                let _: RedisResult<String> = con
                    .xadd(STREAM_RESULTS, "*", &[("payload", receipt_json)])
                    .await;
            }
        }
        
        ack_message(&redis_client, &group_name, &msg_id).await;
        return;
    }

    // Check for transient DB errors (status 500 with pool timeout indicators)
    // These should NOT be ACKed - let scheduler recovery handle them
    let is_transient_db_error = status == 500 && body
        .as_ref()
        .and_then(|b| b.get("error"))
        .and_then(|e| e.as_str())
        .map(|s| s.contains("pool timed out") || s.contains("Database error"))
        .unwrap_or(false);

    if is_transient_db_error {
        eprintln!(
            "  -> TRANSIENT DB ERROR: Node {} failed with pool timeout",
            job_id
        );
        eprintln!("  -> NOT acknowledging - message will be redelivered");
        return; // Exit WITHOUT ack_message
    }

    // Handle retry logic
    if !is_success && is_retryable_error(status) && job.retry_count < job.max_retries {
        handle_retry(
            &job,
            node_clone,
            status,
            &body,
            &run_id,
            &db_pool,
            &redis_client,
            job_isolated,
        )
        .await;
    } else {
        // Final result
        handle_final_result(
            &job,
            status,
            body,
            duration_ms,
            is_success,
            &run_id,
            &db_pool,
            &redis_client,
            job_isolated,
        )
        .await;
    }

    // ACK the message
    ack_message(&redis_client, &group_name, &msg_id).await;
}

// =============================================================================
// NODE EXECUTION
// =============================================================================

/// Execute a node with cancellation support.
/// Returns (status_code, body, was_cancelled).
async fn execute_node(
    node: NodeType,
    job_id: &str,
    run_id: &Option<String>,
    http_client: reqwest::Client,
    redis_client: &redis::Client,
    db_pool: &PgPool,
    js_sender: &mpsc::Sender<JsTask>,
    stream_ctx: Option<&StreamContext>,
    cancel_token: &CancellationToken,
) -> (u16, Option<serde_json::Value>, bool) {
    match node {
        NodeType::Http(data) => {
            let result = nodes::http::execute(http_client, data, stream_ctx, cancel_token).await;
            (result.0, result.1, result.2)
        }

        NodeType::Code(data) => {
            let (status, body) = execute_code_node(data, js_sender).await;
            (status, body, false) // Code execution doesn't support cancellation yet
        }

        NodeType::Delay(data) => {
            nodes::delay::execute(data, job_id, run_id, redis_client, cancel_token).await
        }

        NodeType::DelayResume(data) => {
            let (status, body) = nodes::delay::execute_resume(data.original_delay_ms);
            (status, body, false)
        }

        NodeType::WebhookWait(data) => {
            let rid = run_id.as_ref().and_then(|s| Uuid::parse_str(s).ok());
            let (status, body) = nodes::webhook::execute_wait(data, job_id, rid.as_ref(), db_pool).await;
            (status, body, false) // Webhook wait is a suspension, not cancellable mid-execution
        }

        NodeType::WebhookResume(data) => {
            let rid = run_id.as_ref().and_then(|s| Uuid::parse_str(s).ok());
            let (status, body) = nodes::webhook::execute_resume(data, job_id, rid.as_ref(), db_pool).await;
            (status, body, false)
        }

        NodeType::Router(data) => {
            let (status, body) = nodes::router::execute(data);
            (status, body, false) // Router is instant, no cancellation needed
        }

        NodeType::Llm(data) => {
            nodes::llm::execute(http_client, data, stream_ctx, cancel_token).await
        }

        NodeType::SubFlow(data) => {
            let rid = run_id.as_ref().and_then(|s| Uuid::parse_str(s).ok());
            
            if let Some(parent_run_id) = rid {
                // Get current depth from the run
                let depth: i32 = sqlx::query_scalar(
                    "SELECT COALESCE(depth, 0) FROM workflow_runs WHERE id = $1"
                )
                .bind(parent_run_id)
                .fetch_one(db_pool)
                .await
                .unwrap_or(0);

                // Spawn the child run
                match nodes::spawn_child_run(
                    db_pool,
                    &data,
                    &parent_run_id,
                    job_id,
                    depth as u32,
                ).await {
                    Ok(spawn_result) => {
                        println!(
                            "  -> SubFlow: Spawned child run {} for workflow '{}'",
                            &spawn_result.child_run_id.to_string()[..8],
                            spawn_result.child_workflow_name
                        );

                        // Suspend the parent run
                        if let Err(e) = nodes::suspend_parent_run(db_pool, &parent_run_id).await {
                            eprintln!("  -> SubFlow: Failed to suspend parent: {}", e);
                        }

                        // Start the child run via API (handles template interpolation)
                        let api_base_url = std::env::var("API_BASE_URL")
                            .unwrap_or_else(|_| "http://localhost:5173".to_string());
                        if let Err(e) = start_child_run(
                            &http_client,
                            &api_base_url,
                            spawn_result.child_run_id,
                        ).await {
                            eprintln!("  -> SubFlow: Failed to start child: {}", e);
                            return (
                                500,
                                Some(serde_json::json!({
                                    "error": format!("Failed to start child run: {}", e),
                                })),
                                false,
                            );
                        }

                        // Return 202 (suspended) - the orchestrator should NOT schedule downstream
                        (
                            202,
                            Some(serde_json::json!({
                                "suspended": true,
                                "child_run_id": spawn_result.child_run_id.to_string(),
                                "workflow_name": spawn_result.child_workflow_name,
                            })),
                            false,
                        )
                    }
                    Err(e) => {
                        eprintln!("  -> SubFlow: Failed to spawn child: {}", e);
                        (
                            500,
                            Some(serde_json::json!({
                                "error": e.to_string(),
                            })),
                            false,
                        )
                    }
                }
            } else {
                // No run_id - can't spawn sub-flow in isolated mode
                (
                    400,
                    Some(serde_json::json!({
                        "error": "SubFlow nodes require a run context (cannot run in isolated mode)",
                    })),
                    false,
                )
            }
        }

        NodeType::SubFlowResume(data) => {
            // Child completed - resume the parent
            // The fail_on_error flag is stored in the suspension, we need to look it up
            // For now, assume fail_on_error = false (route to error handle on failure)
            let (status, body) = nodes::handle_resume(&data, false);
            (status, Some(body), false)
        }

        NodeType::Map(data) => {
            // Map/Iterator node - spawn children for each item
            if let Some(run_id_str) = &run_id {
                let run_uuid = match uuid::Uuid::parse_str(run_id_str) {
                    Ok(u) => u,
                    Err(e) => {
                        return (
                            400,
                            Some(serde_json::json!({ "error": format!("Invalid run_id: {}", e) })),
                            false,
                        );
                    }
                };
                
                match nodes::handle_map_init(db_pool, &run_uuid, job_id, &data, 0).await {
                    Ok(result) => {
                        // Note: third value is "was_cancelled", not "is_suspended"
                        // Suspension is handled via status_code 202 check in process_job
                        (result.status_code, result.body, false)
                    }
                    Err(e) => {
                        eprintln!("  -> Map: Failed to initialize: {}", e);
                        (500, Some(serde_json::json!({ "error": e.to_string() })), false)
                    }
                }
            } else {
                (
                    400,
                    Some(serde_json::json!({
                        "error": "Map nodes require a run context (cannot run in isolated mode)",
                    })),
                    false,
                )
            }
        }

        NodeType::MapStep(data) => {
            // Spawn next batch of children (lifecycle event - never "cancelled")
            if let Some(run_id_str) = &run_id {
                let run_uuid = match uuid::Uuid::parse_str(run_id_str) {
                    Ok(u) => u,
                    Err(e) => {
                        return (
                            400,
                            Some(serde_json::json!({ "error": format!("Invalid run_id: {}", e) })),
                            false,
                        );
                    }
                };
                
                match nodes::handle_map_step(db_pool, &run_uuid, job_id, &data).await {
                    Ok(result) => (result.status_code, result.body, false), // Never cancelled
                    Err(e) => {
                        eprintln!("  -> MapStep: Failed: {}", e);
                        (500, Some(serde_json::json!({ "error": e.to_string() })), false)
                    }
                }
            } else {
                (400, Some(serde_json::json!({ "error": "MapStep requires run context" })), false)
            }
        }

        NodeType::MapChildComplete(data) => {
            // A map child completed - record result and maybe spawn more (lifecycle event - never "cancelled")
            if let Some(run_id_str) = &run_id {
                let run_uuid = match uuid::Uuid::parse_str(run_id_str) {
                    Ok(u) => u,
                    Err(e) => {
                        return (
                            400,
                            Some(serde_json::json!({ "error": format!("Invalid run_id: {}", e) })),
                            false,
                        );
                    }
                };
                
                match nodes::handle_child_complete(db_pool, redis_client, &run_uuid, job_id, &data).await {
                    Ok(result) => (result.status_code, result.body, false), // Never cancelled
                    Err(e) => {
                        eprintln!("  -> MapChildComplete: Failed: {}", e);
                        (500, Some(serde_json::json!({ "error": e.to_string() })), false)
                    }
                }
            } else {
                (400, Some(serde_json::json!({ "error": "MapChildComplete requires run context" })), false)
            }
        }
    }
}

/// Start a child run by calling the TypeScript API endpoint.
/// This ensures proper template interpolation ({{$trigger.field}}) is handled.
async fn start_child_run(
    http_client: &reqwest::Client,
    api_base_url: &str,
    child_run_id: Uuid,
) -> Result<(), String> {
    let url = format!("{}/api/runs/{}/start", api_base_url, child_run_id);
    
    let response = http_client
        .post(&url)
        .header("Content-Type", "application/json")
        .send()
        .await
        .map_err(|e| format!("HTTP request failed: {}", e))?;
    
    if !response.status().is_success() {
        let status = response.status();
        let body = response.text().await.unwrap_or_default();
        return Err(format!("Start child run failed ({}): {}", status, body));
    }
    
    Ok(())
}

async fn execute_code_node(
    data: swiftgrid_worker::types::CodeNodeData,
    js_sender: &mpsc::Sender<JsTask>,
) -> (u16, Option<serde_json::Value>) {
    let (tx, rx) = oneshot::channel();
    let task = JsTask {
        code: data.code,
        inputs: data.inputs,
        responder: tx,
        timeout_ms: None, // Use default timeout from SandboxConfig
    };

    if js_sender.send(task).await.is_err() {
        return (
            500,
            Some(serde_json::json!({"error": "JS Engine crashed"})),
        );
    }

    match tokio::time::timeout(Duration::from_secs(30), rx).await {
        Ok(Ok(Ok(val))) => (200, Some(val)),
        Ok(Ok(Err(e))) => (400, Some(serde_json::json!({"error": e}))),
        Ok(Err(_)) => (
            500,
            Some(serde_json::json!({"error": "JS channel closed"})),
        ),
        Err(_) => (
            500,
            Some(serde_json::json!({"error": "JS execution timeout (30s)"})),
        ),
    }
}

// =============================================================================
// RESULT HANDLING
// =============================================================================

async fn handle_retry(
    job: &WorkerJob,
    node_clone: NodeType,
    status: u16,
    body: &Option<serde_json::Value>,
    run_id: &Option<Uuid>,
    db_pool: &PgPool,
    redis_client: &redis::Client,
    isolated: bool,
) {
    let next_attempt = job.retry_count + 1;
    let backoff = calculate_backoff(next_attempt);
    let retry_at = chrono::Utc::now() + chrono::Duration::milliseconds(backoff.as_millis() as i64);

    println!(
        "  → Scheduling retry {} of {} in {:?}",
        next_attempt, job.max_retries, backoff
    );

    // Log retry event
    if let Some(rid) = run_id {
        let _ = log_event(
            db_pool,
            rid,
            &job.id,
            EventType::NodeRetryScheduled,
            serde_json::json!({
                "attempt": next_attempt,
                "error": body.as_ref().and_then(|b| b.get("error")).unwrap_or(&serde_json::json!("Unknown error")),
                "retry_after": retry_at.to_rfc3339(),
                "status_code": status,
            }),
        )
        .await;
    }

    // Re-queue with incremented retry count
    let retry_job = WorkerJob {
        id: job.id.clone(),
        run_id: job.run_id.clone(),
        node: node_clone,
        retry_count: next_attempt,
        max_retries: job.max_retries,
        isolated,
    };

    let redis_for_retry = redis_client.clone();

    tokio::spawn(async move {
        tokio::time::sleep(backoff).await;
        if let Ok(mut con) = redis_for_retry.get_multiplexed_async_connection().await {
            let _: RedisResult<String> = con
                .xadd(
                    STREAM_JOBS,
                    "*",
                    &[("payload", serde_json::to_string(&retry_job).unwrap())],
                )
                .await;
        }
    });
}

async fn handle_final_result(
    job: &WorkerJob,
    status: u16,
    body: Option<serde_json::Value>,
    duration_ms: u64,
    is_success: bool,
    run_id: &Option<Uuid>,
    db_pool: &PgPool,
    redis_client: &redis::Client,
    isolated: bool,
) {
    // Log completion/failure event with retry_count for idempotency
    if let Some(rid) = run_id {
        if is_success {
            let _ = log_event_with_retry(
                db_pool,
                rid,
                &job.id,
                EventType::NodeCompleted,
                Some(job.retry_count),
                serde_json::json!({
                    "result": body,
                    "duration_ms": duration_ms,
                }),
            )
            .await;
        } else {
            let _ = log_event_with_retry(
                db_pool,
                rid,
                &job.id,
                EventType::NodeFailed,
                Some(job.retry_count),
                serde_json::json!({
                    "error": body.as_ref().and_then(|b| b.get("error")).unwrap_or(&serde_json::json!("Unknown error")),
                    "fatal": !is_retryable_error(status),
                    "attempts": job.retry_count + 1,
                    "status_code": status,
                }),
            )
            .await;
        }
    }

    // Publish result to SSE stream
    let receipt = ExecutionResult {
        node_id: job.id.clone(),
        run_id: job.run_id.clone(),
        status_code: status,
        body,
        timestamp: SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_millis() as u64,
        duration_ms,
        isolated,
    };

    if let Ok(mut con) = redis_client.get_multiplexed_async_connection().await {
        if let Ok(receipt_json) = serde_json::to_string(&receipt) {
            let _: RedisResult<String> = con
                .xadd(STREAM_RESULTS, "*", &[("payload", receipt_json)])
                .await;
        }
    }
    
    // Call orchestrator to schedule next nodes (server-side, not relying on frontend)
    // This is critical for child runs (sub-flows, map iterations) that have no frontend
    if !isolated {
        if let Some(rid) = run_id {
            notify_orchestrator(rid, &job.id, is_success).await;
        }
    }
}

/// Notify the orchestrator that a node has completed.
/// This triggers scheduling of dependent nodes and handles parent notifications for child runs.
async fn notify_orchestrator(run_id: &Uuid, node_id: &str, success: bool) {
    verbose_log!("  -> Notifying orchestrator: run={}, node={}, success={}", run_id, node_id, success);
    
    let base_url = std::env::var("ORCHESTRATOR_URL")
        .unwrap_or_else(|_| "http://localhost:5173".to_string());
    
    let client = reqwest::Client::new();
    let resp = client
        .post(format!("{}/api/orchestrate", base_url))
        .json(&serde_json::json!({
            "runId": run_id.to_string(),
            "nodeId": node_id,
            "success": success
        }))
        .send()
        .await;
    
    match resp {
        Ok(r) => {
            if r.status().is_success() {
                verbose_log!("  -> Orchestrator OK");
            } else {
                verbose_log!("  -> Orchestrator returned {}", r.status());
            }
        }
        Err(e) => {
            eprintln!("  -> Failed to notify orchestrator: {}", e);
        }
    }
}

async fn ack_message(redis_client: &redis::Client, group_name: &str, msg_id: &str) {
    if let Ok(mut con) = redis_client.get_multiplexed_async_connection().await {
        let _: RedisResult<()> = con.xack(STREAM_JOBS, group_name, &[msg_id]).await;
        let _: RedisResult<()> = con.xdel(STREAM_JOBS, &[msg_id]).await;
    }
}

// =============================================================================
// WORKER HEARTBEAT
// =============================================================================

/// Sends periodic heartbeats to Redis so the frontend can display worker status.
/// Each worker writes to a Redis hash with its current stats.
async fn heartbeat_loop(
    redis_client: redis::Client,
    worker_id: String,
    in_flight: Arc<AtomicUsize>,
) {
    let mut interval = tokio::time::interval(Duration::from_secs(1)); // Fast heartbeat for real-time UI
    
    // Initialize start time
    let _ = *START_TIME;
    
    loop {
        interval.tick().await;
        
        // Gather stats
        let jobs_processed = JOBS_PROCESSED.load(Ordering::Relaxed);
        let current_jobs = in_flight.load(Ordering::SeqCst);
        let uptime_secs = START_TIME.elapsed().as_secs();
        
        // Get memory usage
        let memory_mb = memory_stats::memory_stats()
            .map(|stats| stats.physical_mem / (1024 * 1024))
            .unwrap_or(0) as u64;
        
        let heartbeat = serde_json::json!({
            "worker_id": worker_id,
            "status": "healthy",
            "memory_mb": memory_mb,
            "jobs_processed": jobs_processed,
            "current_jobs": current_jobs,
            "uptime_secs": uptime_secs,
            "last_seen": chrono::Utc::now().to_rfc3339(),
        });
        
        // Write to Redis hash (key: swiftgrid:workers, field: worker_id)
        if let Ok(mut con) = redis_client.get_multiplexed_async_connection().await {
            let _: RedisResult<()> = redis::cmd("HSET")
                .arg("swiftgrid:workers")
                .arg(&worker_id)
                .arg(heartbeat.to_string())
                .query_async(&mut con)
                .await;
            
            // Set expiry on the hash field (Redis doesn't support per-field expiry,
            // so we'll handle cleanup in the API by checking last_seen)
        }
    }
}
