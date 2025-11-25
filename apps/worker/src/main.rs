use redis::{AsyncCommands, RedisResult, streams::{StreamReadOptions, StreamReadReply}};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::error::Error;
use std::sync::Arc;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::time::{SystemTime, UNIX_EPOCH};
use tokio::sync::mpsc;
use tokio::sync::oneshot;
use typeshare::typeshare;
use rquickjs::{AsyncContext, AsyncRuntime, Value};

// Shared enums map 1:1 with the Svelte side.
#[typeshare]
#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "UPPERCASE")]
pub enum HttpMethod {
    GET, POST, PUT, DELETE, PATCH
}

// Payload shape for HTTP nodes.
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

// Payload shape for inline JS nodes.
#[typeshare]
#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct CodeNodeData {
    pub code: String, // e.g. "return { sum: 1 + 2 };"
    #[typeshare(serialized_as = "any")]
    #[serde(default)]
    pub inputs: Option<serde_json::Value>, // Data from previous nodes
}

// Worker receives either HTTP or CODE.
#[typeshare]
#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(tag = "type", content = "data")] // TypeScript discriminated union
#[serde(rename_all = "UPPERCASE")]
pub enum NodeType {
    Http(HttpNodeData),
    Code(CodeNodeData),
}

// Stream job pulled from Redis.
#[typeshare]
#[derive(Serialize, Deserialize, Debug)]
struct WorkerJob {
    pub id: String,
    pub node: NodeType,
}

// Execution receipt pushed back to the UI.
#[typeshare]
#[derive(Serialize, Deserialize, Debug)]
struct ExecutionResult {
    node_id: String,
    status_code: u16,
    #[typeshare(serialized_as = "any")]
    body: Option<serde_json::Value>,
    #[typeshare(serialized_as = "number")]
    timestamp: u64,
}

// Message sent into the JS runtime thread.
struct JsTask {
    code: String,
    inputs: Option<serde_json::Value>,
    // The channel to send the answer back to the main thread
    responder: oneshot::Sender<Result<serde_json::Value, String>>,
}

