//! LLM (Large Language Model) node execution.
//!
//! Supports any OpenAI-compatible API including OpenAI, Groq, Together, and Ollama.

use crate::streaming::StreamContext;
use crate::types::LlmNodeData;

/// Execute an LLM chat completion request.
pub async fn execute(
    client: reqwest::Client,
    data: LlmNodeData,
    stream_ctx: Option<&StreamContext>,
) -> (u16, Option<serde_json::Value>) {
    println!(
        "  → LLM: model={}, messages={}, stream={}",
        data.model,
        data.messages.len(),
        data.stream
    );

    // Build the request body
    let mut request_body = serde_json::json!({
        "model": data.model,
        "messages": data.messages.iter().map(|m| serde_json::json!({
            "role": m.role,
            "content": m.content
        })).collect::<Vec<_>>(),
        "stream": data.stream
    });

    // Add optional parameters
    if let Some(temp) = data.temperature {
        request_body["temperature"] = serde_json::json!(temp);
    }
    if let Some(max) = data.max_tokens {
        request_body["max_tokens"] = serde_json::json!(max);
    }

    // Build the endpoint URL
    let endpoint = format!(
        "{}/chat/completions",
        data.base_url.trim_end_matches('/')
    );

    // Stream progress
    if let Some(ctx) = stream_ctx {
        ctx.progress(&format!("Calling {} ({})...", data.model, endpoint))
            .await;
    }

    // Make the API request
    let response = client
        .post(&endpoint)
        .header("Content-Type", "application/json")
        .header("Authorization", format!("Bearer {}", data.api_key))
        .json(&request_body)
        .send()
        .await;

    match response {
        Ok(resp) => {
            let status_code = resp.status().as_u16();

            if data.stream && status_code == 200 {
                handle_streaming_response(resp, &data, stream_ctx).await
            } else {
                handle_non_streaming_response(resp, status_code, &data, stream_ctx).await
            }
        }
        Err(e) => (
            500,
            Some(serde_json::json!({
                "error": format!("Request failed: {}", e)
            })),
        ),
    }
}

/// Handle a streaming SSE response from the LLM API.
async fn handle_streaming_response(
    resp: reqwest::Response,
    data: &LlmNodeData,
    stream_ctx: Option<&StreamContext>,
) -> (u16, Option<serde_json::Value>) {
    let mut full_content = String::new();
    let mut prompt_tokens: u32 = 0;
    let mut completion_tokens: u32 = 0;
    let mut model_used = data.model.clone();

    let body_text = resp.text().await.unwrap_or_default();

    // Parse SSE events (data: {...}\n\n format)
    for line in body_text.lines() {
        if line.starts_with("data: ") {
            let json_str = &line[6..];
            if json_str == "[DONE]" {
                break;
            }

            if let Ok(chunk) = serde_json::from_str::<serde_json::Value>(json_str) {
                // Extract content delta
                if let Some(delta) = chunk["choices"][0]["delta"]["content"].as_str() {
                    full_content.push_str(delta);
                    // Stream each token to the UI
                    if let Some(ctx) = stream_ctx {
                        ctx.token(delta).await;
                    }
                }

                // Capture model if provided
                if let Some(m) = chunk["model"].as_str() {
                    model_used = m.to_string();
                }

                // Some providers include usage in the final chunk
                if let Some(usage) = chunk.get("usage") {
                    prompt_tokens = usage["prompt_tokens"].as_u64().unwrap_or(0) as u32;
                    completion_tokens = usage["completion_tokens"].as_u64().unwrap_or(0) as u32;
                }
            }
        }
    }

    if let Some(ctx) = stream_ctx {
        ctx.progress("Complete").await;
    }

    (
        200,
        Some(serde_json::json!({
            "content": full_content,
            "model": model_used,
            "usage": {
                "prompt_tokens": prompt_tokens,
                "completion_tokens": completion_tokens,
                "total_tokens": prompt_tokens + completion_tokens
            },
            "streamed": true
        })),
    )
}

/// Handle a non-streaming response from the LLM API.
async fn handle_non_streaming_response(
    resp: reqwest::Response,
    status_code: u16,
    data: &LlmNodeData,
    stream_ctx: Option<&StreamContext>,
) -> (u16, Option<serde_json::Value>) {
    let body: serde_json::Value = resp
        .json()
        .await
        .unwrap_or(serde_json::json!({"error": "Failed to parse response"}));

    if status_code == 200 {
        // Extract the assistant's message
        let content = body["choices"][0]["message"]["content"]
            .as_str()
            .unwrap_or("")
            .to_string();

        let model_used = body["model"].as_str().unwrap_or(&data.model).to_string();
        let prompt_tokens = body["usage"]["prompt_tokens"].as_u64().unwrap_or(0) as u32;
        let completion_tokens = body["usage"]["completion_tokens"].as_u64().unwrap_or(0) as u32;

        if let Some(ctx) = stream_ctx {
            ctx.progress("Complete").await;
        }

        (
            200,
            Some(serde_json::json!({
                "content": content,
                "model": model_used,
                "usage": {
                    "prompt_tokens": prompt_tokens,
                    "completion_tokens": completion_tokens,
                    "total_tokens": prompt_tokens + completion_tokens
                },
                "streamed": false
            })),
        )
    } else {
        // Error response
        let error_msg = body["error"]["message"]
            .as_str()
            .unwrap_or("Unknown error")
            .to_string();

        (
            status_code,
            Some(serde_json::json!({
                "error": error_msg,
                "status": status_code
            })),
        )
    }
}
