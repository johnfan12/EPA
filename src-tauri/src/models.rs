use serde::{Deserialize, Serialize};
use sqlx::FromRow;

#[derive(Debug, Clone, Serialize, FromRow)]
#[serde(rename_all = "camelCase")]
pub struct Idea {
    pub id: i64,
    pub title: String,
    pub research_area: String,
    pub status: String,
    pub tags: String,
    pub brief: String,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateIdeaPayload {
    pub title: String,
    pub research_area: Option<String>,
    pub tags: Option<String>,
    #[serde(default)]
    pub brief: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateIdeaPayload {
    pub id: i64,
    pub title: String,
    pub research_area: String,
    pub status: String,
    pub tags: String,
    pub brief: String,
}

#[derive(Debug, Clone, Serialize, FromRow)]
#[serde(rename_all = "camelCase")]
pub struct IdeaEntry {
    pub id: i64,
    pub idea_id: i64,
    pub kind: String,
    pub title: String,
    pub content: String,
    pub summary: String,
    pub source: String,
    pub created_at: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateEntryPayload {
    pub idea_id: i64,
    pub kind: String,
    pub title: String,
    pub content: String,
    pub summary: Option<String>,
    pub source: Option<String>,
}

#[derive(Debug, Clone, Serialize, FromRow)]
#[serde(rename_all = "camelCase")]
pub struct AgentRun {
    pub id: i64,
    pub idea_id: i64,
    pub target_agent: String,
    pub task_type: String,
    pub prompt: String,
    pub output: String,
    pub summary: String,
    pub status: String,
    pub created_at: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateAgentRunPayload {
    pub idea_id: i64,
    pub target_agent: String,
    pub task_type: String,
    pub prompt: String,
    pub output: Option<String>,
    pub summary: Option<String>,
    pub status: Option<String>,
}

#[derive(Debug, Clone, Serialize, FromRow)]
#[serde(rename_all = "camelCase")]
pub struct Experiment {
    pub id: i64,
    pub idea_id: i64,
    pub name: String,
    pub dataset: String,
    pub method: String,
    pub config: String,
    pub raw_output: String,
    pub metrics_json: String,
    pub conclusion: String,
    pub created_at: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateExperimentPayload {
    pub idea_id: i64,
    pub name: String,
    pub dataset: Option<String>,
    pub method: Option<String>,
    pub config: Option<String>,
    pub raw_output: Option<String>,
    pub metrics_json: Option<String>,
    pub conclusion: Option<String>,
}

#[derive(Debug, Clone, Serialize, FromRow)]
#[serde(rename_all = "camelCase")]
pub struct Report {
    pub id: i64,
    pub idea_id: i64,
    pub title: String,
    pub content: String,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateReportPayload {
    pub id: i64,
    pub title: String,
    pub content: String,
}

#[derive(Debug, Clone, Serialize, FromRow)]
#[serde(rename_all = "camelCase")]
pub struct Conversation {
    pub id: i64,
    pub title: String,
    /// JSON-encoded array of chat messages (with previews / links / segments).
    pub messages: String,
    /// Owning idea; NULL for the global home-page conversation.
    pub idea_id: Option<i64>,
    pub created_at: String,
    pub updated_at: String,
}

/// Lightweight row for the conversation history list (no message payload).
#[derive(Debug, Clone, Serialize, FromRow)]
#[serde(rename_all = "camelCase")]
pub struct ConversationMeta {
    pub id: i64,
    pub title: String,
    pub updated_at: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveConversationPayload {
    /// None → create a new conversation; Some(id) → update that conversation.
    #[serde(default)]
    pub id: Option<i64>,
    /// Owning idea; None → the global home-page conversation.
    #[serde(default)]
    pub idea_id: Option<i64>,
    pub title: String,
    pub messages: String,
}

#[derive(Debug, Clone, Serialize, FromRow)]
#[serde(rename_all = "camelCase")]
pub struct SearchHit {
    pub entity_type: String,
    pub entity_id: i64,
    pub idea_id: i64,
    pub title: String,
    pub snippet: String,
}

#[derive(Debug, Clone, Serialize, FromRow)]
#[serde(rename_all = "camelCase")]
pub struct ProviderSettings {
    pub provider: String,
    pub model: String,
    #[serde(default)]
    pub api_endpoint: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveProviderSettingsPayload {
    pub provider: String,
    pub model: String,
    #[serde(default)]
    pub api_endpoint: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PromptRequest {
    pub idea_id: i64,
    pub user_goal: Option<String>,
    pub raw_output: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PromptResponse {
    pub prompt: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GenerationRequest {
    pub idea_id: Option<i64>,
    pub task_type: String,
    pub provider: String,
    pub model: String,
    pub prompt: String,
    pub api_key: Option<String>,
    #[serde(default)]
    pub api_endpoint: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GenerationResponse {
    pub mode: String,
    pub prompt: String,
    pub content: Option<String>,
}
