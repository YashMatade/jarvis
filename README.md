# Nexus — local voice assistant

A Next.js console for a fully local, voice-driven assistant powered by your own
Ollama models. No cloud calls except whatever tools you explicitly wire up
(web search, etc.) — the model, the reasoning loop, and tool execution all run
on your machine.

## What's here

- **Voice in/out** using the browser's Web Speech API (free, zero setup, Chrome
  works best). See "Upgrading voice quality" below for a fully local upgrade path.
- **Model routing** across the Ollama models you already have pulled:
  - `qwen3:8b` — main agent brain (reasoning + tool calling)
  - `qwen3.5:0.8b` — reserved for fast/simple queries (not wired into routing
    yet — see `lib/ollama.ts` `pickModel`, easy to extend)
  - `qwen2.5-coder:1.5b` — auto-selected when your message looks code-related
- **Tool calling** — web search, run code, read/write/list/delete files
  (jailed to one directory), and basic computer control (open apps/URLs).
- **Structured info cards** — when the assistant researches a specific person/company/entity, it can call `show_profile_card` to present the result as a proper HUD panel (name, role, summary, facts, links) instead of a wall of spoken-style text.
- **Persistent memory** — Nexus remembers facts about you, past tasks/decisions,
  and full conversation history across sessions and page reloads, stored in a
  local SQLite database (via Node's built-in `node:sqlite`, no extra deps).
- **Reminders & proactive alerts** — set reminders ("remind me in 30 minutes"),
  and Nexus speaks them aloud when they fire. A background scheduler also
  monitors your system (CPU, RAM, disk, battery) and proactively alerts you
  when something needs attention.
- **macOS integration** — Nexus can read your calendar, create events and
  reminders in Apple's apps, control Music, read the volume, toggle dark mode,
  and knows the current time/date for context-aware greetings.
- **Confirmation gate** — anything that touches your filesystem, runs code, or
  controls your computer pauses and asks you to approve it first, right in the
  UI, before it executes.

## Setup

1. **Install Ollama** if you haven't: https://ollama.com
2. Make sure your models are pulled (you already have these):
   ```
   ollama pull qwen3:8b
   ollama pull qwen2.5-coder:1.5b
   ```
3. Start Ollama (usually already running as a service, otherwise `ollama serve`).
4. Install deps and run:
   ```
   npm install
   python3 -m pip install edge-tts    # required for the TTS voice output
   cp .env.local.example .env.local   # adjust models/paths if you want
   npm run dev
   ```
5. Open http://localhost:3000, click **hold to speak**, and talk. Chrome has
   the best Web Speech API support; Safari/Firefox support varies.

## Tool setup (optional but recommended)

- **Web search**: powered by [Tavily](https://tavily.com), a hosted search
  API built for LLM agent tool calls (free tier: 1,000 searches/month, no
  card required). Sign up at https://app.tavily.com, grab an API key from the
  dashboard, and set `TAVILY_API_KEY` in `.env.local`. Without a key,
  `web_search` will just tell the assistant it's unavailable instead of
  failing silently. Note this is the one part of the stack that isn't fully
  local — your search queries go to Tavily's servers. If you want a fully
  local alternative later, SearXNG (self-hosted) is the usual choice; swap
  the `web_search` case in `lib/tools.ts` back to hit a local SearXNG
  instance instead.
- **Movie discovery**: say “find movies near me” or “book movie tickets.”
  Nexus asks the browser for your location, searches nearby listings through
  the same Tavily key, and shows official provider links. It resolves the
  coordinates to a suggested city via OpenStreetMap, then asks you to confirm
  or edit that city before searching. It does not store the location, buy
  tickets, store payment details, or submit checkout forms.
- **Files**: the `read_file`/`write_file`/`list_files`/`delete_file` tools are
  jailed to `NEXUS_FILES_DIR` (defaults to `~/nexus-files`). Nothing outside
  that directory is reachable — this is enforced in `lib/tools.ts`, not just
  suggested to the model.
- **Run code / control computer**: work out of the box using your local shell,
  but every call pauses for your explicit approval in the UI first (see
  `CONFIRMATION_REQUIRED` in `lib/tools.ts` if you want to change what's
  gated — code execution and computer control are not sandboxed beyond that
  confirmation step, so only approve things you'd be comfortable running
  yourself).

## Upgrading voice quality (fully local, no browser dependency)

The Web Speech API's STT/TTS actually round-trips through Google/Apple's
servers in most browsers — it's not fully local. To go 100% offline:

- **STT**: swap in [whisper.cpp](https://github.com/ggml-org/whisper.cpp) or
  `faster-whisper`, running as a small local server. Record audio in the
  browser with `MediaRecorder`, POST the blob to a new `/api/stt` route that
  shells out to your whisper server, return the transcript.
- **TTS**: swap in [Piper](https://github.com/rhasspy/piper) — fast, fully
  local, runs as a subprocess. Add a `/api/tts` route that pipes text to
  Piper and streams the resulting WAV back to the browser `<audio>` element.

Both are drop-in replacements for the `listen()`/`speak()` functions in
`lib/useSpeech.ts` — same interface, different implementation underneath.

## Project structure

```
app/
  api/chat/route.ts     — the one HTTP endpoint; runs the agent loop
  page.tsx               — renders the console UI
  layout.tsx, globals.css
components/
  ChatInterface.tsx      — voice/text UI, transcript, confirmation modal
  VoiceOrb.tsx            — animated HUD orb (idle/listening/thinking/speaking)
lib/
  ollama.ts               — Ollama API client + model routing
  tools.ts                — tool definitions + execution + the files jail
  agent.ts                — the tool-calling loop, pauses for confirmation
  types.ts                 — shared ProfileCardData type (server + client)
  useSpeech.ts             — Web Speech API hook (STT + TTS)
  errors.ts                — tiny error-message helper
```

## Persistent memory

Nexus keeps three kinds of long-term memory in a local SQLite database at
`NEXUS_MEMORY_DIR` (defaults to `~/nexus-memory/nexus.db`):

- **Facts** — stable things it learns about you ("the user prefers dark mode").
  Nexus calls `remember_fact` when you share personal info or preferences.
- **Episodes** — records of significant tasks/decisions ("deployed the app on
  June 1st"). Nexus calls `remember_task` after meaningful work.
- **Conversations** — full message history, grouped by conversation, so the
  chat survives page reloads. Each browser session keeps a stable conversation
  id in `localStorage` and restores it on load.

Relevant memories are injected into the system prompt each turn so Nexus can
personalize its replies. You can also ask it directly: "what do you remember
about me?" (`list_memories`), "remember that..." (`remember_fact`), or "forget
that" (`forget_memory`).

## Reminders & proactive alerts

Nexus runs a lightweight scheduler on the server (started automatically when a
client connects). It:

- **Fires reminders** — "remind me in 15 minutes to call the bank" → Nexus
  stores it and speaks it aloud at the appointed time.
- **Repeats reminders** — pass a `repeat_minutes` to have it re-arm itself.
- **Monitors system health** — every 90s it checks CPU, RAM, disk, and battery,
  and pushes a spoken alert + HUD card the first time a threshold is crossed
  (high CPU/RAM/disk usage, low battery).
- **Pushes via SSE** — the browser keeps a Server-Sent Events connection to
  `/api/events` open so proactive alerts arrive even while Nexus is idle.

Try it: say _"remind me in 30 seconds to drink water"_ — Nexus will interrupt
its listening loop, speak the reminder aloud, and show a HUD card.

## macOS integration

Nexus can control native macOS apps through AppleScript (via `osascript`). These
tools are exposed to the agent and require **one-time macOS automation
permission** (System Settings → Privacy & Security → Automation) the first time
they're used:

- **Calendar** — `get_calendar_events` (safe), `create_calendar_event` (requires
  confirmation). Ask "what's on my calendar today?" or "schedule a meeting."
- **Reminders.app** — `get_apple_reminders`, `create_apple_reminder` (requires
  confirmation).
- **Music** — `control_music` (play, pause, next, previous, playlist,
  currently playing).
- **Notifications** — `read_notifications` (reads Notification Center).
- **System** — `get_frontmost_app` (used indirectly), `set_appearance` (dark/
  light mode, requires confirmation), `system_volume` (get/set, set requires
  confirmation).

Nexus also injects **current situation context** into every prompt: today's
date/time and any pending reminders — so "good morning" becomes a personalized
greeting with real awareness.

## Structured info cards

The model has a `show_profile_card` tool (schema in `lib/tools.ts`) it can
call after researching a person/entity, instead of narrating everything in
speech. `lib/agent.ts` intercepts that specific call, collects the structured
data into a `uiCards` array on the `AgentResult`, and the API route passes it
straight through to the browser. `ChatInterface.tsx` queues any cards it
receives and shows them one at a time in `ProfileCardModal`. If the model
doesn't call it (smaller/weaker models are less reliable at tool calling),
you'll just get the old plain-text answer — nothing breaks, it's additive.

## How the agent loop works

1. Browser sends the full message history to `POST /api/chat`.
2. The route picks a model and calls `runAgentLoop` (`lib/agent.ts`).
3. Ollama replies either with a normal message, or a `tool_calls` request.
4. Safe tools (`web_search`, `read_file`, `list_files`) execute immediately
   and the loop continues automatically.
5. Dangerous tools (`run_code`, `write_file`, `delete_file`,
   `control_computer`) pause the loop and return `needs_confirmation` to the
   browser, which shows the approve/deny modal.
6. On approve/deny, the browser calls `/api/chat` again with
   `resolveToolCall`, and the loop picks back up from where it paused.

The full conversation (including tool calls and results) lives in browser
state and gets sent back on every request. It is also persisted to the local
SQLite store after each turn (see "Persistent memory"), so the conversation
survives page reloads and is restored automatically on the next visit.

## Notes / known limitations

- The scheduler runs only while the Next.js server is running. Like any
  always-on assistant, reminders that fire while the server is stopped are
  marked "missed" rather than replayed.
- Confirmation handling assumes one pending tool call at a time. If a model
  requests several tool calls in a single turn, only the first dangerous one
  triggers a pause; extend `lib/agent.ts` if you need to gate all of them.
- `run_code` and `control_computer` are not sandboxed beyond the confirmation
  step — they run real shell commands on your machine. Tighten `lib/tools.ts`
  (e.g. a Docker sandbox for `run_code`) before giving this broader autonomy.
- Web Speech API quality/availability depends entirely on the browser; see
  the upgrade path above if that's limiting.
