import { create } from "zustand";
import type { IdeaLink, IdeaProposal } from "./types";

type TabId = "discussion" | "agents" | "experiments" | "reports";
export type View = "home" | "workspace";
export type Theme = "light" | "dark";

function initialTheme(): Theme {
  if (typeof window === "undefined") return "light";
  const stored = window.localStorage.getItem("theme");
  if (stored === "light" || stored === "dark") return stored;
  return window.matchMedia?.("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  /** Tool actions the internal agent performed for this message (assistant only). */
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
 * Per-idea working draft. Lives in the store (not in the tab components) so it
 * survives switching between the four tabs and between ideas — tab components
 * unmount on switch and would otherwise lose their local state.
 */
export interface IdeaDraft {
  discussionPaste: string;
  agentChatInput: string;
  agentChatMessages: ChatMessage[];
  agentGoal: string;
  agentPrompt: string;
  agentOutput: string;
  experimentGoal: string;
  experimentPrompt: string;
  experimentOutput: string;
  reportSelectedId: number | null;
  reportChatInput: string;
  reportChatMessages: ChatMessage[];
}

export const emptyDraft: IdeaDraft = {
  discussionPaste: "",
  agentChatInput: "",
  agentChatMessages: [],
  agentGoal: "",
  agentPrompt: "",
  agentOutput: "",
  experimentGoal: "",
  experimentPrompt: "",
  experimentOutput: "",
  reportSelectedId: null,
  reportChatInput: "",
  reportChatMessages: [],
};

interface WorkspaceState {
  view: View;
  selectedIdeaId: number | null;
  activeTab: TabId;
  settingsOpen: boolean;
  theme: Theme;
  apiKeyByProvider: Record<string, string>;
  drafts: Record<number, IdeaDraft>;
  /** Global home-page conversation. Persisted to SQLite per conversation;
   * homeConversationId is null for a not-yet-saved (new) conversation. */
  homeConversationId: number | null;
  homeChatMessages: HomeChatMessage[];
  homeChatInput: string;
  setView: (view: View) => void;
  setSelectedIdeaId: (id: number | null) => void;
  setActiveTab: (tab: TabId) => void;
  setSettingsOpen: (open: boolean) => void;
  setTheme: (theme: Theme) => void;
  toggleTheme: () => void;
  setApiKey: (provider: string, key: string) => void;
  setDraft: (ideaId: number, patch: Partial<IdeaDraft>) => void;
  setHomeConversationId: (id: number | null) => void;
  setHomeChatMessages: (messages: HomeChatMessage[]) => void;
  setHomeChatInput: (value: string) => void;
  /** Reset the home chat to a fresh, unsaved conversation. */
  newHomeConversation: () => void;
  /** Load a persisted conversation into the home chat. */
  loadHomeConversation: (id: number, messages: HomeChatMessage[]) => void;
}

export const useWorkspaceStore = create<WorkspaceState>((set) => ({
  view: "home",
  selectedIdeaId: null,
  activeTab: "discussion",
  settingsOpen: false,
  theme: initialTheme(),
  apiKeyByProvider: {},
  drafts: {},
  homeConversationId: null,
  homeChatMessages: [],
  homeChatInput: "",
  setView: (view) => set({ view }),
  setSelectedIdeaId: (id) => set({ selectedIdeaId: id }),
  setActiveTab: (tab) => set({ activeTab: tab }),
  setSettingsOpen: (open) => set({ settingsOpen: open }),
  setTheme: (theme) => set({ theme }),
  toggleTheme: () => set((state) => ({ theme: state.theme === "dark" ? "light" : "dark" })),
  setHomeConversationId: (id) => set({ homeConversationId: id }),
  setHomeChatMessages: (messages) => set({ homeChatMessages: messages }),
  setHomeChatInput: (value) => set({ homeChatInput: value }),
  newHomeConversation: () =>
    set({ homeConversationId: null, homeChatMessages: [], homeChatInput: "" }),
  loadHomeConversation: (id, messages) =>
    set({ homeConversationId: id, homeChatMessages: messages, homeChatInput: "" }),
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
