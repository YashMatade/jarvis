import { OllamaTool } from "./ollama";
import { errMsg } from "./errors";
import { exec as execCb } from "child_process";
import { promisify } from "util";
import fs from "fs/promises";
import path from "path";
import os from "os";
import {
  rememberFact,
  saveEpisode,
  recallFacts,
  recallEpisodes,
  listFacts,
  forgetFact,
  addReminder,
  listPendingReminders,
  cancelReminder,
} from "./memory";
import { getSystemHealth } from "./system";
import {
  createCalendarEvent,
  getCalendarEvents,
  createAppleReminder,
  getAppleReminders,
  controlMusic,
  readNotifications,
  setDarkMode,
  getVolume,
  setVolume,
} from "./macos";
import { researchTask, devopsTask, writeReport, formatTaskPlan } from "./tasks";
import {
  createAgentFromInput,
  createManagerAgent,
  runAgent,
  testAgent,
} from "./agents";
import {
  getAgent,
  listAgentSummaries,
  setAgentStatus,
  updateAgent,
  deleteAgent,
} from "./memory";

const exec = promisify(execCb);

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

// Everything the "files" tool touches is jailed to this directory.
// Change via .env.local: NEXUS_FILES_DIR=/absolute/path
const FILES_ROOT = path.resolve(
  /*turbopackIgnore: true*/
  process.env.NEXUS_FILES_DIR || path.join(os.homedir(), "nexus-files"),
);

// Opt-in convenience mode for trusted generated projects. It applies only to
// create/update operations that are already jailed to FILES_ROOT; destructive
// actions and code execution always remain confirmation-gated.
const AUTO_APPROVE_FILE_WRITES =
  process.env.NEXUS_AUTO_APPROVE_FILE_WRITES === "true";

// Hosted web search via Tavily (https://tavily.com) — built for LLM agent
// tool calls, free tier is 1,000 searches/month, no card required.
// Get a key at https://app.tavily.com and put it in .env.local as
// TAVILY_API_KEY=tvly-xxxxxxxx
const TAVILY_API_KEY = process.env.TAVILY_API_KEY || "";

interface TavilyResult {
  title: string;
  url: string;
  content?: string;
}

// Tools in this set never execute immediately. The agent loop pauses and
// asks the UI for explicit user approval first. Add/remove names here to
// change what's considered "dangerous" on your machine.
export const CONFIRMATION_REQUIRED = new Set([
  "run_code",
  "write_file",
  "write_project_files",
  "delete_file",
  "create_calendar_event",
  "create_apple_reminder",
  "set_appearance",
  "system_volume",
  "write_report",
]);

