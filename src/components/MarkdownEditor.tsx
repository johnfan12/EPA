import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { markdown } from "@codemirror/lang-markdown";
import {
  bracketMatching,
  defaultHighlightStyle,
  indentOnInput,
  syntaxHighlighting,
} from "@codemirror/language";
import { EditorState } from "@codemirror/state";
import {
  drawSelection,
  EditorView,
  highlightActiveLine,
  highlightSpecialChars,
  keymap,
  lineNumbers,
} from "@codemirror/view";
import { useEffect, useRef } from "react";

interface MarkdownEditorProps {
  value: string;
  onChange: (value: string) => void;
  minHeight?: number;
  maxHeight?: number;
  placeholder?: string;
}

export function MarkdownEditor({
  value,
  onChange,
  minHeight = 220,
  maxHeight = 420,
  placeholder,
}: MarkdownEditorProps) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const viewRef = useRef<EditorView | null>(null);
  const onChangeRef = useRef(onChange);
  const initialValueRef = useRef(value);

  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);

  useEffect(() => {
    if (!rootRef.current || viewRef.current) return;

    const theme = EditorView.theme({
      "&": {
        minHeight: `${minHeight}px`,
        maxHeight: `${maxHeight}px`,
        fontSize: "13px",
        backgroundColor: "hsl(var(--panel))",
        color: "hsl(var(--foreground))",
      },
      ".cm-content": {
        minHeight: `${minHeight}px`,
        caretColor: "hsl(var(--primary))",
        // Break even long unbroken tokens so nothing overflows horizontally.
        overflowWrap: "anywhere",
        fontFamily:
          "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', monospace",
      },
      ".cm-scroller": {
        // Grow with content up to maxHeight, then scroll inside instead of
        // stretching the surrounding panel.
        overflow: "auto",
        fontFamily:
          "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', monospace",
      },
      ".cm-gutters": {
        backgroundColor: "hsl(var(--panel-secondary))",
        color: "hsl(var(--muted-foreground))",
        borderRight: "1px solid hsl(var(--border))",
      },
      "&.cm-focused": {
        outline: "none",
      },
    });

    const placeholderExt = placeholder ? EditorView.contentAttributes.of({ "data-placeholder": placeholder }) : [];

    viewRef.current = new EditorView({
      parent: rootRef.current,
      state: EditorState.create({
        doc: initialValueRef.current,
        extensions: [
          lineNumbers(),
          highlightSpecialChars(),
          history(),
          drawSelection(),
          indentOnInput(),
          bracketMatching(),
          syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
          markdown(),
          EditorView.lineWrapping,
          keymap.of([...defaultKeymap, ...historyKeymap]),
          EditorView.updateListener.of((update) => {
            if (update.docChanged) {
              onChangeRef.current(update.state.doc.toString());
            }
          }),
          placeholderExt,
          theme,
        ],
      }),
    });

    return () => {
      viewRef.current?.destroy();
      viewRef.current = null;
    };
  }, [minHeight, maxHeight, placeholder]);

  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    const current = view.state.doc.toString();
    if (current === value) return;
    view.dispatch({
      changes: { from: 0, to: current.length, insert: value },
    });
  }, [value]);

  return <div className="editor-shell" ref={rootRef} />;
}
