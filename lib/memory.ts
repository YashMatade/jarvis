// Persistent memory store for Jarvis, backed by SQLite via Node's built-in
// `node:sqlite` module (available in Node 22.13+). No native compilation or
// extra dependencies required.
//
// The store keeps three kinds of long-term memory:
//   - facts:      stable things Jarvis learns about the user ("birthday is...")
//   - episodes:   records of past tasks/decisions ("deployed the app on...")
//   - messages:   full conversation history, grouped into conversations
//
// The DB file lives at JARVIS_MEMORY_DIR (defaults to ~/jarvis-memory/jarvis.db).

import { DatabaseSync } from "node:sqlite";
import fs from "fs";
import path from "path";
import os from "os";
import { JarvisAgent, JarvisAgentSummary } from "./types";

const MEMORY_DIR = path.resolve(
  /*turbopackIgnore: true*/
  process.env.JARVIS_MEMORY_DIR || path.join(os.homedir(), "jarvis-memory"),
);
const DB_PATH = path.join(MEMORY_DIR, "jarvis.db");

let db: DatabaseSync | null = null;

export interface Fact {
  id: number;
  fact: string;
  category: string;
  created_at: string;
  updated_at: string;
}

export interface Episode {
  id: number;
  summary: string;
  details: string;
  created_at: string;
}

export interface ConversationSummary {
  id: string;
  title: string;
  created_at: string;
  updated_at: string;
  message_count: number;
}

export interface StoredMessage {
  id: number;
  conversation_id: string;
  role: string;
  content: string;
  tool_calls: string | null;
  tool_name: string | null;
  created_at: string;
}

