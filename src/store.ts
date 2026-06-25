import { create } from "zustand";
import type { IdeaLink, IdeaProposal } from "./types";

export type TabId = "discussion" | "experiments" | "reports";
export type View = "home" | "workspace";
export type Theme = "light" | "dark";

function initialTheme(): Theme {
  if (typeof window === "undefined") return "light";
  const stored = window.localStorage.getItem("theme");
  if (stored === "light" || stored === "dark") return stored;
  return window.matchMedia?.("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

/** Min/max for the draggable Agent column (px). */
export const AGENT_WIDTH_MIN = 280;
export const AGENT_WIDTH_MAX = 760;

function initialAgentWidth(): number {
  if (typeof window === "undefined") return 372;
  const stored = Number(window.localStorage.getItem("agentWidth"));
  return Number.isFinite(stored) && stored >= AGENT_WIDTH_MIN && stored <= AGENT_WIDTH_MAX
    ? stored
    : 372;
}

/**
 * One ordered piece of a streamed assistant turn: either a chunk of answer text
 * or an inline record of a tool action. Rendering them in order interleaves the
 * answer with the tools the agent used, instead of dumping tools at the end.
 */
export type ChatSegment =
  | { type: "text"; text: string }
  | { type: "action"; text: string };

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  /** Ordered text/tool segments for an assistant turn (preferred for rendering). */
  segments?: ChatSegment[];
  /** Legacy flat tool-action list (older persisted messages without segments). */
  actions?: string[];
}

/**
 * Home-page (global) chat message. Beyond a normal chat message it can carry
 * editable idea previews and jump-to-idea buttons emitted by the home agent.
 */
export interface HomeChatMessage extends ChatMessage {
  proposals?: IdeaProposal[];
  links?: IdeaLink[];
}

/**
 * Live state of an agent run, keyed by scope (e.g. `idea-agent:<ideaId>`,
 * `home`, `report-gen:<ideaId>`). Kept in the store so it survives tab/view
 * switches: a run started in one tab keeps streaming and stays "running" even
 * if its component unmounts. `segments` accumulate text deltas and tool actions
 * in arrival order so the live bubble shows tools inline.
 */
export interface AgentRunState {
  running: boolean;
  segments: ChatSegment[];
}

/**
 * Per-idea conversation with the internal agent (the left workspace column).
 * Mirrors the home conversation model; persisted to SQLite per conversation,
 * `conversationId` is null for a not-yet-saved (new) conversation.
 */
export interface IdeaAgentState {
  conversationId: number | null;
  messages: ChatMessage[];
  input: string;
}

export const emptyIdeaAgent: IdeaAgentState = {
  conversationId: null,
  messages: [],
  input: "",
};

/**
 * Drives the right pane when the agent touches data: switch to `tab`, glow the
 * section matching `target`, and slide in the freshly created record `id`.
 * `nonce` changes on every focus so repeated effects replay their animation.
 */
export interface AgentFocus {
  tab: TabId;
  target: string;
  op: "read" | "create" | "delete" | "update";
  id: number | null;
  nonce: number;
}

/**
 * Per-idea working draft for the manual (non-agent) editors. Lives in the store
 * so it survives switching between tabs and between ideas.
 */
export interface IdeaDraft {
  discussionPaste: string;
  experimentOutput: string;
  reportSelectedId: number | null;
}

export const emptyDraft: IdeaDraft = {
  discussionPaste: "",
  experimentOutput: "",
  reportSelectedId: null,
};

interface WorkspaceState {
  view: View;
  selectedIdeaId: number | null;
  activeTab: TabId;
  settingsOpen: boolean;
  theme: Theme;
  /** Width (px) of the draggable Agent workspace column. */
  agentWidth: number;
  apiKeyByProvider: Record<string, string>;
  drafts: Record<number, IdeaDraft>;
  /** Per-idea internal-agent conversations (left workspace column). */
  ideaAgents: Record<number, IdeaAgentState>;
  /** Global home-page conversation. Persisted to SQLite per conversation;
   * homeConversationId is null for a not-yet-saved (new) conversation. */
  homeConversationId: number | null;
  homeChatMessages: HomeChatMessage[];
  homeChatInput: string;
  /** Live agent runs keyed by scope; survives tab/view switches. */
  agentRuns: Record<string, AgentRunState>;
  /** Right-pane focus driven by the agent's tool calls (null = none). */
  agentFocus: AgentFocus | null;
  setView: (view: View) => void;
  setSelectedIdeaId: (id: number | null) => void;
  setActiveTab: (tab: TabId) => void;
  setSettingsOpen: (open: boolean) => void;
  setTheme: (theme: Theme) => void;
  toggleTheme: () => void;
  setAgentWidth: (width: number) => void;
  setApiKey: (provider: string, key: string) => void;
  setDraft: (ideaId: number, patch: Partial<IdeaDraft>) => void;
  setIdeaAgentMessages: (ideaId: number, messages: ChatMessage[]) => void;
  setIdeaAgentInput: (ideaId: number, value: string) => void;
  setIdeaAgentConversationId: (ideaId: number, id: number | null) => void;
  /** Reset an idea's agent chat to a fresh, unsaved conversation. */
  newIdeaConversation: (ideaId: number) => void;
  /** Load a persisted conversation into an idea's agent chat. */
  loadIdeaConversation: (ideaId: number, id: number, messages: ChatMessage[]) => void;
  setHomeConversationId: (id: number | null) => void;
  setHomeChatMessages: (messages: HomeChatMessage[]) => void;
  setHomeChatInput: (value: string) => void;
  /** Reset the home chat to a fresh, unsaved conversation. */
  newHomeConversation: () => void;
  /** Load a persisted conversation into the home chat. */
  loadHomeConversation: (id: number, messages: HomeChatMessage[]) => void;
  setAgentRun: (key: string, patch: Partial<AgentRunState>) => void;
  setAgentFocus: (focus: AgentFocus | null) => void;
}

export const useWorkspaceStore = create<WorkspaceState>((set) => ({
  view: "home",
  selectedIdeaId: null,
  activeTab: "discussion",
  settingsOpen: false,
  theme: initialTheme(),
  agentWidth: initialAgentWidth(),
  apiKeyByProvider: {},
  drafts: {},
  ideaAgents: {},
  homeConversationId: null,
  homeChatMessages: [],
  homeChatInput: "",
  agentRuns: {},
  agentFocus: null,
  setView: (view) => set({ view }),
  setSelectedIdeaId: (id) => set({ selectedIdeaId: id }),
  setActiveTab: (tab) => set({ activeTab: tab }),
  setSettingsOpen: (open) => set({ settingsOpen: open }),
  setTheme: (theme) => set({ theme }),
  toggleTheme: () => set((state) => ({ theme: state.theme === "dark" ? "light" : "dark" })),
  setAgentWidth: (width) =>
    set({ agentWidth: Math.max(AGENT_WIDTH_MIN, Math.min(AGENT_WIDTH_MAX, Math.round(width))) }),
  setIdeaAgentMessages: (ideaId, messages) =>
    set((state) => ({
      ideaAgents: {
        ...state.ideaAgents,
        [ideaId]: { ...emptyIdeaAgent, ...state.ideaAgents[ideaId], messages },
      },
    })),
  setIdeaAgentInput: (ideaId, value) =>
    set((state) => ({
      ideaAgents: {
        ...state.ideaAgents,
        [ideaId]: { ...emptyIdeaAgent, ...state.ideaAgents[ideaId], input: value },
      },
    })),
  setIdeaAgentConversationId: (ideaId, id) =>
    set((state) => ({
      ideaAgents: {
        ...state.ideaAgents,
        [ideaId]: { ...emptyIdeaAgent, ...state.ideaAgents[ideaId], conversationId: id },
      },
    })),
  newIdeaConversation: (ideaId) =>
    set((state) => ({
      ideaAgents: { ...state.ideaAgents, [ideaId]: { ...emptyIdeaAgent } },
    })),
  loadIdeaConversation: (ideaId, id, messages) =>
    set((state) => ({
      ideaAgents: {
        ...state.ideaAgents,
        [ideaId]: { conversationId: id, messages, input: "" },
      },
    })),
  setHomeConversationId: (id) => set({ homeConversationId: id }),
  setHomeChatMessages: (messages) => set({ homeChatMessages: messages }),
  setHomeChatInput: (value) => set({ homeChatInput: value }),
  newHomeConversation: () =>
    set({ homeConversationId: null, homeChatMessages: [], homeChatInput: "" }),
  loadHomeConversation: (id, messages) =>
    set({ homeConversationId: id, homeChatMessages: messages, homeChatInput: "" }),
  setAgentRun: (key, patch) =>
    set((state) => {
      const prev = state.agentRuns[key] ?? { running: false, segments: [] };
      return { agentRuns: { ...state.agentRuns, [key]: { ...prev, ...patch } } };
    }),
  setAgentFocus: (focus) => set({ agentFocus: focus }),
  setApiKey: (provider, key) =>
    set((state) => ({
      apiKeyByProvider: {
        ...state.apiKeyByProvider,
        [provider]: key,
      },
    })),
  setDraft: (ideaId, patch) =>
    set((state) => ({
      drafts: {
        ...state.drafts,
        [ideaId]: { ...emptyDraft, ...state.drafts[ideaId], ...patch },
      },
    })),
}));
