import type { HudCard, HudMessage } from "./Types";

// Domains known to send X-Frame-Options / CSP headers that block iframe
// embedding outright. For these we skip straight to a "launch" card
// instead of showing a permanently blank frame. Not exhaustive — treat
// it as a best-effort allowlist-of-exceptions, not a security boundary.
const FRAME_BLOCKED_DOMAINS = [
  "youtube.com",
  "google.com",
  "facebook.com",
  "instagram.com",
  "twitter.com",
  "x.com",
  "linkedin.com",
  "amazon.com",
  "netflix.com",
  "tiktok.com",
  "reddit.com",
  "github.com",
];

function domainOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

function isFrameBlocked(url: string): boolean {
  const host = domainOf(url);
  return FRAME_BLOCKED_DOMAINS.some(
    (d) => host === d || host.endsWith(`.${d}`),
  );
}

function safeParseJson(content: unknown): unknown {
  if (content == null) return null;
  if (typeof content !== "string") return content; // already an object/array
  try {
    return JSON.parse(content);
  } catch {
    return null;
  }
}

function contentAsString(content: unknown): string {
  if (typeof content === "string") return content;
  try {
    return JSON.stringify(content);
  } catch {
    return String(content);
  }
}

const TOOL_ROLES = new Set(["tool", "function", "tool_result"]);

// Fallback for backends that resolve tools server-side and never expose a
// separate tool-role message to the client — in that case the only signal
// we have is whatever URLs the assistant's own reply mentions.
function extractLinksFromText(text: string): { title: string; url: string }[] {
  const results: { title: string; url: string }[] = [];
  const seen = new Set<string>();

  const mdLinkRe = /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g;
  let match: RegExpExecArray | null;
  while ((match = mdLinkRe.exec(text))) {
    const url = match[2];
    if (!seen.has(url)) {
      results.push({ title: match[1], url });
      seen.add(url);
    }
  }

  const bareUrlRe = /https?:\/\/[^\s)"'<>]+/g;
  while ((match = bareUrlRe.exec(text))) {
    const url = match[0].replace(/[.,;:]+$/, "");
    if (!seen.has(url)) {
      results.push({ title: url, url });
      seen.add(url);
    }
  }

  return results;
}

// Best-effort: pull the arguments the assistant passed to this tool call,
// by looking at the assistant message immediately preceding this tool
// result. Handles both Ollama-style ({ function: { name, arguments } })
// and flatter ({ name, arguments }) tool_call shapes.
function toolArgsFor(
  messages: HudMessage[],
  toolIndex: number,
  toolName: string,
): Record<string, unknown> | undefined {
  for (let i = toolIndex - 1; i >= 0; i--) {
    const m = messages[i];
    if (m.role !== "assistant") continue;
    const calls = m.tool_calls as
      | Array<{
          function?: { name?: string; arguments?: unknown };
          name?: string;
          arguments?: unknown;
        }>
      | undefined;
    if (!calls) return undefined;
    for (const call of calls) {
      const name = call.function?.name ?? call.name;
      if (name === toolName) {
        return (call.function?.arguments ?? call.arguments) as
          | Record<string, unknown>
          | undefined;
      }
    }
    return undefined;
  }
  return undefined;
}

let cardSeq = 0;
function nextId() {
  cardSeq += 1;
  return `hud-${Date.now()}-${cardSeq}`;
}

/**
 * Scans the messages appended since `previousLength` (i.e. everything new
 * in this turn) for tool results, and turns recognizable ones into HUD
 * cards. Anything that doesn't match a known tool pattern still becomes a
 * generic info card, so results are never silently dropped.
 */
export function extractHudCards(
  messages: HudMessage[],
  previousLength: number,
): HudCard[] {
  const cards: HudCard[] = [];
  const newMessages = messages.slice(previousLength);

  if (typeof window !== "undefined") {
    // Temporary diagnostic — remove once card detection is confirmed
    // working against your actual /api/chat response shape.
    // eslint-disable-next-line no-console
    console.debug("[hud] scanning new messages for tool results:", newMessages);
  }

  for (let i = previousLength; i < messages.length; i++) {
    const m = messages[i];
    if (!TOOL_ROLES.has(m.role) || m.content == null) continue;

    const toolName = m.tool_name ?? m.name ?? "";
    const args = toolArgsFor(messages, i, toolName);
    const parsed = safeParseJson(m.content);
    const contentStr = contentAsString(m.content);

    // --- Search-style tool ---
    if (/search/i.test(toolName)) {
      const rawResults = Array.isArray(parsed)
        ? parsed
        : Array.isArray((parsed as { results?: unknown })?.results)
          ? (parsed as { results: unknown[] }).results
          : null;

      if (rawResults) {
        cards.push({
          id: nextId(),
          kind: "search",
          title: (args?.query as string) || "Search results",
          results: rawResults
            .filter(
              (
                r,
              ): r is {
                title?: string;
                url: string;
                snippet?: string;
                description?: string;
              } => !!r && typeof r === "object" && "url" in r,
            )
            .slice(0, 6)
            .map((r) => ({
              title: r.title || r.url,
              url: r.url,
              snippet: r.snippet || r.description,
            })),
        });
        continue;
      }
    }

    // --- Open / navigate-style tool ---
    if (/open|navigate|browse|^url$/i.test(toolName)) {
      const url =
        (typeof parsed === "object" &&
          parsed &&
          (parsed as { url?: string }).url) ||
        (typeof parsed === "string" && /^https?:\/\//.test(parsed) && parsed) ||
        (args?.url as string) ||
        (/^https?:\/\//.test(contentStr.trim()) ? contentStr.trim() : null);

      if (url) {
        cards.push({
          id: nextId(),
          kind: "web",
          title: (args?.title as string) || domainOf(url),
          subtitle: url,
          url,
          blocked: isFrameBlocked(url),
        });
        continue;
      }
    }

    // --- Fallback: show whatever came back so nothing is lost ---
    cards.push({
      id: nextId(),
      kind: "info",
      title: toolName || "Result",
      body: typeof parsed === "string" ? parsed : contentStr.slice(0, 600),
    });
  }

  if (cards.length === 0) {
    const lastAssistant = [...newMessages]
      .reverse()
      .find((m) => m.role === "assistant");
    if (lastAssistant?.content) {
      const text = contentAsString(lastAssistant.content);
      const links = extractLinksFromText(text);

      if (links.length === 1) {
        cards.push({
          id: nextId(),
          kind: "web",
          title: domainOf(links[0].url),
          subtitle: links[0].url,
          url: links[0].url,
          blocked: isFrameBlocked(links[0].url),
        });
      } else if (links.length > 1) {
        cards.push({
          id: nextId(),
          kind: "search",
          title: "Links",
          results: links.slice(0, 6),
        });
      }
    }
  }

  if (typeof window !== "undefined") {
    // eslint-disable-next-line no-console
    console.debug("[hud] extracted cards:", cards);
  }

  return cards;
}
