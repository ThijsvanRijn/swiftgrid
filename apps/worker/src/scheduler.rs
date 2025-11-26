//! Scheduler for delayed jobs and expired suspensions.
//!
//! Runs in a background loop, polling Redis for delayed jobs that are ready
//! and checking PostgreSQL for expired webhook suspensions.

use redis::{AsyncCommands, RedisResult};
use sqlx::PgPool;
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use uuid::Uuid;

/// Redis sorted set for delayed jobs
const DELAYED_JOBS_KEY: &str = "swiftgrid_delayed";
/// Redis stream for active jobs
const ACTIVE_JOBS_KEY: &str = "swiftgrid_stream";

/// Run the scheduler loop.
///
/// This function runs forever, checking for:
/// - Delayed jobs ready to execute (every 1s)
/// - Expired webhook suspensions (every 10s)
pub async fn run(redis_client: redis::Client, db_pool: PgPool) {
    println!("Scheduler started (polling every 1s for delayed jobs and expired suspensions)");

    let poll_interval = Duration::from_secs(1);
    let mut suspension_check_counter = 0u32;

    loop {
        // Check delayed jobs every iteration
        process_delayed_jobs(&redis_client).await;

        // Check for expired suspensions every 10 seconds
        suspension_check_counter += 1;
        if suspension_check_counter >= 10 {
            suspension_check_counter = 0;
            check_expired_suspensions(&db_pool).await;
        }

        tokio::time::sleep(poll_interval).await;
    }
}

/// Process delayed jobs that are ready to execute.
async fn process_delayed_jobs(redis_client: &redis::Client) {
    let Ok(mut con) = redis_client.get_multiplexed_async_connection().await else {
        return;
    };

    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_millis() as f64;

    // Get all jobs that are ready (score <= now)
    let ready_jobs: Vec<String> = match con
        .zrangebyscore_limit(
            DELAYED_JOBS_KEY,
            "-inf",
            now,
            0,
            10, // Process up to 10 at a time
        )
        .await
    {
        Ok(jobs) => jobs,
        Err(e) => {
            eprintln!("Scheduler: Failed to query delayed jobs: {}", e);
            return;
        }
    };

    if ready_jobs.is_empty() {
        return;
    }

    println!(
        "Scheduler: Found {} delayed job(s) ready to run",
        ready_jobs.len()
    );

    for job_json in &ready_jobs {
        // Remove from ZSET
        let _: RedisResult<()> = con.zrem(DELAYED_JOBS_KEY, job_json).await;

        // Add to active queue
        let _: RedisResult<String> = con
            .xadd(ACTIVE_JOBS_KEY, "*", &[("payload", job_json.as_str())])
            .await;
    }
}

/// Check for expired suspensions and fail them.
async fn check_expired_suspensions(pool: &PgPool) {
    // Find expired suspensions that haven't been resumed
    let expired: Vec<(Uuid, String, Uuid)> = match sqlx::query_as(
        r#"
        SELECT id, node_id, run_id FROM suspensions 
        WHERE resumed_at IS NULL 
          AND expires_at IS NOT NULL 
          AND expires_at < NOW()
        LIMIT 10
        "#,
    )
    .fetch_all(pool)
    .await
    {
        Ok(rows) => rows,
        Err(e) => {
            eprintln!("Scheduler: Failed to query expired suspensions: {}", e);
            return;
        }
    };

    for (suspension_id, node_id, run_id) in expired {
        println!(
            "Scheduler: Expiring suspension for node {} in run {}",
            node_id, run_id
        );

        // Log NODE_FAILED event
        let _ = sqlx::query(
            r#"
            INSERT INTO run_events (run_id, node_id, event_type, payload)
            VALUES ($1, $2, 'NODE_FAILED', $3)
            "#,
        )
        .bind(&run_id)
        .bind(&node_id)
        .bind(serde_json::json!({
            "error": "Suspension timeout expired",
            "fatal": true,
        }))
        .execute(pool)
        .await;

        // Mark suspension as resolved (with timeout)
        let _ = sqlx::query(
            r#"
            UPDATE suspensions 
            SET resumed_at = NOW(), 
                resumed_by = 'scheduler:timeout',
                resume_payload = $1
            WHERE id = $2
            "#,
        )
        .bind(serde_json::json!({"timeout": true}))
        .bind(&suspension_id)
        .execute(pool)
        .await;
    }
}

