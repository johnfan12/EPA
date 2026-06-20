use anyhow::Context;
use sqlx::SqlitePool;
use tauri::State;

use crate::{
    db::AppState,
    models::{AgentRun, Experiment, Idea, IdeaEntry, PromptRequest, PromptResponse, Report},
};

#[derive(Debug, Clone)]
pub struct IdeaBundle {
    pub idea: Idea,
    pub entries: Vec<IdeaEntry>,
    pub agent_runs: Vec<AgentRun>,
    pub experiments: Vec<Experiment>,
    pub reports: Vec<Report>,
}

pub async fn load_bundle(pool: &SqlitePool, idea_id: i64) -> anyhow::Result<IdeaBundle> {
    let idea = sqlx::query_as::<_, Idea>("SELECT * FROM ideas WHERE id = ?")
        .bind(idea_id)
        .fetch_one(pool)
        .await
        .context("idea not found")?;

    let entries = sqlx::query_as::<_, IdeaEntry>(
        "SELECT * FROM idea_entries WHERE idea_id = ? ORDER BY created_at DESC, id DESC LIMIT 20",
    )
    .bind(idea_id)
    .fetch_all(pool)
    .await?;

    let agent_runs = sqlx::query_as::<_, AgentRun>(
        "SELECT * FROM agent_runs WHERE idea_id = ? ORDER BY created_at DESC, id DESC LIMIT 20",
    )
    .bind(idea_id)
    .fetch_all(pool)
    .await?;

    let experiments = sqlx::query_as::<_, Experiment>(
        "SELECT * FROM experiments WHERE idea_id = ? ORDER BY created_at DESC, id DESC LIMIT 30",
    )
    .bind(idea_id)
    .fetch_all(pool)
    .await?;

    let reports = sqlx::query_as::<_, Report>(
        "SELECT * FROM reports WHERE idea_id = ? ORDER BY updated_at DESC, id DESC LIMIT 5",
    )
    .bind(idea_id)
    .fetch_all(pool)
    .await?;

    Ok(IdeaBundle {
        idea,
        entries,
        agent_runs,
        experiments,
        reports,
    })
}

fn truncate_for_prompt(input: &str, max_chars: usize) -> String {
    if input.chars().count() <= max_chars {
        return input.to_string();
    }

    let mut value = input.chars().take(max_chars).collect::<String>();
    value.push_str("\n...[truncated]");
    value
}

fn bullets<T, F>(items: &[T], mut render: F, empty: &str) -> String
where
    F: FnMut(&T) -> String,
{
    if items.is_empty() {
        return format!("- {empty}");
    }

    items
        .iter()
        .map(|item| format!("- {}", render(item)))
        .collect::<Vec<_>>()
        .join("\n")
}

fn bundle_context(bundle: &IdeaBundle) -> String {
    let entries = bullets(
        &bundle.entries,
        |entry| {
            format!(
                "[{}] {}: {}\n  摘要: {}",
                entry.kind,
                entry.title,
                truncate_for_prompt(&entry.content, 700),
                if entry.summary.is_empty() {
                    "未填写"
                } else {
                    &entry.summary
                }
            )
        },
        "暂无讨论记录",
    );

    let agent_runs = bullets(
        &bundle.agent_runs,
        |run| {
            format!(
                "{} / {} / {}: {}",
                run.target_agent,
                run.task_type,
                run.status,
                truncate_for_prompt(&run.summary, 500)
            )
        },
        "暂无 Agent 沟通记录",
    );

    let experiments = bullets(
        &bundle.experiments,
        |experiment| {
            format!(
                "{} | 数据集: {} | 方法: {} | 指标: {} | 结论: {}",
                experiment.name,
                empty_dash(&experiment.dataset),
                empty_dash(&experiment.method),
                empty_dash(&experiment.metrics_json),
                empty_dash(&experiment.conclusion)
            )
        },
        "暂无实验数据",
    );

    let reports = bullets(
        &bundle.reports,
        |report| format!("{}: updated at {}", report.title, report.updated_at),
        "暂无报告历史",
    );

    format!(
        "# Idea Context\n\
         标题: {}\n\
         研究方向: {}\n\
         状态: {}\n\
         标签: {}\n\
         当前 brief:\n{}\n\n\
         ## 讨论与演化\n{}\n\n\
         ## Agent 沟通\n{}\n\n\
         ## 实验数据\n{}\n\n\
         ## 报告历史\n{}\n",
        bundle.idea.title,
        empty_dash(&bundle.idea.research_area),
        bundle.idea.status,
        empty_dash(&bundle.idea.tags),
        empty_dash(&bundle.idea.brief),
        entries,
        agent_runs,
        experiments,
        reports
    )
}

