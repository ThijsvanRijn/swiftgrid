//! Real-time streaming output to Redis and PostgreSQL.
//!
//! Provides `StreamContext` for sending progress updates, tokens, and other
//! streaming data from node execution to the frontend via SSE.

use redis::{AsyncCommands, RedisResult};
use sqlx::PgPool;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Arc;
use std::time::{SystemTime, UNIX_EPOCH};
use uuid::Uuid;

/// Redis stream name for real-time chunks
pub const STREAM_CHUNKS: &str = "swiftgrid_chunks";

/// Context for streaming output during node execution.
///
/// Sends chunks to both Redis (for real-time SSE) and PostgreSQL (for replay).
#[derive(Clone)]
pub struct StreamContext {
    redis: redis::Client,
    pool: PgPool,
    run_id: Uuid,
    node_id: String,
    chunk_index: Arc<AtomicUsize>,
}

impl StreamContext {
    /// Create a new streaming context for a node execution.
    pub fn new(redis: redis::Client, pool: PgPool, run_id: Uuid, node_id: String) -> Self {
        Self {
            redis,
            pool,
            run_id,
            node_id,
            chunk_index: Arc::new(AtomicUsize::new(0)),
        }
    }

    /// Send a streaming chunk to both Redis (real-time) and PostgreSQL (persistence).
    pub async fn send_chunk(&self, chunk_type: &str, content: &str) {
        let index = self.chunk_index.fetch_add(1, Ordering::SeqCst);

        // 1. Publish to Redis for real-time SSE
        let chunk_payload = serde_json::json!({
            "run_id": self.run_id.to_string(),
            "node_id": self.node_id,
            "chunk_index": index,
            "chunk_type": chunk_type,
            "content": content,
            "timestamp": SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_millis() as u64
        });

        if let Ok(mut con) = self.redis.get_multiplexed_async_connection().await {
            let _: RedisResult<()> = con
                .xadd(
                    STREAM_CHUNKS,
                    "*",
                    &[(
                        "payload",
                        serde_json::to_string(&chunk_payload).unwrap_or_default(),
                    )],
                )
                .await;
        }

        // 2. Persist to PostgreSQL for replay
        let _ = sqlx::query(
            r#"
            INSERT INTO run_stream_chunks (run_id, node_id, chunk_index, chunk_type, content)
            VALUES ($1, $2, $3, $4, $5)
            "#,
        )
        .bind(&self.run_id)
        .bind(&self.node_id)
        .bind(index as i32)
        .bind(chunk_type)
        .bind(content)
        .execute(&self.pool)
        .await;
    }

    /// Send a progress message (e.g., "Connecting...", "Sending request...").
    pub async fn progress(&self, message: &str) {
        self.send_chunk("progress", message).await;
    }

    /// Send raw data output.
    #[allow(dead_code)]
    pub async fn data(&self, data: &str) {
        self.send_chunk("data", data).await;
    }

    /// Send an error message.
    pub async fn error(&self, error: &str) {
        self.send_chunk("error", error).await;
    }

    /// Signal completion.
    pub async fn complete(&self) {
        self.send_chunk("complete", "").await;
    }

    /// Stream an LLM token for real-time display.
    pub async fn token(&self, token: &str) {
        self.send_chunk("token", token).await;
    }
}
