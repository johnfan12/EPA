use std::{fs, path::PathBuf};

use anyhow::Context;
use sqlx::{
    sqlite::{SqliteConnectOptions, SqliteJournalMode, SqlitePoolOptions},
    SqlitePool,
};
use tauri::{AppHandle, Manager, State};

use crate::models::{
    AgentRun, CreateAgentRunPayload, CreateEntryPayload, CreateExperimentPayload,
    CreateIdeaPayload, Experiment, Idea, IdeaEntry, ProviderSettings, Report,
    SaveProviderSettingsPayload, SearchHit, UpdateIdeaPayload, UpdateReportPayload,
};
use crate::prompt;

#[derive(Clone)]
pub struct AppState {
    pub pool: SqlitePool,
}

pub async fn init_pool(app: &AppHandle) -> anyhow::Result<SqlitePool> {
    let data_dir = app
        .path()
        .app_local_data_dir()
        .context("failed to resolve app data directory")?;
    fs::create_dir_all(&data_dir).context("failed to create app data directory")?;

    let db_path = data_dir.join("research-idea-agent.sqlite3");
    let options = SqliteConnectOptions::new()
        .filename(db_path)
        .create_if_missing(true)
        .foreign_keys(true)
        .journal_mode(SqliteJournalMode::Wal);

    let pool = SqlitePoolOptions::new()
        .max_connections(5)
        .connect_with(options)
        .await
        .context("failed to open SQLite database")?;

    sqlx::migrate!("./migrations")
        .run(&pool)
        .await
        .context("failed to run migrations")?;

    seed_settings(&pool).await?;
    Ok(pool)
}

async fn seed_settings(pool: &SqlitePool) -> anyhow::Result<()> {
    sqlx::query(
        "INSERT OR IGNORE INTO app_settings(key, value) VALUES
         ('provider', 'openai'),
         ('model', 'gpt-4.1')",
    )
    .execute(pool)
    .await?;
    Ok(())
}

fn clean_optional(value: Option<String>) -> String {
    value.unwrap_or_default().trim().to_string()
}

