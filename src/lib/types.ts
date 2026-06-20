import type { Idea, ProviderSettings } from "../types";

/** Shared props passed to each idea tab. */
export interface TabProps {
  idea: Idea;
  providerSettings: ProviderSettings;
  apiKey: string;
  setNotice: (message: string) => void;
}
