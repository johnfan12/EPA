import { Crepe } from "@milkdown/crepe";
import "@milkdown/crepe/theme/common/style.css";
import "@milkdown/crepe/theme/frame.css";
import { useEffect, useRef } from "react";

/**
 * Typora-like WYSIWYG markdown editor (Milkdown Crepe). Uncontrolled: the
 * initial markdown is set once at mount, and edits stream out via `onChange`.
 * Remount (change the React `key`) to load a different document.
 */
export function MarkdownWysiwyg({
  value,
  onChange,
}: {
  value: string;
  onChange: (markdown: string) => void;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const onChangeRef = useRef(onChange);
  const initialRef = useRef(value);

  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);

  useEffect(() => {
    if (!rootRef.current) return;
    const crepe = new Crepe({ root: rootRef.current, defaultValue: initialRef.current });
    crepe.on((api) => {
      api.markdownUpdated((_ctx, markdown) => {
        onChangeRef.current(markdown);
      });
    });

    let destroyed = false;
    crepe.create().then(() => {
      if (destroyed) crepe.destroy();
    });
    return () => {
      destroyed = true;
      crepe.destroy();
    };
  }, []);

  return <div className="milkdown-host" ref={rootRef} />;
}
