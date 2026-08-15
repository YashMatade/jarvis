import { OllamaTool } from "./ollama";
import { errMsg } from "./errors";
import { exec as execCb } from "child_process";
import { promisify } from "util";
import fs from "fs/promises";
import path from "path";
import os from "os";

const exec = promisify(execCb);

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

// Everything the "files" tool touches is jailed to this directory.
// Change via .env.local: NEXUS_FILES_DIR=/absolute/path
const FILES_ROOT = path.resolve(
  process.env.NEXUS_FILES_DIR || path.join(os.homedir(), "nexus-files")
);

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
  "delete_file",
]);

// Browser links and desktop app launches are explicit user-facing requests,
// so both can happen immediately when the assistant invokes this tool.
export function requiresConfirmation(
  name: string,
  _args: Record<string, unknown>,
): boolean {
  return CONFIRMATION_REQUIRED.has(name);
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
            description: "Short role/title/description, e.g. 'Full-Stack Developer'",
          },
          summary: {
            type: "string",
            description: "1-2 sentence overview",
          },
          fields: {
            type: "array",
            description: "Key facts as label/value pairs, e.g. {label: 'Experience', value: '4+ years'}",
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
            description: "Relevant links, e.g. {label: 'GitHub', url: 'https://github.com/...'}",
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

export async function executeTool(
  name: string,
  args: Record<string, unknown>
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
          throw new Error(`Tavily returned ${res.status}: ${body || res.statusText}`);
        }
        const data: { results?: TavilyResult[]; answer?: string } = await res.json();
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
          throw new Error(`Tavily returned ${res.status}: ${body || res.statusText}`);
        }
        const data: { results?: TavilyResult[]; answer?: string } = await res.json();
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

    case "list_files": {
      await ensureRoot();
      const dir = resolveInRoot(String(args.subdirectory || "."));
      try {
        const entries = await fs.readdir(dir, { withFileTypes: true });
        return entries
          .map((e) => (e.isDirectory() ? `${e.name}/` : e.name))
          .join("\n") || "(empty)";
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
            await exec(`powershell -Command "Start-Process ${JSON.stringify(target)}"`);
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

    default:
      return `Unknown tool: ${name}`;
  }
}
