use reqwest::StatusCode;
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use tauri::State;

use crate::{
    db::AppState,
    models::{GenerationRequest, GenerationResponse},
};

fn digest_prompt(prompt: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(prompt.as_bytes());
    let bytes = hasher.finalize();
    bytes.iter().map(|byte| format!("{byte:02x}")).collect()
}

fn collect_text(value: &Value, output: &mut Vec<String>) {
    match value {
        Value::Object(map) => {
            if let Some(Value::String(text)) = map.get("text") {
                if !text.trim().is_empty() {
                    output.push(text.clone());
                }
            }
            for child in map.values() {
                collect_text(child, output);
            }
        }
        Value::Array(items) => {
            for item in items {
                collect_text(item, output);
            }
        }
        _ => {}
    }
}

fn extract_openai_text(value: &Value) -> Option<String> {
    // Chat Completions shape: choices[].message.content
    if let Some(text) = value
        .get("choices")
        .and_then(Value::as_array)
        .and_then(|choices| choices.first())
        .and_then(|choice| choice.get("message"))
        .and_then(|message| message.get("content"))
        .and_then(Value::as_str)
    {
        if !text.trim().is_empty() {
            return Some(text.to_string());
        }
    }

    // Responses API shape: output_text
    if let Some(text) = value.get("output_text").and_then(Value::as_str) {
        if !text.trim().is_empty() {
            return Some(text.to_string());
        }
    }

    let mut chunks = Vec::new();
    if let Some(output) = value.get("output") {
        collect_text(output, &mut chunks);
    } else {
        collect_text(value, &mut chunks);
    }

    if chunks.is_empty() {
        None
    } else {
        Some(chunks.join("\n"))
    }
}

fn extract_anthropic_text(value: &Value) -> Option<String> {
    let chunks = value
        .get("content")
        .and_then(Value::as_array)?
        .iter()
        .filter_map(|item| item.get("text").and_then(Value::as_str))
        .filter(|text| !text.trim().is_empty())
        .map(ToString::to_string)
        .collect::<Vec<_>>();

    if chunks.is_empty() {
        None
    } else {
        Some(chunks.join("\n"))
    }
}

async fn response_json_or_error(response: reqwest::Response) -> Result<Value, String> {
    let status: StatusCode = response.status();
    let text = response.text().await.map_err(|err| err.to_string())?;
    if !status.is_success() {
        return Err(format!("LLM provider returned {status}: {text}"));
    }
    serde_json::from_str::<Value>(&text).map_err(|err| format!("Invalid JSON response: {err}"))
}

pub(crate) fn build_endpoint(custom: Option<&str>, default_base: &str, path: &str) -> String {
    let trimmed = custom.map(str::trim).filter(|value| !value.is_empty());
    match trimmed {
        None => format!("{default_base}{path}"),
        Some(base) => {
            if base.ends_with(path) {
                base.to_string()
            } else {
                let base = base.trim_end_matches('/');
                format!("{base}{path}")
            }
        }
    }
}

async fn call_openai(
    api_key: &str,
    model: &str,
    prompt: &str,
    api_endpoint: Option<&str>,
) -> Result<String, String> {
    let endpoint = build_endpoint(api_endpoint, "https://api.openai.com/v1", "/chat/completions");
    let client = reqwest::Client::new();
    let response = client
        .post(endpoint)
        .bearer_auth(api_key)
        .json(&json!({
            "model": model,
            "messages": [
                {
                    "role": "user",
                    "content": prompt
                }
            ]
        }))
        .send()
        .await
        .map_err(|err| err.to_string())?;

    let value = response_json_or_error(response).await?;
    extract_openai_text(&value).ok_or_else(|| "OpenAI response did not include text".to_string())
}

async fn call_anthropic(
    api_key: &str,
    model: &str,
    prompt: &str,
    api_endpoint: Option<&str>,
) -> Result<String, String> {
    let endpoint = build_endpoint(api_endpoint, "https://api.anthropic.com/v1", "/messages");
    let client = reqwest::Client::new();
    let response = client
        .post(endpoint)
        .header("x-api-key", api_key)
        .header("anthropic-version", "2023-06-01")
        .json(&json!({
            "model": model,
            "max_tokens": 4000,
            "messages": [
                {
                    "role": "user",
                    "content": prompt
                }
            ]
        }))
        .send()
        .await
        .map_err(|err| err.to_string())?;

    let value = response_json_or_error(response).await?;
    extract_anthropic_text(&value)
        .ok_or_else(|| "Anthropic response did not include text".to_string())
}

