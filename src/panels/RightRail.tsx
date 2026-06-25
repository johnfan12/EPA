import { MarkdownPreview } from "../components/MarkdownPreview";
import { splitTags } from "../lib/format";
import type { Experiment, Idea, IdeaEntry, Report } from "../types";

export function RightRail({
  idea,
  entries,
  experiments,
  reports,
}: {
  idea: Idea | null;
  entries: IdeaEntry[];
  experiments: Experiment[];
  reports: Report[];
}) {
  if (!idea) {
    return (
      <aside className="right-rail">
        <h2>项目摘要</h2>
        <p className="muted-text">选择一个 Idea 后显示当前假设、结论和下一步。</p>
      </aside>
    );
  }

  const recent = experiments
    .map((experiment) => experiment.conclusion || experiment.rawOutput)
    .filter((text) => text.trim().length > 0)
    .slice(0, 3);

  return (
    <aside className="right-rail">
      <div>
        <p className="eyebrow">Current Idea</p>
        <h2>{idea.title}</h2>
        <div className="tag-row">
          {splitTags(idea.tags).map((tag) => (
            <span className="tag" key={tag}>{tag}</span>
          ))}
        </div>
      </div>

      <section>
        <h3>当前 Brief</h3>
        <MarkdownPreview markdown={idea.brief || "尚未生成阶段 brief。"} />
      </section>

      <section className="stats-grid">
        <div><strong>{entries.length}</strong><span>讨论</span></div>
        <div><strong>{experiments.length}</strong><span>实验</span></div>
        <div><strong>{reports.length}</strong><span>报告</span></div>
      </section>

      <section>
        <h3>最近实验结论</h3>
        <ul className="compact-list">
          {recent.map((text, index) => (
            <li key={index}>{text.slice(0, 120)}</li>
          ))}
          {!recent.length ? <li>暂无实验结论。</li> : null}
        </ul>
      </section>
    </aside>
  );
}
