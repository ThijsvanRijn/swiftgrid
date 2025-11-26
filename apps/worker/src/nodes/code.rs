//! JavaScript code node execution.
//!
//! Uses QuickJS for sandboxed JavaScript execution.

use rquickjs::{AsyncContext, Value};
use tokio::sync::oneshot;

/// Task sent to the JS runtime thread.
pub struct JsTask {
    pub code: String,
    pub inputs: Option<serde_json::Value>,
    pub responder: oneshot::Sender<Result<serde_json::Value, String>>,
}

/// Execute JavaScript code safely in a sandboxed context.
pub async fn run_js_safely(
    ctx: &AsyncContext,
    code: String,
    inputs: Option<serde_json::Value>,
) -> Result<serde_json::Value, String> {
    ctx.async_with(|ctx| {
        Box::pin(async move {
            let input_json =
                serde_json::to_string(&inputs.unwrap_or(serde_json::json!({}))).unwrap_or("{}".into());

            let script = format!(
                r#"
                (function(INPUT) {{
                    {}
                }})({}) 
                "#,
                code, input_json
            );

            match ctx.eval::<Value, _>(script) {
                Ok(v) => {
                    let json_func: rquickjs::Function = ctx.eval("JSON.stringify").unwrap();
                    match json_func.call::<_, String>((v,)) {
                        Ok(json_str) => {
                            Ok(serde_json::from_str(&json_str).unwrap_or(serde_json::Value::Null))
                        }
                        Err(_) => Ok(serde_json::Value::Null),
                    }
                }
                Err(e) => Err(format!("JS Error: {}", e)),
            }
        })
    })
    .await
}

