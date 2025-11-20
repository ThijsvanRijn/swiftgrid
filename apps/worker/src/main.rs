use redis::AsyncCommands;
use std::error::Error;
use serde::{Deserialize, Serialize}; // NEW: For handling JSON

// 1. Define the Shape of our "Node"
// "derive" tells Rust to write the JSON parser code for us automatically.
#[derive(Serialize, Deserialize, Debug)]
struct HttpRequestNode {
    id: String,
    url: String,
    method: String,
}

#[tokio::main]
async fn main() -> Result<(), Box<dyn Error>> {
    println!("SwiftGrid Worker is waking up...");

    let client = redis::Client::open("redis://127.0.0.1/")?;
    let mut con = client.get_multiplexed_async_connection().await?;
    
    // Create a shared HTTP client with a custom user agent
    static APP_USER_AGENT: &str = concat!(env!("CARGO_PKG_NAME"), "/", env!("CARGO_PKG_VERSION"));
    println!("Worker initialized with User-Agent: {}", APP_USER_AGENT);

    let http_client = reqwest::Client::builder()
        .user_agent(APP_USER_AGENT)
        .build()?;

    println!("Connected to Redis. Waiting for jobs...");

    // Infinite loop to wait for jobs
    loop {
        let result: Option<(String, String)> = con.brpop("job_queue", 0.0).await?;

        if let Some((_queue, payload)) = result {
            println!("RECEIVED: {}", payload);

            // Parse the JSON payload into the HttpRequestNode struct
            let job: Result<HttpRequestNode, _> = serde_json::from_str(&payload);

            // Match the result of the parsing
            match job {
                Ok(node) => {
                    println!("Executing Node: {} ({})", node.id, node.url);

                    // Create the request
                    let request = if node.method == "GET" {
                        http_client.get(&node.url)
                    } else {
                        http_client.post(&node.url)
                    };

                    // Send the request
                    let response = request.send().await;

                    match response {
                        Ok(res) => {
                            if res.status().is_success() {
                                println!("Success! Status: {}", res.status());
                            } else {
                                println!("Request Failed! Status: {}", res.status());
                                // Print the body to see why it failed (e.g., GitHub error message)
                                if let Ok(text) = res.text().await {
                                    println!("Response Body: {}", text);
                                }
                            }
                        }
                        Err(e) => println!("Failed! Error: {}", e),
                    }
                }
                Err(e) => {
                    println!("Could not parse job: {}", e);
                }
            }
        }
    }
}