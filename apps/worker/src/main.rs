use redis::{AsyncCommands, RedisResult, streams::{StreamReadOptions, StreamReadReply}};
use std::error::Error;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use typeshare::typeshare;
use std::time::{SystemTime, UNIX_EPOCH};

// --- SHARED TYPES (Source of Truth) ---
#[typeshare] 
#[derive(Serialize, Deserialize, Debug, Clone)] 
#[serde(rename_all = "UPPERCASE")] 
pub enum HttpMethod {
    GET, POST, PUT, DELETE, PATCH
}

// The Instruction (Svelte -> Rust)
#[typeshare]
#[derive(Serialize, Deserialize, Debug)]
struct HttpRequestNode {
    id: String,
    url: String,
    method: HttpMethod, 
    #[serde(default)] 
    headers: Option<HashMap<String, String>>,
    #[typeshare(serialized_as = "any")]
    #[serde(default)]
    body: Option<serde_json::Value>,
}

// The Receipt (Rust -> Svelte)
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

// Worker Logic

#[tokio::main]
async fn main() -> Result<(), Box<dyn Error>> {
    // Get version from Cargo.toml
    static APP_USER_AGENT: &str = concat!(env!("CARGO_PKG_NAME"), "/", env!("CARGO_PKG_VERSION"));
    println!("SwiftGrid Worker ({}) initializing...", APP_USER_AGENT);

    let client = redis::Client::open("redis://127.0.0.1/")?;
    let mut con = client.get_multiplexed_async_connection().await?;
    
    let http_client = reqwest::Client::builder()
        .user_agent(APP_USER_AGENT)
        .build()?;

    let stream_key = "swiftgrid_stream";
    let result_stream_key = "swiftgrid_results"; // <--- NEW: Output Stream
    let group_name = "workers_group";
    let consumer_name = "worker_1";

    // Ensure Group Exists
    let _: RedisResult<()> = con.xgroup_create_mkstream(stream_key, group_name, "$").await;

    println!("Listening on {}...", stream_key);

    loop {
        let opts = StreamReadOptions::default()
            .group(group_name, consumer_name)
            .count(1)
            .block(0);

        let result: StreamReadReply = con.xread_options(&[stream_key], &[">"], &opts).await?;

        for stream_key_result in result.keys {
            for message in stream_key_result.ids {
                let msg_id = message.id;
                
                if let Some(payload_str) = message.map.get("payload") {
                    if let Ok(value_string) = redis::from_redis_value::<String>(payload_str) {
                         match serde_json::from_str::<HttpRequestNode>(&value_string) {
                            Ok(job) => {
                                println!("Processing Node: {}", job.id);

                                let h_client = http_client.clone();
                                let mut r_con = client.get_multiplexed_async_connection().await?;
                                // We need the job ID inside the thread, so we clone it
                                let job_id = job.id.clone();
                                
                                tokio::spawn(async move {
                                    // Build Request
                                    let reqwest_method: reqwest::Method = format!("{:?}", job.method).parse().unwrap();
                                    let mut req = h_client.request(reqwest_method, &job.url);
                                    
                                    if let Some(h) = job.headers {
                                        for (k,v) in h { req = req.header(k,v); }
                                    }
                                    if let Some(b) = job.body {
                                        req = req.json(&b);
                                    }

                                    // Execute & Capture Result
                                    // We default to status 0/Error if network fails completely
                                    let (status, body) = match req.send().await {
                                        Ok(resp) => {
                                            let s = resp.status().as_u16();
                                            
                                            // Handles Text & JSON
                                            let text = resp.text().await.unwrap_or_default();
                                            // Try to parse as JSON. If fails, wrap the raw text in a JSON String value.
                                            let b = match serde_json::from_str::<serde_json::Value>(&text) {
                                                Ok(json) => Some(json),
                                                Err(_) => if text.is_empty() { None } else { Some(serde_json::Value::String(text)) }
                                            };
                                    
                                            (s, b)
                                        },
                                        Err(e) => {
                                            eprintln!("Network Fail: {}", e);
                                            (0, None)
                                        }
                                    };

                                    // Create Receipt
                                    let receipt = ExecutionResult {
                                        node_id: job_id,
                                        status_code: status,
                                        body,
                                        timestamp: SystemTime::now()
                                            .duration_since(UNIX_EPOCH)
                                            .unwrap()
                                            .as_millis() as u64,
                                    };

                                    // Push Receipt to Redis
                                    let receipt_json = serde_json::to_string(&receipt).unwrap();
                                    let _: RedisResult<String> = r_con.xadd(
                                        result_stream_key, 
                                        "*", 
                                        &[("payload", receipt_json)]
                                    ).await;

                                    println!("> Result stored for Node {}. Status: {}", receipt.node_id, status);

                                    // Cleanup Input
                                    let _: () = r_con.xack(stream_key, group_name, &[&msg_id]).await.unwrap();
                                    let _: () = r_con.xdel(stream_key, &[&msg_id]).await.unwrap();
                                });
                            }
                            Err(e) => eprintln!("JSON Error: {}", e),
                        }
                    }
                }
            }
        }
    }
}