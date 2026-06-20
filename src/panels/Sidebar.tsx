import { Plus, Search } from "lucide-react";
import { FormEvent, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../api";
import { formatDate } from "../lib/format";
import type { Idea, SearchHit } from "../types";

export function Sidebar({
  ideas,
  selectedIdeaId,
  search,
  setSearch,
  onSelect,
  onCreated,
}: {
  ideas: Idea[];
  selectedIdeaId: number | null;
  search: string;
  setSearch: (value: string) => void;
  onSelect: (id: number) => void;
  onCreated: (idea: Idea) => void;
}) {
  const [title, setTitle] = useState("");
  const [composerOpen, setComposerOpen] = useState(false);
  const queryClient = useQueryClient();

  const searchHits = useQuery({
    queryKey: ["search-hits", search],
    queryFn: () => api.searchWorkspace(search),
    enabled: search.trim().length > 1,
  });

  const createIdea = useMutation({
    mutationFn: api.createIdea,
    onSuccess: async (idea) => {
      setTitle("");
      setComposerOpen(false);
      await queryClient.invalidateQueries({ queryKey: ["ideas"] });
      onCreated(idea);
    },
  });

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    if (!title.trim()) return;
    createIdea.mutate({ title });
  };

  const closeComposer = () => {
    setComposerOpen(false);
    setTitle("");
  };

  return (
    <aside className="sidebar">
      <div className="brand">
        <div className="brand-mark">R</div>
        <div>
          <strong>Research Idea Agent</strong>
          <span>本地科研整理台</span>
        </div>
      </div>

      <label className="search-box">
        <Search size={16} />
        <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="搜索 idea / 实验 / 报告" />
      </label>

      <div className="sidebar-section-head">
        <h2>Ideas</h2>
        <button
          className="icon-button subtle"
          type="button"
          title={composerOpen ? "收起" : "新建 Idea"}
          aria-expanded={composerOpen}
          onClick={() => setComposerOpen((open) => !open)}
        >
          <Plus size={16} />
        </button>
      </div>

      {composerOpen ? (
        <form className="new-idea-popover" onSubmit={onSubmit}>
          <input
            autoFocus
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Escape") closeComposer();
            }}
            placeholder="输入题目，回车创建"
          />
          <div className="button-row">
            <button className="icon-button subtle" type="button" onClick={closeComposer}>
              取消
            </button>
            <button className="primary-button" disabled={!title.trim() || createIdea.isPending}>
              <Plus size={16} />
              <span>{createIdea.isPending ? "创建中" : "创建"}</span>
            </button>
          </div>
        </form>
      ) : null}

      <div className="sidebar-list">
        {ideas.map((idea) => (
          <button
            className={idea.id === selectedIdeaId ? "idea-item active" : "idea-item"}
            key={idea.id}
            onClick={() => onSelect(idea.id)}
          >
            <span>{idea.title}</span>
            <small>{idea.researchArea || "未设置方向"} · {formatDate(idea.updatedAt)}</small>
          </button>
        ))}
      </div>

      {searchHits.data?.length ? (
        <div className="search-results">
          <h2>命中片段</h2>
          {searchHits.data.slice(0, 6).map((hit: SearchHit) => (
            <button className="search-hit" key={`${hit.entityType}-${hit.entityId}`} onClick={() => onSelect(hit.ideaId)}>
              <strong>{hit.title || hit.entityType}</strong>
              <span>{hit.snippet}</span>
            </button>
          ))}
        </div>
      ) : null}
    </aside>
  );
}