fn empty_dash(value: &str) -> &str {
    if value.trim().is_empty() {
        "-"
    } else {
        value
    }
}

pub fn render_summary_prompt(bundle: &IdeaBundle) -> String {
    format!(
        "{}\n\n\
         你是一个科研项目整理 Agent。请基于以上材料生成一个可更新的 Idea Brief，用中文 Markdown 输出。\n\n\
         必须包含这些小节：\n\
         1. 研究问题\n\
         2. 当前核心假设\n\
         3. 已讨论过的方法路线\n\
         4. 已知证据与实验信号\n\
         5. 风险、疑点与反例\n\
         6. 下一步最值得做的 3 个动作\n\n\
         要求：不要编造实验结果；如果信息不足，请显式写“不足”。",
        bundle_context(bundle)
    )
}

pub fn render_agent_prompt(bundle: &IdeaBundle, user_goal: &str) -> String {
    format!(
        "{}\n\n\
         # 任务：把下面的需求改写成一份交给外部编程 / 研究 Agent（如 Codex、Claude Code）的高质量 prompt\n\
         用户需求：\n{}\n\n\
         请直接输出最终 prompt（中文，Markdown），要求：\n\
         - 自包含：补全必要的背景、目标、输入资料与约束，让 Agent 不依赖额外解释即可开工；\n\
         - 简洁、明确、结构清晰，易于理解；\n\
         - 不要向用户反问或要求澄清。若存在不确定的点，把它写成 prompt 内“交给该 Agent 在执行中判断 / 核对的问题”，让别的 Agent 去解决；\n\
         - 结尾要求 Agent 输出：完成内容 / 关键结论 / 风险 / 下一步。\n\
         只输出这份 prompt 本身，不要附加你自己的解释或评论。",
        bundle_context(bundle),
        empty_dash(user_goal)
    )
}

pub fn render_experiment_prompt(bundle: &IdeaBundle, user_goal: &str, raw_output: &str) -> String {
    format!(
        "{}\n\n\
         # 任务：把下面的需求改写成一份用于整理 / 分析实验数据的高质量 prompt\n\
         用户需求：\n{}\n\n\
         已粘贴的实验结果（日志 / 表格 / CSV / 自然语言，可能为空）：\n\n\
         ```text\n{}\n```\n\n\
         请直接输出最终 prompt（中文，Markdown），要求：\n\
         - 明确让目标 Agent 从实验结果中抽取并结构化：实验名称、数据集、方法 / 模型、关键配置、JSON 指标对象、主要结论、异常或需复现之处；\n\
         - 自包含、简洁清晰，不要向用户反问；不确定处写成 prompt 内交给 Agent 处理的问题；\n\
         - 要求不要编造数据中不存在的指标。\n\
         只输出这份 prompt 本身，不要附加你自己的解释。",
        bundle_context(bundle),
        empty_dash(user_goal),
        truncate_for_prompt(raw_output, 12_000)
    )
}

pub fn render_report_prompt(bundle: &IdeaBundle) -> String {
    format!(
        "{}\n\n\
         请基于以上资料，生成一份研究生/博士给导师汇报用的完整 Markdown 报告。\n\
         报告需要包含：研究问题、Idea 演化、当前方法、Agent 结论、实验设置、结果表格、分析、风险、下一步计划、给导师的问题。\n\
         语气要客观、可汇报，不要夸大结果。",
        bundle_context(bundle)
    )
}

