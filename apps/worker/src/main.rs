use redis::{AsyncCommands, RedisResult, streams::{StreamReadOptions, StreamReadReply}};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::error::Error;
use std::time::{SystemTime, UNIX_EPOCH};
use tokio::sync::mpsc; // Channels
use tokio::sync::oneshot; // One-way response channel
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

    // Redis streams for jobs + receipts.
    let stream_key = "swiftgrid_stream";
    let result_stream_key = "swiftgrid_results";
    let group_name = "workers_group";
    let consumer_name = "worker_1";
    let _: RedisResult<()> = con.xgroup_create_mkstream(stream_key, group_name, "$").await;

    println!("Listening for jobs...");

    loop {
        // Blocking read so we only wake when a job arrives.
        let opts = StreamReadOptions::default().group(group_name, consumer_name).count(1).block(0);
        let result: StreamReadReply = con.xread_options(&[stream_key], &[">"], &opts).await?;

        for stream_key_result in result.keys {
            for message in stream_key_result.ids {
                let msg_id = message.id.clone();
                
                if let Some(payload_str) = message.map.get("payload") {
                    let payload_string: String = redis::from_redis_value(payload_str)?;
                    
                    match serde_json::from_str::<WorkerJob>(&payload_string) {
                        Ok(job) => {
                            println!("Processing Node: {} [{:?}]", job.id, job.node);

                            let h_client = http_client.clone();
                            let mut r_con = client.get_multiplexed_async_connection().await?;
                            let job_id = job.id.clone();
                            
                            // Clone the channel sender so we can pass it to the task
                            let j_sender = js_sender.clone();

                            tokio::spawn(async move {
                                // Execute node based on type.
                                let (status, body) = match job.node {
                                    NodeType::Http(data) => {
                                        execute_http(h_client, data).await
                                    }
                                    NodeType::Code(data) => {
                                        // Send to JS thread and wait for answer.
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

                                // SEND RECEIPT
                                let receipt = ExecutionResult {
                                    node_id: job_id.clone(),
                                    status_code: status,
                                    body,
                                    timestamp: SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_millis() as u64,
                                };

                                match serde_json::to_string(&receipt) {
                                    Ok(receipt_json) => {
                                        let res: RedisResult<String> = r_con.xadd(result_stream_key, "*", &[("payload", receipt_json)]).await;
                                        if let Err(e) = res {
                                            eprintln!("failed to publish execution result for {}: {}", job_id, e);
                                        }
                                    }
                                    Err(e) => {
                                        eprintln!("critical: failed to serialize execution result for {}: {}", job_id, e);
                                    }
                                }

                                let ack_res: RedisResult<()> = r_con.xack(stream_key, group_name, &[&msg_id]).await;
                                if let Err(e) = ack_res {
                                    eprintln!("failed to acknowledge redis message {}: {}", msg_id, e);
                                }

                                let del_res: RedisResult<()> = r_con.xdel(stream_key, &[&msg_id]).await;
                                if let Err(e) = del_res {
                                    eprintln!("failed to delete redis message {}: {}", msg_id, e);
                                }
                            });
                        }
                        Err(e) => eprintln!("Failed to parse WorkerJob: {}", e),
                    }
                }
            }
        }
    }
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