import { Plus, Search } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { api } from "../api";
import { formatDate } from "../lib/format";
import type { Idea, SearchHit } from "../types";

export function Sidebar({
  ideas,
  selectedIdeaId,
  homeActive,
  search,
  setSearch,
  onSelect,
  onGoHome,
}: {
  ideas: Idea[];
  selectedIdeaId: number | null;
  homeActive: boolean;
  search: string;
  setSearch: (value: string) => void;
  onSelect: (id: number) => void;
  onGoHome: () => void;
}) {
  const searchHits = useQuery({
    queryKey: ["search-hits", search],
    queryFn: () => api.searchWorkspace(search),
    enabled: search.trim().length > 1,
  });

  return (
    <aside className="sidebar">
      <div className="brand">
        <div className="brand-mark">R</div>
        <div>
          <strong>Research Idea Agent</strong>
          <span>本地科研整理台</span>
        </div>
      </div>

      <button
        type="button"
        className={homeActive ? "new-idea-button active" : "new-idea-button"}
        onClick={onGoHome}
        title="回到主页，用聊天新建 / 检索 idea"
      >
        <Plus size={18} />
        <span>新建 Idea</span>
      </button>

      <label className="search-box">
        <Search size={16} />
        <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="搜索 idea / 实验 / 报告" />
      </label>

      <div className="sidebar-section-head">
        <h2>Ideas</h2>
      </div>

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
