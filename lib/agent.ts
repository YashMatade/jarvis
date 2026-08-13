import { ollamaChat, OllamaMessage, OllamaToolCall } from "./ollama";
import { TOOL_DEFINITIONS, executeTool, requiresConfirmation } from "./tools";
import { ProfileCardData } from "./types";

const SYSTEM_PROMPT = `You are Nexus, a helpful local voice assistant running entirely on the user's own machine.
Be concise — your replies may be read aloud by text-to-speech, so avoid markdown, bullet points, or long lists unless the user is clearly asking to read something.
Use tools when they'd genuinely help (current info, running code, files, controlling the computer). Don't narrate that you're "going to use a tool" — just use it.
When the user asks to search, look something up, or find current information online, always call web_search before answering. The resulting search panel is part of the response, so do not answer from memory instead.
When you've researched a specific person, company, or entity and have concrete structured facts (name, role, links), call show_profile_card to present it visually instead of listing everything in speech — keep your spoken reply to a one-sentence summary in that case.
If a tool result comes back empty or with an error, tell the user plainly what happened.`;

export type AgentResult =
  | { status: "done"; messages: OllamaMessage[]; uiCards: ProfileCardData[] }
  | {
      status: "needs_confirmation";
      messages: OllamaMessage[];
      pendingToolCall: { name: string; arguments: Record<string, unknown> };
      uiCards: ProfileCardData[];
    };

function withSystemPrompt(messages: OllamaMessage[]): OllamaMessage[] {
  if (messages.length > 0 && messages[0].role === "system") return messages;
  return [{ role: "system", content: SYSTEM_PROMPT }, ...messages];
}

export async function runAgentLoop(
  messages: OllamaMessage[],
  model: string,
  maxSteps = 6,
): Promise<AgentResult> {
  let working = withSystemPrompt(messages);
  const uiCards: ProfileCardData[] = [];

  for (let step = 0; step < maxSteps; step++) {
    const response = await ollamaChat({
      model,
      messages: working,
      tools: TOOL_DEFINITIONS,
    });

    const assistantMsg = response.message;
    working = [...working, assistantMsg];

    const toolCalls = assistantMsg.tool_calls;
    if (!toolCalls || toolCalls.length === 0) {
      return { status: "done", messages: working, uiCards };
    }

    // Handle tool calls one at a time. If any call needs confirmation,
    // pause the whole loop there — the caller resumes via
    // resolvePendingToolCall once the user approves/denies.
    for (const call of toolCalls) {
      const { name, arguments: rawArgs } = call.function;
      const args = rawArgs || {};

      if (name === "show_profile_card") {
        uiCards.push(args as unknown as ProfileCardData);
        working = [
          ...working,
          { role: "tool", tool_name: name, content: "Card shown to the user." },
        ];
        continue;
      }

      if (requiresConfirmation(name, args)) {
        return {
          status: "needs_confirmation",
          messages: working,
          pendingToolCall: { name, arguments: args },
          uiCards,
        };
      }

      const result = await executeTool(name, args);
      working = [
        ...working,
        { role: "tool", tool_name: name, content: result },
      ];
    }
  }

  working = [
    ...working,
    {
      role: "assistant",
      content:
        "I hit my step limit working on that — could you rephrase or break it into smaller steps?",
    },
  ];
  return { status: "done", messages: working, uiCards };
}

// Called after the user approves/denies a paused tool call. `messages` must
// be the array returned in the `needs_confirmation` result (its last entry
// is the assistant message carrying the pending tool_calls).
export async function resolvePendingToolCall(
  messages: OllamaMessage[],
  approved: boolean,
  model: string,
): Promise<AgentResult> {
  const last = messages[messages.length - 1];
  const call: OllamaToolCall | undefined = last?.tool_calls?.[0];
  if (!call) {
    throw new Error("No pending tool call found in the provided messages.");
  }

  const { name, arguments: args } = call.function;
  const resultContent = approved
    ? await executeTool(name, args || {})
    : "The user denied this action. Do not attempt it again; ask what they'd like instead.";

  const updated: OllamaMessage[] = [
    ...messages,
    { role: "tool", tool_name: name, content: resultContent },
  ];

  return runAgentLoop(updated, model);
}
