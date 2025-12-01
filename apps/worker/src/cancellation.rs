//! Cancellation support for workflow runs.
//!
//! Provides real-time cancellation of in-flight operations via Redis pub/sub.
//! When a user cancels a run, a message is published to `cancel:{run_id}` and
//! all workers processing jobs for that run will abort their operations.

use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::RwLock;
use tokio_util::sync::CancellationToken;
use uuid::Uuid;

/// Registry of active cancellation tokens, keyed by run_id.
/// Multiple jobs for the same run share the same token.
pub struct CancellationRegistry {
    tokens: RwLock<HashMap<Uuid, CancellationToken>>,
}

impl CancellationRegistry {
    pub fn new() -> Self {
        Self {
            tokens: RwLock::new(HashMap::new()),
        }
    }

    /// Get or create a cancellation token for a run.
    /// If the run already has a token (from another parallel job), return that.
    pub async fn get_or_create(&self, run_id: Uuid) -> CancellationToken {
        // Fast path: check if token exists
        {
            let read = self.tokens.read().await;
            if let Some(token) = read.get(&run_id) {
                return token.clone();
            }
        }

        // Slow path: acquire write lock and create token
        let mut write = self.tokens.write().await;
        // Double-check after acquiring write lock (another task may have created it)
        write
            .entry(run_id)
            .or_insert_with(CancellationToken::new)
            .clone()
    }

    /// Cancel all jobs for a run.
    pub async fn cancel(&self, run_id: &Uuid) {
        if let Some(token) = self.tokens.read().await.get(run_id) {
            token.cancel();
            println!("Cancellation: Signalled cancel for run {}", run_id);
        }
    }

    /// Remove token when run completes (cleanup to prevent memory leak).
    pub async fn remove(&self, run_id: &Uuid) {
        self.tokens.write().await.remove(run_id);
    }

    /// Check if a run is cancelled.
    pub async fn is_cancelled(&self, run_id: &Uuid) -> bool {
        if let Some(token) = self.tokens.read().await.get(run_id) {
            token.is_cancelled()
        } else {
            false
        }
    }
}

/// Listen for cancellation messages on Redis pub/sub.
/// This runs in a background task and cancels tokens when messages arrive.
pub async fn listen_for_cancellations(
    redis_client: redis::Client,
    registry: Arc<CancellationRegistry>,
) {
    use futures_util::StreamExt;

    println!("Cancellation: Starting pub/sub listener...");

    loop {
        // Get a dedicated connection for pub/sub
        let mut pubsub = match redis_client.get_async_pubsub().await {
            Ok(ps) => ps,
            Err(e) => {
                eprintln!("Cancellation: Failed to connect to Redis pub/sub: {}", e);
                tokio::time::sleep(tokio::time::Duration::from_secs(5)).await;
                continue;
            }
        };

        // Subscribe to all cancel channels
        if let Err(e) = pubsub.psubscribe("cancel:*").await {
            eprintln!("Cancellation: Failed to subscribe: {}", e);
            tokio::time::sleep(tokio::time::Duration::from_secs(5)).await;
            continue;
        }

        println!("Cancellation: Subscribed to cancel:* channels");

        // Process messages
        let mut stream = pubsub.on_message();
        while let Some(msg) = stream.next().await {
            let channel: String = match msg.get_channel() {
                Ok(c) => c,
                Err(_) => continue,
            };

            // Extract run_id from channel name (cancel:{run_id})
            if let Some(run_id_str) = channel.strip_prefix("cancel:") {
                if let Ok(run_id) = Uuid::parse_str(run_id_str) {
                    registry.cancel(&run_id).await;
                }
            }
        }

        // If we exit the loop, the connection was lost - reconnect
        eprintln!("Cancellation: Pub/sub connection lost, reconnecting...");
        tokio::time::sleep(tokio::time::Duration::from_secs(1)).await;
    }
}

