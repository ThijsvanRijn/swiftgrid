use redis::{AsyncCommands, RedisResult, streams::{StreamReadOptions, StreamReadReply}};
use serde::{Deserialize, Serialize};
use sqlx::postgres::PgPoolOptions;
use sqlx::PgPool;
use std::collections::HashMap;
use std::error::Error;
use std::sync::Arc;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};
use tokio::sync::mpsc;
use tokio::sync::oneshot;
use typeshare::typeshare;
use rquickjs::{AsyncContext, AsyncRuntime, Value};
use uuid::Uuid;
use rand::Rng;

// =============================================================================
// SHARED TYPES (must match @swiftgrid/shared)
// =============================================================================

#[typeshare]
#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "UPPERCASE")]
pub enum HttpMethod {
    GET, POST, PUT, DELETE, PATCH
}

#[typeshare]
#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct HttpNodeData {
    pub url: String,
    pub method: HttpMethod,
    #[serde(default)]
    pub headers: Option<HashMap<String, String>>,
    #[typeshare(serialized_as = "any")]
    #[serde(default)]
    pub body: Option<serde_json::Value>,
}

#[typeshare]
#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct CodeNodeData {
    pub code: String,
    #[typeshare(serialized_as = "any")]
    #[serde(default)]
    pub inputs: Option<serde_json::Value>,
}

#[typeshare]
#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(tag = "type", content = "data")]
#[serde(rename_all = "UPPERCASE")]
pub enum NodeType {
    Http(HttpNodeData),
    Code(CodeNodeData),
}

// Enhanced job with run context and retry metadata
#[typeshare]
#[derive(Serialize, Deserialize, Debug)]
pub struct WorkerJob {
    pub id: String,           // Node ID
    #[serde(default)]
    pub run_id: Option<String>,  // Run UUID (optional for backwards compat)
    pub node: NodeType,
    #[serde(default)]
    pub retry_count: u32,
    #[serde(default = "default_max_retries")]
    pub max_retries: u32,
}

fn default_max_retries() -> u32 { 3 }

// Execution receipt pushed back to the UI
#[typeshare]
#[derive(Serialize, Deserialize, Debug)]
pub struct ExecutionResult {
    pub node_id: String,
    pub run_id: Option<String>,
    pub status_code: u16,
    #[typeshare(serialized_as = "any")]
    pub body: Option<serde_json::Value>,
    #[typeshare(serialized_as = "number")]
    pub timestamp: u64,
    pub duration_ms: u64,
}

// Message sent into the JS runtime thread
struct JsTask {
    code: String,
    inputs: Option<serde_json::Value>,
    responder: oneshot::Sender<Result<serde_json::Value, String>>,
}

// =============================================================================
// EVENT LOGGING
// =============================================================================

#[derive(Debug, Clone, Copy)]
enum EventType {
    NodeStarted,
    NodeCompleted,
    NodeFailed,
    NodeRetryScheduled,
}

impl EventType {
    fn as_str(&self) -> &'static str {
        match self {
            EventType::NodeStarted => "NODE_STARTED",
            EventType::NodeCompleted => "NODE_COMPLETED",
            EventType::NodeFailed => "NODE_FAILED",
            EventType::NodeRetryScheduled => "NODE_RETRY_SCHEDULED",
        }
    }
}

async fn log_event(
    pool: &PgPool,
    run_id: &Uuid,
    node_id: &str,
    event_type: EventType,
    payload: serde_json::Value,
) -> Result<(), sqlx::Error> {
    sqlx::query(
        r#"
        INSERT INTO run_events (run_id, node_id, event_type, payload)
        VALUES ($1, $2, $3, $4)
        "#
    )
    .bind(run_id)
    .bind(node_id)
    .bind(event_type.as_str())
    .bind(payload)
    .execute(pool)
    .await?;
    
    Ok(())
}

