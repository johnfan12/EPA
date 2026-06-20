export type IdeaStatus = "active" | "paused" | "archived";

export interface Idea {
  id: number;
  title: string;
  researchArea: string;
  status: string;
  tags: string;
  brief: string;
  createdAt: string;
  updatedAt: string;
}

export interface IdeaEntry {
  id: number;
  ideaId: number;
  kind: string;
  title: string;
  content: string;
  summary: string;
  source: string;
  createdAt: string;
}

export interface AgentRun {
  id: number;
  ideaId: number;
  targetAgent: string;
  taskType: string;
  prompt: string;
  output: string;
  summary: string;
  status: string;
  createdAt: string;
}

export interface Experiment {
  id: number;
  ideaId: number;
  name: string;
  dataset: string;
  method: string;
  config: string;
  rawOutput: string;
  metricsJson: string;
  conclusion: string;
  createdAt: string;
}

export interface Report {
  id: number;
  ideaId: number;
  title: string;
  content: string;
  createdAt: string;
  updatedAt: string;
}

export interface SearchHit {
  entityType: string;
  entityId: number;
  ideaId: number;
  title: string;
  snippet: string;
}

export interface ProviderSettings {
  provider: string;
  model: string;
  apiEndpoint?: string;
}

export interface PromptResponse {
  prompt: string;
}

export interface GenerationResponse {
  mode: "prompt" | "api";
  prompt: string;
  content: string | null;
}

export interface CreateIdeaPayload {
  title: string;
  researchArea?: string;
  tags?: string;
}

export interface CreateEntryPayload {
  ideaId: number;
  kind: string;
  title: string;
  content: string;
  summary?: string;
  source?: string;
}

export interface CreateAgentRunPayload {
  ideaId: number;
  targetAgent: string;
  taskType: string;
  prompt: string;
  output?: string;
  summary?: string;
  status?: string;
}

export interface CreateExperimentPayload {
  ideaId: number;
  name: string;
  dataset?: string;
  method?: string;
  config?: string;
  rawOutput?: string;
  metricsJson?: string;
  conclusion?: string;
}