// Worker Logic
#[tokio::main]
async fn main() -> Result<(), Box<dyn Error>> {
    println!("SwiftGrid Worker initializing...");

    // Read Redis URL from env, fallback to localhost
    let redis_url = std::env::var("REDIS_URL").unwrap_or_else(|_| "redis://127.0.0.1/".to_string());
    let client = redis::Client::open(redis_url)?;
    let mut con = client.get_multiplexed_async_connection().await?;
    
    static APP_USER_AGENT: &str = concat!(env!("CARGO_PKG_NAME"), "/", env!("CARGO_PKG_VERSION"));
    let http_client = reqwest::Client::builder()
        .user_agent(APP_USER_AGENT)
        .build()?;

    // Spin up the dedicated JS thread and keep a channel to it.
    let (js_sender, mut js_receiver) = mpsc::channel::<JsTask>(100);
    
    std::thread::spawn(move || {
        // Create Runtime INSIDE this thread (It stays here forever)
        let rt = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .unwrap();

        rt.block_on(async move {
            let js_runtime = AsyncRuntime::new().unwrap();
            let js_context = AsyncContext::full(&js_runtime).await.unwrap();

            println!("JS Sandbox Ready.");

            // Loop forever waiting for tasks
            while let Some(task) = js_receiver.recv().await {
                let result = run_js_safely(&js_context, task.code, task.inputs).await;
                let _ = task.responder.send(result);
            }
        });
    });

    // Redis streams for jobs + receipts (must match @swiftgrid/shared)
    const STREAM_JOBS: &str = "swiftgrid_stream";
    const STREAM_RESULTS: &str = "swiftgrid_results";
    let group_name = "workers_group";
    
    // Unique consumer name: worker_<random_id> (allows multiple workers)
    let consumer_name = format!("worker_{}", &uuid::Uuid::new_v4().to_string()[..8]);
    let _: RedisResult<()> = con.xgroup_create_mkstream(STREAM_JOBS, group_name, "$").await;

    println!("Worker '{}' listening for jobs... (Ctrl+C to stop)", consumer_name);

    // Track in-flight jobs for graceful shutdown
    let in_flight = Arc::new(AtomicUsize::new(0));

    loop {
        // Check for shutdown signal (non-blocking)
        tokio::select! {
            _ = tokio::signal::ctrl_c() => {
                println!("\nShutdown signal received, stopping...");
                break;
            }
            result = async {
                // Block for 1 second at a time so we can check shutdown periodically
                let opts = StreamReadOptions::default()
                    .group(group_name, &consumer_name)
                    .count(1)
                    .block(1000); // 1 second timeout
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
                                            println!("Processing Node: {} [{:?}]", job.id, job.node);

                                            let h_client = http_client.clone();
                                            let mut r_con = match client.get_multiplexed_async_connection().await {
                                                Ok(c) => c,
                                                Err(e) => {
                                                    eprintln!("Failed to get Redis connection: {}", e);
                                                    continue;
                                                }
                                            };
                                            let job_id = job.id.clone();
                                            let j_sender = js_sender.clone();
                                            let in_flight_clone = Arc::clone(&in_flight);

                                            // Increment in-flight counter
                                            in_flight.fetch_add(1, Ordering::SeqCst);

                                            tokio::spawn(async move {
                                                let (status, body) = match job.node {
                                                    NodeType::Http(data) => {
                                                        execute_http(h_client, data).await
                                                    }
                                                    NodeType::Code(data) => {
                                                        let (tx, rx) = oneshot::channel();
                                                        
                                                        let task = JsTask {
                                                            code: data.code,
                                                            inputs: data.inputs,
                                                            responder: tx
                                                        };

                                                        if j_sender.send(task).await.is_err() {
                                                            (500, Some(serde_json::json!({"error": "JS Engine crashed"})))
                                                        } else {
                                                            match rx.await {
                                                                Ok(Ok(val)) => (200, Some(val)),
                                                                Ok(Err(e)) => (400, Some(serde_json::json!({"error": e}))),
                                                                Err(_) => (500, Some(serde_json::json!({"error": "JS Timeout"})))
                                                            }
                                                        }
                                                    }
                                                };

                                                let receipt = ExecutionResult {
                                                    node_id: job_id.clone(),
                                                    status_code: status,
                                                    body,
                                                    timestamp: SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_millis() as u64,
                                                };

                                                match serde_json::to_string(&receipt) {
                                                    Ok(receipt_json) => {
                                                        let res: RedisResult<String> = r_con.xadd(STREAM_RESULTS, "*", &[("payload", receipt_json)]).await;
                                                        if let Err(e) = res {
                                                            eprintln!("Failed to publish result for {}: {}", job_id, e);
                                                        }
                                                    }
                                                    Err(e) => {
                                                        eprintln!("Failed to serialize result for {}: {}", job_id, e);
                                                    }
                                                }

                                                let _: RedisResult<()> = r_con.xack(STREAM_JOBS, group_name, &[&msg_id]).await;
                                                let _: RedisResult<()> = r_con.xdel(STREAM_JOBS, &[&msg_id]).await;

                                                // Decrement in-flight counter
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

    // Wait for in-flight jobs to complete
    let pending = in_flight.load(Ordering::SeqCst);
    if pending > 0 {
        println!("Waiting for {} in-flight job(s) to complete...", pending);
        while in_flight.load(Ordering::SeqCst) > 0 {
            tokio::time::sleep(tokio::time::Duration::from_millis(100)).await;
        }
    }

    println!("Worker '{}' shut down gracefully.", consumer_name);
    Ok(())
}

// Basic HTTP executor so the worker can stay lean.
async fn execute_http(client: reqwest::Client, data: HttpNodeData) -> (u16, Option<serde_json::Value>) {
    let reqwest_method: reqwest::Method = format!("{:?}", data.method).parse().unwrap();
    let mut req = client.request(reqwest_method, &data.url);
    if let Some(h) = data.headers { for (k,v) in h { req = req.header(k,v); } }
    if let Some(b) = data.body { req = req.json(&b); }

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
        Err(e) => (500, Some(serde_json::json!({ "error": e.to_string() })))
    }
}

// Runs user code inside rquickjs and converts whatever comes back into JSON.
async fn run_js_safely(ctx: &AsyncContext, code: String, inputs: Option<serde_json::Value>) -> Result<serde_json::Value, String> {
    ctx.async_with(|ctx| Box::pin(async move { 

        // This produces a valid JS Object literal, e.g., {"key":"value"}
        let input_json = serde_json::to_string(&inputs.unwrap_or(serde_json::json!({}))).unwrap_or("{}".into());
        
        // We simply pass the object literal directly into the function arguments.
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