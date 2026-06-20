import type { ReactNode } from "react";

/** Large centered placeholder used when no idea is selected. */
export function EmptyState({
  icon,
  title,
  message,
}: {
  icon: ReactNode;
  title: string;
  message: ReactNode;
}) {
  return (
    <div className="empty-state">
      {icon}
      <h2>{title}</h2>
      <p>{message}</p>
    </div>
  );
}

/** Dashed placeholder used inside a record timeline column when it is empty. */
export function TimelineEmpty({ icon, message }: { icon: ReactNode; message: ReactNode }) {
  return (
    <div className="timeline-empty">
      {icon}
      <p>{message}</p>
    </div>
  );
}
