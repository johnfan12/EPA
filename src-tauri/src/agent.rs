use reqwest::StatusCode;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sqlx::SqlitePool;
use tauri::State;

use crate::{
    db::AppState,
    llm::build_endpoint,
    models::{AgentRun, Experiment, Idea, IdeaEntry, Report, SearchHit},
};

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentChatMessage {
    pub role: String,
    #[serde(default)]
    pub content: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InternalAgentRequest {
    pub idea_id: i64,
    pub provider: String,
    pub model: String,
    pub api_key: Option<String>,
    #[serde(default)]
    pub api_endpoint: Option<String>,
    pub messages: Vec<AgentChatMessage>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InternalAgentResponse {
    pub content: String,
    pub actions: Vec<String>,
}

const MAX_TOOL_ROUNDS: usize = 8;

/// Tool schemas advertised to the model. The current idea id is injected by the
/// backend, so the model never has to (and cannot) target another idea.
fn tool_definitions() -> Value {
    json!([
        {"type": "function", "function": {
            "name": "list_discussions",
            "description": "列出当前 idea 下最近的讨论与演化记录（返回 id、标题、类型、摘要）。",
            "parameters": {"type": "object", "properties": {}}
        }},
        {"type": "function", "function": {
            "name": "create_discussion",
            "description": "在当前 idea 下新建一条讨论/笔记/总结记录。",
            "parameters": {"type": "object", "properties": {
                "title": {"type": "string"},
                "content": {"type": "string"},
                "kind": {"type": "string", "description": "note | dialogue | summary，默认 note"},
                "summary": {"type": "string"},
                "source": {"type": "string"}
            }, "required": ["title", "content"]}
        }},
        {"type": "function", "function": {
            "name": "delete_discussion",
            "description": "按 id 删除一条讨论记录。",
            "parameters": {"type": "object", "properties": {"id": {"type": "integer"}}, "required": ["id"]}
        }},
        {"type": "function", "function": {
            "name": "list_agent_runs",
            "description": "列出当前 idea 下最近的 Agent 沟通记录（返回 id、状态、prompt/输出摘要）。",
            "parameters": {"type": "object", "properties": {}}
        }},
        {"type": "function", "function": {
            "name": "create_agent_run",
            "description": "在当前 idea 下新建一条 Agent 沟通记录。",
            "parameters": {"type": "object", "properties": {
                "prompt": {"type": "string"},
                "output": {"type": "string"},
                "summary": {"type": "string"},
                "status": {"type": "string", "description": "prompted | completed，默认 recorded"}
            }, "required": ["prompt"]}
        }},
        {"type": "function", "function": {
            "name": "delete_agent_run",
            "description": "按 id 删除一条 Agent 沟通记录。",
            "parameters": {"type": "object", "properties": {"id": {"type": "integer"}}, "required": ["id"]}
        }},
        {"type": "function", "function": {
            "name": "list_experiments",
            "description": "列出当前 idea 下最近的实验记录（返回 id、名称、结论/原始结果摘要）。",
            "parameters": {"type": "object", "properties": {}}
        }},
        {"type": "function", "function": {
            "name": "create_experiment",
            "description": "在当前 idea 下新建一条实验记录。",
            "parameters": {"type": "object", "properties": {
                "name": {"type": "string"},
                "dataset": {"type": "string"},
                "method": {"type": "string"},
                "config": {"type": "string"},
                "raw_output": {"type": "string"},
                "metrics_json": {"type": "string", "description": "合法 JSON 字符串，如 {\"accuracy\": 0.9}"},
                "conclusion": {"type": "string"}
            }, "required": ["name"]}
        }},
        {"type": "function", "function": {
            "name": "delete_experiment",
            "description": "按 id 删除一条实验记录。",
            "parameters": {"type": "object", "properties": {"id": {"type": "integer"}}, "required": ["id"]}
        }},
        {"type": "function", "function": {
            "name": "list_reports",
            "description": "列出当前 idea 下的报告（返回 id、标题、更新时间）。",
            "parameters": {"type": "object", "properties": {}}
        }},
        {"type": "function", "function": {
            "name": "create_report",
            "description": "在当前 idea 下新建一份报告。先用 list_discussions / list_experiments / list_agent_runs 读取材料，再据此写出完整的中文 Markdown 报告内容。",
            "parameters": {"type": "object", "properties": {
                "title": {"type": "string"},
                "content": {"type": "string", "description": "完整的 Markdown 报告正文"}
            }, "required": ["title", "content"]}
        }}
    ])
}

fn snippet(text: &str, max: usize) -> String {
    let trimmed = text.trim();
    if trimmed.chars().count() <= max {
        return trimmed.to_string();
    }
    let mut value = trimmed.chars().take(max).collect::<String>();
    value.push('…');
    value
}

fn arg_str(args: &Value, key: &str) -> String {
    args.get(key)
        .and_then(Value::as_str)
        .unwrap_or("")
        .to_string()
}

fn arg_id(args: &Value) -> Option<i64> {
    let value = args.get("id")?;
    value
        .as_i64()
        .or_else(|| value.as_str().and_then(|s| s.trim().parse::<i64>().ok()))
}

/// Runs one tool call against the database. Returns (json_result, action_log).
async fn dispatch_tool(
    pool: &SqlitePool,
    idea_id: i64,
    name: &str,
    args: &Value,
) -> Result<(Value, String), String> {
    match name {
        "list_discussions" => {
            let rows = sqlx::query_as::<_, IdeaEntry>(
                "SELECT * FROM idea_entries WHERE idea_id = ? ORDER BY created_at DESC, id DESC LIMIT 30",
            )
            .bind(idea_id)
            .fetch_all(pool)
            .await
            .map_err(|err| err.to_string())?;
            let items = rows
                .iter()
                .map(|entry| {
                    json!({
                        "id": entry.id,
                        "kind": entry.kind,
                        "title": entry.title,
                        "summary": snippet(if entry.summary.is_empty() { &entry.content } else { &entry.summary }, 200),
                    })
                })
                .collect::<Vec<_>>();
            Ok((json!({ "items": items }), format!("读取了 {} 条讨论记录", rows.len())))
        }
        "create_discussion" => {
            let title = arg_str(args, "title");
            let content = arg_str(args, "content");
            if title.trim().is_empty() || content.trim().is_empty() {
                return Err("title 和 content 不能为空".to_string());
            }
            let kind = {
                let value = arg_str(args, "kind");
                if value.trim().is_empty() { "note".to_string() } else { value }
            };
            let id = sqlx::query(
                "INSERT INTO idea_entries(idea_id, kind, title, content, summary, source)
                 VALUES (?, ?, ?, ?, ?, ?)",
            )
            .bind(idea_id)
            .bind(kind.trim())
            .bind(title.trim())
            .bind(content.trim())
            .bind(arg_str(args, "summary").trim())
            .bind({
                let source = arg_str(args, "source");
                if source.trim().is_empty() { "agent".to_string() } else { source }
            })
            .execute(pool)
            .await
            .map_err(|err| err.to_string())?
            .last_insert_rowid();
            Ok((json!({ "id": id, "ok": true }), format!("新建讨论「{}」", snippet(&title, 24))))
        }
        "delete_discussion" => {
            let id = arg_id(args).ok_or("缺少有效的 id")?;
            let affected = sqlx::query("DELETE FROM idea_entries WHERE id = ? AND idea_id = ?")
                .bind(id)
                .bind(idea_id)
                .execute(pool)
                .await
                .map_err(|err| err.to_string())?
                .rows_affected();
            Ok((json!({ "deleted": affected }), format!("删除讨论记录 #{id}")))
        }
        "list_agent_runs" => {
            let rows = sqlx::query_as::<_, AgentRun>(
                "SELECT * FROM agent_runs WHERE idea_id = ? ORDER BY created_at DESC, id DESC LIMIT 30",
            )
            .bind(idea_id)
            .fetch_all(pool)
            .await
            .map_err(|err| err.to_string())?;
            let items = rows
                .iter()
                .map(|run| {
                    json!({
                        "id": run.id,
                        "status": run.status,
                        "summary": snippet(if !run.summary.is_empty() { &run.summary } else if !run.output.is_empty() { &run.output } else { &run.prompt }, 200),
                    })
                })
                .collect::<Vec<_>>();
            Ok((json!({ "items": items }), format!("读取了 {} 条 Agent 沟通记录", rows.len())))
        }
        "create_agent_run" => {
            let prompt = arg_str(args, "prompt");
            if prompt.trim().is_empty() {
                return Err("prompt 不能为空".to_string());
            }
            let status = {
                let value = arg_str(args, "status");
                if value.trim().is_empty() { "recorded".to_string() } else { value }
            };
            let id = sqlx::query(
                "INSERT INTO agent_runs(idea_id, target_agent, task_type, prompt, output, summary, status)
                 VALUES (?, '', '', ?, ?, ?, ?)",
            )
            .bind(idea_id)
            .bind(prompt.trim())
            .bind(arg_str(args, "output").trim())
            .bind(arg_str(args, "summary").trim())
            .bind(status.trim())
            .execute(pool)
            .await
            .map_err(|err| err.to_string())?
            .last_insert_rowid();
            Ok((json!({ "id": id, "ok": true }), "新建 Agent 沟通记录".to_string()))
        }
        "delete_agent_run" => {
            let id = arg_id(args).ok_or("缺少有效的 id")?;
            let affected = sqlx::query("DELETE FROM agent_runs WHERE id = ? AND idea_id = ?")
                .bind(id)
                .bind(idea_id)
                .execute(pool)
                .await
                .map_err(|err| err.to_string())?
                .rows_affected();
            Ok((json!({ "deleted": affected }), format!("删除 Agent 沟通记录 #{id}")))
        }
        "list_experiments" => {
            let rows = sqlx::query_as::<_, Experiment>(
                "SELECT * FROM experiments WHERE idea_id = ? ORDER BY created_at DESC, id DESC LIMIT 30",
            )
            .bind(idea_id)
            .fetch_all(pool)
            .await
            .map_err(|err| err.to_string())?;
            let items = rows
                .iter()
                .map(|experiment| {
                    json!({
                        "id": experiment.id,
                        "name": experiment.name,
                        "metrics": experiment.metrics_json,
                        "summary": snippet(if !experiment.conclusion.is_empty() { &experiment.conclusion } else { &experiment.raw_output }, 200),
                    })
                })
                .collect::<Vec<_>>();
            Ok((json!({ "items": items }), format!("读取了 {} 条实验记录", rows.len())))
        }
        "create_experiment" => {
            let name = arg_str(args, "name");
            if name.trim().is_empty() {
                return Err("name 不能为空".to_string());
            }
            let metrics = {
                let raw = arg_str(args, "metrics_json");
                if raw.trim().is_empty() {
                    "{}".to_string()
                } else {
                    serde_json::from_str::<Value>(raw.trim())
                        .map_err(|err| format!("metrics_json 必须是合法 JSON: {err}"))?;
                    raw.trim().to_string()
                }
            };
            let id = sqlx::query(
                "INSERT INTO experiments(idea_id, name, dataset, method, config, raw_output, metrics_json, conclusion)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
            )
            .bind(idea_id)
            .bind(name.trim())
            .bind(arg_str(args, "dataset").trim())
            .bind(arg_str(args, "method").trim())
            .bind(arg_str(args, "config").trim())
            .bind(arg_str(args, "raw_output").trim())
            .bind(metrics)
            .bind(arg_str(args, "conclusion").trim())
            .execute(pool)
            .await
            .map_err(|err| err.to_string())?
            .last_insert_rowid();
            Ok((json!({ "id": id, "ok": true }), format!("新建实验「{}」", snippet(&name, 24))))
        }
        "delete_experiment" => {
            let id = arg_id(args).ok_or("缺少有效的 id")?;
            let affected = sqlx::query("DELETE FROM experiments WHERE id = ? AND idea_id = ?")
                .bind(id)
                .bind(idea_id)
                .execute(pool)
                .await
                .map_err(|err| err.to_string())?
                .rows_affected();
            Ok((json!({ "deleted": affected }), format!("删除实验记录 #{id}")))
        }
        "list_reports" => {
            let rows = sqlx::query_as::<_, Report>(
                "SELECT * FROM reports WHERE idea_id = ? ORDER BY updated_at DESC, id DESC LIMIT 20",
            )
            .bind(idea_id)
            .fetch_all(pool)
            .await
            .map_err(|err| err.to_string())?;
            let items = rows
                .iter()
                .map(|report| json!({ "id": report.id, "title": report.title, "updatedAt": report.updated_at }))
                .collect::<Vec<_>>();
            Ok((json!({ "items": items }), format!("读取了 {} 条报告", rows.len())))
        }
        "create_report" => {
            let title = arg_str(args, "title");
            let content = arg_str(args, "content");
            if title.trim().is_empty() || content.trim().is_empty() {
                return Err("title 和 content 不能为空".to_string());
            }
            let id = sqlx::query("INSERT INTO reports(idea_id, title, content) VALUES (?, ?, ?)")
                .bind(idea_id)
                .bind(title.trim())
                .bind(content.trim())
                .execute(pool)
                .await
                .map_err(|err| err.to_string())?
                .last_insert_rowid();
            Ok((json!({ "id": id, "ok": true }), format!("新建报告「{}」", snippet(&title, 24))))
        }
        other => Err(format!("未知工具: {other}")),
    }
}

async fn chat_completion(
    api_key: &str,
    model: &str,
    api_endpoint: Option<&str>,
    messages: &Value,
    tools: &Value,
) -> Result<Value, String> {
    let endpoint = build_endpoint(api_endpoint, "https://api.openai.com/v1", "/chat/completions");
    let client = reqwest::Client::new();
    let response = client
        .post(endpoint)
        .bearer_auth(api_key)
        .json(&json!({
            "model": model,
            "messages": messages,
            "tools": tools,
            "tool_choice": "auto"
        }))
        .send()
        .await
        .map_err(|err| err.to_string())?;

    let status: StatusCode = response.status();
    let text = response.text().await.map_err(|err| err.to_string())?;
    if !status.is_success() {
        return Err(format!("LLM provider returned {status}: {text}"));
    }
    serde_json::from_str::<Value>(&text).map_err(|err| format!("Invalid JSON response: {err}"))
}

/// Validates the api key + provider, returning the trimmed key or an early
/// (non-error) response to hand straight back to the UI.
fn validate_provider<'a>(
    api_key: Option<&'a str>,
    provider: &str,
) -> Result<&'a str, InternalAgentResponse> {
    let Some(key) = api_key.map(str::trim).filter(|key| !key.is_empty()) else {
        return Err(InternalAgentResponse {
            content: "请先在设置里配置 API key，Agent 才能工作。".to_string(),
            actions: Vec::new(),
        });
    };
    if provider.to_lowercase() != "openai" {
        return Err(InternalAgentResponse {
            content:
                "Agent 目前需要 OpenAI 兼容接口（chat/completions + function calling）。请在设置里将 provider 切换为 OpenAI，或填入兼容的自定义 Endpoint。"
                    .to_string(),
            actions: Vec::new(),
        });
    }
    Ok(key)
}

