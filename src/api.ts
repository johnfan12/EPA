import { invoke } from "@tauri-apps/api/core";
import type {
  AgentRun,
  CreateAgentRunPayload,
  CreateEntryPayload,
  CreateExperimentPayload,
  CreateIdeaPayload,
  Experiment,
  GenerationResponse,
  Idea,
  IdeaEntry,
  PromptResponse,
  ProviderSettings,
  Report,
  SearchHit,
} from "./types";

const call = <T>(command: string, args?: Record<string, unknown>) => invoke<T>(command, args);

export const api = {
  listIdeas: (query?: string) => call<Idea[]>("list_ideas", { query }),
  getIdea: (id: number) => call<Idea>("get_idea", { id }),
  createIdea: (payload: CreateIdeaPayload) => call<Idea>("create_idea", { payload }),
  updateIdea: (payload: Idea) => call<Idea>("update_idea", { payload }),
  deleteIdea: (id: number) => call<void>("delete_idea", { id }),

  listEntries: (ideaId: number) => call<IdeaEntry[]>("list_entries", { ideaId }),
  createEntry: (payload: CreateEntryPayload) => call<IdeaEntry>("create_entry", { payload }),

  listAgentRuns: (ideaId: number) => call<AgentRun[]>("list_agent_runs", { ideaId }),
  createAgentRun: (payload: CreateAgentRunPayload) =>
    call<AgentRun>("create_agent_run", { payload }),

  listExperiments: (ideaId: number) => call<Experiment[]>("list_experiments", { ideaId }),
  createExperiment: (payload: CreateExperimentPayload) =>
    call<Experiment>("create_experiment", { payload }),

  listReports: (ideaId: number) => call<Report[]>("list_reports", { ideaId }),
  generateReport: (ideaId: number) => call<Report>("generate_report", { ideaId }),
  updateReport: (payload: Pick<Report, "id" | "title" | "content">) =>
    call<Report>("update_report", { payload }),
  deleteReport: (reportId: number) => call<void>("delete_report", { reportId }),
  exportReportMarkdown: (reportId: number) =>
    call<string>("export_report_markdown", { reportId }),

  saveApiKey: (provider: string, apiKey: string) =>
    call<void>("save_api_key", { provider, apiKey }),
  loadApiKey: (provider: string) => call<string | null>("load_api_key", { provider }),
  deleteApiKey: (provider: string) => call<void>("delete_api_key", { provider }),

  searchWorkspace: (query: string) => call<SearchHit[]>("search_workspace", { query }),

  getProviderSettings: () => call<ProviderSettings>("get_provider_settings"),
  saveProviderSettings: (payload: ProviderSettings) =>
    call<ProviderSettings>("save_provider_settings", { payload }),

  composeSummaryPrompt: (ideaId: number) =>
    call<PromptResponse>("compose_summary_prompt", { payload: { ideaId } }),
  composeAgentPrompt: (ideaId: number, userGoal: string) =>
    call<PromptResponse>("compose_agent_prompt", {
      payload: { ideaId, userGoal },
    }),
  composeExperimentPrompt: (ideaId: number, userGoal: string, rawOutput: string) =>
    call<PromptResponse>("compose_experiment_prompt", {
      payload: { ideaId, userGoal, rawOutput },
    }),
  composeReportPrompt: (ideaId: number) =>
    call<PromptResponse>("compose_report_prompt", { payload: { ideaId } }),

  runGeneration: (payload: {
    ideaId?: number;
    taskType: string;
    provider: string;
    model: string;
    prompt: string;
    apiKey?: string;
    apiEndpoint?: string;
  }) => call<GenerationResponse>("run_generation", { request: payload }),

  runInternalAgent: (payload: {
    ideaId: number;
    provider: string;
    model: string;
    apiKey?: string;
    apiEndpoint?: string;
    messages: { role: "user" | "assistant"; content: string }[];
  }) =>
    call<{ content: string; actions: string[] }>("run_internal_agent", { request: payload }),

  runReportAgent: (payload: {
    ideaId: number;
    provider: string;
    model: string;
    apiKey?: string;
    apiEndpoint?: string;
  }) =>
    call<{ content: string; actions: string[] }>("run_report_agent", { request: payload }),

  runReportEditAgent: (payload: {
    ideaId: number;
    provider: string;
    model: string;
    apiKey?: string;
    apiEndpoint?: string;
    content: string;
    instruction: string;
  }) =>
    call<{ content: string; actions: string[] }>("run_report_edit_agent", { request: payload }),
};

