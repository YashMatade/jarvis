import { NextRequest, NextResponse } from "next/server";
import { runAgentLoop, resolvePendingToolCall } from "@/lib/agent";
import { pickModel } from "@/lib/ollama";
import { OllamaMessage } from "@/lib/ollama";
import { errMsg } from "@/lib/errors";
import {
  saveConversation,
  loadConversation,
  listConversations,
} from "@/lib/memory";

export const runtime = "nodejs";

// Very rough router: if the latest user message looks code-flavored, use the
// coder model instead of the general agent model. Tune this however you like.
function chooseModel(messages: OllamaMessage[]): string {
  const lastUser = [...messages].reverse().find((m) => m.role === "user");
  const text = (lastUser?.content || "").toLowerCase();
  const codeSignals = [
    "write a function",
    "debug",
    "stack trace",
    "refactor",
    "regex",
    " code",
    "```",
  ];
  if (codeSignals.some((s) => text.includes(s))) return pickModel("code");
  return pickModel("agent");
}

// The agent loop prepends a system prompt (with a fresh memory context) on
// every run. We strip it from what we return/save so the client's history
// stays clean and the memory context is recomputed each turn.
function stripSystem(messages: OllamaMessage[]): OllamaMessage[] {
  return messages.filter((m) => m.role !== "system");
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const messages: OllamaMessage[] = body.messages;
    const resolve: { approved: boolean } | undefined = body.resolveToolCall;
    const conversationId: string =
      body.conversationId || `conv-${Date.now()}`;

    if (!Array.isArray(messages) || messages.length === 0) {
      return NextResponse.json(
        { error: "Expected a non-empty `messages` array." },
        { status: 400 },
      );
    }

    const model = body.model || chooseModel(messages);

    const result = resolve
      ? await resolvePendingToolCall(messages, resolve.approved, model)
      : await runAgentLoop(messages, model);

    const clientMessages = stripSystem(result.messages);

    // Persist the conversation. Non-fatal if storage fails — the assistant
    // still responds, it just won't be remembered.
    try {
      saveConversation(conversationId, clientMessages);
    } catch (err) {
      console.error("Failed to save conversation:", errMsg(err));
    }

    return NextResponse.json({
      ...result,
      messages: clientMessages,
      model,
      conversationId,
    });
  } catch (err) {
    return NextResponse.json(
      { error: errMsg(err) || "Unknown error" },
      { status: 500 },
    );
  }
}

export async function GET(req: NextRequest) {
  try {
    const conversationId = req.nextUrl.searchParams.get("conversationId");
    const list = req.nextUrl.searchParams.get("list");

    if (list === "1") {
      return NextResponse.json({ conversations: listConversations(20) });
    }

    if (conversationId) {
      const stored = loadConversation(conversationId);
      const messages: OllamaMessage[] = stored.map((m) => ({
        role: m.role as OllamaMessage["role"],
        content: m.content,
        ...(m.tool_calls ? { tool_calls: JSON.parse(m.tool_calls) } : {}),
        ...(m.tool_name ? { tool_name: m.tool_name } : {}),
      }));
      return NextResponse.json({ messages, conversationId });
    }

    return NextResponse.json({ conversations: listConversations(20) });
  } catch (err) {
    return NextResponse.json(
      { error: errMsg(err) || "Unknown error" },
      { status: 500 },
    );
  }
}