/// Runs the tool-calling loop until the model produces a final answer (or the
/// round budget is exhausted). `messages` must already include the system turn.
async fn run_agent_loop(
    pool: &SqlitePool,
    idea_id: i64,
    api_key: &str,
    model: &str,
    api_endpoint: Option<&str>,
    mut messages: Vec<Value>,
) -> Result<InternalAgentResponse, String> {
    let tools = tool_definitions();
    let mut actions: Vec<String> = Vec::new();

    for _ in 0..MAX_TOOL_ROUNDS {
        let value =
            chat_completion(api_key, model, api_endpoint, &json!(messages), &tools).await?;
        let message = value
            .get("choices")
            .and_then(Value::as_array)
            .and_then(|choices| choices.first())
            .and_then(|choice| choice.get("message"))
            .cloned()
            .ok_or_else(|| "LLM 响应缺少 message".to_string())?;

        let tool_calls = message
            .get("tool_calls")
            .and_then(Value::as_array)
            .cloned()
            .unwrap_or_default();

        if tool_calls.is_empty() {
            let content = message
                .get("content")
                .and_then(Value::as_str)
                .unwrap_or("")
                .to_string();
            return Ok(InternalAgentResponse { content, actions });
        }

        // The assistant turn that issued the tool calls must be replayed verbatim.
        messages.push(message.clone());

        for call in &tool_calls {
            let call_id = call.get("id").and_then(Value::as_str).unwrap_or("").to_string();
            let function = call.get("function");
            let name = function
                .and_then(|f| f.get("name"))
                .and_then(Value::as_str)
                .unwrap_or("")
                .to_string();
            let args = function
                .and_then(|f| f.get("arguments"))
                .map(|value| match value {
                    Value::String(raw) => serde_json::from_str::<Value>(raw).unwrap_or(json!({})),
                    other => other.clone(),
                })
                .unwrap_or(json!({}));

            let (result, log) = match dispatch_tool(pool, idea_id, &name, &args).await {
                Ok(pair) => pair,
                Err(err) => (json!({ "error": err }), format!("工具 {name} 失败：{err}")),
            };
            actions.push(log);
            messages.push(json!({
                "role": "tool",
                "tool_call_id": call_id,
                "content": result.to_string()
            }));
        }
    }

    Ok(InternalAgentResponse {
        content: "已达到本轮工具调用上限，请把任务拆得更小一些再试。".to_string(),
        actions,
    })
}

