import { MessageSquareText, Save } from "lucide-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../api";
import { MarkdownEditor } from "../components/MarkdownEditor";
import { MarkdownPreview } from "../components/MarkdownPreview";
import { Surface } from "../components/Surface";
import { TimelineEmpty } from "../components/EmptyState";
import { useIdeaDraft } from "../hooks/useIdeaDraft";
import { deriveTitle, formatDate } from "../lib/format";
import { useWorkspaceStore } from "../store";
import type { TabProps } from "../lib/types";
import type { IdeaEntry } from "../types";

export function DiscussionTab({ idea, setNotice }: TabProps) {
  const queryClient = useQueryClient();
  const [draft, patch] = useIdeaDraft(idea.id);
  const agentFocus = useWorkspaceStore((state) => state.agentFocus);
  const focus = agentFocus?.target === "discussion" ? agentFocus : null;
  const reading = focus?.op === "read";

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

  const entries = entriesQuery.data ?? [];

  return (
    <section className="tab-panel flow">
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
          minHeight={200}
          maxHeight={360}
          placeholder="粘贴对话、笔记或任何想记录的内容，点“保存到历史”归档。也可以直接让左侧 Agent 帮你整理写入。"
        />
      </Surface>

      <div
        className={reading ? "timeline is-reading" : "timeline"}
        key={reading ? `read-${focus.nonce}` : "timeline"}
      >
        {entries.length ? (
          entries.map((entry: IdeaEntry) => (
            <article
              className={
                focus?.op === "create" && focus.id === entry.id ? "record-card is-new" : "record-card"
              }
              key={entry.id}
            >
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
    </section>
  );
}
