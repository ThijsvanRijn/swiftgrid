//! SwiftGrid Worker - High-performance workflow execution engine.
//!
//! This worker consumes jobs from Redis streams and executes workflow nodes.

use redis::{AsyncCommands, RedisResult, streams::{StreamReadOptions, StreamReadReply}};
use rquickjs::{AsyncContext, AsyncRuntime};
use sqlx::postgres::PgPoolOptions;
use sqlx::PgPool;
use std::error::Error;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Arc;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};
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

// =============================================================================
// MAIN
// =============================================================================

#[tokio::main]
async fn main() -> Result<(), Box<dyn Error>> {
    println!("SwiftGrid Worker initializing...");

    // Database connection pool
    let database_url = std::env::var("DATABASE_URL")
        .unwrap_or_else(|_| "postgres://dev:dev123@localhost:5432/swiftgrid".to_string());

    let db_pool = PgPoolOptions::new()
        .max_connections(5)
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
            let js_context = AsyncContext::full(&js_runtime).await.unwrap();

            println!("✓ JS Sandbox Ready");

            while let Some(task) = js_receiver.recv().await {
                let result = run_js_safely(&js_context, task.code, task.inputs).await;
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

    // Main job processing loop
    loop {
        tokio::select! {
            _ = tokio::signal::ctrl_c() => {
                println!("\nShutdown signal received, stopping...");
                break;
            }
            result = read_next_job(&mut con, group_name, &consumer_name) => {
                if let Some((msg_id, job)) = result {
                    println!(
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
                    Err(e) => eprintln!("Failed to parse WorkerJob: {}", e),
                }
            }
        }
    }

    None
}

// =============================================================================
// JOB PROCESSING
// =============================================================================

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
            println!("  -> Skipping node {} - run {} is cancelled (token)", job_id, rid);
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
        
        if let Ok(Some((status,))) = status_result {
            if status == "cancelled" || status == "failed" {
                println!("  -> Skipping node {} - run {} is {}", job_id, rid, status);
                ack_message(&redis_client, &group_name, &msg_id).await;
                return;
            }
        }

        // Idempotency check: skip if this exact attempt already completed
        // Prevents duplicate execution after worker crash (post-execution, pre-ACK)
        match has_node_completed(&db_pool, rid, &job_id, job.retry_count).await {
            Ok(true) => {
                println!(
                    "  -> Skipping node {} (attempt {}) - already executed (idempotency)",
                    job_id,
                    job.retry_count + 1
                );
                ack_message(&redis_client, &group_name, &msg_id).await;
                return;
            }
            Err(e) => {
                // Log but continue - better to risk duplicate than to stall
                eprintln!("  -> Warning: idempotency check failed: {}", e);
            }
            Ok(false) => {} // Normal case: proceed with execution
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
    let is_suspended = status == 202
        && body
            .as_ref()
            .map(|b| b.get("suspended").is_some())
            .unwrap_or(false);

    // Handle cancelled nodes
    if was_cancelled {
        println!("  -> Node {} cancelled", job_id);
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

    // Handle suspended nodes
    if is_suspended {
        println!("  -> Node suspended, waiting for external trigger");
        ack_message(&redis_client, &group_name, &msg_id).await;
        return;
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
    }
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
}

async fn ack_message(redis_client: &redis::Client, group_name: &str, msg_id: &str) {
    if let Ok(mut con) = redis_client.get_multiplexed_async_connection().await {
        let _: RedisResult<()> = con.xack(STREAM_JOBS, group_name, &[msg_id]).await;
        let _: RedisResult<()> = con.xdel(STREAM_JOBS, &[msg_id]).await;
    }
}
