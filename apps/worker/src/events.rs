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
    sqlx::query(
        r#"
        INSERT INTO run_events (run_id, node_id, event_type, payload)
        VALUES ($1, $2, $3, $4)
        "#,
    )
    .bind(run_id)
    .bind(node_id)
    .bind(event_type.as_str())
    .bind(payload)
    .execute(pool)
    .await?;

    Ok(())
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
