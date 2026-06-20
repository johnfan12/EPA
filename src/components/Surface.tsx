import type { ReactNode } from "react";

/**
 * A bordered panel ("tool-surface") with an optional header row holding a title
 * on the left and an action (usually a button) on the right.
 */
export function Surface({
  title,
  action,
  className,
  children,
}: {
  title?: ReactNode;
  action?: ReactNode;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div className={className ? `tool-surface ${className}` : "tool-surface"}>
      {title || action ? (
        <div className="row-between">
          {title ? <h2>{title}</h2> : <span />}
          {action ?? null}
        </div>
      ) : null}
      {children}
    </div>
  );
}
