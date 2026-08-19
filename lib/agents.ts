// Nexus Agent Foundry — internal worker-agent runtime.
//
// The main Nexus agent (lib/agent.ts) is the central controller. This module
// lets it create, configure, test, store, run, and coordinate internal worker
// agents. Workers are NOT independent services: they run inside Nexus's own
// tool-calling loop (runLoop in lib/agent.ts), each with its own system
// prompt, model, and granted tool subset.

import { OllamaMessage, OllamaTool, pickModel } from "./ollama";
import { runLoop } from "./agent";
import { AgentResult } from "./agent";
import { TOOL_DEFINITIONS } from "./tools";
import { createAgent, getAgent, listAgents, listAgentSummaries } from "./memory";
import { NexusAgent } from "./types";
import { errMsg } from "./errors";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export function slugify(input: string): string {
  return (
    input
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "agent"
  );
}

// An agent's `model` may be an intent key ("agent" | "fast" | "code") or an
// explicit Ollama model name.
function resolveAgentModel(model: string): string {
  // Agent definitions are often generated from natural language, so accept
  // familiar intent aliases instead of treating values like "assistant" as
  // literal Ollama model names.
  switch (model.trim().toLowerCase()) {
    case "":
    case "agent":
    case "assistant":
    case "default":
    case "general":
      return pickModel("agent");
    case "fast":
    case "quick":
      return pickModel("fast");
    case "code":
    case "coder":
    case "coding":
      return pickModel("code");
    default:
      return model;
  }
}

// Filter the global tool schema down to the tools this agent is granted.
function resolveAgentTools(agent: NexusAgent): OllamaTool[] {
  const allowed = new Set(agent.tools);
  // Existing developer agents that were granted write_file can use the safer
  // single-confirmation batch writer without needing to be recreated.
  if (allowed.has("write_file")) allowed.add("write_project_files");
  return TOOL_DEFINITIONS.filter((t) => allowed.has(t.function.name));
}

// ---------------------------------------------------------------------------
// Prompt building
// ---------------------------------------------------------------------------

export function buildAgentSystemPrompt(agent: NexusAgent): string {
  return `You are the ${agent.name} — ${agent.role || agent.purpose}. You are an internal worker agent created by and operating inside Nexus, the user's personal AI assistant. You are NOT a standalone service. You work on the task assigned to you and report your results back to Nexus concisely and accurately.

PURPOSE
${agent.purpose}

ROLE
${agent.role || agent.name}

SYSTEM INSTRUCTIONS
${agent.systemInstructions || agent.purpose}

EXECUTION RULES
${
  agent.executionRules ||
  "Work autonomously within your granted tools. Actions that require user confirmation pause automatically — do not bypass that. Never invent tool results; if a tool fails, say so and try to recover."
}

WORKFLOW
${
  agent.workflow ||
  "1. Understand the assigned task.\n2. Use your granted tools to complete it.\n3. Report the outcome, key decisions, and any next steps in a concise summary."
}

You may ONLY use the tools explicitly granted to you. Never attempt tools that are not listed.
When creating a multi-file project such as a website, prefer write_project_files
over repeated write_file calls. Put every planned file in one batch. File
creation and updates inside the configured Nexus files directory may be
auto-approved by trusted-workspace mode; never assume this permission applies
to deletion, shell commands, package installation, Git actions, or other paths.
When done, give a concise final report: what you did, what the result was, and anything the user should know.`;
}

// ---------------------------------------------------------------------------
// Running agents
// ---------------------------------------------------------------------------

export interface AgentRunContext {
  agentId: string;
  agentName: string;
  task: string;
}