function getDb(): DatabaseSync {
  if (db) return db;
  fs.mkdirSync(MEMORY_DIR, { recursive: true });
  db = new DatabaseSync(DB_PATH);
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;

    CREATE TABLE IF NOT EXISTS conversations (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL DEFAULT 'Untitled',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      conversation_id TEXT NOT NULL,
      role TEXT NOT NULL,
      content TEXT NOT NULL DEFAULT '',
      tool_calls TEXT,
      tool_name TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_messages_conversation
      ON messages(conversation_id, id);

    CREATE TABLE IF NOT EXISTS facts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      fact TEXT NOT NULL UNIQUE,
      category TEXT NOT NULL DEFAULT 'general',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS episodes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      summary TEXT NOT NULL,
      details TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS reminders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      message TEXT NOT NULL,
      remind_at TEXT NOT NULL,
      category TEXT NOT NULL DEFAULT 'general',
      repeat_minutes INTEGER,
      status TEXT NOT NULL DEFAULT 'pending',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_reminders_due
      ON reminders(status, remind_at);

    CREATE TABLE IF NOT EXISTS notifications (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      body TEXT NOT NULL DEFAULT '',
      type TEXT NOT NULL DEFAULT 'notification',
      acknowledged INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS agents (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      purpose TEXT NOT NULL DEFAULT '',
      role TEXT NOT NULL DEFAULT '',
      system_instructions TEXT NOT NULL DEFAULT '',
      model TEXT NOT NULL DEFAULT 'agent',
      tools TEXT NOT NULL DEFAULT '[]',
      memory INTEGER NOT NULL DEFAULT 1,
      capabilities TEXT NOT NULL DEFAULT '[]',
      execution_rules TEXT NOT NULL DEFAULT '',
      workflow TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'active',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
  return db;
}

// ---------------------------------------------------------------------------
// Conversations
// ---------------------------------------------------------------------------

export function saveConversation(
  conversationId: string,
  messages: Array<{
    role: string;
    content: string;
    tool_calls?: unknown;
    tool_name?: string;
  }>,
): void {
  const d = getDb();
  const title =
    messages.find((m) => m.role === "user")?.content.slice(0, 60) || "Untitled";

  d.prepare(
    `INSERT INTO conversations (id, title) VALUES (?, ?)
     ON CONFLICT(id) DO UPDATE SET
       title = CASE WHEN title = 'Untitled' THEN excluded.title ELSE title END,
       updated_at = datetime('now')`,
  ).run(conversationId, title);

  const insert = d.prepare(
    `INSERT INTO messages (conversation_id, role, content, tool_calls, tool_name)
     VALUES (?, ?, ?, ?, ?)`,
  );
  const countStmt = d.prepare(
    `SELECT COUNT(*) AS n FROM messages WHERE conversation_id = ?`,
  );
  const existing = Number(countStmt.get(conversationId)?.n || 0);

  // Only append messages we haven't stored yet. The browser sends the full
  // history each turn, so we skip the ones already persisted.
  const start = Math.max(
    0,
    messages.length - Math.max(0, messages.length - existing),
  );
  for (let i = start; i < messages.length; i++) {
    const m = messages[i];
    insert.run(
      conversationId,
      m.role,
      m.content || "",
      m.tool_calls ? JSON.stringify(m.tool_calls) : null,
      m.tool_name || null,
    );
  }
}

export function loadConversation(conversationId: string): StoredMessage[] {
  const d = getDb();
  return d
    .prepare(`SELECT * FROM messages WHERE conversation_id = ? ORDER BY id ASC`)
    .all(conversationId) as unknown as StoredMessage[];
}

export function listConversations(limit = 20): ConversationSummary[] {
  const d = getDb();
  return d
    .prepare(
      `SELECT c.id, c.title, c.created_at, c.updated_at,
              (SELECT COUNT(*) FROM messages m WHERE m.conversation_id = c.id) AS message_count
       FROM conversations c
       ORDER BY c.updated_at DESC
       LIMIT ?`,
    )
    .all(limit) as unknown as ConversationSummary[];
}

export function deleteConversation(conversationId: string): void {
  const d = getDb();
  d.prepare(`DELETE FROM conversations WHERE id = ?`).run(conversationId);
}

// ---------------------------------------------------------------------------
// Facts
// ---------------------------------------------------------------------------

export function rememberFact(fact: string, category = "general"): Fact {
  const d = getDb();
  d.prepare(
    `INSERT INTO facts (fact, category) VALUES (?, ?)
     ON CONFLICT(fact) DO UPDATE SET
       category = excluded.category,
       updated_at = datetime('now')`,
  ).run(fact.trim(), category);
  const row = d
    .prepare(`SELECT * FROM facts WHERE fact = ?`)
    .get(fact.trim()) as unknown as Fact;
  return row;
}

export function recallFacts(query: string, limit = 8): Fact[] {
  const d = getDb();
  const terms = query
    .split(/\s+/)
    .filter((t) => t.length > 2)
    .map((t) => `%${t}%`);
  if (terms.length === 0) {
    return d
      .prepare(`SELECT * FROM facts ORDER BY updated_at DESC LIMIT ?`)
      .all(limit) as unknown as Fact[];
  }
  const where = terms
    .map(() => `(fact LIKE ? OR category LIKE ?)`)
    .join(" OR ");
  const params: string[] = [];
  for (const t of terms) params.push(t, t);
  params.push(String(limit));
  return d
    .prepare(
      `SELECT * FROM facts WHERE ${where} ORDER BY updated_at DESC LIMIT ?`,
    )
    .all(...params) as unknown as Fact[];
}

export function listFacts(limit = 50): Fact[] {
  const d = getDb();
  return d
    .prepare(`SELECT * FROM facts ORDER BY updated_at DESC LIMIT ?`)
    .all(limit) as unknown as Fact[];
}

export function forgetFact(id: number): boolean {
  const d = getDb();
  const res = d.prepare(`DELETE FROM facts WHERE id = ?`).run(id);
  return Number(res.changes) > 0;
}

// ---------------------------------------------------------------------------
// Episodes
// ---------------------------------------------------------------------------

export function saveEpisode(summary: string, details = ""): Episode {
  const d = getDb();
  const res = d
    .prepare(`INSERT INTO episodes (summary, details) VALUES (?, ?)`)
    .run(summary.trim(), details);
  const row = d
    .prepare(`SELECT * FROM episodes WHERE id = ?`)
    .get(Number(res.lastInsertRowid)) as unknown as Episode;
  return row;
}

export function recallEpisodes(query: string, limit = 5): Episode[] {
  const d = getDb();
  const terms = query
    .split(/\s+/)
    .filter((t) => t.length > 2)
    .map((t) => `%${t}%`);
  if (terms.length === 0) {
    return d
      .prepare(`SELECT * FROM episodes ORDER BY created_at DESC LIMIT ?`)
      .all(limit) as unknown as Episode[];
  }
  const where = terms
    .map(() => `(summary LIKE ? OR details LIKE ?)`)
    .join(" OR ");
  const params: string[] = [];
  for (const t of terms) params.push(t, t);
  params.push(String(limit));
  return d
    .prepare(
      `SELECT * FROM episodes WHERE ${where} ORDER BY created_at DESC LIMIT ?`,
    )
    .all(...params) as unknown as Episode[];
}

// ---------------------------------------------------------------------------
// Context assembly
// ---------------------------------------------------------------------------

// Build a compact memory context block to inject into the system prompt so
// Jarvis can ground its replies in what it already knows about the user.
export function buildMemoryContext(query: string): string {
  const facts = recallFacts(query, 8);
  const episodes = recallEpisodes(query, 4);

  const parts: string[] = [];
  if (facts.length > 0) {
    parts.push(
      "KNOWN FACTS ABOUT THE USER:\n" +
        facts.map((f) => `- [${f.category}] ${f.fact}`).join("\n"),
    );
  }
  if (episodes.length > 0) {
    parts.push(
      "PAST TASKS / DECISIONS:\n" +
        episodes.map((e) => `- ${e.summary}`).join("\n"),
    );
  }
  if (parts.length === 0) return "";
  return (
    "\n\n--- PERSISTENT MEMORY (use them to reply; do not repeat it back) ---\n" +
    parts.join("\n\n")
  );
}

// ---------------------------------------------------------------------------
// Reminders
// ---------------------------------------------------------------------------

export interface Reminder {
  id: number;
  message: string;
  remind_at: string;
  category: string;
  repeat_minutes: number | null;
  status: string;
  created_at: string;
}

export function addReminder(
  message: string,
  remindAtIso: string,
  category = "general",
  repeatMinutes: number | null = null,
): Reminder {
  const d = getDb();
  const res = d
    .prepare(
      `INSERT INTO reminders (message, remind_at, category, repeat_minutes)
       VALUES (?, ?, ?, ?)`,
    )
    .run(message.trim(), remindAtIso, category, repeatMinutes);
  return getReminderById(Number(res.lastInsertRowid));
}

export function getReminderById(id: number): Reminder {
  const d = getDb();
  return d
    .prepare(`SELECT * FROM reminders WHERE id = ?`)
    .get(id) as unknown as Reminder;
}

export function listPendingReminders(): Reminder[] {
  const d = getDb();
  return d
    .prepare(
      `SELECT * FROM reminders WHERE status = 'pending' ORDER BY remind_at ASC`,
    )
    .all() as unknown as Reminder[];
}

export function getDueReminders(nowIso: string): Reminder[] {
  const d = getDb();
  return d
    .prepare(
      `SELECT * FROM reminders WHERE status = 'pending' AND remind_at <= ?`,
    )
    .all(nowIso) as unknown as Reminder[];
}

export function markReminderTriggered(id: number): boolean {
  const d = getDb();
  const res = d
    .prepare(
      `UPDATE reminders SET status = 'triggered', updated_at = datetime('now') WHERE id = ?`,
    )
    .run(id);
  return Number(res.changes) > 0;
}

export function cancelReminder(id: number): boolean {
  const d = getDb();
  const res = d
    .prepare(
      `UPDATE reminders SET status = 'cancelled', updated_at = datetime('now') WHERE id = ? AND status = 'pending'`,
    )
    .run(id);
  return Number(res.changes) > 0;
}

export function resetOverdueReminders(minutes: number): number {
  // Mark stale pending reminders as missed (e.g. the browser was closed).
  const d = getDb();
  const cutoff = new Date(Date.now() - minutes * 60_000).toISOString();
  const res = d
    .prepare(
      `UPDATE reminders SET status = 'missed', updated_at = datetime('now')
       WHERE status = 'pending' AND remind_at < ?`,
    )
    .run(cutoff);
  return Number(res.changes);
}

// ---------------------------------------------------------------------------
// Notifications
// ---------------------------------------------------------------------------

export interface NotificationRow {
  id: number;
  title: string;
  body: string;
  type: string;
  acknowledged: number;
  created_at: string;
}

export function addNotification(
  title: string,
  body = "",
  type = "notification",
): NotificationRow {
  const d = getDb();
  const res = d
    .prepare(`INSERT INTO notifications (title, body, type) VALUES (?, ?, ?)`)
    .run(title.trim(), body.trim(), type);
  const row = d
    .prepare(`SELECT * FROM notifications WHERE id = ?`)
    .get(Number(res.lastInsertRowid)) as unknown as NotificationRow;
  return row;
}

export function listUnacknowledgedNotifications(): NotificationRow[] {
  const d = getDb();
  return d
    .prepare(
      `SELECT * FROM notifications WHERE acknowledged = 0 ORDER BY id ASC LIMIT 50`,
    )
    .all() as unknown as NotificationRow[];
}

export function markNotificationsAcknowledged(ids: number[]): void {
  if (ids.length === 0) return;
  const d = getDb();
  const placeholders = ids.map(() => "?").join(",");
  d.prepare(
    `UPDATE notifications SET acknowledged = 1 WHERE id IN (${placeholders})`,
  ).run(...ids.map(String));
}

// ---------------------------------------------------------------------------
// Jarvis Agent Foundry — persistent agent store
// ---------------------------------------------------------------------------

interface AgentRow {
  id: string;
  name: string;
  purpose: string;
  role: string;
  system_instructions: string;
  model: string;
  tools: string;
  memory: number;
  capabilities: string;
  execution_rules: string;
  workflow: string;
  status: string;
  created_at: string;
  updated_at: string;
}

function rowToAgent(row: AgentRow): JarvisAgent {
  return {
    id: row.id,
    name: row.name,
    purpose: row.purpose,
    role: row.role,
    systemInstructions: row.system_instructions,
    model: row.model,
    tools: safeJsonArray(row.tools),
    memory: row.memory === 1,
    capabilities: safeJsonArray(row.capabilities),
    executionRules: row.execution_rules,
    workflow: row.workflow,
    status: (row.status as JarvisAgent["status"]) || "active",
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function safeJsonArray(raw: string): string[] {
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}

export function createAgent(agent: JarvisAgent): JarvisAgent {
  const d = getDb();
  d.prepare(
    `INSERT INTO agents (
       id, name, purpose, role, system_instructions, model, tools,
       memory, capabilities, execution_rules, workflow, status
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    agent.id,
    agent.name,
    agent.purpose,
    agent.role,
    agent.systemInstructions,
    agent.model,
    JSON.stringify(agent.tools),
    agent.memory ? 1 : 0,
    JSON.stringify(agent.capabilities),
    agent.executionRules,
    agent.workflow,
    agent.status,
  );
  return getAgent(agent.id)!;
}

export function getAgent(id: string): JarvisAgent | null {
  const d = getDb();
  const row = d
    .prepare(`SELECT * FROM agents WHERE id = ?`)
    .get(id) as unknown as AgentRow | undefined;
  return row ? rowToAgent(row) : null;
}

export function listAgents(): JarvisAgent[] {
  const d = getDb();
  const rows = d
    .prepare(`SELECT * FROM agents ORDER BY updated_at DESC`)
    .all() as unknown as AgentRow[];
  return rows.map(rowToAgent);
}

export function listAgentSummaries(): JarvisAgentSummary[] {
  return listAgents().map((a) => ({
    id: a.id,
    name: a.name,
    purpose: a.purpose,
    status: a.status,
    tools: a.tools,
    capabilities: a.capabilities,
    updatedAt: a.updatedAt,
  }));
}

export function updateAgent(
  id: string,
  patch: Partial<Omit<JarvisAgent, "id" | "createdAt">>,
): JarvisAgent | null {
  const d = getDb();
  const existing = getAgent(id);
  if (!existing) return null;
  const merged: JarvisAgent = {
    ...existing,
    ...patch,
    id,
    createdAt: existing.createdAt,
  };
  d.prepare(
    `UPDATE agents SET
       name = ?, purpose = ?, role = ?, system_instructions = ?, model = ?,
       tools = ?, memory = ?, capabilities = ?, execution_rules = ?,
       workflow = ?, status = ?, updated_at = datetime('now')
     WHERE id = ?`,
  ).run(
    merged.name,
    merged.purpose,
    merged.role,
    merged.systemInstructions,
    merged.model,
    JSON.stringify(merged.tools),
    merged.memory ? 1 : 0,
    JSON.stringify(merged.capabilities),
    merged.executionRules,
    merged.workflow,
    merged.status,
    id,
  );
  return getAgent(id);
}

export function setAgentStatus(
  id: string,
  status: JarvisAgent["status"],
): JarvisAgent | null {
  return updateAgent(id, { status });
}

export function deleteAgent(id: string): boolean {
  const d = getDb();
  const res = d.prepare(`DELETE FROM agents WHERE id = ?`).run(id);
  return Number(res.changes) > 0;
}
