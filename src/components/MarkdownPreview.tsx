import DOMPurify from "dompurify";
import { marked } from "marked";
import { useMemo } from "react";

export function MarkdownPreview({ markdown }: { markdown: string }) {
  const html = useMemo(() => {
    const rendered = marked.parse(markdown || "_暂无内容_", { async: false }) as string;
    return DOMPurify.sanitize(rendered);
  }, [markdown]);

  return <div className="markdown-preview" dangerouslySetInnerHTML={{ __html: html }} />;
}

