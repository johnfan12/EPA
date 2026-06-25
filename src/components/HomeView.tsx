import {
  ArrowUpRight,
  History,
  Moon,
  Send,
  Settings,
  Sparkles,
  SquarePen,
  Sun,
  Trash2,
} from "lucide-react";
import { useState } from "react";
import type { KeyboardEvent } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../api";
import { MarkdownPreview } from "./MarkdownPreview";
import { AgentSegments } from "./AgentSegments";
import { IdeaPreviewCard } from "./IdeaPreviewCard";
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
import type { HomeChatMessage } from "../store";
import type { Idea, ProviderSettings } from "../types";

const SUGGESTIONS = [
  "帮我新建一个关于「长上下文检索增强」的 idea",
  "我之前关于多模态对齐的 idea 在哪？",
  "在所有 idea 里找包含『对比学习』的内容",
];

function firstUserText(messages: HomeChatMessage[]) {
  return messages.find((message) => message.role === "user")?.content ?? "";
}

/** Claude-style centered home chat: a global agent that reads every idea, can
 * answer / locate content, propose new ideas (editable preview) and emit jump
 * buttons to existing ideas. Conversations are persisted to SQLite, with
 * new / history / delete controls in the header. */
export function HomeView({
  providerSettings,
  apiKey,
  onOpenIdea,
}: {
  providerSettings: ProviderSettings;
  apiKey: string;
  onOpenIdea: (id: number) => void;
}) {
  const queryClient = useQueryClient();
  const conversationId = useWorkspaceStore((state) => state.homeConversationId);
  const setConversationId = useWorkspaceStore((state) => state.setHomeConversationId);
  const messages = useWorkspaceStore((state) => state.homeChatMessages);
  const setMessages = useWorkspaceStore((state) => state.setHomeChatMessages);
  const input = useWorkspaceStore((state) => state.homeChatInput);
  const setInput = useWorkspaceStore((state) => state.setHomeChatInput);
  const newConversation = useWorkspaceStore((state) => state.newHomeConversation);
  const loadConversation = useWorkspaceStore((state) => state.loadHomeConversation);
  const theme = useWorkspaceStore((state) => state.theme);
  const toggleTheme = useWorkspaceStore((state) => state.toggleTheme);
  const setSettingsOpen = useWorkspaceStore((state) => state.setSettingsOpen);

  const [historyOpen, setHistoryOpen] = useState(false);

  const conversations = useQuery({
    queryKey: ["conversations", "home"],
    queryFn: () => api.listConversations(),
  });

  // Persist the conversation after each turn. Reads the live id from the store
  // so a freshly-created conversation updates instead of duplicating.
  const persist = (msgs: HomeChatMessage[]) => {
    const id = useWorkspaceStore.getState().homeConversationId;
    api
      .saveConversation({
        id: id ?? undefined,
        title: deriveTitle(firstUserText(msgs), "新对话"),
        messages: JSON.stringify(msgs),
      })
      .then((conv) => {
        if (id == null) setConversationId(conv.id);
        queryClient.invalidateQueries({ queryKey: ["conversations", "home"] });
      })
      .catch(() => undefined);
  };

  const run = useAgentRun(runKey.home);

  const send = (text: string) => {
    const value = text.trim();
    if (!value || run.running || !apiKey) return;
    const next: HomeChatMessage[] = [...messages, { id: uid(), role: "user", content: value }];
    setMessages(next);
    setInput("");
    beginRun(runKey.home);
    api
      .runHomeAgentStream(
        {
          provider: providerSettings.provider,
          model: providerSettings.model,
          apiKey,
          apiEndpoint: providerSettings.apiEndpoint,
          messages: next.map((message) => ({ role: message.role, content: message.content })),
        },
        (event) => {
          if (event.type === "delta") appendDelta(runKey.home, event.text);
          else if (event.type === "action") appendAction(runKey.home, event.text);
        },
      )
      .then((result) => {
        const segments = result.segments?.length
          ? toChatSegments(result.segments)
          : snapshotRun(runKey.home);
        const final: HomeChatMessage[] = [
          ...next,
          {
            id: uid(),
            role: "assistant",
            content: result.content || "（无输出）",
            segments,
            proposals: result.proposals,
            links: result.links,
          },
        ];
        setMessages(final);
        endRun(runKey.home);
        persist(final);
        // The agent may have read/affected ideas — keep the sidebar list fresh.
        if (result.actions.length) {
          queryClient.invalidateQueries({ queryKey: ["ideas"] });
        }
      })
      .catch((error) => {
        const final: HomeChatMessage[] = [
          ...next,
          { id: uid(), role: "assistant", content: `出错了：${String(error)}` },
        ];
        setMessages(final);
        endRun(runKey.home);
        persist(final);
      });
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      send(input);
    }
  };

  const handleAccepted = (idea: Idea) => {
    queryClient.invalidateQueries({ queryKey: ["ideas"] });
    onOpenIdea(idea.id);
  };

  const startNew = () => {
    setHistoryOpen(false);
    newConversation();
  };

  const openConversation = async (id: number) => {
    setHistoryOpen(false);
    if (id === conversationId) return;
    try {
      const conv = await api.getConversation(id);
      let parsed: HomeChatMessage[] = [];
      try {
        parsed = JSON.parse(conv.messages) as HomeChatMessage[];
      } catch {
        parsed = [];
      }
      loadConversation(id, parsed);
    } catch {
      /* ignore load errors */
    }
  };

  const deleteConversation = async (id: number, event: React.MouseEvent) => {
    event.stopPropagation();
    try {
      await api.deleteConversation(id);
      if (useWorkspaceStore.getState().homeConversationId === id) newConversation();
      queryClient.invalidateQueries({ queryKey: ["conversations", "home"] });
    } catch {
      /* ignore */
    }
  };

  // Remember the user prompt that precedes each assistant turn so an accepted
  // preview can keep it as the first discussion record.
  let lastUserPrompt = "";

  return (
    <div className="home-view">
      <header className="home-header">
        <div className="home-header-title">
          <Sparkles size={16} />
          <span>主页</span>
        </div>
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
                  {conversations.data?.length ? (
                    conversations.data.map((conv) => (
                      <div
                        key={conv.id}
                        className={
                          conv.id === conversationId ? "home-history-item active" : "home-history-item"
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
                    <div className="home-history-empty">还没有历史会话</div>
                  )}
                </div>
              </>
            ) : null}
          </div>
          <button
            className="icon-button subtle"
            title={theme === "dark" ? "切换到浅色" : "切换到深色"}
            onClick={toggleTheme}
          >
            {theme === "dark" ? <Sun size={16} /> : <Moon size={16} />}
          </button>
          <button className="icon-button subtle" title="模型设置" onClick={() => setSettingsOpen(true)}>
            <Settings size={16} />
          </button>
        </div>
      </header>

      <div className="home-scroll">
        <div className="home-inner">
          {messages.length === 0 ? (
            <div className="home-greeting">
              <h1>你想研究点什么？</h1>
              <p className="muted-text">
                描述一个想法，我会按需帮你建立 idea；也可以让我在你所有的 idea 里查找、定位内容。
              </p>
              {!apiKey ? (
                <p className="home-warning">请先在右上角「设置」里配置 API key，Agent 才能工作。</p>
              ) : (
                <div className="home-suggestions">
                  {SUGGESTIONS.map((text) => (
                    <button key={text} type="button" className="home-suggestion" onClick={() => send(text)}>
                      {text}
                    </button>
                  ))}
                </div>
              )}
            </div>
          ) : (
            <div className="home-thread">
              {messages.map((message) => {
                if (message.role === "user") lastUserPrompt = message.content;
                const promptForCard = lastUserPrompt;
                return (
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

                    {message.proposals?.map((proposal, index) => (
                      <IdeaPreviewCard
                        key={index}
                        proposal={proposal}
                        originalPrompt={promptForCard}
                        onAccepted={handleAccepted}
                      />
                    ))}

                    {message.links?.length ? (
                      <div className="idea-link-row">
                        {message.links.map((link, index) => (
                          <button
                            key={index}
                            type="button"
                            className="idea-link-button"
                            onClick={() => onOpenIdea(link.ideaId)}
                          >
                            <span>{link.title}</span>
                            <ArrowUpRight size={14} />
                          </button>
                        ))}
                      </div>
                    ) : null}
                  </div>
                );
              })}
              {run.running ? (
                <div className="chat-message assistant pending">
                  {run.segments.length ? <AgentSegments segments={run.segments} /> : "执行中…"}
                </div>
              ) : null}
            </div>
          )}
        </div>
      </div>

      <div className="home-composer">
        <div className="home-composer-inner chat-input-row">
          <textarea
            value={input}
            onChange={(event) => setInput(event.target.value)}
            onKeyDown={onKeyDown}
            placeholder={apiKey ? "描述一个想法或问题，Enter 发送，Shift+Enter 换行" : "请先在设置里配置 API key"}
            disabled={!apiKey}
          />
          <button
            className="primary-button"
            onClick={() => send(input)}
            disabled={run.running || !apiKey || !input.trim()}
            title="发送"
          >
            <Send size={16} />
          </button>
        </div>
      </div>
    </div>
  );
}