#[tauri::command]
pub async fn run_internal_agent(
    state: State<'_, AppState>,
    request: InternalAgentRequest,
) -> Result<InternalAgentResponse, String> {
    let api_key = match validate_provider(request.api_key.as_deref(), &request.provider) {
        Ok(key) => key,
        Err(early) => return Ok(early),
    };

    let idea = sqlx::query_as::<_, Idea>("SELECT * FROM ideas WHERE id = ?")
        .bind(request.idea_id)
        .fetch_one(&state.pool)
        .await
        .map_err(|err| err.to_string())?;

    let system = format!(
        "你是科研工作台的内部 Agent，当前正在处理 idea「{}」(id={})。\
         你可以使用提供的工具读取 / 新建 / 删除该 idea 下的讨论记录、Agent 沟通记录、实验记录，读取报告，并新建报告。\
         如果用户要你写 / 生成报告，请先用 list_discussions、list_experiments、list_agent_runs 读取材料，\
         再调用 create_report 写入一份完整的中文 Markdown 报告（标题简洁、正文覆盖研究问题、进展、方法、结果、分析、下一步）。\
         请根据用户请求规划并调用工具完成任务：删除或修改前如不确定，先用 list_* 工具读取确认。\
         所有工具都只作用于当前这个 idea。完成后用中文简要说明你做了什么。",
        idea.title, idea.id
    );

    let mut messages: Vec<Value> = vec![json!({ "role": "system", "content": system })];
    for message in &request.messages {
        let role = match message.role.as_str() {
            "assistant" => "assistant",
            _ => "user",
        };
        messages.push(json!({ "role": role, "content": message.content }));
    }

    run_agent_loop(
        &state.pool,
        request.idea_id,
        api_key,
        &request.model,
        request.api_endpoint.as_deref(),
        messages,
    )
    .await
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReportAgentRequest {
    pub idea_id: i64,
    pub provider: String,
    pub model: String,
    pub api_key: Option<String>,
    #[serde(default)]
    pub api_endpoint: Option<String>,
}

#[tauri::command]
pub async fn run_report_agent(
    state: State<'_, AppState>,
    request: ReportAgentRequest,
) -> Result<InternalAgentResponse, String> {
    let api_key = match validate_provider(request.api_key.as_deref(), &request.provider) {
        Ok(key) => key,
        Err(early) => return Ok(early),
    };

    let idea = sqlx::query_as::<_, Idea>("SELECT * FROM ideas WHERE id = ?")
        .bind(request.idea_id)
        .fetch_one(&state.pool)
        .await
        .map_err(|err| err.to_string())?;

    // Most recent report = the "progress" the new report should build on.
    let latest = sqlx::query_as::<_, Report>(
        "SELECT * FROM reports WHERE idea_id = ? ORDER BY updated_at DESC, id DESC LIMIT 1",
    )
    .bind(request.idea_id)
    .fetch_optional(&state.pool)
    .await
    .map_err(|err| err.to_string())?;

    let progress = match latest {
        Some(report) => format!(
            "# 已有最近报告（作为进度参考）\n标题：{}\n\n{}",
            report.title, report.content
        ),
        None => "（还没有历史报告，这是第一份。）".to_string(),
    };

    let system = format!(
        "你是科研报告撰写 Agent，正在处理 idea「{}」(id={})。\
         你可以使用工具读取本 idea 下的讨论记录、实验记录、Agent 沟通记录。\
         请先调用 list_discussions、list_experiments、list_agent_runs 读取最新内容，\
         再结合下面用户给出的『已有报告进度』，写出一份更新后的完整中文 Markdown 研究报告。\
         报告需覆盖：研究问题、当前进展、方法、实验与结果、分析、风险与未解决问题、下一步计划、给导师的问题。\
         语气客观、可汇报、不要夸大；直接且只输出报告 Markdown 本身，不要任何额外说明或寒暄。",
        idea.title, idea.id
    );

    let user = format!("{progress}\n\n请基于以上进度与读取到的最新内容，生成新的完整报告。");

    let messages = vec![
        json!({ "role": "system", "content": system }),
        json!({ "role": "user", "content": user }),
    ];

    run_agent_loop(
        &state.pool,
        request.idea_id,
        api_key,
        &request.model,
        request.api_endpoint.as_deref(),
        messages,
    )
    .await
}

// ----------------------------------------------------------------------------
// Home (global) agent: reads across all ideas, can answer / find content,
// propose new ideas (rendered as an editable preview in the UI) and emit
// jump-to-idea buttons. Reuses validate_provider / chat_completion above.
// ----------------------------------------------------------------------------

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HomeAgentRequest {
    pub provider: String,
    pub model: String,
    pub api_key: Option<String>,
    #[serde(default)]
    pub api_endpoint: Option<String>,
    pub messages: Vec<AgentChatMessage>,
}

/// A draft idea the agent suggests creating. Surfaced to the UI as an editable
/// preview card; nothing is written to the DB until the user accepts.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct IdeaProposal {
    pub title: String,
    pub research_area: String,
    pub tags: String,
    pub brief: String,
}

