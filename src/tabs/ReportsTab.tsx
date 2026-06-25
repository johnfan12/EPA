import { Code, Eye, FileText, Sparkles, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../api";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { MarkdownEditor } from "../components/MarkdownEditor";
import { MarkdownWysiwyg } from "../components/MarkdownWysiwyg";
import { TimelineEmpty } from "../components/EmptyState";
import { useIdeaDraft } from "../hooks/useIdeaDraft";
import { beginRun, endRun, runKey, useAgentRun } from "../lib/agentRun";
import { formatDate, stripCodeFence } from "../lib/format";
import { useWorkspaceStore } from "../store";
import type { TabProps } from "../lib/types";
import type { Report } from "../types";

type Mode = "wysiwyg" | "source";

export function ReportsTab({ idea, providerSettings, apiKey, setNotice }: TabProps) {
  const queryClient = useQueryClient();
  const [draft, patch] = useIdeaDraft(idea.id);
  const [mode, setMode] = useState<Mode>("wysiwyg");
  const [content, setContent] = useState("");
  const [editVersion, setEditVersion] = useState(0);
  const [confirmDel, setConfirmDel] = useState(false);

  const agentFocus = useWorkspaceStore((state) => state.agentFocus);
  const focus = agentFocus?.target === "report" ? agentFocus : null;
  const glowing = focus?.op === "read" || focus?.op === "update";

  const reportsQuery = useQuery({
    queryKey: ["reports", idea.id],
    queryFn: () => api.listReports(idea.id),
  });
  const reports = reportsQuery.data ?? [];
  const selectedReport =
    reports.find((report) => report.id === draft.reportSelectedId) ?? reports[0];

  // Seed the edit buffer from the DB the moment the selected report changes
  // (during render so the WYSIWYG mounts with content on its first render).
  const [seededReportId, setSeededReportId] = useState<number | undefined>(undefined);
  if (selectedReport?.id !== seededReportId) {
    setSeededReportId(selectedReport?.id);
    setContent(selectedReport?.content ?? "");
  }

  // When the left agent creates / edits a report, open it and re-seed the editor
  // from the DB so the change shows up live. Keyed on the focus nonce so it only
  // fires on a fresh agent action, not on our own autosave round-trips.
  useEffect(() => {
    if (!focus || (focus.op !== "create" && focus.op !== "update") || focus.id == null) return;
    if (draft.reportSelectedId !== focus.id) {
      patch({ reportSelectedId: focus.id });
      return;
    }
    const fresh = reports.find((report) => report.id === focus.id);
    if (fresh && fresh.content !== content) {
      setContent(fresh.content);
      setEditVersion((version) => version + 1);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focus?.nonce, reportsQuery.dataUpdatedAt]);

  const autosave = useMutation({
    mutationFn: (vars: { id: number; title: string; content: string }) => api.updateReport(vars),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["reports", idea.id] }),
  });

  // Debounced autosave of inline edits — Typora-style, no save button.
  useEffect(() => {
    if (!selectedReport) return;
    if (content === selectedReport.content) return;
    const timeout = window.setTimeout(() => {
      autosave.mutate({ id: selectedReport.id, title: selectedReport.title, content });
    }, 800);
    return () => window.clearTimeout(timeout);
  }, [content, selectedReport?.id]);

  // Generate run state lives in the store so it survives tab switches.
  const genKey = runKey.reportGen(idea.id);
  const genRun = useAgentRun(genKey);

  const runGenerate = () => {
    if (genRun.running) return;
    beginRun(genKey);
    (async () => {
      try {
        const result = await api.runReportAgent({
          ideaId: idea.id,
          provider: providerSettings.provider,
          model: providerSettings.model,
          apiKey,
          apiEndpoint: providerSettings.apiEndpoint,
        });
        if (!result.content.trim()) {
          throw new Error("Agent 未返回报告内容（请确认已配置 OpenAI 兼容的 API key）。");
        }
        const created = await api.generateReport(idea.id);
        const title = `${idea.title} - AI 报告 ${new Date().toLocaleDateString()}`;
        await api.updateReport({ id: created.id, title, content: stripCodeFence(result.content) });
        patch({ reportSelectedId: created.id });
        await queryClient.invalidateQueries({ queryKey: ["reports", idea.id] });
        setNotice("AI 已生成新报告。");
      } catch (error) {
        setNotice(String(error));
      } finally {
        endRun(genKey);
      }
    })();
  };

  const deleteReport = useMutation({
    mutationFn: (reportId: number) => api.deleteReport(reportId),
    onSuccess: async () => {
      patch({ reportSelectedId: null });
      await queryClient.invalidateQueries({ queryKey: ["reports", idea.id] });
      setNotice("报告已删除。");
    },
    onError: (error) => setNotice(String(error)),
  });

  const editorKey = selectedReport ? `${selectedReport.id}-${editVersion}` : "none";

  return (
    <section className="tab-panel report-layout">
      <div className="report-actions">
        <button className="primary-button" onClick={runGenerate} disabled={genRun.running}>
          <Sparkles size={16} />
          <span>{genRun.running ? "AI 生成中…" : "生成报告"}</span>
        </button>
        <span className="muted-text">
          AI 会读取本 idea 的讨论 / 实验记录，并参考上一份报告，生成一份新报告，之后可直接修改或让左侧 Agent 改。
        </span>
      </div>

      <div className={glowing ? "report-view is-reading" : "report-view"} key={glowing ? `read-${focus.nonce}` : "report-view"}>
        <aside className="report-list">
          {reports.length ? (
            reports.map((report: Report) => (
              <button
                key={report.id}
                className={
                  (report.id === selectedReport?.id ? "idea-item active" : "idea-item") +
                  (focus?.op === "create" && focus.id === report.id ? " is-new" : "")
                }
                onClick={() => patch({ reportSelectedId: report.id })}
              >
                <span>{report.title}</span>
                <small>{formatDate(report.updatedAt)}</small>
              </button>
            ))
          ) : (
            <p className="muted-text">还没有报告。</p>
          )}
        </aside>

        {selectedReport ? (
          <div className="report-main">
            <div className="report-editor-pane">
              <div className="report-doc">
                {mode === "wysiwyg" ? (
                  <MarkdownWysiwyg key={editorKey} value={content} onChange={setContent} />
                ) : (
                  <MarkdownEditor
                    key={`src-${editorKey}`}
                    value={content}
                    onChange={setContent}
                    minHeight={420}
                    maxHeight={100000}
                    placeholder="报告 Markdown 源码"
                  />
                )}
              </div>
              <div className="report-editor-footer">
                <button
                  className="icon-button subtle"
                  onClick={() => setMode((current) => (current === "wysiwyg" ? "source" : "wysiwyg"))}
                  title={mode === "wysiwyg" ? "查看 / 编辑原始 Markdown" : "回到所见即所得"}
                >
                  {mode === "wysiwyg" ? <Code size={14} /> : <Eye size={14} />}
                  <span>{mode === "wysiwyg" ? "源码" : "所见即所得"}</span>
                </button>
                <div className="report-footer-right">
                  <span className="muted-text">{autosave.isPending ? "保存中…" : "已自动保存"}</span>
                  <button
                    className="icon-button subtle"
                    onClick={() => setConfirmDel(true)}
                    title="删除此报告"
                  >
                    <Trash2 size={14} />
                    <span>删除</span>
                  </button>
                </div>
              </div>
            </div>
          </div>
        ) : (
          <div className="report-editor-pane empty">
            <TimelineEmpty
              icon={<FileText size={22} />}
              message="还没有报告。点上方“生成报告”，或让左侧 Agent 综合现有进度写一份，再在这里直接修改。"
            />
          </div>
        )}
      </div>

      {confirmDel && selectedReport ? (
        <ConfirmDialog
          title="删除报告"
          message={`确定删除「${selectedReport.title}」？删除后不可恢复。`}
          confirmLabel="删除"
          danger
          onCancel={() => setConfirmDel(false)}
          onConfirm={() => {
            deleteReport.mutate(selectedReport.id);
            setConfirmDel(false);
          }}
        />
      ) : null}
    </section>
  );
}
