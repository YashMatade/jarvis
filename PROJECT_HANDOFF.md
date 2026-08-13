# Nexus / Jarvis — Project Handoff

## What this project is

Nexus is a browser-based, voice-driven personal assistant with a sci-fi / Jarvis-style interface. It runs as a local Next.js app and uses locally hosted Ollama models for the AI conversation and tool-calling loop.

The intended flow is simple: speak or type to Nexus, let it decide whether it needs a tool, show useful results in the HUD, then have the answer spoken back.

## What is installed in the project

### Application stack

- **Next.js 16.3** with **React 19.2** and **TypeScript**
- **Tailwind CSS 4** for styling
- **Three.js**, `@react-three/fiber`, `@react-three/drei`, and `@react-three/postprocessing` for the animated 3D Nexus/HUD scene
- **ESLint** for code-quality checks

### AI and voice packages

- **Ollama** is used as the local LLM server (external application, not an npm package).
- `@google/genai` is installed, though the current assistant flow uses Ollama rather than Google AI.
- `edge-tts` is used by a small Python script to generate spoken MP3 responses with the British `en-GB-RyanNeural` voice.
- Browser **Web Speech API** is used for speech-to-text / microphone recognition.

### Local prerequisites

- Node.js and npm
- Python 3 (detected: 3.9.6)
- Ollama CLI is available. It needs to be running at `http://127.0.0.1:11434` for the assistant to respond.
- The project dependencies are already installed in `node_modules`.

## Models we are using

The app is configured to use local Ollama models, with environment-variable overrides available:

| Purpose | Default model | Notes |
| --- | --- | --- |
| Main assistant / tool calling | `qwen3:8b` | The normal Nexus “brain.” |
| Fast/simple requests | `qwen3.5:0.8b` | Available in the routing helper but not yet actively selected by the API route. |
| Code-related requests | `qwen2.5-coder:1.5b` | Chosen when the request looks code-related. |

## What the app can do today

- Accept typed messages and voice input.
- Speak replies using Edge TTS.
- Show an animated 3D Nexus visual and HUD-style interface.
- Chat through a local Ollama model.
- Search the web through Tavily when `TAVILY_API_KEY` is configured.
- Read and list files inside a restricted `NEXUS_FILES_DIR` directory.
- Write and delete files in that restricted directory after confirmation.
- Run shell/Python/Node snippets after confirmation.
- Open an app or URL on the computer.
- Render search results and structured person/company information as HUD cards.

## What we are actively working on

The current uncommitted work focuses on making the interaction feel more like a smooth voice assistant:

- A spoken “processing” or “searching” status line plays while Nexus waits for an answer.
- Microphone recognition is paused during speech so Nexus does not hear its own voice, then resumes after playback.
- Explicit searches immediately show a temporary **WEB SEARCH** HUD card while the web request runs.
- Tavily results are now kept as structured JSON so the HUD can render useful search panels instead of a plain text block.
- `show_profile_card` data from the agent is reliably passed to the UI and rendered as a structured card.
- HUD cards are mounted in a portal with a high z-index so they stay visible over the 3D scene.
- A voice command such as “close the card/panel/search results” clears the open HUD panels.
- Opening apps and URLs is now treated as an immediate user-facing action; shell execution and file modification still require confirmation.

## How the system works

```text
Browser UI (voice or typed input)
  -> POST /api/chat
  -> agent loop chooses local Ollama model
  -> Ollama replies or requests a tool
  -> tool result returns to the agent loop
  -> API returns assistant response + optional HUD-card data
  -> browser displays the response and sends it to /api/tts for speech
```

For actions that modify files or execute code, the agent loop stops and asks for approval in the UI before continuing.

## Important configuration

Environment files already exist locally (`.env` and `.env.local`) and should stay private. Do not share their keys or contents.

Useful settings include:

```env
OLLAMA_HOST=http://127.0.0.1:11434
OLLAMA_AGENT_MODEL=qwen3:8b
OLLAMA_FAST_MODEL=qwen3.5:0.8b
OLLAMA_CODE_MODEL=qwen2.5-coder:1.5b
TAVILY_API_KEY=...
NEXUS_FILES_DIR=/absolute/path/to/nexus-files
```

## Running it

```bash
npm run dev
```

Then open `http://localhost:3000` in Chrome (best browser support for microphone recognition). Ollama must be running separately, for example with `ollama serve` when it is not already running as a service.

## Main folders and files

```text
app/
  page.tsx                 Main page
  api/chat/route.ts        Chat API endpoint
  api/tts/route.ts         Generates MP3 speech through Python + Edge TTS
components/
  ChatInterface.tsx        Main interaction, voice flow, cards, confirmations
  hud/                     Search/result HUD cards
  nexus/                   Three.js animated Nexus scene
lib/
  agent.ts                 Ollama tool-calling loop and confirmation pause
  ollama.ts                Ollama client and model routing
  tools.ts                 Tool schemas, tool execution, safety rules
  useSpeech.ts             Browser speech recognition
  useTTS.ts                Client-side audio playback and status prompts
scripts/
  tts_edge.py              Edge TTS MP3 generation script
```

## Known limitations / next things to improve

- Ollama was not reachable during the latest local check, so start or verify the Ollama service before testing chat.
- Browser speech recognition usually depends on browser/vendor services; it is not fully offline. Replacing it with Whisper or faster-whisper would make speech-to-text local.
- Edge TTS is not fully offline; Piper would be a good local TTS replacement.
- `run_code` can run real commands once approved. It has a confirmation step but is not sandboxed, so approvals should be deliberate.
- Conversation history is held in browser memory and is lost on page reload. Local persistence (such as SQLite) is not implemented yet.
- The fast-model route is defined but not yet wired into an active request classifier.

## Repository status

The current HUD/search/voice improvements are local, uncommitted changes. The last commits are `095f55d` (“names changed”) and `8739790` (“jarvis”).
