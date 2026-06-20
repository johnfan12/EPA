import { ArrowRight, Check } from "lucide-react";
import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { api } from "../api";
import { deriveTitle } from "../lib/format";
import type { Idea, IdeaProposal } from "../types";

/**
 * Editable preview of an idea the home agent proposed. Nothing is persisted
 * until the user accepts: accept creates the idea (with brief), stores the
 * original prompt as the first discussion record, then jumps to the idea.
 */
export function IdeaPreviewCard({
  proposal,
  originalPrompt,
  onAccepted,
}: {
  proposal: IdeaProposal;
  originalPrompt: string;
  onAccepted: (idea: Idea) => void;
}) {
  const [title, setTitle] = useState(proposal.title);
  const [researchArea, setResearchArea] = useState(proposal.researchArea);
  const [tags, setTags] = useState(proposal.tags);
  const [brief, setBrief] = useState(proposal.brief);
  const [accepted, setAccepted] = useState(false);

  const accept = useMutation({
    mutationFn: async () => {
      const idea = await api.createIdea({
        title: title.trim(),
        researchArea: researchArea.trim(),
        tags: tags.trim(),
        brief: brief.trim(),
      });
      // Keep the originating prompt as the first discussion record.
      if (originalPrompt.trim()) {
        await api.createEntry({
          ideaId: idea.id,
          kind: "note",
          title: deriveTitle(originalPrompt, "建立 idea"),
          content: originalPrompt.trim(),
          source: "home-agent",
        });
      }
      return idea;
    },
    onSuccess: (idea) => {
      setAccepted(true);
      onAccepted(idea);
    },
  });

  return (
    <div className="idea-preview-card">
      <div className="idea-preview-head">
        <span className="idea-preview-tag">Idea 预览</span>
        <span className="muted-text">可修改后再接受</span>
      </div>

      <label className="idea-preview-field">
        <span>标题</span>
        <input
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          placeholder="idea 标题"
          disabled={accepted}
        />
      </label>

      <div className="idea-preview-row">
        <label className="idea-preview-field">
          <span>研究方向</span>
          <input
            value={researchArea}
            onChange={(event) => setResearchArea(event.target.value)}
            placeholder="如：多模态对齐"
            disabled={accepted}
          />
        </label>
        <label className="idea-preview-field">
          <span>标签</span>
          <input
            value={tags}
            onChange={(event) => setTags(event.target.value)}
            placeholder="逗号分隔"
            disabled={accepted}
          />
        </label>
      </div>

      <label className="idea-preview-field">
        <span>详情 / Brief</span>
        <textarea
          value={brief}
          onChange={(event) => setBrief(event.target.value)}
          placeholder="idea 的详细描述，将写入该 idea 的 Brief。"
          rows={5}
          disabled={accepted}
        />
      </label>

      <div className="idea-preview-foot">
        <button
          className="primary-button"
          type="button"
          onClick={() => accept.mutate()}
          disabled={!title.trim() || accept.isPending || accepted}
        >
          {accepted ? <Check size={16} /> : <ArrowRight size={16} />}
          <span>{accepted ? "已创建" : accept.isPending ? "创建中…" : "接受并跳转"}</span>
        </button>
        {accept.isError ? (
          <span className="idea-preview-error">{String(accept.error)}</span>
        ) : null}
      </div>
    </div>
  );
}