export interface AgentInvocation {
  agent: NexusAgent;
  task: string;
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Deterministically recognize an explicit request to use a saved agent.
 * We deliberately require an action word and a complete agent name or id so
 * ordinary conversation does not accidentally start a worker.
 */
export function findAgentInvocation(text: string): AgentInvocation | null {
  const input = text.trim();
  if (!input) return null;

  const agents = listAgents()
    .filter((agent) => agent.status === "active")
    .sort((a, b) => Math.max(b.name.length, b.id.length) - Math.max(a.name.length, a.id.length));

  for (const agent of agents) {
    for (const alias of [agent.name, agent.id]) {
      const name = escapeRegex(alias.trim());
      if (!name) continue;
      const match = input.match(
        new RegExp(
          `^\\s*(?:use|run|ask|have)\\s+(?:my\\s+|the\\s+)?${name}(?:\\s+agent)?\\s*(?:to\\s+|,\\s*|:\\s*)(.+)$`,
          "i",
        ),
      );
      if (match?.[1]?.trim()) return { agent, task: match[1].trim() };
    }
  }

  return null;
}

/**
 * Run a worker agent on a task. `messages` is optional — when provided (e.g.
 * resuming after a confirmation), the existing worker conversation continues;
 * otherwise a fresh user message carrying the task is used.
 */
export async function runAgent(
  agentId: string,
  task: string,
  messages?: OllamaMessage[],
): Promise<AgentResult> {
  const agent = getAgent(agentId);
  if (!agent) throw new Error(`Agent "${agentId}" not found.`);
  if (agent.status !== "active") {
    throw new Error(
      `Agent "${agent.name}" is ${agent.status}. Use resume_agent before running it.`,
    );
  }

  const tools = resolveAgentTools(agent);
  const model = resolveAgentModel(agent.model);
  const context: AgentRunContext = {
    agentId: agent.id,
    agentName: agent.name,
    task,
  };

  const initialMessages =
    messages && messages.length > 0
      ? messages
      : [{ role: "user" as const, content: task }];

  return runLoop(initialMessages, {
    model,
    tools,
    systemPrompt: buildAgentSystemPrompt(agent),
    maxSteps: 8,
    agentContext: context,
  });
}

/**
 * Resume a worker agent's loop after the user approved/denied a paused
 * confirmation. The messages array already contains the tool result.
 */
export async function resumeAgentLoop(
  agentId: string,
  task: string,
  messages: OllamaMessage[],
): Promise<AgentResult> {
  const agent = getAgent(agentId);
  if (!agent) throw new Error(`Agent "${agentId}" not found.`);

  const tools = resolveAgentTools(agent);
  const model = resolveAgentModel(agent.model);
  const context: AgentRunContext = {
    agentId: agent.id,
    agentName: agent.name,
    task,
  };

  return runLoop(messages, {
    model,
    tools,
    systemPrompt: buildAgentSystemPrompt(agent),
    maxSteps: 8,
    agentContext: context,
  });
}

// ---------------------------------------------------------------------------
// Creating / managing agents (used by the foundry tools)
// ---------------------------------------------------------------------------

export interface CreateAgentInput {
  name: string;
  purpose: string;
  role?: string;
  systemInstructions?: string;
  model?: string;
  tools?: string[];
  memory?: boolean;
  capabilities?: string[];
  executionRules?: string;
  workflow?: string;
}

const DEFAULT_TOOLS = [
  "web_search",
  "list_files",
  "read_file",
  "write_file",
  "run_code",
  "remember_fact",
  "remember_task",
  "recall_memory",
  "list_memories",
];

export function createAgentFromInput(
  input: CreateAgentInput & { id?: string },
): { ok: boolean; agent?: NexusAgent; error?: string } {
  const name = (input.name || "").trim();
  const purpose = (input.purpose || "").trim();
  if (!name || !purpose) {
    return {
      ok: false,
      error: "create_agent needs both a name and a purpose.",
    };
  }

  const id = (input.id || slugify(name)).trim();
  if (getAgent(id)) {
    return {
      ok: false,
      error: `An agent with id "${id}" already exists. Use update_agent to modify it.`,
    };
  }

  const now = new Date().toISOString();
  const agent: NexusAgent = {
    id,
    name,
    purpose,
    role: (input.role || "").trim() || name,
    systemInstructions: (input.systemInstructions || "").trim() || purpose,
    model: (input.model || "agent").trim(),
    tools:
      Array.isArray(input.tools) && input.tools.length > 0
        ? (input.tools as string[])
        : DEFAULT_TOOLS,
    memory: input.memory !== false,
    capabilities: Array.isArray(input.capabilities)
      ? (input.capabilities.map((c) => String(c)) as string[])
      : [purpose],
    executionRules: (input.executionRules || "").trim(),
    workflow: (input.workflow || "").trim(),
    status: "active",
    createdAt: now,
    updatedAt: now,
  };

  try {
    const stored = createAgent(agent);
    return { ok: true, agent: stored };
  } catch (err) {
    return { ok: false, error: `Could not create agent: ${errMsg(err)}` };
  }
}

/**
 * Create a manager agent that can coordinate a team of existing agents by
 * delegating sub-tasks to them via run_agent.
 */
export function createManagerAgent(input: {
  name: string;
  purpose: string;
  memberIds: string[];
}): { ok: boolean; agent?: NexusAgent; error?: string } {
  const name = (input.name || "").trim() || "Manager Agent";
  const memberIds = (input.memberIds || []).filter((id) => getAgent(id));
  if (memberIds.length === 0) {
    return {
      ok: false,
      error:
        "combine_agents needs at least one existing agent id in memberIds.",
    };
  }

  const memberNames = memberIds.map((id) => getAgent(id)!.name).join(", ");

  const systemInstructions =
    `You are a coordination manager for a team of Nexus internal worker agents.\n` +
    `Your team members are: ${memberNames}.\n\n` +
    `To delegate a task to a team member, call run_agent with their agent id and a clear, self-contained task description.\n` +
    `Sequence work appropriately: break the user's goal into steps, assign each step to the right member, gather their results, and present a final consolidated report.\n` +
    `If a delegated step fails, either retry with clearer instructions or reason about an alternative approach.\n` +
    `You do not do the members' work yourself — you delegate and coordinate.`;

  return createAgentFromInput({
    name,
    purpose: input.purpose || `Coordinates the team: ${memberNames}`,
    systemInstructions,
    model: "agent",
    tools: [
      "run_agent",
      "list_agents",
      "inspect_agent",
      "web_search",
      "remember_fact",
      "remember_task",
      "recall_memory",
      "list_memories",
    ],
    capabilities: ["coordination", "delegation"],
    workflow:
      "1. Break the user's goal into sub-tasks. 2. Assign each sub-task to the best team member via run_agent. 3. Collect results, resolve conflicts, and iterate if needed. 4. Report a final consolidated summary.",
  });
}

// ---------------------------------------------------------------------------
// Testing agents
// ---------------------------------------------------------------------------

/**
 * Test an internal worker agent on a sample task without persisting anything.
 * Use when the user wants to try an agent before committing to it.
 */
export async function testAgent(
  agentId: string,
  task: string,
): Promise<AgentResult> {
  const agent = getAgent(agentId);
  if (!agent) throw new Error(`Agent "${agentId}" not found.`);
  if (agent.status !== "active") {
    throw new Error(
      `Agent "${agent.name}" is ${agent.status}. Use resume_agent before running it.`,
    );
  }

  const tools = resolveAgentTools(agent);
  const model = resolveAgentModel(agent.model);
  const context: AgentRunContext = {
    agentId: agent.id,
    agentName: agent.name,
    task,
  };

  const initialMessages = [{ role: "user" as const, content: task }];

  return runLoop(initialMessages, {
    model,
    tools,
    systemPrompt: buildAgentSystemPrompt(agent),
    maxSteps: 8,
    agentContext: context,
  });
}

// ---------------------------------------------------------------------------
// Formatting for tool results / UI
// ---------------------------------------------------------------------------

export function formatAgentList(): string {
  const agents = listAgentSummaries();
  if (agents.length === 0) {
    return "No agents created yet. Ask Nexus to create one (e.g. 'create a developer agent').";
  }
  return (
    `Agents (${agents.length}):\n` +
    agents
      .map(
        (a) =>
          `- ${a.name} [${a.id}] (${a.status}) — ${a.purpose} | tools: ${a.tools.join(", ") || "none"}`,
      )
      .join("\n")
  );
}

export function formatAgentDetail(agent: NexusAgent): string {
  return [
    `Name: ${agent.name}`,
    `ID: ${agent.id}`,
    `Status: ${agent.status}`,
    `Purpose: ${agent.purpose}`,
    `Role: ${agent.role}`,
    `Model: ${agent.model}`,
    `Memory: ${agent.memory ? "enabled" : "disabled"}`,
    `Tools: ${agent.tools.join(", ") || "(none)"}`,
    `Capabilities: ${agent.capabilities.join(", ") || "(none)"}`,
    `Execution rules: ${agent.executionRules || "(defaults)"}`,
    `Workflow: ${agent.workflow || "(defaults)"}`,
    `Created: ${agent.createdAt}`,
    `Updated: ${agent.updatedAt}`,
  ].join("\n");
}