/// A jump button pointing at an existing idea.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct IdeaLink {
    pub idea_id: i64,
    pub title: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HomeAgentResponse {
    pub content: String,
    pub actions: Vec<String>,
    pub proposals: Vec<IdeaProposal>,
    pub links: Vec<IdeaLink>,
}

/// Tool schemas for the global home agent (cross-idea, plus propose/link).
fn home_tool_definitions() -> Value {
    json!([
        {"type": "function", "function": {
            "name": "list_ideas",
            "description": "列出工作台里所有 idea（返回 id、标题、研究方向、标签、brief 摘要、更新时间）。",
            "parameters": {"type": "object", "properties": {}}
        }},
        {"type": "function", "function": {
            "name": "read_idea",
            "description": "读取某个 idea 的详情，以及它下面的讨论、实验、报告摘要。用于回答问题或定位内容。",
            "parameters": {"type": "object", "properties": {"idea_id": {"type": "integer"}}, "required": ["idea_id"]}
        }},
        {"type": "function", "function": {
            "name": "search_workspace",
            "description": "跨所有 idea 全文检索讨论 / 实验 / 报告等内容，返回命中片段及其所属 ideaId。",
            "parameters": {"type": "object", "properties": {"query": {"type": "string"}}, "required": ["query"]}
        }},
        {"type": "function", "function": {
            "name": "propose_idea",
            "description": "当用户描述了一个想新建的研究 idea 时调用：给出结构化草稿。不会直接创建，会作为可编辑预览展示给用户确认。brief 填入用户描述的 idea 详情。",
            "parameters": {"type": "object", "properties": {
                "title": {"type": "string"},
                "research_area": {"type": "string"},
                "tags": {"type": "string", "description": "逗号分隔的标签"},
                "brief": {"type": "string", "description": "idea 详情 / 简介，可用 Markdown"}
            }, "required": ["title", "brief"]}
        }},
        {"type": "function", "function": {
            "name": "link_idea",
            "description": "生成一个跳转到指定已存在 idea 的按钮（用于引用、给出答案出处、或建议用户打开）。",
            "parameters": {"type": "object", "properties": {
                "idea_id": {"type": "integer"},
                "label": {"type": "string", "description": "按钮文案，可选，默认用 idea 标题"}
            }, "required": ["idea_id"]}
        }}
    ])
}

