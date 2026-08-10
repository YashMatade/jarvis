// Thin client for the local Ollama HTTP API.
// Docs: https://github.com/ollama/ollama/blob/main/docs/api.md

const OLLAMA_HOST = process.env.OLLAMA_HOST || "http://127.0.0.1:11434";

export interface OllamaMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  tool_calls?: OllamaToolCall[];
  tool_name?: string;
}

export interface OllamaToolCall {
  function: {
    name: string;
    arguments: Record<string, unknown>;
  };
}

export interface OllamaTool {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: {
      type: "object";
      properties: Record<string, unknown>;
      required?: string[];
    };
  };
}

export interface OllamaChatResponse {
  model: string;
  message: OllamaMessage;
  done: boolean;
}

export async function ollamaChat(params: {
  model: string;
  messages: OllamaMessage[];
  tools?: OllamaTool[];
  stream?: false;
}): Promise<OllamaChatResponse> {
  const res = await fetch(`${OLLAMA_HOST}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: params.model,
      messages: params.messages,
      tools: params.tools,
      stream: false,
    }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(
      `Ollama request failed (${res.status}): ${text || res.statusText}. Is "ollama serve" running and is the model pulled?`,
    );
  }

  return res.json();
}

// Simple routing helper: pick a model based on the task, since different
// local models on this machine are good at different things.
export function pickModel(intent: "agent" | "fast" | "code"): string {
  switch (intent) {
    case "fast":
      return process.env.OLLAMA_FAST_MODEL || "qwen3.5:0.8b";
    case "code":
      return process.env.OLLAMA_CODE_MODEL || "qwen2.5-coder:1.5b";
    case "agent":
    default:
      return process.env.OLLAMA_AGENT_MODEL || "qwen3:8b";
  }
}
