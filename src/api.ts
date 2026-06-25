import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type {
  AgentRun,
  Conversation,
  ConversationMeta,
  CreateAgentRunPayload,
  CreateEntryPayload,
  CreateExperimentPayload,
  CreateIdeaPayload,
  Experiment,
  GenerationResponse,
  Idea,
  IdeaEntry,
  IdeaLink,
  IdeaProposal,
  PromptResponse,
  ProviderSettings,
  Report,
  SearchHit,
} from "./types";

const call = <T>(command: string, args?: Record<string, unknown>) => invoke<T>(command, args);

/** Navigation metadata attached to a tool action. */
export type AgentActionMeta = {
  op: "read" | "create" | "delete" | "update";
  target: string;
  id: number | null;
};

/** Incremental events streamed from a running agent. Action events carry
 * navigation metadata so the UI can jump/animate the right pane. */
export type AgentStreamEvent =
  | { type: "delta"; text: string }
  | ({ type: "action"; text: string } & AgentActionMeta);

/** One ordered piece of a finished assistant turn (answer text or tool record),
 * returned with the final result so the UI can render tools inline and replay
 * right-pane animations even when live deltas didn't arrive. */
export type AgentResponseSegment =
  | { type: "text"; text: string }
  | ({ type: "action"; text: string } & AgentActionMeta);

/** Invoke a streaming command: subscribes to a per-run Tauri event for live
 * incremental events, then resolves with the final structured result. The
 * event system (rather than ipc::Channel) reliably delivers events while the
 * command is still running. */
const callStream = async <T>(
  command: string,
  request: Record<string, unknown>,
  onEvent: (event: AgentStreamEvent) => void,
): Promise<T> => {
  const streamId =
    globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  // Register the listener before invoking so no early events are missed.
  const unlisten = await listen<AgentStreamEvent>(`agent-stream:${streamId}`, (event) =>
    onEvent(event.payload),
  );
  try {
    return await invoke<T>(command, { request, streamId });
  } finally {
    unlisten();
  }
};

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

  listConversations: (ideaId?: number | null) =>
    call<ConversationMeta[]>("list_conversations", { ideaId: ideaId ?? null }),
  getConversation: (id: number) => call<Conversation>("get_conversation", { id }),
  saveConversation: (payload: {
    id?: number | null;
    ideaId?: number | null;
    title: string;
    messages: string;
  }) => call<Conversation>("save_conversation", { payload }),
  deleteConversation: (id: number) => call<void>("delete_conversation", { id }),

  getProviderSettings: () => call<ProviderSettings>("get_provider_settings"),
  saveProviderSettings: (payload: ProviderSettings) =>
    call<ProviderSettings>("save_provider_settings", { payload }),

  composeSummaryPrompt: (ideaId: number) =>
    call<PromptResponse>("compose_summary_prompt", { payload: { ideaId } }),
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

  runInternalAgentStream: (
    payload: {
      ideaId: number;
      provider: string;
      model: string;
      apiKey?: string;
      apiEndpoint?: string;
      messages: { role: "user" | "assistant"; content: string }[];
    },
    onEvent: (event: AgentStreamEvent) => void,
  ) =>
    callStream<{ content: string; actions: string[]; segments: AgentResponseSegment[] }>(
      "run_internal_agent_stream",
      payload,
      onEvent,
    ),

  runHomeAgent: (payload: {
    provider: string;
    model: string;
    apiKey?: string;
    apiEndpoint?: string;
    messages: { role: "user" | "assistant"; content: string }[];
  }) =>
    call<{ content: string; actions: string[]; proposals: IdeaProposal[]; links: IdeaLink[] }>(
      "run_home_agent",
      { request: payload },
    ),

  runHomeAgentStream: (
    payload: {
      provider: string;
      model: string;
      apiKey?: string;
      apiEndpoint?: string;
      messages: { role: "user" | "assistant"; content: string }[];
    },
    onEvent: (event: AgentStreamEvent) => void,
  ) =>
    callStream<{
      content: string;
      actions: string[];
      segments: AgentResponseSegment[];
      proposals: IdeaProposal[];
      links: IdeaLink[];
    }>("run_home_agent_stream", payload, onEvent),

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

