//! Delay node execution.
//!
//! Handles both short delays (inline sleep) and long delays (scheduled via Redis).

use crate::types::DelayNodeData;
use redis::{AsyncCommands, RedisResult};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

/// Short delay threshold (60 seconds).
/// Delays shorter than this are executed inline.
const SHORT_DELAY_THRESHOLD_MS: u64 = 60_000;

/// Redis sorted set for delayed jobs
const DELAYED_JOBS_KEY: &str = "swiftgrid_delayed";

/// Execute a delay node.
///
/// - Short delays (< 60s): Sleep inline
/// - Long delays (>= 60s): Schedule via Redis ZSET for later execution
pub async fn execute(
    data: DelayNodeData,
    job_id: &str,
    run_id: &Option<String>,
    redis_client: &redis::Client,
) -> (u16, Option<serde_json::Value>) {
    let delay_ms = data.duration_ms;

    if delay_ms <= SHORT_DELAY_THRESHOLD_MS {
        // Short delay: sleep inline
        println!("  → Sleeping for {}ms", delay_ms);
        tokio::time::sleep(Duration::from_millis(delay_ms)).await;

        (
            200,
            Some(serde_json::json!({
                "delayed_ms": delay_ms,
                "message": format!("Delayed for {}ms", delay_ms)
            })),
        )
    } else {
        // Long delay: schedule for later via Redis ZSET
        let resume_at = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_millis() as u64
            + delay_ms;

        // Create a "resume" job that will be picked up by the scheduler
        let resume_job = serde_json::json!({
            "id": job_id,
            "run_id": run_id,
            "node": { "type": "DELAY_RESUME", "data": { "original_delay_ms": delay_ms } },
            "retry_count": 0,
            "max_retries": 0
        });

        if let Ok(mut con) = redis_client.get_multiplexed_async_connection().await {
            let _: RedisResult<()> = con
                .zadd(
                    DELAYED_JOBS_KEY,
                    serde_json::to_string(&resume_job).unwrap(),
                    resume_at as f64,
                )
                .await;
        }

        println!(
            "  → Scheduled delay for {}ms (resume at {})",
            delay_ms, resume_at
        );

        // Return 202 (Accepted) - scheduler will handle completion
        (
            202,
            Some(serde_json::json!({
                "scheduled": true,
                "resume_at": resume_at,
                "delayed_ms": delay_ms
            })),
        )
    }
}

/// Handle a delay resume (called by scheduler when delay has elapsed).
pub fn execute_resume(original_delay_ms: u64) -> (u16, Option<serde_json::Value>) {
    println!("  → Delay resumed after {}ms", original_delay_ms);

    (
        200,
        Some(serde_json::json!({
            "delayed_ms": original_delay_ms,
            "message": format!("Delay completed after {}ms", original_delay_ms)
        })),
    )
}