#[tauri::command]
pub async fn run_generation(
    state: State<'_, AppState>,
    request: GenerationRequest,
) -> Result<GenerationResponse, String> {
    let Some(api_key) = request
        .api_key
        .as_deref()
        .map(str::trim)
        .filter(|key| !key.is_empty())
    else {
        return Ok(GenerationResponse {
            mode: "prompt".to_string(),
            prompt: request.prompt,
            content: None,
        });
    };

    let provider = request.provider.to_lowercase();
    let content = match provider.as_str() {
        "openai" => {
            call_openai(api_key, &request.model, &request.prompt, request.api_endpoint.as_deref())
                .await?
        }
        "anthropic" | "claude" => {
            call_anthropic(api_key, &request.model, &request.prompt, request.api_endpoint.as_deref())
                .await?
        }
        other => {
            return Err(format!(
                "Unsupported provider '{other}'. Use openai or anthropic for v1."
            ))
        }
    };

    sqlx::query(
        "INSERT INTO llm_runs(idea_id, task_type, provider, model, input_digest, output)
         VALUES (?, ?, ?, ?, ?, ?)",
    )
    .bind(request.idea_id)
    .bind(&request.task_type)
    .bind(&request.provider)
    .bind(&request.model)
    .bind(digest_prompt(&request.prompt))
    .bind(&content)
    .execute(&state.pool)
    .await
    .map_err(|err| err.to_string())?;

    Ok(GenerationResponse {
        mode: "api".to_string(),
        prompt: request.prompt,
        content: Some(content),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn openai_text_can_be_read_from_output_text() {
        let value = json!({ "output_text": "hello" });
        assert_eq!(extract_openai_text(&value), Some("hello".to_string()));
    }

    #[test]
    fn openai_text_can_be_read_from_chat_completions() {
        let value = json!({
            "choices": [
                { "message": { "role": "assistant", "content": "hi there" } }
            ]
        });
        assert_eq!(extract_openai_text(&value), Some("hi there".to_string()));
    }

    #[test]
    fn anthropic_text_is_joined() {
        let value = json!({
            "content": [
                { "type": "text", "text": "a" },
                { "type": "text", "text": "b" }
            ]
        });
        assert_eq!(extract_anthropic_text(&value), Some("a\nb".to_string()));
    }

    #[test]
    fn digest_is_stable() {
        assert_eq!(digest_prompt("abc"), digest_prompt("abc"));
        assert_ne!(digest_prompt("abc"), digest_prompt("abcd"));
    }

    #[test]
    fn build_endpoint_uses_default_when_empty() {
        assert_eq!(
            build_endpoint(None, "https://api.openai.com/v1", "/chat/completions"),
            "https://api.openai.com/v1/chat/completions"
        );
        assert_eq!(
            build_endpoint(Some(""), "https://api.openai.com/v1", "/chat/completions"),
            "https://api.openai.com/v1/chat/completions"
        );
        assert_eq!(
            build_endpoint(Some("   "), "https://api.openai.com/v1", "/chat/completions"),
            "https://api.openai.com/v1/chat/completions"
        );
    }

    #[test]
    fn build_endpoint_appends_path_to_base() {
        assert_eq!(
            build_endpoint(Some("https://proxy.example.com/v1"), "https://api.openai.com/v1", "/chat/completions"),
            "https://proxy.example.com/v1/chat/completions"
        );
        assert_eq!(
            build_endpoint(Some("https://proxy.example.com/v1/"), "https://api.openai.com/v1", "/chat/completions"),
            "https://proxy.example.com/v1/chat/completions"
        );
    }

    #[test]
    fn build_endpoint_keeps_full_url() {
        assert_eq!(
            build_endpoint(Some("https://proxy.example.com/v1/chat/completions"), "https://api.openai.com/v1", "/chat/completions"),
            "https://proxy.example.com/v1/chat/completions"
        );
    }
}