/// Builds an FTS5 MATCH expression from free text (mirrors db::fts_query).
fn home_fts_query(input: &str) -> Option<String> {
    let terms = input
        .split_whitespace()
        .map(|term| {
            term.chars()
                .filter(|ch| ch.is_alphanumeric() || *ch == '_' || *ch as u32 > 0x7f)
                .collect::<String>()
        })
        .filter(|term| !term.is_empty())
        .map(|term| format!("{term}*"))
        .collect::<Vec<_>>();
    if terms.is_empty() {
        None
    } else {
        Some(terms.join(" "))
    }
}

fn arg_i64(args: &Value, key: &str) -> Option<i64> {
    let value = args.get(key)?;
    value
        .as_i64()
        .or_else(|| value.as_str().and_then(|s| s.trim().parse::<i64>().ok()))
}

/// Dispatches one home-agent tool call. `propose_idea` / `link_idea` accumulate
/// into the provided collectors instead of touching the database.
async fn home_dispatch_tool(
    pool: &SqlitePool,
    name: &str,
    args: &Value,
    proposals: &mut Vec<IdeaProposal>,
    links: &mut Vec<IdeaLink>,
) -> Result<(Value, String), String> {
    match name {
        "list_ideas" => {
            let rows = sqlx::query_as::<_, Idea>(
                "SELECT * FROM ideas ORDER BY updated_at DESC LIMIT 100",
            )
            .fetch_all(pool)
            .await
            .map_err(|err| err.to_string())?;
            let items = rows
                .iter()
                .map(|idea| {
                    json!({
                        "id": idea.id,
                        "title": idea.title,
                        "researchArea": idea.research_area,
                        "tags": idea.tags,
                        "brief": snippet(&idea.brief, 200),
                        "updatedAt": idea.updated_at,
                    })
                })
                .collect::<Vec<_>>();
            Ok((json!({ "items": items }), format!("读取了 {} 个 idea", rows.len())))
        }
        "read_idea" => {
            let idea_id = arg_i64(args, "idea_id").ok_or("缺少有效的 idea_id")?;
            let Some(idea) = sqlx::query_as::<_, Idea>("SELECT * FROM ideas WHERE id = ?")
                .bind(idea_id)
                .fetch_optional(pool)
                .await
                .map_err(|err| err.to_string())?
            else {
                return Ok((json!({ "error": "idea 不存在" }), format!("idea #{idea_id} 不存在")));
            };

            let discussions = sqlx::query_as::<_, IdeaEntry>(
                "SELECT * FROM idea_entries WHERE idea_id = ? ORDER BY created_at DESC, id DESC LIMIT 20",
            )
            .bind(idea_id)
            .fetch_all(pool)
            .await
            .map_err(|err| err.to_string())?;
            let experiments = sqlx::query_as::<_, Experiment>(
                "SELECT * FROM experiments WHERE idea_id = ? ORDER BY created_at DESC, id DESC LIMIT 20",
            )
            .bind(idea_id)
            .fetch_all(pool)
            .await
            .map_err(|err| err.to_string())?;
            let reports = sqlx::query_as::<_, Report>(
                "SELECT * FROM reports WHERE idea_id = ? ORDER BY updated_at DESC, id DESC LIMIT 10",
            )
            .bind(idea_id)
            .fetch_all(pool)
            .await
            .map_err(|err| err.to_string())?;

            let result = json!({
                "id": idea.id,
                "title": idea.title,
                "researchArea": idea.research_area,
                "status": idea.status,
                "tags": idea.tags,
                "brief": idea.brief,
                "discussions": discussions.iter().map(|entry| json!({
                    "id": entry.id,
                    "kind": entry.kind,
                    "title": entry.title,
                    "summary": snippet(if entry.summary.is_empty() { &entry.content } else { &entry.summary }, 200),
                })).collect::<Vec<_>>(),
                "experiments": experiments.iter().map(|exp| json!({
                    "id": exp.id,
                    "name": exp.name,
                    "metrics": exp.metrics_json,
                    "summary": snippet(if !exp.conclusion.is_empty() { &exp.conclusion } else { &exp.raw_output }, 200),
                })).collect::<Vec<_>>(),
                "reports": reports.iter().map(|report| json!({
                    "id": report.id,
                    "title": report.title,
                    "updatedAt": report.updated_at,
                })).collect::<Vec<_>>(),
            });
            Ok((result, format!("读取了 idea「{}」", snippet(&idea.title, 24))))
        }
        "search_workspace" => {
            let query = arg_str(args, "query");
            let Some(match_query) = home_fts_query(&query) else {
                return Ok((json!({ "items": [] }), "搜索词为空".to_string()));
            };
            let hits = sqlx::query_as::<_, SearchHit>(
                "SELECT
                   entity_type,
                   entity_id,
                   idea_id,
                   title,
                   snippet(search_index, 4, '', '', '...', 18) AS snippet
                 FROM search_index
                 WHERE search_index MATCH ?
                 ORDER BY rank
                 LIMIT 30",
            )
            .bind(match_query)
            .fetch_all(pool)
            .await
            .map_err(|err| err.to_string())?;
            let items = hits
                .iter()
                .map(|hit| {
                    json!({
                        "entityType": hit.entity_type,
                        "entityId": hit.entity_id,
                        "ideaId": hit.idea_id,
                        "title": hit.title,
                        "snippet": hit.snippet,
                    })
                })
                .collect::<Vec<_>>();
            Ok((json!({ "items": items }), format!("搜索「{}」命中 {} 条", snippet(&query, 16), hits.len())))
        }
        "propose_idea" => {
            let title = arg_str(args, "title");
            if title.trim().is_empty() {
                return Err("title 不能为空".to_string());
            }
            let log = format!("生成 idea 预览「{}」", snippet(&title, 24));
            proposals.push(IdeaProposal {
                title: title.trim().to_string(),
                research_area: arg_str(args, "research_area").trim().to_string(),
                tags: arg_str(args, "tags").trim().to_string(),
                brief: arg_str(args, "brief").trim().to_string(),
            });
            Ok((
                json!({ "ok": true, "note": "已在聊天中向用户展示可编辑预览，等待用户确认，请勿直接创建。" }),
                log,
            ))
        }
        "link_idea" => {
            let idea_id = arg_i64(args, "idea_id").ok_or("缺少有效的 idea_id")?;
            let Some(idea) = sqlx::query_as::<_, Idea>("SELECT * FROM ideas WHERE id = ?")
                .bind(idea_id)
                .fetch_optional(pool)
                .await
                .map_err(|err| err.to_string())?
            else {
                return Ok((json!({ "error": "idea 不存在" }), format!("idea #{idea_id} 不存在")));
            };
            let label = {
                let value = arg_str(args, "label");
                if value.trim().is_empty() { idea.title.clone() } else { value.trim().to_string() }
            };
            links.push(IdeaLink { idea_id: idea.id, title: label });
            Ok((json!({ "ok": true }), format!("生成跳转按钮 →「{}」", snippet(&idea.title, 24))))
        }
        other => Err(format!("未知工具: {other}")),
    }
}

