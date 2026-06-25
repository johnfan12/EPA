mod agent;
mod db;
mod llm;
mod models;
mod prompt;
mod secrets;

use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            let data_dir = app
                .path()
                .app_local_data_dir()
                .expect("failed to resolve app data directory");
            std::fs::create_dir_all(&data_dir)?;
            let salt_path = data_dir.join("stronghold-salt.txt");
            app.handle()
                .plugin(tauri_plugin_stronghold::Builder::with_argon2(&salt_path).build())?;

            let pool = tauri::async_runtime::block_on(db::init_pool(app.handle()))
                .expect("failed to initialize local SQLite database");
            app.manage(db::AppState { pool });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            db::list_ideas,
            db::get_idea,
            db::create_idea,
            db::update_idea,
            db::delete_idea,
            db::list_entries,
            db::create_entry,
            db::list_agent_runs,
            db::create_agent_run,
            db::list_experiments,
            db::create_experiment,
            db::list_reports,
            db::generate_report,
            db::update_report,
            db::delete_report,
            db::export_report_markdown,
            db::search_workspace,
            db::list_conversations,
            db::get_conversation,
            db::save_conversation,
            db::delete_conversation,
            db::get_provider_settings,
            db::save_provider_settings,
            prompt::compose_summary_prompt,
            prompt::compose_agent_prompt,
            prompt::compose_experiment_prompt,
            prompt::compose_report_prompt,
            llm::run_generation,
            agent::run_internal_agent,
            agent::run_internal_agent_stream,
            agent::run_home_agent,
            agent::run_home_agent_stream,
            agent::run_report_agent,
            agent::run_report_edit_agent,
            secrets::save_api_key,
            secrets::load_api_key,
            secrets::delete_api_key
        ])
        .run(tauri::generate_context!())
        .expect("error while running Research Idea Agent");
}
