// Multi-step task execution for Nexus. These helpers give the agent the
// ability to do real multi-step work in a single tool call:
//
//  - research_task:    run several web searches in parallel, synthesize into
//                      a structured summary, and optionally save it as a file
//  - devops_task:      run common dev workflows (status, test, build, commit)
//  - write_report:     write a text/markdown report into the user's nexus-files
//
// All functions return plain strings usable as tool results. Failures are
// returned as text, never thrown.

import { exec as execCb } from "child_process";
import { promisify } from "util";
import fs from "fs/promises";
import path from "path";
import os from "os";

const exec = promisify(execCb);

const TAVILY_API_KEY = process.env.TAVILY_API_KEY || "";

// Everything written by Nexus is jailed to this directory.
const FILES_ROOT = path.resolve(
  /*turbopackIgnore: true*/
  process.env.NEXUS_FILES_DIR || path.join(os.homedir(), "nexus-files"),
);

interface SearchResult {
  title: string;
  url: string;
  snippet: string;
}

async function tavilySearch(
  query: string,
  maxResults = 5,
): Promise<SearchResult[]> {
  if (!TAVILY_API_KEY) {
    throw new Error(
      "No TAVILY_API_KEY set. Get a free key at https://app.tavily.com and add it to .env.local.",
    );
  }
  const res = await fetch("https://api.tavily.com/search", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      api_key: TAVILY_API_KEY,
      query,
      max_results: maxResults,
    }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Tavily returned ${res.status}: ${body || res.statusText}`);
  }
  const data: {
    results?: Array<{ title?: string; url?: string; content?: string }>;
  } = await res.json();
  return (data.results || []).map((r) => ({
    title: r.title || "",
    url: r.url || "",
    snippet: r.content || "",
  }));
}

// ---------------------------------------------------------------------------
// Research agent
// ---------------------------------------------------------------------------

/**
 * Run `depth` web searches around a topic and combine them into a readable
 * report. Queries are derived from the topic plus variation words so the
 * parallel searches explore different angles.
 */
export async function researchTask(options: {
  topic: string;
  depth?: number;
}): Promise<string> {
  const topic = options.topic.trim();
  const depth = Math.min(Math.max(Number(options.depth) || 1, 1), 4);

  if (!topic) return "research_task needs a topic.";

  const angleQueries = [
    topic,
    `${topic} overview`,
    `${topic} latest 2026`,
    `${topic} pros and cons`,
  ].slice(0, depth);

  try {
    const results = await Promise.all(
      angleQueries.map(async (q) => {
        const found = await tavilySearch(q, 4);
        return { query: q, found };
      }),
    );

    const sections = results
      .map(({ query, found }) => {
        if (found.length === 0) return null;
        const items = found
          .slice(0, 3)
          .map(
            (r) => `- **${r.title}** (${r.url})\n  ${r.snippet.slice(0, 250)}`,
          )
          .join("\n");
        return `### Search: "${query}"\n${items}`;
      })
      .filter(Boolean);

    const seen = new Set<string>();
    let total = 0;
    for (const r of results) {
      for (const item of r.found) {
        if (!seen.has(item.url)) {
          seen.add(item.url);
          total++;
        }
      }
    }

    return (
      `# Research: ${topic}\n\n` +
      `Searched ${angleQueries.length} angles, gathered ${total} unique sources.\n\n` +
      sections.join("\n\n")
    );
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return `Research failed: ${message.slice(0, 300)}`;
  }
}

// ---------------------------------------------------------------------------
// DevOps agent
// ---------------------------------------------------------------------------

/**
 * Run common dev workflows in the current working directory (the user's
 * project). `action` is one of:
 *   status, test, build, diff, install, commit
 * For `commit`, pass a `message`. Committing is a mutation, so callers must
 * route this through the confirmation gate (see CONFIRMATION_REQUIRED).
 */
