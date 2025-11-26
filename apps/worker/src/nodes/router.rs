//! Router node execution.
//!
//! Conditional branching based on data. The actual condition evaluation
//! happens in the orchestrator; the worker just acknowledges and returns config.

use crate::types::RouterNodeData;

/// Execute a router node.
///
/// The router node's conditions are evaluated by the orchestrator since it needs
/// access to resolved variables from previous nodes. The worker just returns
/// the routing configuration.
pub fn execute(data: RouterNodeData) -> (u16, Option<serde_json::Value>) {
    println!(
        "  → Router: '{}' mode with {} conditions",
        data.mode,
        data.conditions.len()
    );

    (
        200,
        Some(serde_json::json!({
            "router": true,
            "route_by": data.route_by,
            "conditions": data.conditions.iter().map(|c| serde_json::json!({
                "id": c.id,
                "label": c.label,
                "expression": c.expression
            })).collect::<Vec<_>>(),
            "default_output": data.default_output,
            "mode": data.mode
        })),
    )
}

