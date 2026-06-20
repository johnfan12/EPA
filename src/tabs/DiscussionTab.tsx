import { MessageSquareText, Save } from "lucide-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../api";
import { ChatBox } from "../components/ChatBox";
import { MarkdownEditor } from "../components/MarkdownEditor";
import { MarkdownPreview } from "../components/MarkdownPreview";
import { Surface } from "../components/Surface";
import { TimelineEmpty } from "../components/EmptyState";
import { useIdeaDraft } from "../hooks/useIdeaDraft";
import { deriveTitle, formatDate, uid } from "../lib/format";
import type { TabProps } from "../lib/types";
import type { ChatMessage } from "../store";
import type { IdeaEntry } from "../types";

export function DiscussionTab({ idea, providerSettings, apiKey, setNotice }: TabProps) {
  const queryClient = useQueryClient();
  const [draft, patch] = useIdeaDraft(idea.id);

  const entriesQuery = useQuery({
    queryKey: ["entries", idea.id],
    queryFn: () => api.listEntries(idea.id),
  });

  const createEntry = useMutation({
    mutationFn: api.createEntry,
    onSuccess: async () => {
      patch({ discussionPaste: "" });
      await queryClient.invalidateQueries({ queryKey: ["entries", idea.id] });
      await queryClient.invalidateQueries({ queryKey: ["ideas"] });
      setNotice("已保存到历史记录。");
    },
    onError: (error) => setNotice(String(error)),
  });

  const agent = useMutation({
    mutationFn: (messages: ChatMessage[]) =>
      api.runInternalAgent({
        ideaId: idea.id,
        provider: providerSettings.provider,
        model: providerSettings.model,
        apiKey,
        apiEndpoint: providerSettings.apiEndpoint,
        messages: messages.map((message) => ({ role: message.role, content: message.content })),
      }),
    onSuccess: async (result, messages) => {
      patch({
        agentChatMessages: [
          ...messages,
          {
            id: uid(),
            role: "assistant",
            content: result.content || "（无输出）",
            actions: result.actions,
          },
        ],
      });
      // The agent may have created/deleted records — refresh anything it can touch.
      if (result.actions.length) {
        await Promise.all([
          queryClient.invalidateQueries({ queryKey: ["entries", idea.id] }),
          queryClient.invalidateQueries({ queryKey: ["agent-runs", idea.id] }),
          queryClient.invalidateQueries({ queryKey: ["experiments", idea.id] }),
          queryClient.invalidateQueries({ queryKey: ["reports", idea.id] }),
          queryClient.invalidateQueries({ queryKey: ["ideas"] }),
        ]);
      }
    },
    onError: (error) => setNotice(String(error)),
  });

  const savePaste = () => {
    const content = draft.discussionPaste.trim();
    if (!content) return;
    createEntry.mutate({
      ideaId: idea.id,
      kind: "note",
      title: deriveTitle(content, "讨论记录"),
      content,
      source: "paste",
    });
  };

  const sendAgent = () => {
    const text = draft.agentChatInput.trim();
    if (!text || agent.isPending || !apiKey) return;
    const next = [...draft.agentChatMessages, { id: uid(), role: "user" as const, content: text }];
    patch({ agentChatMessages: next, agentChatInput: "" });
    agent.mutate(next);
  };

  return (
    <section className="tab-panel two-column">
      <ChatBox
        title="内部 Agent"
        hint={apiKey ? "可读写 / 删除记录、生成报告" : "配置 API key 后可用"}
        emptyHint="让 Agent 帮你整理记录，例如“把上一条粘贴存成讨论”“根据现有讨论和实验生成一份报告”“列出所有实验并删掉最早的一个”。"
        placeholder="描述任务，Enter 发送，Shift+Enter 换行"
        messages={draft.agentChatMessages}
        input={draft.agentChatInput}
        onInputChange={(value) => patch({ agentChatInput: value })}
        onSend={sendAgent}
        sending={agent.isPending}
        disabled={!apiKey}
      />

      <div className="flow">
        <Surface
          title="讨论与演化"
          action={
            <button
              className="icon-button"
              type="button"
              onClick={savePaste}
              disabled={!draft.discussionPaste.trim() || createEntry.isPending}
            >
              <Save size={16} />
              <span>保存到历史</span>
            </button>
          }
        >
          <MarkdownEditor
            value={draft.discussionPaste}
            onChange={(value) => patch({ discussionPaste: value })}
            minHeight={240}
            maxHeight={400}
            placeholder="粘贴对话、笔记或任何想记录的内容，点“保存到历史”归档。"
          />
        </Surface>

        <div className="timeline">
          {(entriesQuery.data ?? []).length ? (
            (entriesQuery.data ?? []).map((entry: IdeaEntry) => (
              <article className="record-card" key={entry.id}>
                <div className="row-between">
                  <strong>{entry.title}</strong>
                  <span className="status-pill">{entry.kind}</span>
                </div>
                <small>{entry.source || "local"} · {formatDate(entry.createdAt)}</small>
                <MarkdownPreview markdown={entry.summary || entry.content.slice(0, 700)} />
              </article>
            ))
          ) : (
            <TimelineEmpty
              icon={<MessageSquareText size={22} />}
              message="还没有历史记录。粘贴内容并保存、或让左侧 Agent 写入后，会在这里展示。"
            />
          )}
        </div>
      </div>
    </section>
  );
}