fn fts_query(input: &str) -> Option<String> {
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

fn export_filename(title: &str) -> String {
    let safe = title
        .chars()
        .map(|ch| {
            if ch.is_alphanumeric() || ch == '-' || ch == '_' {
                ch
            } else {
                '_'
            }
        })
        .collect::<String>();
    let trimmed = safe.trim_matches('_');
    if trimmed.is_empty() {
        "research_report.md".to_string()
    } else {
        format!("{trimmed}.md")
    }
}

#[tauri::command]
pub async fn list_ideas(
    state: State<'_, AppState>,
    query: Option<String>,
) -> Result<Vec<Idea>, String> {
    let query = query.unwrap_or_default();
    if let Some(match_query) = fts_query(&query) {
        sqlx::query_as::<_, Idea>(
            "SELECT DISTINCT ideas.*
             FROM ideas
             JOIN search_index ON search_index.idea_id = ideas.id
             WHERE search_index MATCH ?
             ORDER BY ideas.updated_at DESC",
        )
        .bind(match_query)
        .fetch_all(&state.pool)
        .await
        .map_err(|err| err.to_string())
    } else {
        sqlx::query_as::<_, Idea>("SELECT * FROM ideas ORDER BY updated_at DESC")
            .fetch_all(&state.pool)
            .await
            .map_err(|err| err.to_string())
    }
}

#[tauri::command]
pub async fn get_idea(state: State<'_, AppState>, id: i64) -> Result<Idea, String> {
    sqlx::query_as::<_, Idea>("SELECT * FROM ideas WHERE id = ?")
        .bind(id)
        .fetch_one(&state.pool)
        .await
        .map_err(|err| err.to_string())
}

#[tauri::command]
pub async fn create_idea(
    state: State<'_, AppState>,
    payload: CreateIdeaPayload,
) -> Result<Idea, String> {
    let title = payload.title.trim();
    if title.is_empty() {
        return Err("Idea title is required".to_string());
    }

    let id = sqlx::query(
        "INSERT INTO ideas(title, research_area, tags)
         VALUES (?, ?, ?)",
    )
    .bind(title)
    .bind(clean_optional(payload.research_area))
    .bind(clean_optional(payload.tags))
    .execute(&state.pool)
    .await
    .map_err(|err| err.to_string())?
    .last_insert_rowid();

    get_idea(state, id).await
}

#[tauri::command]
pub async fn update_idea(
    state: State<'_, AppState>,
    payload: UpdateIdeaPayload,
) -> Result<Idea, String> {
    sqlx::query(
        "UPDATE ideas
         SET title = ?, research_area = ?, status = ?, tags = ?, brief = ?
         WHERE id = ?",
    )
    .bind(payload.title.trim())
    .bind(payload.research_area.trim())
    .bind(payload.status.trim())
    .bind(payload.tags.trim())
    .bind(payload.brief.trim())
    .bind(payload.id)
    .execute(&state.pool)
    .await
    .map_err(|err| err.to_string())?;

    get_idea(state, payload.id).await
}

#[tauri::command]
pub async fn delete_idea(state: State<'_, AppState>, id: i64) -> Result<(), String> {
    sqlx::query("DELETE FROM ideas WHERE id = ?")
        .bind(id)
        .execute(&state.pool)
        .await
        .map_err(|err| err.to_string())?;
    Ok(())
}

#[tauri::command]
pub async fn list_entries(
    state: State<'_, AppState>,
    idea_id: i64,
) -> Result<Vec<IdeaEntry>, String> {
    sqlx::query_as::<_, IdeaEntry>(
        "SELECT * FROM idea_entries WHERE idea_id = ? ORDER BY created_at DESC, id DESC",
    )
    .bind(idea_id)
    .fetch_all(&state.pool)
    .await
    .map_err(|err| err.to_string())
}

#[tauri::command]
pub async fn create_entry(
    state: State<'_, AppState>,
    payload: CreateEntryPayload,
) -> Result<IdeaEntry, String> {
    if payload.title.trim().is_empty() || payload.content.trim().is_empty() {
        return Err("Entry title and content are required".to_string());
    }

    let id = sqlx::query(
        "INSERT INTO idea_entries(idea_id, kind, title, content, summary, source)
         VALUES (?, ?, ?, ?, ?, ?)",
    )
    .bind(payload.idea_id)
    .bind(payload.kind.trim())
    .bind(payload.title.trim())
    .bind(payload.content.trim())
    .bind(clean_optional(payload.summary))
    .bind(clean_optional(payload.source))
    .execute(&state.pool)
    .await
    .map_err(|err| err.to_string())?
    .last_insert_rowid();

    sqlx::query_as::<_, IdeaEntry>("SELECT * FROM idea_entries WHERE id = ?")
        .bind(id)
        .fetch_one(&state.pool)
        .await
        .map_err(|err| err.to_string())
}

#[tauri::command]
pub async fn list_agent_runs(
    state: State<'_, AppState>,
    idea_id: i64,
) -> Result<Vec<AgentRun>, String> {
    sqlx::query_as::<_, AgentRun>(
        "SELECT * FROM agent_runs WHERE idea_id = ? ORDER BY created_at DESC, id DESC",
    )
    .bind(idea_id)
    .fetch_all(&state.pool)
    .await
    .map_err(|err| err.to_string())
}

#[tauri::command]
pub async fn create_agent_run(
    state: State<'_, AppState>,
    payload: CreateAgentRunPayload,
) -> Result<AgentRun, String> {
    let output_preview = payload.output.as_deref().unwrap_or("").trim();
    if payload.prompt.trim().is_empty() && output_preview.is_empty() {
        return Err("Agent prompt or output is required".to_string());
    }

    let id = sqlx::query(
        "INSERT INTO agent_runs(idea_id, target_agent, task_type, prompt, output, summary, status)
         VALUES (?, ?, ?, ?, ?, ?, ?)",
    )
    .bind(payload.idea_id)
    .bind(payload.target_agent.trim())
    .bind(payload.task_type.trim())
    .bind(payload.prompt.trim())
    .bind(clean_optional(payload.output))
    .bind(clean_optional(payload.summary))
    .bind(payload.status.unwrap_or_else(|| "recorded".to_string()))
    .execute(&state.pool)
    .await
    .map_err(|err| err.to_string())?
    .last_insert_rowid();

    sqlx::query_as::<_, AgentRun>("SELECT * FROM agent_runs WHERE id = ?")
        .bind(id)
        .fetch_one(&state.pool)
        .await
        .map_err(|err| err.to_string())
}

#[tauri::command]
pub async fn list_experiments(
    state: State<'_, AppState>,
    idea_id: i64,
) -> Result<Vec<Experiment>, String> {
    sqlx::query_as::<_, Experiment>(
        "SELECT * FROM experiments WHERE idea_id = ? ORDER BY created_at DESC, id DESC",
    )
    .bind(idea_id)
    .fetch_all(&state.pool)
    .await
    .map_err(|err| err.to_string())
}

#[tauri::command]
pub async fn create_experiment(
    state: State<'_, AppState>,
    payload: CreateExperimentPayload,
) -> Result<Experiment, String> {
    if payload.name.trim().is_empty() {
        return Err("Experiment name is required".to_string());
    }

    let metrics_json = clean_optional(payload.metrics_json);
    let metrics_json = if metrics_json.is_empty() {
        "{}".to_string()
    } else {
        serde_json::from_str::<serde_json::Value>(&metrics_json)
            .map_err(|err| format!("Metrics must be valid JSON: {err}"))?;
        metrics_json
    };

    let id = sqlx::query(
        "INSERT INTO experiments(idea_id, name, dataset, method, config, raw_output, metrics_json, conclusion)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    )
    .bind(payload.idea_id)
    .bind(payload.name.trim())
    .bind(clean_optional(payload.dataset))
    .bind(clean_optional(payload.method))
    .bind(clean_optional(payload.config))
    .bind(clean_optional(payload.raw_output))
    .bind(metrics_json)
    .bind(clean_optional(payload.conclusion))
    .execute(&state.pool)
    .await
    .map_err(|err| err.to_string())?
    .last_insert_rowid();

    sqlx::query_as::<_, Experiment>("SELECT * FROM experiments WHERE id = ?")
        .bind(id)
        .fetch_one(&state.pool)
        .await
        .map_err(|err| err.to_string())
}

#[tauri::command]
pub async fn list_reports(state: State<'_, AppState>, idea_id: i64) -> Result<Vec<Report>, String> {
    sqlx::query_as::<_, Report>(
        "SELECT * FROM reports WHERE idea_id = ? ORDER BY updated_at DESC, id DESC",
    )
    .bind(idea_id)
    .fetch_all(&state.pool)
    .await
    .map_err(|err| err.to_string())
}

#[tauri::command]
pub async fn generate_report(state: State<'_, AppState>, idea_id: i64) -> Result<Report, String> {
    let bundle = prompt::load_bundle(&state.pool, idea_id)
        .await
        .map_err(|err| err.to_string())?;
    let title = format!("{} - 阶段汇报", bundle.idea.title);
    let content = prompt::render_report_markdown(&bundle);

    let id = sqlx::query("INSERT INTO reports(idea_id, title, content) VALUES (?, ?, ?)")
        .bind(idea_id)
        .bind(&title)
        .bind(&content)
        .execute(&state.pool)
        .await
        .map_err(|err| err.to_string())?
        .last_insert_rowid();

    sqlx::query_as::<_, Report>("SELECT * FROM reports WHERE id = ?")
        .bind(id)
        .fetch_one(&state.pool)
        .await
        .map_err(|err| err.to_string())
}

#[tauri::command]
pub async fn update_report(
    state: State<'_, AppState>,
    payload: UpdateReportPayload,
) -> Result<Report, String> {
    sqlx::query("UPDATE reports SET title = ?, content = ? WHERE id = ?")
        .bind(payload.title.trim())
        .bind(payload.content)
        .bind(payload.id)
        .execute(&state.pool)
        .await
        .map_err(|err| err.to_string())?;

    sqlx::query_as::<_, Report>("SELECT * FROM reports WHERE id = ?")
        .bind(payload.id)
        .fetch_one(&state.pool)
        .await
        .map_err(|err| err.to_string())
}

#[tauri::command]
pub async fn delete_report(state: State<'_, AppState>, report_id: i64) -> Result<(), String> {
    sqlx::query("DELETE FROM reports WHERE id = ?")
        .bind(report_id)
        .execute(&state.pool)
        .await
        .map_err(|err| err.to_string())?;
    Ok(())
}

#[tauri::command]
pub async fn export_report_markdown(
    app: AppHandle,
    state: State<'_, AppState>,
    report_id: i64,
) -> Result<String, String> {
    let report = sqlx::query_as::<_, Report>("SELECT * FROM reports WHERE id = ?")
        .bind(report_id)
        .fetch_one(&state.pool)
        .await
        .map_err(|err| err.to_string())?;

    let export_dir = app
        .path()
        .app_local_data_dir()
        .map_err(|err| err.to_string())?
        .join("exports");
    fs::create_dir_all(&export_dir).map_err(|err| err.to_string())?;

    let path: PathBuf = export_dir.join(export_filename(&report.title));
    fs::write(&path, report.content).map_err(|err| err.to_string())?;
    Ok(path.to_string_lossy().to_string())
}

#[tauri::command]
pub async fn search_workspace(
    state: State<'_, AppState>,
    query: String,
) -> Result<Vec<SearchHit>, String> {
    let Some(match_query) = fts_query(&query) else {
        return Ok(Vec::new());
    };

    sqlx::query_as::<_, SearchHit>(
        "SELECT
           entity_type,
           entity_id,
           idea_id,
           title,
           snippet(search_index, 4, '', '', '...', 18) AS snippet
         FROM search_index
         WHERE search_index MATCH ?
         ORDER BY rank
         LIMIT 50",
    )
    .bind(match_query)
    .fetch_all(&state.pool)
    .await
    .map_err(|err| err.to_string())
}

#[tauri::command]
pub async fn get_provider_settings(state: State<'_, AppState>) -> Result<ProviderSettings, String> {
    let provider =
        sqlx::query_scalar::<_, String>("SELECT value FROM app_settings WHERE key = 'provider'")
            .fetch_optional(&state.pool)
            .await
            .map_err(|err| err.to_string())?
            .unwrap_or_else(|| "openai".to_string());

    let model =
        sqlx::query_scalar::<_, String>("SELECT value FROM app_settings WHERE key = 'model'")
            .fetch_optional(&state.pool)
            .await
            .map_err(|err| err.to_string())?
            .unwrap_or_else(|| "gpt-4.1".to_string());

    let api_endpoint =
        sqlx::query_scalar::<_, String>("SELECT value FROM app_settings WHERE key = 'api_endpoint'")
            .fetch_optional(&state.pool)
            .await
            .map_err(|err| err.to_string())?
            .unwrap_or_default();

    Ok(ProviderSettings {
        provider,
        model,
        api_endpoint,
    })
}

#[tauri::command]
pub async fn save_provider_settings(
    state: State<'_, AppState>,
    payload: SaveProviderSettingsPayload,
) -> Result<ProviderSettings, String> {
    let api_endpoint = clean_optional(payload.api_endpoint);

    sqlx::query(
        "INSERT INTO app_settings(key, value, updated_at)
         VALUES ('provider', ?, CURRENT_TIMESTAMP), ('model', ?, CURRENT_TIMESTAMP), ('api_endpoint', ?, CURRENT_TIMESTAMP)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP",
    )
    .bind(payload.provider.trim())
    .bind(payload.model.trim())
    .bind(api_endpoint.trim())
    .execute(&state.pool)
    .await
    .map_err(|err| err.to_string())?;

    get_provider_settings(state).await
}
