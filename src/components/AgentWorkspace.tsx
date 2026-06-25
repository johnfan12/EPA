import { History, Search, Send, SquarePen, Trash2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { KeyboardEvent } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../api";
import { AgentSegments } from "./AgentSegments";
import { MarkdownPreview } from "./MarkdownPreview";
import {
  appendAction,
  appendDelta,
  beginRun,
  endRun,
  runKey,
  snapshotRun,
  toChatSegments,
  useAgentRun,
} from "../lib/agentRun";
import { deriveTitle, formatDate, uid } from "../lib/format";
import { useWorkspaceStore } from "../store";
import { emptyIdeaAgent } from "../store";
import type { AgentActionMeta, AgentResponseSegment } from "../api";
import type { ChatMessage, TabId } from "../store";
import type { Idea, ProviderSettings } from "../types";

/** Maps a backend tool `target` to the right-pane tab + the query to refresh. */
function targetInfo(target: string, ideaId: number): { tab: TabId; queryKey: unknown[] } | null {
  switch (target) {
    case "discussion":
      return { tab: "discussion", queryKey: ["entries", ideaId] };
    case "experiment":
      return { tab: "experiments", queryKey: ["experiments", ideaId] };
    case "report":
      return { tab: "reports", queryKey: ["reports", ideaId] };
    default:
      return null;
  }
}

function firstUserText(messages: ChatMessage[]) {
  return messages.find((message) => message.role === "user")?.content ?? "";
}

/**
 * The idea's primary, always-on conversation with the internal agent. Streams
 * answers with inline tool records, and drives the right pane (tab switch +
 * glow / slide-in) as the agent reads and writes records. Conversations are
 * persisted to SQLite per idea, with new / history / delete controls.
 */
export function AgentWorkspace({
  idea,
  providerSettings,
  apiKey,
  setNotice,
  width,
}: {
  idea: Idea;
  providerSettings: ProviderSettings;
  apiKey: string;
  setNotice: (message: string) => void;
  width: number;
}) {
  const queryClient = useQueryClient();
  const agent = useWorkspaceStore((state) => state.ideaAgents[idea.id]) ?? emptyIdeaAgent;
  const setMessages = useWorkspaceStore((state) => state.setIdeaAgentMessages);
  const setInput = useWorkspaceStore((state) => state.setIdeaAgentInput);
  const setConversationId = useWorkspaceStore((state) => state.setIdeaAgentConversationId);
  const newConversation = useWorkspaceStore((state) => state.newIdeaConversation);
  const loadConversation = useWorkspaceStore((state) => state.loadIdeaConversation);
  const setActiveTab = useWorkspaceStore((state) => state.setActiveTab);
  const setAgentFocus = useWorkspaceStore((state) => state.setAgentFocus);

  const [historyOpen, setHistoryOpen] = useState(false);
  const [historySearch, setHistorySearch] = useState("");

  // Thread scroll: follow new output unless the user has scrolled up.
  const threadRef = useRef<HTMLDivElement>(null);
  const stickRef = useRef(true);

  const conversations = useQuery({
    queryKey: ["conversations", idea.id],
    queryFn: () => api.listConversations(idea.id),
  });

  const filteredConversations = (conversations.data ?? []).filter((conv) =>
    conv.title.toLowerCase().includes(historySearch.trim().toLowerCase()),
  );

  const key = runKey.ideaAgent(idea.id);
  const run = useAgentRun(key);

  const onThreadScroll = () => {
    const el = threadRef.current;
    if (!el) return;
    stickRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 48;
  };

  // Auto-scroll to the latest output while streaming / on new messages, but only
  // when the user is already pinned near the bottom (didn't scroll up to read).
  useEffect(() => {
    const el = threadRef.current;
    if (el && stickRef.current) el.scrollTop = el.scrollHeight;
  }, [agent.messages, run.segments, run.running]);

  // Persist after each turn. Reads the live id from the store so a freshly
  // created conversation updates instead of duplicating.
  const persist = (msgs: ChatMessage[]) => {
    const id = useWorkspaceStore.getState().ideaAgents[idea.id]?.conversationId ?? null;
    api
      .saveConversation({
        id: id ?? undefined,
        ideaId: idea.id,
        title: deriveTitle(firstUserText(msgs), "新对话"),
        messages: JSON.stringify(msgs),
      })
      .then((conv) => {
        if (id == null) setConversationId(idea.id, conv.id);
        queryClient.invalidateQueries({ queryKey: ["conversations", idea.id] });
      })
      .catch(() => undefined);
  };

  // When the agent touches data: jump the right pane to the matching tab, flag
  // it for the glow / slide-in animation, and refresh that query so newly
  // created records appear. Returns true if it navigated (a known target).
  const focusFromAction = (event: AgentActionMeta) => {
    const info = targetInfo(event.target, idea.id);
    if (!info) return false;
    setActiveTab(info.tab);
    setAgentFocus({ tab: info.tab, target: event.target, op: event.op, id: event.id, nonce: Date.now() });
    queryClient.invalidateQueries({ queryKey: info.queryKey });
    return true;
  };

  // Fallback when live stream events didn't drive the right pane (e.g. a
  // non-streaming provider): replay each tool action's focus in order so the
  // user still sees the glow / slide-in for what the agent did.
  const replayFocus = (segments: AgentResponseSegment[]) => {
    const navigable = segments.filter(
      (segment): segment is Extract<AgentResponseSegment, { type: "action" }> =>
        segment.type === "action" && targetInfo(segment.target, idea.id) != null,
    );
    navigable.forEach((segment, index) => {
      window.setTimeout(() => focusFromAction(segment), index * 850);
    });
  };

  const send = (text: string) => {
    const value = text.trim();
    if (!value || run.running || !apiKey) return;
    stickRef.current = true; // a fresh send should follow the output
    const next: ChatMessage[] = [...agent.messages, { id: uid(), role: "user", content: value }];
    setMessages(idea.id, next);
    setInput(idea.id, "");
    beginRun(key);
    let firedFocus = false;
    api
      .runInternalAgentStream(
        {
          ideaId: idea.id,
          provider: providerSettings.provider,
          model: providerSettings.model,
          apiKey,
          apiEndpoint: providerSettings.apiEndpoint,
          messages: next.map((message) => ({ role: message.role, content: message.content })),
        },
        (event) => {
          if (event.type === "delta") {
            appendDelta(key, event.text);
          } else if (event.type === "action") {
            appendAction(key, event.text);
            if (focusFromAction(event)) firedFocus = true;
          }
        },
      )
      .then(async (result) => {
        // Prefer the authoritative ordered segments from the result (always
        // present); fall back to whatever streamed live.
        const segments = result.segments?.length ? toChatSegments(result.segments) : snapshotRun(key);
        const final: ChatMessage[] = [
          ...next,
          {
            id: uid(),
            role: "assistant",
            content: result.content || "（无输出）",
            segments,
          },
        ];
        setMessages(idea.id, final);
        endRun(key);
        persist(final);
        // Final sweep in case anything else changed during the run.
        if (result.actions.length) {
          await Promise.all([
            queryClient.invalidateQueries({ queryKey: ["entries", idea.id] }),
            queryClient.invalidateQueries({ queryKey: ["experiments", idea.id] }),
            queryClient.invalidateQueries({ queryKey: ["reports", idea.id] }),
            queryClient.invalidateQueries({ queryKey: ["ideas"] }),
          ]);
        }
        // If the live channel didn't drive the right pane, replay animations now.
        if (!firedFocus && result.segments?.length) {
          replayFocus(result.segments);
        }
      })
      .catch((error) => {
        setMessages(idea.id, [
          ...next,
          { id: uid(), role: "assistant", content: `出错了：${String(error)}` },
        ]);
        endRun(key);
        setNotice(String(error));
      });
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      send(agent.input);
    }
  };

  const startNew = () => {
    setHistoryOpen(false);
    stickRef.current = true;
    newConversation(idea.id);
  };

  const openConversation = async (id: number) => {
    setHistoryOpen(false);
    stickRef.current = true;
    if (id === agent.conversationId) return;
    try {
      const conv = await api.getConversation(id);
      let parsed: ChatMessage[] = [];
      try {
        parsed = JSON.parse(conv.messages) as ChatMessage[];
      } catch {
        parsed = [];
      }
      loadConversation(idea.id, id, parsed);
    } catch {
      /* ignore load errors */
    }
  };

  const deleteConversation = async (id: number, event: React.MouseEvent) => {
    event.stopPropagation();
    try {
      await api.deleteConversation(id);
      if (useWorkspaceStore.getState().ideaAgents[idea.id]?.conversationId === id) {
        newConversation(idea.id);
      }
      queryClient.invalidateQueries({ queryKey: ["conversations", idea.id] });
    } catch {
      /* ignore */
    }
  };

  return (
    <aside className="agent-workspace" style={{ width, flex: "none" }}>
      <header className="agent-head">
        <div className="agent-head-title">Agent 工作区</div>
        <div className="button-row">
          <button className="icon-button subtle" title="新建对话" onClick={startNew}>
            <SquarePen size={16} />
          </button>
          <div className="home-history">
            <button
              className={historyOpen ? "icon-button subtle active" : "icon-button subtle"}
              title="历史会话"
              aria-expanded={historyOpen}
              onClick={() => setHistoryOpen((open) => !open)}
            >
              <History size={16} />
            </button>
            {historyOpen ? (
              <>
                <div className="home-history-backdrop" onClick={() => setHistoryOpen(false)} />
                <div className="home-history-menu">
                  <div className="home-history-head">历史会话</div>
                  <div className="home-history-search">
                    <Search size={14} />
                    <input
                      type="text"
                      value={historySearch}
                      onChange={(event) => setHistorySearch(event.target.value)}
                      placeholder="搜索对话标题…"
                      autoFocus
                    />
                  </div>
                  {filteredConversations.length ? (
                    filteredConversations.map((conv) => (
                      <div
                        key={conv.id}
                        className={
                          conv.id === agent.conversationId
                            ? "home-history-item active"
                            : "home-history-item"
                        }
                        onClick={() => openConversation(conv.id)}
                      >
                        <div className="home-history-item-text">
                          <span>{conv.title}</span>
                          <small>{formatDate(conv.updatedAt)}</small>
                        </div>
                        <button
                          className="home-history-delete"
                          title="删除会话"
                          onClick={(event) => deleteConversation(conv.id, event)}
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                    ))
                  ) : (
                    <div className="home-history-empty">
                      {historySearch.trim() ? "未找到匹配的对话" : "还没有历史会话"}
                    </div>
                  )}
                </div>
              </>
            ) : null}
          </div>
        </div>
      </header>

      <div className="agent-thread" ref={threadRef} onScroll={onThreadScroll}>
        {agent.messages.length === 0 && !run.running ? (
          <p className="muted-text agent-empty">
            {apiKey
              ? "把这里当作这个 idea 的指挥台：让 Agent 整理讨论、登记实验、写 / 改报告。它的每一步读写都会实时反映到右侧。"
              : "请先在右上角「设置」里配置 API key，Agent 才能工作。"}
          </p>
        ) : (
          agent.messages.map((message) => (
            <div className={`chat-message ${message.role}`} key={message.id}>
              {message.role === "assistant" ? (
                message.segments?.length ? (
                  <AgentSegments segments={message.segments} />
                ) : (
                  <>
                    <MarkdownPreview markdown={message.content} />
                    {message.actions?.length ? (
                      <ul className="chat-actions">
                        {message.actions.map((action, index) => (
                          <li key={index}>{action}</li>
                        ))}
                      </ul>
                    ) : null}
                  </>
                )
              ) : (
                <p>{message.content}</p>
              )}
            </div>
          ))
        )}
        {run.running ? (
          <div className="chat-message assistant pending">
            {run.segments.length ? <AgentSegments segments={run.segments} /> : "执行中…"}
          </div>
        ) : null}
      </div>

      <div className="agent-composer chat-input-row">
        <textarea
          value={agent.input}
          onChange={(event) => setInput(idea.id, event.target.value)}
          onKeyDown={onKeyDown}
          placeholder={apiKey ? "描述任务，Enter 发送，Shift+Enter 换行" : "请先在设置里配置 API key"}
          disabled={!apiKey}
        />
        <button
          className="primary-button"
          onClick={() => send(agent.input)}
          disabled={run.running || !apiKey || !agent.input.trim()}
          title="发送"
        >
          <Send size={16} />
        </button>
      </div>
    </aside>
  );
}