#[allow(dead_code)] // Will be used by orchestrator in Phase 2
async fn update_run_status(pool: &PgPool, run_id: &Uuid, status: &str) -> Result<(), sqlx::Error> {
    let now = chrono::Utc::now();
    
    match status {
        "running" => {
            sqlx::query(
                "UPDATE workflow_runs SET status = $1, started_at = $2 WHERE id = $3"
            )
            .bind(status)
            .bind(now)
            .bind(run_id)
            .execute(pool)
            .await?;
        }
        "completed" | "failed" => {
            sqlx::query(
                "UPDATE workflow_runs SET status = $1, completed_at = $2 WHERE id = $3"
            )
            .bind(status)
            .bind(now)
            .bind(run_id)
            .execute(pool)
            .await?;
        }
        _ => {
            sqlx::query("UPDATE workflow_runs SET status = $1 WHERE id = $2")
                .bind(status)
                .bind(run_id)
                .execute(pool)
                .await?;
        }
    }
    
    Ok(())
}

// =============================================================================
// RETRY LOGIC
// =============================================================================

fn calculate_backoff(attempt: u32) -> Duration {
    let base_ms = 2u64.pow(attempt) * 1000; // 2s, 4s, 8s, 16s...
    let jitter_ms = rand::rng().random_range(0..=500);
    Duration::from_millis(base_ms + jitter_ms)
}

fn is_retryable_error(status_code: u16) -> bool {
    matches!(status_code, 408 | 429 | 500 | 502 | 503 | 504)
}

