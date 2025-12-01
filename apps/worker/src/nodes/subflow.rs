//! Sub-flow node execution.
//!
//! Spawns a child workflow run and suspends the parent until completion.

use chrono;
use sqlx::PgPool;
use uuid::Uuid;

use crate::types::{SubFlowNodeData, SubFlowResumeData};

/// Error type for sub-flow operations
#[derive(Debug)]
pub enum SubFlowError {
    DepthLimitExceeded { current: u32, limit: u32 },
    WorkflowNotFound { workflow_id: i32 },
    NoPublishedVersion { workflow_id: i32 },
    VersionNotFound { version_id: String },
    DatabaseError(String),
    ChildFailed { error: String },
}

impl std::fmt::Display for SubFlowError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            SubFlowError::DepthLimitExceeded { current, limit } => {
                write!(f, "Sub-flow depth limit exceeded: {} > {}", current, limit)
            }
            SubFlowError::WorkflowNotFound { workflow_id } => {
                write!(f, "Workflow not found: {}", workflow_id)
            }
            SubFlowError::NoPublishedVersion { workflow_id } => {
                write!(f, "No published version for workflow: {}", workflow_id)
            }
            SubFlowError::VersionNotFound { version_id } => {
                write!(f, "Version not found: {}", version_id)
            }
            SubFlowError::DatabaseError(msg) => write!(f, "Database error: {}", msg),
            SubFlowError::ChildFailed { error } => write!(f, "Child sub-flow failed: {}", error),
        }
    }
}

/// Result of spawning a sub-flow
pub struct SpawnResult {
    pub child_run_id: Uuid,
    pub child_workflow_name: String,
}

