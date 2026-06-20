import { Bot, Save, Sparkles } from "lucide-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../api";
import { MarkdownEditor } from "../components/MarkdownEditor";
import { MarkdownPreview } from "../components/MarkdownPreview";
import { PromptPanel } from "../components/PromptPanel";
import { Surface } from "../components/Surface";
import { TimelineEmpty } from "../components/EmptyState";
import { useIdeaDraft } from "../hooks/useIdeaDraft";
import { formatDate } from "../lib/format";
import type { TabProps } from "../lib/types";
import type { AgentRun } from "../types";

export function AgentTab({ idea, providerSettings, apiKey, setNotice }: TabProps) {
  const queryClient = useQueryClient();
  const [draft, patch] = useIdeaDraft(idea.id);

  const runsQuery = useQuery({
    queryKey: ["agent-runs", idea.id],
    queryFn: () => api.listAgentRuns(idea.id),
  });

  const saveRun = useMutation({
    mutationFn: api.createAgentRun,
    onSuccess: async () => {
      patch({ agentOutput: "" });
      await queryClient.invalidateQueries({ queryKey: ["agent-runs", idea.id] });
      setNotice("Agent 沟通记录已保存。");
    },
    onError: (error) => setNotice(String(error)),
  });

  const generation = useMutation({
    mutationFn: async () => {
      const composed = await api.composeAgentPrompt(idea.id, draft.agentGoal);
      const result = await api.runGeneration({
        ideaId: idea.id,
        taskType: "agent_prompt",
        provider: providerSettings.provider,
        model: providerSettings.model,
        prompt: composed.prompt,
        apiKey,
        apiEndpoint: providerSettings.apiEndpoint,
      });
      return { meta: composed.prompt, content: result.content };
    },
    onSuccess: ({ meta, content }) => {
      patch({ agentPrompt: content ?? meta });
      if (!content) {
        setNotice("未配置 API key，已生成 prompt 模板，可复制到外部 AI 完善。");
      }
    },
    onError: (error) => setNotice(String(error)),
  });

  return (
    <section className="tab-panel two-column">
      <div className="flow">
        <Surface
          title="Agent 沟通"
          action={
            <button
              className="icon-button"
              onClick={() => generation.mutate()}
              disabled={!draft.agentGoal.trim() || generation.isPending}
            >
              <Sparkles size={16} />
              <span>{generation.isPending ? "生成中" : "生成 Prompt"}</span>
            </button>
          }
        >
          <textarea
            value={draft.agentGoal}
            onChange={(event) => patch({ agentGoal: event.target.value })}
            placeholder="描述需求：希望交给外部 Agent（Codex / Claude 等）完成什么。生成时由 AI 补全成一份简洁明确、自包含的 prompt。"
          />
        </Surface>

        <PromptPanel
          prompt={draft.agentPrompt}
          onPromptChange={(value) => patch({ agentPrompt: value })}
        />

        <Surface
          title="粘贴 Agent 输出"
          action={
            <button
              className="icon-button"
              disabled={(!draft.agentPrompt.trim() && !draft.agentOutput.trim()) || saveRun.isPending}
              onClick={() =>
                saveRun.mutate({
                  ideaId: idea.id,
                  targetAgent: "",
                  taskType: "",
                  prompt: draft.agentPrompt,
                  output: draft.agentOutput,
                  status: draft.agentOutput.trim() ? "completed" : "prompted",
                })
              }
            >
              <Save size={16} />
              <span>保存记录</span>
            </button>
          }
        >
          <MarkdownEditor
            value={draft.agentOutput}
            onChange={(value) => patch({ agentOutput: value })}
            minHeight={220}
            maxHeight={360}
            placeholder="把外部 Agent 的回复粘贴到这里，连同上面的 prompt 一起保存到历史。"
          />
        </Surface>
      </div>

      <div className="timeline">
        {(runsQuery.data ?? []).length ? (
          (runsQuery.data ?? []).map((run: AgentRun) => (
            <article className="record-card" key={run.id}>
              <div className="row-between">
                <strong>{run.output.trim() ? "Agent 回复" : "待执行 Prompt"}</strong>
                <span className="status-pill">{run.status}</span>
              </div>
              <small>{formatDate(run.createdAt)}</small>
              <MarkdownPreview markdown={run.output || run.prompt.slice(0, 700)} />
            </article>
          ))
        ) : (
          <TimelineEmpty
            icon={<Bot size={22} />}
            message="还没有 Agent 沟通记录。生成 prompt、粘贴外部 Agent 的回复并保存后会出现在这里。"
          />
        )}
      </div>
    </section>
  );
}