// =============================================================================
// MAIN WORKER
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
    let redis_url = std::env::var("REDIS_URL")
        .unwrap_or_else(|_| "redis://127.0.0.1/".to_string());
    let redis_client = redis::Client::open(redis_url)?;
    let mut con = redis_client.get_multiplexed_async_connection().await?;
    
    println!("✓ Connected to Redis");

    // HTTP client
    static APP_USER_AGENT: &str = concat!(env!("CARGO_PKG_NAME"), "/", env!("CARGO_PKG_VERSION"));
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

    // Redis streams
    const STREAM_JOBS: &str = "swiftgrid_stream";
    #[allow(dead_code)] // Used in process_job for publishing results
    const STREAM_RESULTS: &str = "swiftgrid_results";
    let group_name = "workers_group";
    
    let consumer_name = format!("worker_{}", &Uuid::new_v4().to_string()[..8]);
    let _: RedisResult<()> = con.xgroup_create_mkstream(STREAM_JOBS, group_name, "$").await;

    println!("Worker '{}' listening for jobs... (Ctrl+C to stop)", consumer_name);

    let in_flight = Arc::new(AtomicUsize::new(0));

    loop {
        tokio::select! {
            _ = tokio::signal::ctrl_c() => {
                println!("\nShutdown signal received, stopping...");
                break;
            }
            result = async {
                let opts = StreamReadOptions::default()
                    .group(group_name, &consumer_name)
                    .count(1)
                    .block(1000);
                con.xread_options::<&str, &str, StreamReadReply>(&[STREAM_JOBS], &[">"], &opts).await
            } => {
                match result {
                    Ok(reply) => {
                        for stream_key_result in reply.keys {
                            for message in stream_key_result.ids {
                                let msg_id = message.id.clone();
                                
                                if let Some(payload_str) = message.map.get("payload") {
                                    let payload_string: String = match redis::from_redis_value(payload_str) {
                                        Ok(s) => s,
                                        Err(e) => {
                                            eprintln!("Failed to parse payload: {}", e);
                                            continue;
                                        }
                                    };
                                    
                                    match serde_json::from_str::<WorkerJob>(&payload_string) {
                                        Ok(job) => {
                                            println!("Processing Node: {} (run: {:?}, attempt: {})", 
                                                job.id, job.run_id, job.retry_count + 1);

                                            let h_client = http_client.clone();
                                            let r_client = redis_client.clone();
                                            let pool = db_pool.clone();
                                            let j_sender = js_sender.clone();
                                            let in_flight_clone = Arc::clone(&in_flight);
                                            let group = group_name.to_string();

                                            in_flight.fetch_add(1, Ordering::SeqCst);

                                            tokio::spawn(async move {
                                                process_job(
                                                    job, 
                                                    h_client, 
                                                    r_client, 
                                                    pool, 
                                                    j_sender,
                                                    msg_id,
                                                    group,
                                                ).await;
                                                in_flight_clone.fetch_sub(1, Ordering::SeqCst);
                                            });
                                        }
                                        Err(e) => eprintln!("Failed to parse WorkerJob: {}", e),
                                    }
                                }
                            }
                        }
                    }
                    Err(e) => {
                        eprintln!("Redis error: {}", e);
                    }
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
) {
    let start = Instant::now();
    let job_id = job.id.clone();
    let run_id = job.run_id.as_ref().and_then(|s| Uuid::parse_str(s).ok());
    
    // Log NODE_STARTED event
    if let Some(ref rid) = run_id {
        let _ = log_event(&db_pool, rid, &job_id, EventType::NodeStarted, serde_json::json!({})).await;
    }

    // Clone node for potential retry (before we consume it in match)
    let node_clone = job.node.clone();
    
    // Execute the node
    let (status, body) = match job.node {
        NodeType::Http(data) => execute_http(http_client, data).await,
        NodeType::Code(data) => {
            let (tx, rx) = oneshot::channel();
            let task = JsTask {
                code: data.code,
                inputs: data.inputs,
                responder: tx
            };

            if js_sender.send(task).await.is_err() {
                (500, Some(serde_json::json!({"error": "JS Engine crashed"})))
            } else {
                match tokio::time::timeout(Duration::from_secs(30), rx).await {
                    Ok(Ok(Ok(val))) => (200, Some(val)),
                    Ok(Ok(Err(e))) => (400, Some(serde_json::json!({"error": e}))),
                    Ok(Err(_)) => (500, Some(serde_json::json!({"error": "JS channel closed"}))),
                    Err(_) => (500, Some(serde_json::json!({"error": "JS execution timeout (30s)"})))
                }
            }
        }
    };

    let duration_ms = start.elapsed().as_millis() as u64;
    let is_success = status >= 200 && status < 300;

    // Handle result with retry logic
    if !is_success && is_retryable_error(status) && job.retry_count < job.max_retries {
        // Schedule retry
        let next_attempt = job.retry_count + 1;
        let backoff = calculate_backoff(next_attempt);
        let retry_at = chrono::Utc::now() + chrono::Duration::milliseconds(backoff.as_millis() as i64);
        
        println!("  → Scheduling retry {} of {} in {:?}", next_attempt, job.max_retries, backoff);
        
        // Log retry event
        if let Some(ref rid) = run_id {
            let _ = log_event(&db_pool, rid, &job_id, EventType::NodeRetryScheduled, serde_json::json!({
                "attempt": next_attempt,
                "error": body.as_ref().and_then(|b| b.get("error")).unwrap_or(&serde_json::json!("Unknown error")),
                "retry_after": retry_at.to_rfc3339(),
            })).await;
        }
        
        // Re-queue with incremented retry count
        let retry_job = WorkerJob {
            id: job.id.clone(),
            run_id: job.run_id.clone(),
            node: node_clone,  // Use the clone we made earlier
            retry_count: next_attempt,
            max_retries: job.max_retries,
        };
        
        // Clone redis_client for the spawn closure
        let redis_for_retry = redis_client.clone();
        
        // For now, use simple delay + re-queue (Phase 2 will add proper ZSET scheduling)
        tokio::spawn(async move {
            tokio::time::sleep(backoff).await;
            if let Ok(mut con) = redis_for_retry.get_multiplexed_async_connection().await {
                let _: RedisResult<String> = con.xadd(
                    "swiftgrid_stream", 
                    "*", 
                    &[("payload", serde_json::to_string(&retry_job).unwrap())]
                ).await;
            }
        });
    } else {
        // Final result (success or exhausted retries)
        if let Some(ref rid) = run_id {
            if is_success {
                let _ = log_event(&db_pool, rid, &job_id, EventType::NodeCompleted, serde_json::json!({
                    "result": body,
                    "duration_ms": duration_ms,
                })).await;
            } else {
                let _ = log_event(&db_pool, rid, &job_id, EventType::NodeFailed, serde_json::json!({
                    "error": body.as_ref().and_then(|b| b.get("error")).unwrap_or(&serde_json::json!("Unknown error")),
                    "fatal": !is_retryable_error(status),
                    "attempts": job.retry_count + 1,
                    "status_code": status,
                })).await;
            }
        }

        // Publish result to SSE stream
        let receipt = ExecutionResult {
            node_id: job_id.clone(),
            run_id: job.run_id,
            status_code: status,
            body,
            timestamp: SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_millis() as u64,
            duration_ms,
        };

        if let Ok(mut con) = redis_client.get_multiplexed_async_connection().await {
            if let Ok(receipt_json) = serde_json::to_string(&receipt) {
                let _: RedisResult<String> = con.xadd("swiftgrid_results", "*", &[("payload", receipt_json)]).await;
            }
        }
    }

    // ACK and delete the message
    if let Ok(mut con) = redis_client.get_multiplexed_async_connection().await {
        let _: RedisResult<()> = con.xack("swiftgrid_stream", &group_name, &[&msg_id]).await;
        let _: RedisResult<()> = con.xdel("swiftgrid_stream", &[&msg_id]).await;
    }
}

// =============================================================================
// HTTP EXECUTOR
// =============================================================================

async fn execute_http(client: reqwest::Client, data: HttpNodeData) -> (u16, Option<serde_json::Value>) {
    let reqwest_method: reqwest::Method = format!("{:?}", data.method).parse().unwrap();
    let mut req = client.request(reqwest_method, &data.url);
    
    if let Some(h) = data.headers { 
        for (k, v) in h { 
            req = req.header(k, v); 
        } 
    }
    if let Some(b) = data.body { 
        req = req.json(&b); 
    }

    match req.send().await {
        Ok(resp) => {
            let s = resp.status().as_u16();
            let text = resp.text().await.unwrap_or_default();
            let b = match serde_json::from_str::<serde_json::Value>(&text) {
                Ok(json) => Some(json),
                Err(_) => if text.is_empty() { None } else { Some(serde_json::Value::String(text)) }
            };
            (s, b)
        },
        Err(e) => {
            let status = if e.is_timeout() { 408 } 
                else if e.is_connect() { 503 } 
                else { 500 };
            (status, Some(serde_json::json!({ "error": e.to_string() })))
        }
    }
}

// =============================================================================
// JS EXECUTOR
// =============================================================================

async fn run_js_safely(
    ctx: &AsyncContext, 
    code: String, 
    inputs: Option<serde_json::Value>
) -> Result<serde_json::Value, String> {
    ctx.async_with(|ctx| Box::pin(async move { 
        let input_json = serde_json::to_string(&inputs.unwrap_or(serde_json::json!({}))).unwrap_or("{}".into());
        
        let script = format!(
            r#"
            (function(INPUT) {{
                {}
            }})({}) 
            "#,
            code,
            input_json
        );

        match ctx.eval::<Value, _>(script) {
            Ok(v) => {
                let json_func: rquickjs::Function = ctx.eval("JSON.stringify").unwrap();
                match json_func.call::<_, String>((v,)) {
                    Ok(json_str) => Ok(serde_json::from_str(&json_str).unwrap_or(serde_json::Value::Null)),
                    Err(_) => Ok(serde_json::Value::Null)
                }
            },
            Err(e) => Err(format!("JS Error: {}", e))
        }
    })).await
}