/// Tool-calling loop for the home agent; collects proposals/links alongside the
/// final answer.
async fn run_home_loop(
    pool: &SqlitePool,
    api_key: &str,
    model: &str,
    api_endpoint: Option<&str>,
    mut messages: Vec<Value>,
) -> Result<HomeAgentResponse, String> {
    let tools = home_tool_definitions();
    let mut actions: Vec<String> = Vec::new();
    let mut proposals: Vec<IdeaProposal> = Vec::new();
    let mut links: Vec<IdeaLink> = Vec::new();

    for _ in 0..MAX_TOOL_ROUNDS {
        let value =
            chat_completion(api_key, model, api_endpoint, &json!(messages), &tools).await?;
        let message = value
            .get("choices")
            .and_then(Value::as_array)
            .and_then(|choices| choices.first())
            .and_then(|choice| choice.get("message"))
            .cloned()
            .ok_or_else(|| "LLM 响应缺少 message".to_string())?;

        let tool_calls = message
            .get("tool_calls")
            .and_then(Value::as_array)
            .cloned()
            .unwrap_or_default();

        if tool_calls.is_empty() {
            let content = message
                .get("content")
                .and_then(Value::as_str)
                .unwrap_or("")
                .to_string();
            return Ok(HomeAgentResponse { content, actions, proposals, links });
        }

        messages.push(message.clone());

        for call in &tool_calls {
            let call_id = call.get("id").and_then(Value::as_str).unwrap_or("").to_string();
            let function = call.get("function");
            let name = function
                .and_then(|f| f.get("name"))
                .and_then(Value::as_str)
                .unwrap_or("")
                .to_string();
            let args = function
                .and_then(|f| f.get("arguments"))
                .map(|value| match value {
                    Value::String(raw) => serde_json::from_str::<Value>(raw).unwrap_or(json!({})),
                    other => other.clone(),
                })
                .unwrap_or(json!({}));

            let (result, log) =
                match home_dispatch_tool(pool, &name, &args, &mut proposals, &mut links).await {
                    Ok(pair) => pair,
                    Err(err) => (json!({ "error": err }), format!("工具 {name} 失败：{err}")),
                };
            actions.push(log);
            messages.push(json!({
                "role": "tool",
                "tool_call_id": call_id,
                "content": result.to_string()
            }));
        }
    }

    Ok(HomeAgentResponse {
        content: "已达到本轮工具调用上限，请把任务拆得更小一些再试。".to_string(),
        actions,
        proposals,
        links,
    })
}