/// Spawn a child workflow run.
/// Returns the child run ID. The parent should be suspended after this.
pub async fn spawn_child_run(
    db_pool: &PgPool,
    data: &SubFlowNodeData,
    parent_run_id: &Uuid,
    parent_node_id: &str,
    parent_depth: u32,
) -> Result<SpawnResult, SubFlowError> {
    // Check depth limit
    let new_depth = parent_depth + 1;
    if new_depth > data.depth_limit {
        return Err(SubFlowError::DepthLimitExceeded {
            current: new_depth,
            limit: data.depth_limit,
        });
    }

    // Get the workflow
    let workflow: Option<(i32, String, Option<Uuid>)> = sqlx::query_as(
        "SELECT id, name, active_version_id FROM workflows WHERE id = $1"
    )
    .bind(data.workflow_id)
    .fetch_optional(db_pool)
    .await
    .map_err(|e| SubFlowError::DatabaseError(e.to_string()))?;

    let (workflow_id, workflow_name, active_version_id) = workflow.ok_or_else(|| {
        SubFlowError::WorkflowNotFound {
            workflow_id: data.workflow_id,
        }
    })?;

    // Determine which version to use
    let version_id = if let Some(ref pinned_version) = data.version_id {
        // Use pinned version
        let parsed = Uuid::parse_str(pinned_version)
            .map_err(|_| SubFlowError::VersionNotFound {
                version_id: pinned_version.clone(),
            })?;
        
        // Verify it exists
        let exists: Option<(Uuid,)> = sqlx::query_as(
            "SELECT id FROM workflow_versions WHERE id = $1 AND workflow_id = $2"
        )
        .bind(parsed)
        .bind(workflow_id)
        .fetch_optional(db_pool)
        .await
        .map_err(|e| SubFlowError::DatabaseError(e.to_string()))?;

        exists.ok_or_else(|| SubFlowError::VersionNotFound {
            version_id: pinned_version.clone(),
        })?;

        parsed
    } else {
        // Use active published version
        active_version_id.ok_or_else(|| SubFlowError::NoPublishedVersion {
            workflow_id: data.workflow_id,
        })?
    };

    // Get the graph from the version
    let version_graph: Option<(serde_json::Value,)> = sqlx::query_as(
        "SELECT graph FROM workflow_versions WHERE id = $1"
    )
    .bind(version_id)
    .fetch_optional(db_pool)
    .await
    .map_err(|e| SubFlowError::DatabaseError(e.to_string()))?;

    let (graph,) = version_graph.ok_or_else(|| SubFlowError::VersionNotFound {
        version_id: version_id.to_string(),
    })?;

    // Create the child run
    let child_run_id = Uuid::new_v4();
    
    sqlx::query(
        r#"
        INSERT INTO workflow_runs (
            id, workflow_id, workflow_version_id, snapshot_graph, 
            status, trigger, input_data,
            parent_run_id, parent_node_id, depth
        )
        VALUES ($1, $2, $3, $4, 'pending', 'subflow', $5, $6, $7, $8)
        "#
    )
    .bind(child_run_id)
    .bind(workflow_id)
    .bind(version_id)
    .bind(&graph)
    .bind(&data.input)
    .bind(parent_run_id)
    .bind(parent_node_id)
    .bind(new_depth as i32)
    .execute(db_pool)
    .await
    .map_err(|e| SubFlowError::DatabaseError(e.to_string()))?;

    // Log RUN_CREATED event for child
    sqlx::query(
        r#"
        INSERT INTO run_events (run_id, event_type, payload)
        VALUES ($1, 'RUN_CREATED', $2)
        "#
    )
    .bind(child_run_id)
    .bind(serde_json::json!({
        "trigger": "subflow",
        "parent_run_id": parent_run_id.to_string(),
        "parent_node_id": parent_node_id,
        "workflow_id": workflow_id,
        "version_id": version_id.to_string(),
        "timeout_ms": data.timeout_ms,
    }))
    .execute(db_pool)
    .await
    .map_err(|e| SubFlowError::DatabaseError(e.to_string()))?;

    // Create a suspension record to track the sub-flow state
    // This stores output_path for mapping when child completes
    let timeout_at = if data.timeout_ms > 0 {
        Some(chrono::Utc::now() + chrono::Duration::milliseconds(data.timeout_ms as i64))
    } else {
        None
    };
    
    sqlx::query(
        r#"
        INSERT INTO suspensions (run_id, node_id, suspension_type, resume_after, execution_context)
        VALUES ($1, $2, 'subflow', $3, $4)
        "#
    )
    .bind(parent_run_id)
    .bind(parent_node_id)
    .bind(timeout_at)
    .bind(serde_json::json!({
        "child_run_id": child_run_id.to_string(),
        "fail_on_error": data.fail_on_error,
        "output_path": data.output_path,
        "max_retries": data.max_retries,
        "retry_count": 0,
        "workflow_id": data.workflow_id,
        "version_id": data.version_id,
        "input": data.input,
        "timeout_ms": data.timeout_ms,
        "depth_limit": data.depth_limit,
    }))
    .execute(db_pool)
    .await
    .map_err(|e| SubFlowError::DatabaseError(e.to_string()))?;

    Ok(SpawnResult {
        child_run_id,
        child_workflow_name: workflow_name,
    })
}

/// Handle the resume after a child sub-flow completes.
/// Returns (status_code, body) for the parent node.
pub fn handle_resume(data: &SubFlowResumeData, fail_on_error: bool) -> (u16, serde_json::Value) {
    if data.success {
        // Success - return child's output
        (
            200,
            serde_json::json!({
                "child_run_id": data.child_run_id,
                "output": data.output,
            }),
        )
    } else if fail_on_error {
        // Failure with fail_on_error = true - propagate error
        (
            500,
            serde_json::json!({
                "error": data.error.clone().unwrap_or_else(|| "Sub-flow failed".to_string()),
                "child_run_id": data.child_run_id,
            }),
        )
    } else {
        // Failure with fail_on_error = false - route to error handle (use 299 as special code)
        // The orchestrator will use the "error" handle instead of "success"
        (
            299, // Special code: success but route to error handle
            serde_json::json!({
                "error": data.error.clone().unwrap_or_else(|| "Sub-flow failed".to_string()),
                "child_run_id": data.child_run_id,
                "route_to": "error",
            }),
        )
    }
}

/// Mark the parent run as suspended (waiting for child).
pub async fn suspend_parent_run(
    db_pool: &PgPool,
    parent_run_id: &Uuid,
) -> Result<(), SubFlowError> {
    sqlx::query("UPDATE workflow_runs SET status = 'suspended' WHERE id = $1")
        .bind(parent_run_id)
        .execute(db_pool)
        .await
        .map_err(|e| SubFlowError::DatabaseError(e.to_string()))?;

    Ok(())
}

