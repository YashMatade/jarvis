export type HudCardKind = "search" | "web" | "info";

export interface HudSearchResult {
  title: string;
  url: string;
  snippet?: string;
}

export interface HudCard {
  id: string;
  kind: HudCardKind;
  title: string;
  subtitle?: string;
  /** kind: "search" */
  results?: HudSearchResult[];
  /** kind: "web" */
  url?: string;
  /** true when the target site is known to block iframe embedding */
  blocked?: boolean;
  /** kind: "info" */
  body?: string;
}

// Minimal shape of a chat message this module needs to read. Structurally
// compatible with ChatInterface's `Msg`, kept separate to avoid a circular
// import between the two files. `content` and `role` are typed loosely
// because different backends serialize tool results differently (string
// vs. already-parsed JSON, "tool" vs. "function" role, etc.) — the parser
// normalizes these, see extractHudCards.ts.
export interface HudMessage {
  role: string;
  content: unknown;
  tool_name?: string;
  name?: string;
  tool_calls?: unknown[];
}
