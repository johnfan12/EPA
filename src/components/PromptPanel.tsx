import { Check, Clipboard, Sparkles } from "lucide-react";
import { useState } from "react";
import { MarkdownEditor } from "./MarkdownEditor";

interface PromptPanelProps {
  prompt: string;
  onPromptChange?: (prompt: string) => void;
  onRun?: () => void;
  running?: boolean;
  runDisabled?: boolean;
}

export function PromptPanel({
  prompt,
  onPromptChange,
  onRun,
  running,
  runDisabled,
}: PromptPanelProps) {
  const [copied, setCopied] = useState(false);

  if (!prompt) return null;

  const copyPrompt = async () => {
    await navigator.clipboard.writeText(prompt);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1200);
  };

  return (
    <section className="prompt-panel">
      <div className="row-between">
        <div>
          <h3>可复制 Prompt</h3>
          <p>可以直接交给 Codex、Claude Code 或 ChatGPT，也可以用已配置的 API 生成。</p>
        </div>
        <div className="button-row">
          {onRun ? (
            <button className="icon-button" onClick={onRun} disabled={running || runDisabled} title="用 API 生成">
              <Sparkles size={16} />
              <span>{running ? "生成中" : "API"}</span>
            </button>
          ) : null}
          <button className="icon-button" onClick={copyPrompt} title="复制 prompt">
            {copied ? <Check size={16} /> : <Clipboard size={16} />}
            <span>{copied ? "已复制" : "复制"}</span>
          </button>
        </div>
      </div>
      <MarkdownEditor value={prompt} onChange={onPromptChange ?? (() => undefined)} minHeight={260} maxHeight={420} />
    </section>
  );
}

