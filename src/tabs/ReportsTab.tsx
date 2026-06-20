import { Code, Eye, FileText, Sparkles, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../api";
import { ChatBox } from "../components/ChatBox";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { MarkdownEditor } from "../components/MarkdownEditor";
import { MarkdownWysiwyg } from "../components/MarkdownWysiwyg";
import { TimelineEmpty } from "../components/EmptyState";
import { useIdeaDraft } from "../hooks/useIdeaDraft";
import { formatDate, stripCodeFence, uid } from "../lib/format";
import type { TabProps } from "../lib/types";
import type { ChatMessage } from "../store";
import type { Report } from "../types";

type Mode = "wysiwyg" | "source";

export function ReportsTab({ idea, providerSettings, apiKey, setNotice }: TabProps) {
  const queryClient = useQueryClient();
  const [draft, patch] = useIdeaDraft(idea.id);
  const [mode, setMode] = useState<Mode>("wysiwyg");
  const [content, setContent] = useState("");
  const [editVersion, setEditVersion] = useState(0);
  const [confirmDel, setConfirmDel] = useState(false);

  const reportsQuery = useQuery({
    queryKey: ["reports", idea.id],
    queryFn: () => api.listReports(idea.id),
  });
  const reports = reportsQuery.data ?? [];
  const selectedReport =
    reports.find((report) => report.id === draft.reportSelectedId) ?? reports[0];

  // Seed the edit buffer from the DB whenever the selected report changes.
  useEffect(() => {
    setContent(selectedReport?.content ?? "");
  }, [selectedReport?.id]);

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

  const generate = useMutation({
    mutationFn: async () => {
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
      return created.id;
    },
    onSuccess: async (reportId) => {
      patch({ reportSelectedId: reportId });
      await queryClient.invalidateQueries({ queryKey: ["reports", idea.id] });
      setNotice("AI 已生成新报告。");
    },
    onError: (error) => setNotice(String(error)),
  });

  const deleteReport = useMutation({
    mutationFn: (reportId: number) => api.deleteReport(reportId),
    onSuccess: async () => {
      patch({ reportSelectedId: null });
      await queryClient.invalidateQueries({ queryKey: ["reports", idea.id] });
      setNotice("报告已删除。");
    },
    onError: (error) => setNotice(String(error)),
  });

  // Chat that asks the agent to rewrite the current report.
  const edit = useMutation({
    mutationFn: (vars: { instruction: string; messages: ChatMessage[] }) =>
      api.runReportEditAgent({
        ideaId: idea.id,
        provider: providerSettings.provider,
        model: providerSettings.model,
        apiKey,
        apiEndpoint: providerSettings.apiEndpoint,
        content,
        instruction: vars.instruction,
      }),
    onSuccess: async (result, vars) => {
      const ok = result.content.trim().length > 0;
      patch({
        reportChatMessages: [
          ...vars.messages,
          {
            id: uid(),
            role: "assistant",
            content: ok ? "已根据指令更新报告。" : "未能生成修改后的报告。",
            actions: result.actions,
          },
        ],
      });
      if (ok && selectedReport) {
        const next = stripCodeFence(result.content);
        await api.updateReport({
          id: selectedReport.id,
          title: selectedReport.title,
          content: next,
        });
        setContent(next);
        setEditVersion((version) => version + 1);
        await queryClient.invalidateQueries({ queryKey: ["reports", idea.id] });
      }
    },
    onError: (error) => setNotice(String(error)),
  });

  const sendReportEdit = () => {
    const text = draft.reportChatInput.trim();
    if (!text || edit.isPending || !apiKey || !selectedReport) return;
    const messages = [...draft.reportChatMessages, { id: uid(), role: "user" as const, content: text }];
    patch({ reportChatMessages: messages, reportChatInput: "" });
    edit.mutate({ instruction: text, messages });
  };

  const editorKey = selectedReport ? `${selectedReport.id}-${editVersion}` : "none";

  return (
    <section className="tab-panel report-layout">
      <div className="report-actions">
        <button className="primary-button" onClick={() => generate.mutate()} disabled={generate.isPending}>
          <Sparkles size={16} />
          <span>{generate.isPending ? "AI 生成中…" : "生成报告"}</span>
        </button>
        <span className="muted-text">
          AI 会读取本 idea 的讨论 / 实验 / 沟通记录，并参考上一份报告，生成一份新报告，之后可直接修改或让下方 Agent 改。
        </span>
      </div>

      <div className="report-view">
        <aside className="report-list">
          {reports.length ? (
            reports.map((report: Report) => (
              <button
                key={report.id}
                className={report.id === selectedReport?.id ? "idea-item active" : "idea-item"}
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

            <ChatBox
              title="让 Agent 改报告"
              hint={apiKey ? "描述要怎么改，Agent 会改写当前报告" : "配置 API key 后可用"}
              emptyHint="例如“把第 2 节写详细些”“补上最新实验结果”“整体更简洁”。Agent 会读取记录并重写当前报告。"
              placeholder="描述修改要求，Enter 发送，Shift+Enter 换行"
              messages={draft.reportChatMessages}
              input={draft.reportChatInput}
              onInputChange={(value) => patch({ reportChatInput: value })}
              onSend={sendReportEdit}
              sending={edit.isPending}
              disabled={!apiKey}
            />
          </div>
        ) : (
          <div className="report-editor-pane empty">
            <TimelineEmpty
              icon={<FileText size={22} />}
              message="还没有报告。点上方“生成报告”，AI 会综合现有进度写出一份，再在这里直接修改。"
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