#[tauri::command]
pub async fn run_home_agent(
    state: State<'_, AppState>,
    request: HomeAgentRequest,
) -> Result<HomeAgentResponse, String> {
    let api_key = match validate_provider(request.api_key.as_deref(), &request.provider) {
        Ok(key) => key,
        Err(early) => {
            return Ok(HomeAgentResponse {
                content: early.content,
                actions: early.actions,
                proposals: Vec::new(),
                links: Vec::new(),
            })
        }
    };

    let system = "你是科研工作台主页的全局助手。\
         你可以使用工具读取用户的所有 idea 来回答问题、查找内容：list_ideas 列出全部 idea，\
         read_idea 读取某个 idea 的详情与其讨论 / 实验 / 报告，search_workspace 跨 idea 全文检索。\
         当用户描述了一个想要新建的研究 idea 时，不要直接创建，而是调用 propose_idea 给出结构化草稿\
         （title、research_area、tags，brief 填入用户描述的 idea 详情）；草稿会作为可编辑预览展示给用户，\
         由用户确认后才真正创建。\
         当你需要指向某个已存在的 idea（引用、给出答案出处、建议用户打开）时，调用 link_idea 生成跳转按钮。\
         回答用中文，简洁清楚。"
        .to_string();

    let mut messages: Vec<Value> = vec![json!({ "role": "system", "content": system })];
    for message in &request.messages {
        let role = match message.role.as_str() {
            "assistant" => "assistant",
            _ => "user",
        };
        messages.push(json!({ "role": role, "content": message.content }));
    }

    run_home_loop(
        &state.pool,
        api_key,
        &request.model,
        request.api_endpoint.as_deref(),
        messages,
    )
    .await
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReportEditAgentRequest {
    pub idea_id: i64,
    pub provider: String,
    pub model: String,
    pub api_key: Option<String>,
    #[serde(default)]
    pub api_endpoint: Option<String>,
    pub content: String,
    pub instruction: String,
}

#[tauri::command]
pub async fn run_report_edit_agent(
    state: State<'_, AppState>,
    request: ReportEditAgentRequest,
) -> Result<InternalAgentResponse, String> {
    let api_key = match validate_provider(request.api_key.as_deref(), &request.provider) {
        Ok(key) => key,
        Err(early) => return Ok(early),
    };

    let idea = sqlx::query_as::<_, Idea>("SELECT * FROM ideas WHERE id = ?")
        .bind(request.idea_id)
        .fetch_one(&state.pool)
        .await
        .map_err(|err| err.to_string())?;

    let system = format!(
        "你是报告修改 Agent，正在处理 idea「{}」(id={})。\
         你可以使用工具读取本 idea 下的讨论记录、实验记录、Agent 沟通记录作为参考。\
         请根据用户指令修改下面给出的当前报告：保持未被要求改动的部分尽量不变，按指令调整需要改的地方。\
         直接且只输出修改后的完整中文 Markdown 报告本身，不要任何额外说明、寒暄或代码块包裹。",
        idea.title, idea.id
    );

    let user = format!(
        "当前报告全文：\n```markdown\n{}\n```\n\n修改指令：{}",
        request.content, request.instruction
    );

    let messages = vec![
        json!({ "role": "system", "content": system }),
        json!({ "role": "user", "content": user }),
    ];

    run_agent_loop(
        &state.pool,
        request.idea_id,
        api_key,
        &request.model,
        request.api_endpoint.as_deref(),
        messages,
    )
    .await
}
