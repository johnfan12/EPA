import { useWorkspaceStore } from "../store";
import type { AgentResponseSegment } from "../api";
import type { AgentRunState, ChatSegment } from "../store";

/** Map a backend response's segments to store ChatSegments (drops nav metadata). */
export function toChatSegments(segments: AgentResponseSegment[]): ChatSegment[] {
  return segments.map((segment) =>
    segment.type === "text"
      ? { type: "text", text: segment.text }
      : { type: "action", text: segment.text },
  );
}

const EMPTY: AgentRunState = { running: false, segments: [] };

/** Stable scope keys for agent runs tracked in the store. */
export const runKey = {
  ideaAgent: (ideaId: number) => `idea-agent:${ideaId}`,
  reportGen: (ideaId: number) => `report-gen:${ideaId}`,
  home: "home",
};

/** Reactively read the run state for a scope (subscribe in a component). */
export function useAgentRun(key: string): AgentRunState {
  return useWorkspaceStore((state) => state.agentRuns[key]) ?? EMPTY;
}

export function beginRun(key: string) {
  useWorkspaceStore.getState().setAgentRun(key, { running: true, segments: [] });
}

/** Append a streamed text chunk, merging into the trailing text segment. */
export function appendDelta(key: string, text: string) {
  const current = useWorkspaceStore.getState().agentRuns[key]?.segments ?? [];
  const last = current[current.length - 1];
  let next: ChatSegment[];
  if (last && last.type === "text") {
    next = [...current.slice(0, -1), { type: "text", text: last.text + text }];
  } else {
    next = [...current, { type: "text", text }];
  }
  useWorkspaceStore.getState().setAgentRun(key, { segments: next });
}

/** Append an inline tool-action record (starts a fresh text segment after it). */
export function appendAction(key: string, text: string) {
  const current = useWorkspaceStore.getState().agentRuns[key]?.segments ?? [];
  useWorkspaceStore.getState().setAgentRun(key, {
    segments: [...current, { type: "action", text }],
  });
}

/** Snapshot the segments accumulated so far (to persist on the final message). */
export function snapshotRun(key: string): ChatSegment[] {
  return useWorkspaceStore.getState().agentRuns[key]?.segments ?? [];
}

export function endRun(key: string) {
  useWorkspaceStore.getState().setAgentRun(key, { running: false, segments: [] });
}
