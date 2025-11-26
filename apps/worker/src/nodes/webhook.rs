//! Webhook wait/resume node execution.
//!
//! Handles workflow suspension waiting for external webhooks.

use crate::events::{log_event, EventType};
use crate::types::{WebhookResumeData, WebhookWaitData};
use sqlx::PgPool;
use uuid::Uuid;

/// Execute a webhook wait node (suspend until external POST arrives).
pub async fn execute_wait(
    data: WebhookWaitData,
    job_id: &str,
    run_id: Option<&Uuid>,
    db_pool: &PgPool,
) -> (u16, Option<serde_json::Value>) {
    let resume_token = Uuid::new_v4().to_string();
    let expires_at = chrono::Utc::now() + chrono::Duration::milliseconds(data.timeout_ms as i64);

    println!(
        "  → Suspending for webhook (token: {}, expires: {})",
        &resume_token[..8],
        expires_at.format("%Y-%m-%d %H:%M")
    );

    // Create suspension in database
    if let Some(rid) = run_id {
        // Log suspension event
        let _ = log_event(
            db_pool,
            rid,
            job_id,
            EventType::NodeSuspended,
            serde_json::json!({
                "type": "webhook",
                "resume_token": resume_token,
                "description": data.description,
                "expires_at": expires_at.to_rfc3339(),
            }),
        )
        .await;

        // Create suspension record
        let _ = sqlx::query(
            r#"
            INSERT INTO suspensions (run_id, node_id, suspension_type, resume_token, execution_context, expires_at)
            VALUES ($1, $2, 'webhook', $3, $4, $5)
            "#,
        )
        .bind(rid)
        .bind(job_id)
        .bind(&resume_token)
        .bind(serde_json::json!({
            "description": data.description,
            "timeout_ms": data.timeout_ms,
        }))
        .bind(expires_at)
        .execute(db_pool)
        .await;
    }

    // Return 202 (Accepted) - signals "suspended, don't publish result yet"
    (
        202,
        Some(serde_json::json!({
            "suspended": true,
            "resume_token": resume_token,
            "resume_url": format!("/api/hooks/resume/{}", resume_token),
            "expires_at": expires_at.to_rfc3339(),
            "description": data.description
        })),
    )
}

/// Execute a webhook resume (called when webhook POST arrives).
pub async fn execute_resume(
    data: WebhookResumeData,
    job_id: &str,
    run_id: Option<&Uuid>,
    db_pool: &PgPool,
) -> (u16, Option<serde_json::Value>) {
    println!("  → Webhook resumed (token: {})", &data.resume_token[..8]);

    // Log resume event
    if let Some(rid) = run_id {
        let _ = log_event(
            db_pool,
            rid,
            job_id,
            EventType::NodeResumed,
            serde_json::json!({
                "source": "webhook",
                "resume_token": data.resume_token,
                "payload": data.payload,
            }),
        )
        .await;
    }

    (
        200,
        Some(serde_json::json!({
            "resumed": true,
            "webhook_payload": data.payload,
            "message": "Webhook received, workflow resumed"
        })),
    )
}

