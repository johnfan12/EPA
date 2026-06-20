import { Beaker, Save, Sparkles } from "lucide-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../api";
import { MarkdownEditor } from "../components/MarkdownEditor";
import { MarkdownPreview } from "../components/MarkdownPreview";
import { PromptPanel } from "../components/PromptPanel";
import { Surface } from "../components/Surface";
import { TimelineEmpty } from "../components/EmptyState";
import { useIdeaDraft } from "../hooks/useIdeaDraft";
import { deriveTitle, formatDate } from "../lib/format";
import type { TabProps } from "../lib/types";
import type { Experiment } from "../types";

export function ExperimentsTab({ idea, providerSettings, apiKey, setNotice }: TabProps) {
  const queryClient = useQueryClient();
  const [draft, patch] = useIdeaDraft(idea.id);

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

  const generation = useMutation({
    mutationFn: async () => {
      const composed = await api.composeExperimentPrompt(
        idea.id,
        draft.experimentGoal,
        draft.experimentOutput,
      );
      const result = await api.runGeneration({
        ideaId: idea.id,
        taskType: "experiment_prompt",
        provider: providerSettings.provider,
        model: providerSettings.model,
        prompt: composed.prompt,
        apiKey,
        apiEndpoint: providerSettings.apiEndpoint,
      });
      return { meta: composed.prompt, content: result.content };
    },
    onSuccess: ({ meta, content }) => {
      patch({ experimentPrompt: content ?? meta });
      if (!content) {
        setNotice("未配置 API key，已生成 prompt 模板，可复制到外部 AI 完善。");
      }
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
    <section className="tab-panel two-column">
      <div className="flow">
        <Surface
          title="实验数据"
          action={
            <button
              className="icon-button"
              onClick={() => generation.mutate()}
              disabled={!draft.experimentGoal.trim() || generation.isPending}
            >
              <Sparkles size={16} />
              <span>{generation.isPending ? "生成中" : "生成 Prompt"}</span>
            </button>
          }
        >
          <textarea
            value={draft.experimentGoal}
            onChange={(event) => patch({ experimentGoal: event.target.value })}
            placeholder="描述需求：希望从实验结果里整理 / 分析出什么。生成时由 AI 结合下方粘贴内容补全成一份 prompt。"
          />
        </Surface>

        <PromptPanel
          prompt={draft.experimentPrompt}
          onPromptChange={(value) => patch({ experimentPrompt: value })}
        />

        <Surface
          title="粘贴实验结果"
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
            minHeight={220}
            maxHeight={360}
            placeholder="粘贴实验日志、表格、CSV 或自然语言结果，保存后归档到历史。"
          />
        </Surface>
      </div>

      <div className="timeline">
        {experiments.length ? (
          experiments.map((experiment: Experiment) => (
            <article className="record-card" key={experiment.id}>
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
            message="还没有实验记录。粘贴实验结果并保存后，会在这里按时间线展示。"
          />
        )}
      </div>
    </section>
  );
}
