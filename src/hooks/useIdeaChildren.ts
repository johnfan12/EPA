import { useQuery } from "@tanstack/react-query";
import { api } from "../api";

/** Loads the four record collections that belong to an idea (for the right rail). */
export function useIdeaChildren(ideaId: number | null) {
  const enabled = ideaId != null;
  const entries = useQuery({
    queryKey: ["entries", ideaId],
    queryFn: () => api.listEntries(ideaId as number),
    enabled,
  });
  const agentRuns = useQuery({
    queryKey: ["agent-runs", ideaId],
    queryFn: () => api.listAgentRuns(ideaId as number),
    enabled,
  });
  const experiments = useQuery({
    queryKey: ["experiments", ideaId],
    queryFn: () => api.listExperiments(ideaId as number),
    enabled,
  });
  const reports = useQuery({
    queryKey: ["reports", ideaId],
    queryFn: () => api.listReports(ideaId as number),
    enabled,
  });

  return {
    entries: entries.data ?? [],
    agentRuns: agentRuns.data ?? [],
    experiments: experiments.data ?? [],
    reports: reports.data ?? [],
  };
}
