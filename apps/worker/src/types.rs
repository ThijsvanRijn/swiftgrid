//! Shared types for the SwiftGrid worker.
//!
//! These types are shared with the frontend via `typeshare`.
//! Run `typeshare` from this directory to regenerate TypeScript types:
//! ```bash
//! typeshare ./src --lang=typescript --output-file=../../packages/shared/src/worker.ts
//! ```

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use typeshare::typeshare;

// =============================================================================
// HTTP NODE
// =============================================================================

#[typeshare]
#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "UPPERCASE")]
pub enum HttpMethod {
    GET,
    POST,
    PUT,
    DELETE,
    PATCH,
}

#[typeshare]
#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct HttpNodeData {
    pub url: String,
    pub method: HttpMethod,
    #[serde(default)]
    pub headers: Option<HashMap<String, String>>,
    #[typeshare(serialized_as = "any")]
    #[serde(default)]
    pub body: Option<serde_json::Value>,
}

// =============================================================================
// CODE NODE
// =============================================================================

#[typeshare]
#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct CodeNodeData {
    pub code: String,
    #[typeshare(serialized_as = "any")]
    #[serde(default)]
    pub inputs: Option<serde_json::Value>,
}

// =============================================================================
// DELAY NODE
// =============================================================================

#[typeshare]
#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct DelayNodeData {
    /// Delay duration in milliseconds
    #[typeshare(serialized_as = "number")]
    pub duration_ms: u64,
    /// Human-readable duration string: "5s", "2m", "1h"
    #[serde(default)]
    pub duration_str: Option<String>,
}

#[typeshare]
#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct DelayResumeData {
    #[typeshare(serialized_as = "number")]
    pub original_delay_ms: u64,
}

// =============================================================================
// WEBHOOK WAIT NODE
// =============================================================================

fn default_timeout_ms() -> u64 {
    7 * 24 * 60 * 60 * 1000 // 7 days
}

#[typeshare]
#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct WebhookWaitData {
    /// Description shown to user: "Wait for payment confirmation"
    pub description: Option<String>,
    /// Timeout in milliseconds (default: 7 days)
    #[typeshare(serialized_as = "number")]
    #[serde(default = "default_timeout_ms")]
    pub timeout_ms: u64,
}

#[typeshare]
#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct WebhookResumeData {
    pub resume_token: String,
    #[typeshare(serialized_as = "any")]
    pub payload: Option<serde_json::Value>,
}

// =============================================================================
// ROUTER NODE
// =============================================================================

fn default_router_mode() -> String {
    "first_match".to_string()
}

#[typeshare]
#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct RouterCondition {
    /// Output handle ID
    pub id: String,
    /// Display label (e.g., "Success", "Error")
    pub label: String,
    /// JS expression: "value >= 200 && value < 300"
    pub expression: String,
}

#[typeshare]
#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct RouterNodeData {
    /// Variable to evaluate: "{{node.status}}"
    pub route_by: String,
    /// Conditions to check in order
    pub conditions: Vec<RouterCondition>,
    /// Output if no conditions match
    pub default_output: String,
    /// "first_match" or "broadcast"
    #[serde(default = "default_router_mode")]
    pub mode: String,
}

// =============================================================================
// LLM NODE
// =============================================================================

#[typeshare]
#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct LlmMessage {
    /// "system", "user", or "assistant"
    pub role: String,
    pub content: String,
}

#[typeshare]
#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct LlmNodeData {
    /// Base URL: "https://api.openai.com/v1" or custom
    pub base_url: String,
    /// API key (can be {{$env.OPENAI_KEY}})
    pub api_key: String,
    /// Model name: "gpt-4o", "gpt-3.5-turbo", etc.
    pub model: String,
    /// Conversation messages
    pub messages: Vec<LlmMessage>,
    /// Temperature: 0.0 - 2.0
    #[serde(default)]
    pub temperature: Option<f32>,
    /// Max response tokens
    #[serde(default)]
    pub max_tokens: Option<u32>,
    /// Enable streaming (default: false)
    #[serde(default)]
    pub stream: bool,
}

// =============================================================================
// SUBFLOW NODE
// =============================================================================

fn default_depth_limit() -> u32 {
    10
}

#[typeshare]
#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct SubFlowNodeData {
    /// Workflow ID to execute
    pub workflow_id: i32,
    /// Pinned version ID (null = use active published version)
    #[serde(default)]
    pub version_id: Option<String>,
    /// Input data to pass to the sub-flow (JSON or template)
    #[typeshare(serialized_as = "any")]
    #[serde(default)]
    pub input: Option<serde_json::Value>,
    /// If true, parent fails when sub-flow fails (otherwise routes to error handle)
    #[serde(default)]
    pub fail_on_error: bool,
    /// Current depth (for recursion limit)
    #[serde(default)]
    pub current_depth: u32,
    /// Max depth before failing (default: 10)
    #[serde(default = "default_depth_limit")]
    pub depth_limit: u32,
    /// Timeout in milliseconds (0 = no timeout)
    #[serde(default)]
    pub timeout_ms: u64,
    /// Output mapping - extract specific fields from child output (e.g., "result.data")
    #[serde(default)]
    pub output_path: Option<String>,
    /// Maximum retry attempts for the sub-flow (0 = no retries)
    #[serde(default)]
    pub max_retries: u32,
}

#[typeshare]
#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct SubFlowResumeData {
    /// The child run ID that completed
    pub child_run_id: String,
    /// Output from the child run
    #[typeshare(serialized_as = "any")]
    pub output: Option<serde_json::Value>,
    /// Whether the child succeeded
    pub success: bool,
    /// Error message if failed
    #[serde(default)]
    pub error: Option<String>,
}

// =============================================================================
// NODE TYPE ENUM
// =============================================================================

#[typeshare]
#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(tag = "type", content = "data")]
#[serde(rename_all = "UPPERCASE")]
pub enum NodeType {
    Http(HttpNodeData),
    Code(CodeNodeData),
    Delay(DelayNodeData),
    DelayResume(DelayResumeData),
    WebhookWait(WebhookWaitData),
    WebhookResume(WebhookResumeData),
    Router(RouterNodeData),
    Llm(LlmNodeData),
    SubFlow(SubFlowNodeData),
    SubFlowResume(SubFlowResumeData),
}

// =============================================================================
// WORKER JOB
// =============================================================================

fn default_max_retries() -> u32 {
    3
}

#[typeshare]
#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct WorkerJob {
    /// Node ID
    pub id: String,
    /// Run UUID (optional for backwards compat)
    #[serde(default)]
    pub run_id: Option<String>,
    /// The node to execute
    pub node: NodeType,
    /// Current retry attempt (0-indexed)
    #[serde(default)]
    pub retry_count: u32,
    /// Maximum retry attempts
    #[serde(default = "default_max_retries")]
    pub max_retries: u32,
    /// If true, don't trigger downstream nodes
    #[serde(default)]
    pub isolated: bool,
}

// =============================================================================
// EXECUTION RESULT
// =============================================================================

#[typeshare]
#[derive(Serialize, Deserialize, Debug)]
pub struct ExecutionResult {
    pub node_id: String,
    pub run_id: Option<String>,
    pub status_code: u16,
    #[typeshare(serialized_as = "any")]
    pub body: Option<serde_json::Value>,
    #[typeshare(serialized_as = "number")]
    pub timestamp: u64,
    #[typeshare(serialized_as = "number")]
    pub duration_ms: u64,
    /// If true, frontend should not trigger downstream
    #[serde(default)]
    pub isolated: bool,
}
