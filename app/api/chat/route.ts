import { NextRequest, NextResponse } from "next/server";
import { runAgentLoop, resolvePendingToolCall } from "@/lib/agent";
import { pickModel } from "@/lib/ollama";
import { OllamaMessage } from "@/lib/ollama";
import { errMsg } from "@/lib/errors";

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

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const messages: OllamaMessage[] = body.messages;
    const resolve: { approved: boolean } | undefined = body.resolveToolCall;

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

    return NextResponse.json({ ...result, model });
  } catch (err) {
    return NextResponse.json(
      { error: errMsg(err) || "Unknown error" },
      { status: 500 },
    );
  }
}
