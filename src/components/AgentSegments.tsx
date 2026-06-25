import { Wrench } from "lucide-react";
import { MarkdownPreview } from "./MarkdownPreview";
import type { ChatSegment } from "../store";

/**
 * Renders an assistant turn's ordered segments: answer text (markdown) and
 * inline tool-action records, interleaved in the order they happened.
 */
export function AgentSegments({ segments }: { segments: ChatSegment[] }) {
  return (
    <>
      {segments.map((segment, index) =>
        segment.type === "text" ? (
          segment.text ? <MarkdownPreview key={index} markdown={segment.text} /> : null
        ) : (
          <div className="tool-record" key={index}>
            <Wrench size={12} />
            <span>{segment.text}</span>
          </div>
        ),
      )}
    </>
  );
}