export async function devopsTask(options: {
  action: string;
  message?: string;
}): Promise<string> {
  const action = (options.action || "").trim().toLowerCase();
  const cwd = process.cwd();

  try {
    switch (action) {
      case "status": {
        const { stdout, stderr } = await exec("git status --short", {
          cwd,
          timeout: 10_000,
        });
        return stdout.trim() || stderr.trim() || "Working tree clean.";
      }

      case "diff": {
        const { stdout } = await exec("git diff --stat", {
          cwd,
          timeout: 10_000,
        });
        return stdout.trim() || "No unstaged changes.";
      }

      case "test": {
        const { stdout, stderr } = await exec(
          "npm test -- --runInBand 2>&1 || true",
          {
            cwd,
            timeout: 120_000,
            maxBuffer: 4 * 1024 * 1024,
          },
        );
        const output = (stdout || stderr || "(no output)").trim();
        return output.slice(-3000);
      }

      case "build": {
        const { stdout, stderr } = await exec("npm run build 2>&1 || true", {
          cwd,
          timeout: 180_000,
          maxBuffer: 4 * 1024 * 1024,
        });
        const output = (stdout || stderr || "(no output)").trim();
        return output.slice(-3000);
      }

      case "lint": {
        const { stdout, stderr } = await exec("npm run lint 2>&1 || true", {
          cwd,
          timeout: 60_000,
          maxBuffer: 2 * 1024 * 1024,
        });
        return (stdout || stderr || "(no output)").trim().slice(-3000);
      }

      case "install": {
        const { stdout, stderr } = await exec("npm install 2>&1 || true", {
          cwd,
          timeout: 300_000,
          maxBuffer: 4 * 1024 * 1024,
        });
        return (stdout || stderr || "npm install done").trim().slice(-2000);
      }

      case "commit": {
        const message = (options.message || "").trim();
        if (!message) {
          return "devops commit needs a message.";
        }
        await exec("git add -A", { cwd, timeout: 15_000 });
        const { stdout, stderr } = await exec(
          `git commit -m ${JSON.stringify(message)}`,
          { cwd, timeout: 30_000 },
        );
        return (
          (stdout || stderr || "Committed.").trim().slice(-1500) +
          `\n\nCommitted with message: "${message}"`
        );
      }

      case "log": {
        const { stdout } = await exec("git log --oneline -10", {
          cwd,
          timeout: 10_000,
        });
        return stdout.trim().slice(-1500) || "(no commits yet)";
      }

      default:
        return `Unknown devops action: ${action}. Valid: status, diff, test, build, lint, install, commit, log`;
    }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return `DevOps task failed: ${message.slice(0, 300)}`;
  }
}

// ---------------------------------------------------------------------------
// Report writing
// ---------------------------------------------------------------------------

/**
 * Write a markdown/text report into the user's nexus-files directory.
 * Subdirectories are created as needed.
 */
export async function writeReport(options: {
  filename: string;
  content: string;
}): Promise<string> {
  const filename = options.filename.trim();
  const content = options.content;

  const normalized = filename.replace(/^\/+/, "");
  const target = path.resolve(FILES_ROOT, normalized);
  if (!target.startsWith(FILES_ROOT)) {
    return "Report path escapes the nexus-files directory.";
  }

  try {
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, content, "utf-8");
    return `Report saved: ${target} (${content.length} bytes)`;
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return `Could not write report: ${message.slice(0, 300)}`;
  }
}

// ---------------------------------------------------------------------------
// Task planning
// ---------------------------------------------------------------------------

/**
 * Return a clean list of steps for a complex task. This is a convenience for
 * the model — it can describe a plan and Nexus will confirm splitting the
 * work into explicit steps. The plan itself is stored as an episode so it
 * survives across sessions.
 */
export function formatTaskPlan(steps: string[]): string {
  if (steps.length === 0) return "(no steps)";
  return steps.map((s, i) => `${i + 1}. ${s}`).join("\n");
}