pub fn render_report_markdown(bundle: &IdeaBundle) -> String {
    let latest_entries = bullets(
        &bundle.entries,
        |entry| {
            format!(
                "**{}**（{}）: {}",
                entry.title,
                entry.kind,
                if entry.summary.is_empty() {
                    truncate_for_prompt(&entry.content, 240)
                } else {
                    entry.summary.clone()
                }
            )
        },
        "暂无讨论记录",
    );

    let agent_conclusions = bullets(
        &bundle.agent_runs,
        |run| {
            format!(
                "**{} / {}**: {}",
                run.target_agent,
                run.task_type,
                if run.summary.is_empty() {
                    truncate_for_prompt(&run.output, 260)
                } else {
                    run.summary.clone()
                }
            )
        },
        "暂无 Agent 输出",
    );

    let experiment_table = if bundle.experiments.is_empty() {
        "暂无实验数据。".to_string()
    } else {
        let mut table = String::from(
            "| 实验 | 数据集 | 方法 | 指标 | 结论 |\n| --- | --- | --- | --- | --- |\n",
        );
        for experiment in &bundle.experiments {
            table.push_str(&format!(
                "| {} | {} | {} | `{}` | {} |\n",
                escape_table(&experiment.name),
                escape_table(empty_dash(&experiment.dataset)),
                escape_table(empty_dash(&experiment.method)),
                escape_table(empty_dash(&experiment.metrics_json)),
                escape_table(empty_dash(&experiment.conclusion))
            ));
        }
        table
    };

    format!(
        "# {}\n\n\
         ## 1. 研究问题\n\n\
         - 研究方向：{}\n\
         - 当前状态：{}\n\
         - 标签：{}\n\n\
         ## 2. 当前 Idea Brief\n\n\
         {}\n\n\
         ## 3. Idea 讨论与演化\n\n\
         {}\n\n\
         ## 4. Agent 沟通结论\n\n\
         {}\n\n\
         ## 5. 实验设置与结果\n\n\
         {}\n\n\
         ## 6. 初步分析\n\n\
         - 当前证据是否支持核心假设：待结合上述实验进一步判断。\n\
         - 最需要补充的对照实验：待确认。\n\
         - 可能的负结果解释：待确认。\n\n\
         ## 7. 风险与未解决问题\n\n\
         - 数据、baseline、实现细节或统计显著性仍需要逐项核查。\n\
         - Agent 输出需要人工复核，不能直接视为最终科研结论。\n\n\
         ## 8. 下一步计划\n\n\
         - 补全关键实验配置与可复现脚本。\n\
         - 对最强 baseline 做同设置复跑。\n\
         - 根据导师反馈收敛下一版研究问题。\n\n\
         ## 9. 给导师的问题\n\n\
         - 当前研究问题是否足够聚焦？\n\
         - 实验设置是否覆盖了最重要的反例？\n\
         - 下一步应优先补实验、补理论解释，还是调整问题定义？\n",
        bundle.idea.title,
        empty_dash(&bundle.idea.research_area),
        bundle.idea.status,
        empty_dash(&bundle.idea.tags),
        empty_dash(&bundle.idea.brief),
        latest_entries,
        agent_conclusions,
        experiment_table
    )
}

fn escape_table(value: &str) -> String {
    value.replace('|', "\\|").replace('\n', "<br>")
}

#[tauri::command]
pub async fn compose_summary_prompt(
    state: State<'_, AppState>,
    payload: PromptRequest,
) -> Result<PromptResponse, String> {
    let bundle = load_bundle(&state.pool, payload.idea_id)
        .await
        .map_err(|err| err.to_string())?;
    Ok(PromptResponse {
        prompt: render_summary_prompt(&bundle),
    })
}

#[tauri::command]
pub async fn compose_agent_prompt(
    state: State<'_, AppState>,
    payload: PromptRequest,
) -> Result<PromptResponse, String> {
    let bundle = load_bundle(&state.pool, payload.idea_id)
        .await
        .map_err(|err| err.to_string())?;
    Ok(PromptResponse {
        prompt: render_agent_prompt(&bundle, payload.user_goal.as_deref().unwrap_or("")),
    })
}

#[tauri::command]
pub async fn compose_experiment_prompt(
    state: State<'_, AppState>,
    payload: PromptRequest,
) -> Result<PromptResponse, String> {
    let bundle = load_bundle(&state.pool, payload.idea_id)
        .await
        .map_err(|err| err.to_string())?;
    Ok(PromptResponse {
        prompt: render_experiment_prompt(
            &bundle,
            payload.user_goal.as_deref().unwrap_or(""),
            payload.raw_output.as_deref().unwrap_or(""),
        ),
    })
}

#[tauri::command]
pub async fn compose_report_prompt(
    state: State<'_, AppState>,
    payload: PromptRequest,
) -> Result<PromptResponse, String> {
    let bundle = load_bundle(&state.pool, payload.idea_id)
        .await
        .map_err(|err| err.to_string())?;
    Ok(PromptResponse {
        prompt: render_report_prompt(&bundle),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample_bundle() -> IdeaBundle {
        IdeaBundle {
            idea: Idea {
                id: 1,
                title: "多步时间序列预测".to_string(),
                research_area: "Forecasting".to_string(),
                status: "active".to_string(),
                tags: "LLM, baseline".to_string(),
                brief: "比较基础模型和大模型在小样本场景下的表现。".to_string(),
                created_at: "2026-01-01".to_string(),
                updated_at: "2026-01-01".to_string(),
            },
            entries: Vec::new(),
            agent_runs: Vec::new(),
            experiments: Vec::new(),
            reports: Vec::new(),
        }
    }

    #[test]
    fn summary_prompt_contains_required_sections() {
        let prompt = render_summary_prompt(&sample_bundle());
        assert!(prompt.contains("研究问题"));
        assert!(prompt.contains("下一步最值得做"));
    }

    #[test]
    fn report_markdown_contains_advisor_questions() {
        let report = render_report_markdown(&sample_bundle());
        assert!(report.contains("给导师的问题"));
        assert!(report.contains("多步时间序列预测"));
    }
}
