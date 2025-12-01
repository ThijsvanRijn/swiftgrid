//! HTTP node execution.
//!
//! Makes HTTP requests with streaming progress updates and cancellation support.

use crate::streaming::StreamContext;
use crate::types::HttpNodeData;
use tokio_util::sync::CancellationToken;

/// Execute an HTTP request node with cancellation support.
/// Returns (status_code, body, was_cancelled).
pub async fn execute(
    client: reqwest::Client,
    data: HttpNodeData,
    stream_ctx: Option<&StreamContext>,
    cancel_token: &CancellationToken,
) -> (u16, Option<serde_json::Value>, bool) {
    let method_str = format!("{:?}", data.method);
    let reqwest_method: reqwest::Method = method_str.parse().unwrap();

    // Stream progress: starting
    if let Some(ctx) = stream_ctx {
        ctx.progress(&format!("{} {}", method_str, &data.url)).await;
    }

    let mut req = client.request(reqwest_method, &data.url);

    if let Some(h) = data.headers {
        for (k, v) in h {
            req = req.header(k, v);
        }
    }
    if let Some(b) = data.body {
        req = req.json(&b);
    }

    // Stream progress: sending
    if let Some(ctx) = stream_ctx {
        ctx.progress("Sending request...").await;
    }

    // Execute with cancellation support using tokio::select!
    let result = tokio::select! {
        biased; // Check cancellation first

        _ = cancel_token.cancelled() => {
            // Cancelled before or during request
            if let Some(ctx) = stream_ctx {
                ctx.progress("Cancelled").await;
            }
            return (499, Some(serde_json::json!({ "error": "Request cancelled" })), true);
        }

        result = req.send() => result
    };

    match result {
        Ok(resp) => {
            let status = resp.status().as_u16();

            // Stream progress: receiving
            if let Some(ctx) = stream_ctx {
                ctx.progress(&format!(
                    "Response: {} {}",
                    status,
                    resp.status().canonical_reason().unwrap_or("")
                ))
                .await;
            }

            // Check cancellation before reading body
            if cancel_token.is_cancelled() {
                if let Some(ctx) = stream_ctx {
                    ctx.progress("Cancelled").await;
                }
                return (499, Some(serde_json::json!({ "error": "Request cancelled" })), true);
            }

            let text = resp.text().await.unwrap_or_default();
            let body = match serde_json::from_str::<serde_json::Value>(&text) {
                Ok(json) => Some(json),
                Err(_) => {
                    if text.is_empty() {
                        None
                    } else {
                        Some(serde_json::Value::String(text))
                    }
                }
            };

            // Stream complete
            if let Some(ctx) = stream_ctx {
                ctx.complete().await;
            }

            (status, body, false)
        }
        Err(e) => {
            let status = if e.is_timeout() {
                408
            } else if e.is_connect() {
                503
            } else {
                500
            };

            // Stream error
            if let Some(ctx) = stream_ctx {
                ctx.error(&e.to_string()).await;
            }

            (status, Some(serde_json::json!({ "error": e.to_string() })), false)
        }
    }
}
