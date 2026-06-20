import { Send } from "lucide-react";
import type { KeyboardEvent } from "react";
import { MarkdownPreview } from "./MarkdownPreview";
import type { ChatMessage } from "../store";

export function ChatBox({
  title,
  hint,
  emptyHint,
  placeholder,
  messages,
  input,
  onInputChange,
  onSend,
  sending,
  disabled,
}: {
  title: string;
  hint: string;
  emptyHint: string;
  placeholder: string;
  messages: ChatMessage[];
  input: string;
  onInputChange: (value: string) => void;
  onSend: () => void;
  sending: boolean;
  disabled: boolean;
}) {
  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      onSend();
    }
  };

  return (
    <div className="tool-surface chat-box">
      <div className="row-between">
        <h2>{title}</h2>
        <span className="muted-text">{hint}</span>
      </div>
      <div className="chat-thread">
        {messages.length ? (
          messages.map((message) => (
            <div className={`chat-message ${message.role}`} key={message.id}>
              {message.role === "assistant" ? (
                <MarkdownPreview markdown={message.content} />
              ) : (
                <p>{message.content}</p>
              )}
              {message.actions?.length ? (
                <ul className="chat-actions">
                  {message.actions.map((action, index) => (
                    <li key={index}>{action}</li>
                  ))}
                </ul>
              ) : null}
            </div>
          ))
        ) : (
          <p className="muted-text">{emptyHint}</p>
        )}
        {sending ? <div className="chat-message assistant pending">执行中…</div> : null}
      </div>
      <div className="chat-input-row">
        <textarea
          value={input}
          onChange={(event) => onInputChange(event.target.value)}
          onKeyDown={onKeyDown}
          placeholder={disabled ? "请先在设置里配置 API key" : placeholder}
          disabled={disabled}
        />
        <button
          className="primary-button"
          onClick={onSend}
          disabled={sending || disabled || !input.trim()}
          title="发送"
        >
          <Send size={16} />
        </button>
      </div>
    </div>
  );
}
