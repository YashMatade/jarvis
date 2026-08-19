export interface ProfileCardLink {
  label: string;
  url: string;
}

export interface ProfileCardField {
  label: string;
  value: string;
}

// In your types file
export interface ProfileCardData {
  name: string;
  subtitle?: string;
  summary?: string;
  image?: string; // URL to the profile image
  status?: string; // Optional status indicator
  fields?: Array<{
    label: string;
    value: string;
  }>;
  links?: Array<{
    label: string;
    url: string;
  }>;
}

// ---------------------------------------------------------------------------
// Nexus Agent Foundry
// ---------------------------------------------------------------------------

// A persistent, user-created internal worker agent. Nexus (the central
// controller) creates, configures, tests, stores, and runs these agents.
// They are NOT independent services — they run inside Nexus's own loop.
export interface NexusAgent {
  id: string; // slug, e.g. "developer-agent"
  name: string; // "Developer Agent"
  purpose: string; // one-line intent
  role: string; // "Builds React/Next.js applications"
  systemInstructions: string; // the worker's system prompt body
  model: string; // resolved model name (or intent key)
  tools: string[]; // subset of tool names it may call
  memory: boolean; // inject persistent memory context?
  capabilities: string[]; // ["coding", "files", "terminal", ...]
  executionRules: string; // safety / behavior rules
  workflow: string; // how it sequences work
  status: "active" | "paused" | "archived";
  createdAt: string;
  updatedAt: string;
}

// A lightweight summary used for listing agents in the UI / tool results.
export interface NexusAgentSummary {
  id: string;
  name: string;
  purpose: string;
  status: NexusAgent["status"];
  tools: string[];
  capabilities: string[];
  updatedAt: string;
}
