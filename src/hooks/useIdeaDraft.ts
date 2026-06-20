import { useCallback } from "react";
import { emptyDraft, useWorkspaceStore } from "../store";
import type { IdeaDraft } from "../store";

/**
 * Per-idea working draft accessor. Returns the current draft (or a stable empty
 * one) plus a `patch` that merges a partial update into the store.
 */
export function useIdeaDraft(ideaId: number) {
  const draft = useWorkspaceStore((state) => state.drafts[ideaId] ?? emptyDraft);
  const setDraft = useWorkspaceStore((state) => state.setDraft);
  const patch = useCallback(
    (value: Partial<IdeaDraft>) => setDraft(ideaId, value),
    [ideaId, setDraft],
  );
  return [draft, patch] as const;
}