// Browser links and desktop app launches are explicit user-facing requests,
// so both can happen immediately when the assistant invokes this tool.
// Some task agents are read-only, but mutating dev workflows (commit and
// install) and anything writing to disk pause for approval first.
export function requiresConfirmation(
  name: string,
  args: Record<string, unknown>,
): boolean {
  if (
    AUTO_APPROVE_FILE_WRITES &&
    (name === "write_file" || name === "write_project_files")
  ) {
    return false;
  }
  if (CONFIRMATION_REQUIRED.has(name)) return true;
  if (name === "devops_task") {
    const action = String(args.action || "").toLowerCase();
    if (action === "commit" || action === "install") return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// Tool schema (sent to Ollama so the model knows what it can call)
// ---------------------------------------------------------------------------

export const TOOL_DEFINITIONS: OllamaTool[] = [
  {
    type: "function",
    function: {
      name: "web_search",
      description:
        "Search the web for current information via Tavily. Use for anything you're not sure about or that may be recent.",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "The search query" },
        },
        required: ["query"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "movie_search",
      description:
        "Find currently playing movies, nearby cinemas, and showtimes for a location. Use this when the user asks about movies, cinemas, showtimes, or booking movie tickets. This only discovers options; never purchase tickets or open checkout unless the user explicitly selects a provider link.",
      parameters: {
        type: "object",
        properties: {
          location: {
            type: "string",
            description:
              "City, neighbourhood, or user-authorized latitude/longitude to search near",
          },
          date: {
            type: "string",
            description: "Requested date, if the user gave one",
          },
        },
        required: ["location"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "run_code",
      description:
        "Execute a short shell command or script on the user's machine and return stdout/stderr. Requires explicit user confirmation before it runs. Use for calculations, quick scripts, checking system state, etc.",
      parameters: {
        type: "object",
        properties: {
          language: {
            type: "string",
            enum: ["bash", "python", "node"],
            description: "Which interpreter to run the code with",
          },
          code: { type: "string", description: "The code to execute" },
        },
        required: ["language", "code"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "read_file",
      description: `Read a text file. Only files inside ${FILES_ROOT} are accessible.`,
      parameters: {
        type: "object",
        properties: {
          filename: {
            type: "string",
            description: "Path relative to the nexus-files directory",
          },
        },
        required: ["filename"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "write_file",
      description: `Write/overwrite a text file. Only files inside ${FILES_ROOT} are accessible. Requires user confirmation.`,
      parameters: {
        type: "object",
        properties: {
          filename: {
            type: "string",
            description: "Path relative to the nexus-files directory",
          },
          content: { type: "string", description: "Content to write" },
        },
        required: ["filename", "content"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "write_project_files",
      description:
        `Create or update all files for one project in a single batch. Every file is confined to one project folder inside the Nexus files directory. Use this instead of repeated write_file calls when building a website or other multi-file project.${AUTO_APPROVE_FILE_WRITES ? " Trusted workspace mode is enabled, so these jailed file writes execute automatically." : " Requires one user confirmation for the entire listed batch."}`,
      parameters: {
        type: "object",
        properties: {
          project: {
            type: "string",
            description:
              "Project folder relative to the Nexus files directory, e.g. 'portfolio'",
          },
          files: {
            type: "array",
            description:
              "Files to create within the project folder. Include every filename and its complete content.",
            items: {
              type: "object",
              properties: {
                filename: {
                  type: "string",
                  description:
                    "Relative filename inside the project, e.g. 'index.html' or 'assets/app.js'",
                },
                content: { type: "string" },
              },
              required: ["filename", "content"],
            },
          },
        },
        required: ["project", "files"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "list_files",
      description: `List files inside ${FILES_ROOT}.`,
      parameters: {
        type: "object",
        properties: {
          subdirectory: {
            type: "string",
            description: "Optional subdirectory to list, relative to root",
          },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "delete_file",
      description: `Delete a file inside ${FILES_ROOT}. Requires user confirmation.`,
      parameters: {
        type: "object",
        properties: {
          filename: {
            type: "string",
            description: "Path relative to the nexus-files directory",
          },
        },
        required: ["filename"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "control_computer",
      description:
        "Open an application, or open a URL in the user's default web browser. These direct user-facing actions happen immediately. Platform-specific: uses `open`/osascript on macOS, PowerShell on Windows, xdg-open on Linux.",
      parameters: {
        type: "object",
        properties: {
          action: {
            type: "string",
            enum: ["open_app", "open_application", "open_url"],
            description: "What kind of action to perform",
          },
          target: {
            type: "string",
            description:
              "App name (e.g. 'Spotify', 'Calculator') or URL to open",
          },
        },
        required: ["action", "target"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "show_profile_card",
      description:
        "Present a structured info card in the UI for a specific person, company, or entity you just researched (e.g. via web_search). Use this whenever you have name + a few concrete facts/links to show, instead of dumping everything into your spoken reply — keep your accompanying text reply short since it will be read aloud, and let the card carry the details.",
      parameters: {
        type: "object",
        properties: {
          name: { type: "string", description: "The person/entity's name" },
          subtitle: {
            type: "string",
            description:
              "Short role/title/description, e.g. 'Full-Stack Developer'",
          },
          summary: {
            type: "string",
            description: "1-2 sentence overview",
          },
          fields: {
            type: "array",
            description:
              "Key facts as label/value pairs, e.g. {label: 'Experience', value: '4+ years'}",
            items: {
              type: "object",
              properties: {
                label: { type: "string" },
                value: { type: "string" },
              },
              required: ["label", "value"],
            },
          },
          links: {
            type: "array",
            description:
              "Relevant links, e.g. {label: 'GitHub', url: 'https://github.com/...'}",
            items: {
              type: "object",
              properties: {
                label: { type: "string" },
                url: { type: "string" },
              },
              required: ["label", "url"],
            },
          },
        },
        required: ["name"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "remember_fact",
      description:
        "Store a stable fact about the user in long-term memory (e.g. 'the user's birthday is March 3rd', 'the user prefers dark mode', 'the user works on a project called jarvis'). Call this whenever the user shares personal information, preferences, or details worth remembering across sessions. This is safe and immediate.",
      parameters: {
        type: "object",
        properties: {
          fact: {
            type: "string",
            description:
              "The fact to remember, phrased as a complete statement",
          },
          category: {
            type: "string",
            description:
              "Optional category, e.g. personal, preference, project, work",
          },
        },
        required: ["fact"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "remember_task",
      description:
        "Record a significant task, decision, or event in long-term memory (e.g. 'deployed the app to production on June 1st', 'user decided to use SQLite for memory'). Call this after completing a meaningful task or when the user makes an important decision worth recalling later.",
      parameters: {
        type: "object",
        properties: {
          summary: {
            type: "string",
            description: "One-line summary of the task or decision",
          },
          details: {
            type: "string",
            description: "Optional additional context or details",
          },
        },
        required: ["summary"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "recall_memory",
      description:
        "Search long-term memory for facts about the user and past tasks/decisions relevant to the current request. Use this when you need context you may have learned in a previous session, or when the user references something from the past.",
      parameters: {
        type: "object",
        properties: {
          query: {
            type: "string",
            description: "What to search memory for",
          },
        },
        required: ["query"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "list_memories",
      description:
        "List all facts currently stored in long-term memory. Use this when the user asks what you remember about them.",
      parameters: {
        type: "object",
        properties: {},
      },
    },
  },
  {
    type: "function",
    function: {
      name: "forget_memory",
      description:
        "Delete a specific fact from long-term memory by its id. Use this when the user asks you to forget something.",
      parameters: {
        type: "object",
        properties: {
          id: {
            type: "number",
            description: "The id of the fact to delete",
          },
        },
        required: ["id"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "set_reminder",
      description:
        "Set a reminder that Nexus will fire at the specified time and speak aloud. Use for scheduling future tasks, appointments, or notifications. The time is relative to now unless an ISO date is given.",
      parameters: {
        type: "object",
        properties: {
          message: {
            type: "string",
            description: "The reminder message text",
          },
          delay_minutes: {
            type: "number",
            description:
              "How many minutes from now to fire the reminder. Combine with seconds for finer control.",
          },
          seconds: {
            type: "number",
            description:
              "Additional seconds from now (used with delay_minutes)",
          },
          repeat_minutes: {
            type: "number",
            description:
              "Optional: repeat every N minutes after the first firing",
          },
        },
        required: ["message"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "list_reminders",
      description: "List all pending reminders that haven't fired yet.",
      parameters: {
        type: "object",
        properties: {},
      },
    },
  },
  {
    type: "function",
    function: {
      name: "cancel_reminder",
      description: "Cancel a pending reminder by its id.",
      parameters: {
        type: "object",
        properties: {
          id: {
            type: "number",
            description: "The id of the reminder to cancel",
          },
        },
        required: ["id"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "system_status",
      description:
        "Check the current system health (CPU, memory, disk, battery) on the user's machine.",
      parameters: {
        type: "object",
        properties: {},
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_calendar_events",
      description:
        "Read the user's calendar events for today (or the next N days). Use for 'what's on my calendar', 'when is my meeting', or to prepare a greeting with real context.",
      parameters: {
        type: "object",
        properties: {
          days: {
            type: "number",
            description: "How many days forward to look (default 1 = today)",
          },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "create_calendar_event",
      description:
        "Create a calendar event on macOS Calendar. Requires user confirmation before it runs.",
      parameters: {
        type: "object",
        properties: {
          title: { type: "string", description: "Event title" },
          startDate: {
            type: "string",
            description: "ISO start date, e.g. 2026-08-20T15:00:00",
          },
          endDate: {
            type: "string",
            description: "Optional ISO end date",
          },
          location: { type: "string", description: "Optional location" },
          calendar: {
            type: "string",
            description: "Calendar name (default 'Calendar')",
          },
        },
        required: ["title", "startDate"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "create_apple_reminder",
      description:
        "Add a reminder to Apple's Reminders app. Requires user confirmation before it runs.",
      parameters: {
        type: "object",
        properties: {
          title: { type: "string", description: "Reminder text" },
          dueDate: { type: "string", description: "Optional ISO due date" },
          list: {
            type: "string",
            description: "Reminders list name (default 'Reminders')",
          },
        },
        required: ["title"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_apple_reminders",
      description: "List pending items in Apple's Reminders app.",
      parameters: {
        type: "object",
        properties: {},
      },
    },
  },
  {
    type: "function",
    function: {
      name: "control_music",
      description:
        "Control the Apple Music app: play, pause, next/previous track, play a playlist, or report currently playing.",
      parameters: {
        type: "object",
        properties: {
          action: {
            type: "string",
            enum: [
              "play",
              "pause",
              "next",
              "previous",
              "playlist",
              "currently_playing",
            ],
            description: "What to do",
          },
          target: {
            type: "string",
            description:
              "Playlist name for 'playlist', or empty for other actions",
          },
        },
        required: ["action"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "read_notifications",
      description: "Read recent items from the macOS Notification Center.",
      parameters: {
        type: "object",
        properties: {},
      },
    },
  },
  {
    type: "function",
    function: {
      name: "set_appearance",
      description:
        "Toggle macOS dark/light appearance. Requires confirmation before it runs.",
      parameters: {
        type: "object",
        properties: {
          dark: {
            type: "boolean",
            description: "true for dark mode, false for light mode",
          },
        },
        required: ["dark"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "system_volume",
      description:
        "Get or set the system volume. Requires confirmation to change.",
      parameters: {
        type: "object",
        properties: {
          action: {
            type: "string",
            enum: ["get", "set"],
            description: "get current volume, or set it",
          },
          level: {
            type: "number",
            description: "Volume 0-100 (needed when action is 'set')",
          },
        },
        required: ["action"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "research_task",
      description:
        "Run a multi-angle research agent: it runs several web searches in parallel around a topic and synthesizes a structured report. Use this instead of a single web_search when the user wants a thorough investigation or comparison ('research the best project management tools for a small team'). Requires TAVILY_API_KEY.",
      parameters: {
        type: "object",
        properties: {
          topic: {
            type: "string",
            description: "The topic to research",
          },
          depth: {
            type: "number",
            description:
              "How many search angles to run (1-4, default 1). Higher = more thorough but slower",
          },
        },
        required: ["topic"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "devops_task",
      description:
        "Run a development workflow in the user's project directory. Valid actions: status, diff, test, build, lint, install, commit (requires confirmation), log. Use for 'check git status', 'run the tests', 'build the project', 'lint the code', or 'commit changes'.",
      parameters: {
        type: "object",
        properties: {
          action: {
            type: "string",
            enum: [
              "status",
              "diff",
              "test",
              "build",
              "lint",
              "install",
              "commit",
              "log",
            ],
            description: "Which dev workflow to run",
          },
          message: {
            type: "string",
            description: "Commit message (required when action is 'commit')",
          },
        },
        required: ["action"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "write_report",
      description:
        "Write a markdown/text report into the user's nexus-files directory (jailed, same as write_file). Use this to save research findings, meeting notes, or any structured output to disk. Requires confirmation before it runs.",
      parameters: {
        type: "object",
        properties: {
          filename: {
            type: "string",
            description:
              "Relative path inside nexus-files, e.g. 'notes/meeting.md'",
          },
          content: {
            type: "string",
            description: "The full report content",
          },
        },
        required: ["filename", "content"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "format_task_plan",
      description:
        "Describe a complex task as a numbered list of steps. Use when the user asks for a plan ('how should I approach X', 'give me a step-by-step plan'). The plan is returned to the user and also stored in long-term memory as a task episode so it can be recalled later.",
      parameters: {
        type: "object",
        properties: {
          steps: {
            type: "array",
            description: "The ordered steps of the plan",
            items: { type: "string" },
          },
        },
        required: ["steps"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "create_agent",
      description:
        "Create a new internal worker agent in the Nexus Agent Foundry. Use this when the user asks you to create an agent ('create a developer agent that can build websites'). The agent is persisted and can be run later with run_agent.",
      parameters: {
        type: "object",
        properties: {
          name: {
            type: "string",
            description: "Human-readable agent name, e.g. 'Developer Agent'",
          },
          purpose: {
            type: "string",
            description: "One-line description of what the agent does",
          },
          role: {
            type: "string",
            description:
              "The agent's role, e.g. 'Builds React/Next.js applications'",
          },
          systemInstructions: {
            type: "string",
            description: "Detailed system prompt body for the agent",
          },
          model: {
            type: "string",
            description:
              "Model intent: 'agent', 'fast', 'code', or an explicit Ollama model name",
          },
          tools: {
            type: "array",
            items: { type: "string" },
            description:
              "Tool names this agent may call (e.g. ['web_search', 'run_code', 'write_file'])",
          },
          memory: {
            type: "boolean",
            description:
              "Whether to inject persistent memory context (default true)",
          },
          capabilities: {
            type: "array",
            items: { type: "string" },
            description: "Free-form capability tags",
          },
          executionRules: {
            type: "string",
            description: "Safety / behavior rules for the agent",
          },
          workflow: {
            type: "string",
            description: "How the agent sequences its work",
          },
        },
        required: ["name", "purpose"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "list_agents",
      description:
        "List all internal worker agents in the Nexus Agent Foundry with their status, purpose, and granted tools. Use when the user asks what agents exist.",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function",
    function: {
      name: "inspect_agent",
      description:
        "Show the full definition of a single internal worker agent, including its system instructions, model, tools, capabilities, execution rules, and workflow.",
      parameters: {
        type: "object",
        properties: { id: { type: "string", description: "The agent id" } },
        required: ["id"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "run_agent",
      description:
        "Run an internal worker agent on a task. The agent executes inside Nexus's own loop with its granted tools and returns a report. Use when the user asks an agent to do something ('developer agent, build me a portfolio website').",
      parameters: {
        type: "object",
        properties: {
          id: { type: "string", description: "The agent id to run" },
          task: { type: "string", description: "The task to give the agent" },
        },
        required: ["id", "task"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "test_agent",
      description:
        "Test an internal worker agent on a sample task without persisting anything. Use when the user wants to try an agent before committing to it.",
      parameters: {
        type: "object",
        properties: {
          id: { type: "string", description: "The agent id to test" },
          task: { type: "string", description: "The sample task" },
        },
        required: ["id", "task"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "update_agent",
      description:
        "Update an existing internal worker agent's definition (name, purpose, role, instructions, model, tools, memory, capabilities, execution rules, workflow, status).",
      parameters: {
        type: "object",
        properties: {
          id: { type: "string", description: "The agent id to update" },
          name: { type: "string" },
          purpose: { type: "string" },
          role: { type: "string" },
          systemInstructions: { type: "string" },
          model: { type: "string" },
          tools: { type: "array", items: { type: "string" } },
          memory: { type: "boolean" },
          capabilities: { type: "array", items: { type: "string" } },
          executionRules: { type: "string" },
          workflow: { type: "string" },
        },
        required: ["id"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "delete_agent",
      description:
        "Permanently delete an internal worker agent from the Nexus Agent Foundry.",
      parameters: {
        type: "object",
        properties: {
          id: { type: "string", description: "The agent id to delete" },
        },
        required: ["id"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "pause_agent",
      description:
        "Pause an internal worker agent so it cannot be run until resumed. Use when the user wants to disable an agent without deleting it.",
      parameters: {
        type: "object",
        properties: {
          id: { type: "string", description: "The agent id to pause" },
        },
        required: ["id"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "resume_agent",
      description:
        "Resume a paused internal worker agent so it can be run again.",
      parameters: {
        type: "object",
        properties: {
          id: { type: "string", description: "The agent id to resume" },
        },
        required: ["id"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "combine_agents",
      description:
        "Create a manager agent that coordinates a team of existing internal worker agents. The manager delegates sub-tasks to its team members via run_agent and consolidates the results. Use when the user wants to combine agents or build a team ('create a manager agent for my developer, QA, and DevOps agents').",
      parameters: {
        type: "object",
        properties: {
          name: { type: "string", description: "Name for the manager agent" },
          purpose: {
            type: "string",
            description: "What the manager coordinates",
          },
          memberIds: {
            type: "array",
            items: { type: "string" },
            description: "Agent ids of the team members to coordinate",
          },
        },
        required: ["memberIds"],
      },
    },
  },
];

// ---------------------------------------------------------------------------
// Execution
// ---------------------------------------------------------------------------

function resolveInRoot(filename: string): string {
  const resolved = path.resolve(FILES_ROOT, filename);
  if (!resolved.startsWith(FILES_ROOT)) {
    throw new Error("Path escapes the allowed nexus-files directory.");
  }
  return resolved;
}

async function ensureRoot() {
  await fs.mkdir(FILES_ROOT, { recursive: true });
}

function optionalString(v: unknown): string | undefined {
  return v ? String(v) : undefined;
}

interface ProjectFileInput {
  filename?: unknown;
  content?: unknown;
}

function resolveInProject(projectRoot: string, filename: string): string {
  const resolved = path.resolve(projectRoot, filename);
  if (resolved !== projectRoot && !resolved.startsWith(`${projectRoot}${path.sep}`)) {
    throw new Error("Project file path escapes the approved project folder.");
  }
  return resolved;
}

export async function executeTool(
  name: string,
  args: Record<string, unknown>,
): Promise<string> {
  switch (name) {
    case "web_search": {
      const query = String(args.query || "");
      if (!TAVILY_API_KEY) {
        return "Web search unavailable: no TAVILY_API_KEY set. Get a free key at https://app.tavily.com and add it to .env.local, then restart the dev server.";
      }
      try {
        const res = await fetch("https://api.tavily.com/search", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            api_key: TAVILY_API_KEY,
            query,
            max_results: 5,
          }),
        });
        if (!res.ok) {
          const body = await res.text().catch(() => "");
          throw new Error(
            `Tavily returned ${res.status}: ${body || res.statusText}`,
          );
        }
        const data: { results?: TavilyResult[]; answer?: string } =
          await res.json();
        // Keep the tool response structured. Besides giving the model cleaner
        // context, this is the payload the client uses to render its search
        // popup. The prior bullet-list format discarded the result boundaries,
        // so the UI could only render a generic text panel.
        return JSON.stringify({
          query,
          answer: data.answer,
          results: (data.results || []).map((result) => ({
            title: result.title,
            url: result.url,
            snippet: result.content || "",
          })),
        });
      } catch (err) {
        return `Web search failed: ${errMsg(err)}`;
      }
    }

    case "movie_search": {
      const location = String(args.location || "").trim();
      const date = String(args.date || "today").trim();
      if (!location) return "Movie search needs a city or location.";
      if (!TAVILY_API_KEY) {
        return "Movie search unavailable: no TAVILY_API_KEY set. Get a free key at https://app.tavily.com and add it to .env.local, then restart the dev server.";
      }
      try {
        const query = `movies currently playing, cinema showtimes, and ticket booking near ${location} for ${date}`;
        const res = await fetch("https://api.tavily.com/search", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            api_key: TAVILY_API_KEY,
            query,
            max_results: 8,
          }),
        });
        if (!res.ok) {
          const body = await res.text().catch(() => "");
          throw new Error(
            `Tavily returned ${res.status}: ${body || res.statusText}`,
          );
        }
        const data: { results?: TavilyResult[]; answer?: string } =
          await res.json();
        return JSON.stringify({
          query,
          answer: data.answer,
          results: (data.results || []).map((result) => ({
            title: result.title,
            url: result.url,
            snippet: result.content || "",
          })),
        });
      } catch (err) {
        return `Movie search failed: ${errMsg(err)}`;
      }
    }

    case "run_code": {
      const language = String(args.language || "bash");
      const code = String(args.code || "");
      const cmdMap: Record<string, string> = {
        bash: `bash -c ${JSON.stringify(code)}`,
        python: `python3 -c ${JSON.stringify(code)}`,
        node: `node -e ${JSON.stringify(code)}`,
      };
      const cmd = cmdMap[language] || cmdMap.bash;
      try {
        const { stdout, stderr } = await exec(cmd, {
          timeout: 15_000,
          maxBuffer: 1024 * 1024,
        });
        return stdout || stderr || "(no output)";
      } catch (err) {
        return `Execution error: ${errMsg(err)}`;
      }
    }

    case "read_file": {
      await ensureRoot();
      const filePath = resolveInRoot(String(args.filename));
      try {
        return await fs.readFile(filePath, "utf-8");
      } catch (err) {
        return `Could not read file: ${errMsg(err)}`;
      }
    }

    case "write_file": {
      await ensureRoot();
      const filePath = resolveInRoot(String(args.filename));
      await fs.mkdir(path.dirname(filePath), { recursive: true });
      await fs.writeFile(filePath, String(args.content ?? ""), "utf-8");
      return `Wrote ${filePath}`;
    }

    case "write_project_files": {
      const project = String(args.project || "").trim();
      const rawFiles = Array.isArray(args.files)
        ? (args.files as ProjectFileInput[])
        : [];
      if (!project) return "write_project_files needs a project folder.";
      if (rawFiles.length === 0 || rawFiles.length > 30) {
        return "write_project_files needs between 1 and 30 files.";
      }

      await ensureRoot();
      const projectRoot = resolveInRoot(project);
      const files = rawFiles.map((file) => {
        const filename = String(file.filename || "").trim();
        const content = String(file.content ?? "");
        if (!filename) throw new Error("Each project file needs a filename.");
        if (content.length > 1_000_000) {
          throw new Error(`Project file "${filename}" exceeds the 1 MB limit.`);
        }
        return { filename, content, path: resolveInProject(projectRoot, filename) };
      });

      await Promise.all(files.map((file) => fs.mkdir(path.dirname(file.path), { recursive: true })));
      await Promise.all(files.map((file) => fs.writeFile(file.path, file.content, "utf-8")));
      return `Created ${files.length} file(s) in ${projectRoot}: ${files.map((file) => file.filename).join(", ")}`;
    }

    case "list_files": {
      await ensureRoot();
      const dir = resolveInRoot(String(args.subdirectory || "."));
      try {
        const entries = await fs.readdir(dir, { withFileTypes: true });
        return (
          entries
            .map((e) => (e.isDirectory() ? `${e.name}/` : e.name))
            .join("\n") || "(empty)"
        );
      } catch (err) {
        return `Could not list directory: ${errMsg(err)}`;
      }
    }

    case "delete_file": {
      await ensureRoot();
      const filePath = resolveInRoot(String(args.filename));
      try {
        await fs.unlink(filePath);
        return `Deleted ${filePath}`;
      } catch (err) {
        return `Could not delete file: ${errMsg(err)}`;
      }
    }

    case "control_computer": {
      const action = String(args.action);
      const target = String(args.target);
      const platform = os.platform();
      try {
        if (action === "open_url") {
          const opener =
            platform === "darwin"
              ? "open"
              : platform === "win32"
                ? "start"
                : "xdg-open";
          await exec(`${opener} ${JSON.stringify(target)}`);
          return `Opened URL: ${target}`;
        }
        if (action === "open_app" || action === "open_application") {
          if (platform === "darwin") {
            await exec(`open -a ${JSON.stringify(target)}`);
          } else if (platform === "win32") {
            await exec(
              `powershell -Command "Start-Process ${JSON.stringify(target)}"`,
            );
          } else {
            await exec(`${JSON.stringify(target.toLowerCase())} &`);
          }
          return `Launched: ${target}`;
        }
        return `Unknown action: ${action}`;
      } catch (err) {
        return `Control action failed: ${errMsg(err)}`;
      }
    }

    case "show_profile_card": {
      // Structured data is captured by the agent loop before reaching this
      // dispatcher (see lib/agent.ts) so it can be threaded back to the UI.
      // This branch only runs if the tool is invoked outside that loop.
      return "Card shown to the user.";
    }

    case "remember_fact": {
      const fact = String(args.fact || "").trim();
      if (!fact) return "remember_fact needs a fact to store.";
      const category = String(args.category || "general").trim();
      const stored = rememberFact(fact, category);
      return `Remembered: "${stored.fact}" (id ${stored.id}, category ${stored.category})`;
    }

    case "remember_task": {
      const summary = String(args.summary || "").trim();
      if (!summary) return "remember_task needs a summary.";
      const details = String(args.details || "").trim();
      const episode = saveEpisode(summary, details);
      return `Recorded task/decision: "${episode.summary}" (id ${episode.id})`;
    }

    case "recall_memory": {
      const query = String(args.query || "").trim();
      const facts = recallFacts(query, 8);
      const episodes = recallEpisodes(query, 4);
      const parts: string[] = [];
      if (facts.length > 0) {
        parts.push(
          "FACTS:\n" +
            facts.map((f) => `- [${f.category}] ${f.fact}`).join("\n"),
        );
      }
      if (episodes.length > 0) {
        parts.push(
          "PAST TASKS/DECISIONS:\n" +
            episodes.map((e) => `- ${e.summary}`).join("\n"),
        );
      }
      return parts.length > 0
        ? parts.join("\n\n")
        : "No relevant memories found.";
    }

    case "list_memories": {
      const facts = listFacts(50);
      if (facts.length === 0) return "No facts stored yet.";
      return facts
        .map((f) => `- [id ${f.id}] [${f.category}] ${f.fact}`)
        .join("\n");
    }

    case "forget_memory": {
      const id = Number(args.id);
      if (!Number.isFinite(id)) return "forget_memory needs a numeric id.";
      return forgetFact(id)
        ? `Forgot fact id ${id}.`
        : `No fact found with id ${id}.`;
    }

    case "set_reminder": {
      const message = String(args.message || "").trim();
      if (!message) return "set_reminder needs a message.";
      const delayMinutes = Number(args.delay_minutes) || 0;
      const seconds = Number(args.seconds) || 0;
      const repeatMinutes = Number(args.repeat_minutes) || null;
      const totalMs = (delayMinutes * 60 + seconds) * 1000;
      const remindAt = new Date(Date.now() + totalMs).toISOString();
      const reminder = addReminder(message, remindAt, "general", repeatMinutes);
      return `Reminder #${reminder.id} set for ${remindAt}: "${message}"${
        repeatMinutes ? ` (repeats every ${repeatMinutes} min)` : ""
      }`;
    }

    case "list_reminders": {
      const reminders = listPendingReminders();
      if (reminders.length === 0) return "No pending reminders.";
      return reminders
        .map((r) => `- [id ${r.id}] ${r.remind_at}: ${r.message}`)
        .join("\n");
    }

    case "cancel_reminder": {
      const id = Number(args.id);
      if (!Number.isFinite(id)) return "cancel_reminder needs a numeric id.";
      return cancelReminder(id)
        ? `Cancelled reminder id ${id}.`
        : `No pending reminder found with id ${id}.`;
    }

    case "system_status": {
      const health = await getSystemHealth(true);
      const parts = [
        `CPU: ${health.cpuPct}%`,
        `RAM: ${health.ramUsedPct}%`,
        `Disk: ${health.diskUsedPct}%`,
        `Load: ${health.load.toFixed(2)}`,
      ];
      if (health.batteryPct !== undefined) {
        parts.push(
          `Battery: ${health.batteryPct}% ${health.batteryCharging ? "(charging)" : ""}`,
        );
      }
      return parts.join("\n");
    }

    case "get_calendar_events": {
      const days = Number(args.days) || 1;
      return await getCalendarEvents(days);
    }

    case "create_calendar_event": {
      const title = String(args.title || "").trim();
      const startDate = String(args.startDate || "").trim();
      if (!title || !startDate) {
        return "create_calendar_event needs title and startDate.";
      }
      return await createCalendarEvent({
        title,
        startDate,
        endDate: args.endDate ? String(args.endDate) : undefined,
        location: args.location ? String(args.location) : undefined,
        calendar: args.calendar ? String(args.calendar) : undefined,
      });
    }

    case "create_apple_reminder": {
      const title = String(args.title || "").trim();
      if (!title) return "create_apple_reminder needs a title.";
      return await createAppleReminder({
        title,
        dueDate: args.dueDate ? String(args.dueDate) : undefined,
        list: args.list ? String(args.list) : undefined,
      });
    }

    case "get_apple_reminders": {
      return await getAppleReminders();
    }

    case "control_music": {
      const action = String(args.action || "").trim();
      if (!action) return "control_music needs an action.";
      const target = args.target ? String(args.target) : "";
      return await controlMusic(action, target);
    }

    case "read_notifications": {
      return await readNotifications();
    }

    case "set_appearance": {
      const dark = Boolean(args.dark);
      return await setDarkMode(dark);
    }

    case "system_volume": {
      const action = String(args.action || "get").trim();
      if (action === "get") {
        return await getVolume();
      }
      const level = Number(args.level);
      if (!Number.isFinite(level)) {
        return "system_volume set needs a numeric level (0-100).";
      }
      return setVolume(Math.max(0, Math.min(100, level)));
    }

    case "research_task": {
      const topic = String(args.topic || "").trim();
      const depth = Number(args.depth) || 3;
      return await researchTask({ topic, depth });
    }

    case "devops_task": {
      const action = String(args.action || "").trim();
      const message = args.message ? String(args.message) : undefined;
      return await devopsTask({ action, ...(message ? { message } : {}) });
    }

    case "write_report": {
      const filename = String(args.filename || "").trim();
      const content = String(args.content || "");
      if (!filename) return "write_report needs a filename.";
      return await writeReport({ filename, content });
    }

    case "format_task_plan": {
      const steps = Array.isArray(args.steps)
        ? args.steps.map((s: string) => String(s))
        : [];
      if (steps.length === 0) return "format_task_plan needs a steps array.";
      // Store the plan as an episode so it can be recalled in a future session.
      const plan = formatTaskPlan(steps);
      try {
        saveEpisode(
          `Task plan: ${steps[0]}${steps.length > 1 ? ` (+${steps.length - 1} more steps)` : ""}`,
          plan,
        );
      } catch {
        // non-fatal — the plan is still returned to the user
      }
      return plan;
    }

    case "create_agent": {
      const agent = createAgentFromInput({
        name: String(args.name || "Untitled Agent"),
        purpose: String(args.purpose || ""),
        role: String(args.role || "assistant"),
        systemInstructions: String(args.systemInstructions || ""),
        model: String(args.model || "agent"),
        tools: args.tools ? (args.tools as string[]) : undefined,
        memory: args.memory !== false,
        capabilities: args.capabilities
          ? (args.capabilities as string[])
          : undefined,
        executionRules: String(args.executionRules || ""),
        workflow: String(args.workflow || ""),
      });
      return JSON.stringify(agent);
    }

    case "list_agents": {
      return JSON.stringify(listAgentSummaries());
    }

    case "inspect_agent": {
      const id = String(args.id || "");
      const agent = getAgent(id);
      return agent ? JSON.stringify(agent) : `Agent "${id}" not found.`;
    }

    case "run_agent": {
      const id = String(args.id || "");
      const task = String(args.task || "");
      if (!id || !task) return "run_agent needs id and task.";
      const result = await runAgent(id, task);
      return JSON.stringify(result);
    }

    case "test_agent": {
      const id = String(args.id || "");
      const task = String(args.task || "");
      if (!id || !task) return "test_agent needs id and task.";
      const result = await testAgent(id, task);
      return JSON.stringify(result);
    }

    case "update_agent": {
      const id = String(args.id || "");
      const updated = updateAgent(id, {
        name: optionalString(args.name),
        purpose: optionalString(args.purpose),
        role: optionalString(args.role),
        systemInstructions: optionalString(args.systemInstructions),
        model: optionalString(args.model),
        tools: args.tools ? (args.tools as string[]) : undefined,
        memory: args.memory !== false,
        capabilities: args.capabilities
          ? (args.capabilities as string[])
          : undefined,
        executionRules: optionalString(args.executionRules),
        workflow: optionalString(args.workflow),
      });
      if (!updated) return `Agent "${id}" not found.`;
      return JSON.stringify(updated);
    }

    case "delete_agent": {
      const removed = deleteAgent(String(args.id || ""));
      return removed
        ? `Agent "${args.id}" deleted.`
        : `Agent "${args.id}" not found.`;
    }

    case "pause_agent": {
      return setAgentStatus(String(args.id || ""), "paused")
        ? `Agent "${args.id}" paused.`
        : `Agent "${args.id}" not found.`;
    }

    case "resume_agent": {
      return setAgentStatus(String(args.id || ""), "active")
        ? `Agent "${args.id}" resumed.`
        : `Agent "${args.id}" not found.`;
    }

    case "combine_agents": {
      const result = createManagerAgent({
        name: String(args.name || "Manager Agent"),
        purpose: String(args.purpose || ""),
        memberIds: args.memberIds ? (args.memberIds as string[]) : [],
      });
      return JSON.stringify(result);
    }

    default:
      return `Unknown tool: ${name}`;
  }
}
