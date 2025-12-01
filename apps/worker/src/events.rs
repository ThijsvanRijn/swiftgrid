//! Event logging for workflow run tracking.
//!
//! All node lifecycle events are logged to PostgreSQL for observability,
//! debugging, and replay capabilities.

use sqlx::PgPool;
use uuid::Uuid;

/// Types of events that can occur during node execution.
#[derive(Debug, Clone, Copy)]
pub enum EventType {
    NodeStarted,
    NodeCompleted,
    NodeFailed,
    NodeCancelled,
    NodeRetryScheduled,
    NodeSuspended,
    NodeResumed,
}

impl EventType {
    /// Convert to the string representation stored in the database.
    pub fn as_str(&self) -> &'static str {
        match self {
            EventType::NodeStarted => "NODE_STARTED",
            EventType::NodeCompleted => "NODE_COMPLETED",
            EventType::NodeFailed => "NODE_FAILED",
            EventType::NodeCancelled => "NODE_CANCELLED",
            EventType::NodeRetryScheduled => "NODE_RETRY_SCHEDULED",
            EventType::NodeSuspended => "NODE_SUSPENDED",
            EventType::NodeResumed => "NODE_RESUMED",
        }
    }
}

/// Log an event to the run_events table.
pub async fn log_event(
    pool: &PgPool,
    run_id: &Uuid,
    node_id: &str,
    event_type: EventType,
    payload: serde_json::Value,
) -> Result<(), sqlx::Error> {
    log_event_with_retry(pool, run_id, node_id, event_type, None, payload).await
}

/// Log an event with retry count for idempotency tracking.
pub async fn log_event_with_retry(
    pool: &PgPool,
    run_id: &Uuid,
    node_id: &str,
    event_type: EventType,
    retry_count: Option<u32>,
    payload: serde_json::Value,
) -> Result<(), sqlx::Error> {
    sqlx::query(
        r#"
        INSERT INTO run_events (run_id, node_id, event_type, retry_count, payload)
        VALUES ($1, $2, $3, $4, $5)
        "#,
    )
    .bind(run_id)
    .bind(node_id)
    .bind(event_type.as_str())
    .bind(retry_count.map(|c| c as i32))
    .bind(payload)
    .execute(pool)
    .await?;

    Ok(())
}

/// Check if a node execution attempt has already completed or failed.
/// Used for idempotency: prevents re-execution after worker crash.
pub async fn has_node_completed(
    pool: &PgPool,
    run_id: &Uuid,
    node_id: &str,
    retry_count: u32,
) -> Result<bool, sqlx::Error> {
    let result: Option<(i64,)> = sqlx::query_as(
        r#"
        SELECT 1 FROM run_events 
        WHERE run_id = $1 
          AND node_id = $2 
          AND retry_count = $3
          AND event_type IN ('NODE_COMPLETED', 'NODE_FAILED', 'NODE_CANCELLED')
        LIMIT 1
        "#,
    )
    .bind(run_id)
    .bind(node_id)
    .bind(retry_count as i32)
    .fetch_optional(pool)
    .await?;

    Ok(result.is_some())
}

/// Update the status of a workflow run.
#[allow(dead_code)]
pub async fn update_run_status(
    pool: &PgPool,
    run_id: &Uuid,
    status: &str,
) -> Result<(), sqlx::Error> {
    let now = chrono::Utc::now();

    match status {
        "running" => {
            sqlx::query("UPDATE workflow_runs SET status = $1, started_at = $2 WHERE id = $3")
                .bind(status)
                .bind(now)
                .bind(run_id)
                .execute(pool)
                .await?;
        }
        "completed" | "failed" | "cancelled" => {
            sqlx::query("UPDATE workflow_runs SET status = $1, completed_at = $2 WHERE id = $3")
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
