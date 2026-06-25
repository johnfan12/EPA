import { Beaker, Save } from "lucide-react";
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
import type { Experiment } from "../types";

export function ExperimentsTab({ idea, setNotice }: TabProps) {
  const queryClient = useQueryClient();
  const [draft, patch] = useIdeaDraft(idea.id);
  const agentFocus = useWorkspaceStore((state) => state.agentFocus);
  const focus = agentFocus?.target === "experiment" ? agentFocus : null;
  const reading = focus?.op === "read";

  const experimentsQuery = useQuery({
    queryKey: ["experiments", idea.id],
    queryFn: () => api.listExperiments(idea.id),
  });

  const experiments = experimentsQuery.data ?? [];

  const createExperiment = useMutation({
    mutationFn: api.createExperiment,
    onSuccess: async () => {
      patch({ experimentOutput: "" });
      await queryClient.invalidateQueries({ queryKey: ["experiments", idea.id] });
      setNotice("实验记录已保存。");
    },
    onError: (error) => setNotice(String(error)),
  });

  const saveExperiment = () => {
    const content = draft.experimentOutput.trim();
    if (!content) return;
    createExperiment.mutate({
      ideaId: idea.id,
      name: deriveTitle(content, `实验 ${new Date().toLocaleDateString()}`),
      rawOutput: content,
    });
  };

  return (
    <section className="tab-panel flow">
      <Surface
        title="实验数据"
        action={
          <button
            className="icon-button"
            onClick={saveExperiment}
            disabled={!draft.experimentOutput.trim() || createExperiment.isPending}
          >
            <Save size={16} />
            <span>保存到历史</span>
          </button>
        }
      >
        <MarkdownEditor
          value={draft.experimentOutput}
          onChange={(value) => patch({ experimentOutput: value })}
          minHeight={200}
          maxHeight={360}
          placeholder="粘贴实验日志、表格、CSV 或自然语言结果，保存后归档到历史。也可以让左侧 Agent 帮你登记、整理实验。"
        />
      </Surface>

      <div
        className={reading ? "timeline is-reading" : "timeline"}
        key={reading ? `read-${focus.nonce}` : "timeline"}
      >
        {experiments.length ? (
          experiments.map((experiment: Experiment) => (
            <article
              className={
                focus?.op === "create" && focus.id === experiment.id
                  ? "record-card is-new"
                  : "record-card"
              }
              key={experiment.id}
            >
              <div className="row-between">
                <strong>{experiment.name}</strong>
                <span className="status-pill">实验</span>
              </div>
              <small>{formatDate(experiment.createdAt)}</small>
              <MarkdownPreview
                markdown={experiment.conclusion || experiment.rawOutput.slice(0, 700)}
              />
            </article>
          ))
        ) : (
          <TimelineEmpty
            icon={<Beaker size={22} />}
            message="还没有实验记录。粘贴实验结果并保存、或让左侧 Agent 登记后，会在这里按时间线展示。"
          />
        )}
      </div>
    </section>
  );
}
