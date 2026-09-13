import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const WHISPER_CONTAINER = "jarvis-whisper";
const WHISPER_HEALTH_URL = "http://127.0.0.1:9000/health";

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function commandExists(command) {
  try {
    await execFileAsync(command, ["--version"]);
    return true;
  } catch {
    return false;
  }
}

async function waitFor(check, label, timeoutMs = 60_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await check()) return;
    await sleep(1_000);
  }
  throw new Error(`${label} did not become ready within ${timeoutMs / 1_000}s.`);
}

async function dockerReady() {
  try {
    await execFileAsync("docker", ["info"]);
    return true;
  } catch {
    return false;
  }
}

async function ensureDocker() {
  if (!(await commandExists("docker"))) {
    throw new Error("Docker is not installed. Install Docker Desktop first.");
  }
  if (await dockerReady()) return;

  if (process.platform === "darwin") {
    console.log("Starting Docker Desktop…");
    await execFileAsync("open", ["-a", "Docker"]);
  }
  console.log("Waiting for Docker…");
  await waitFor(dockerReady, "Docker Desktop");
}

async function whisperHealthy() {
  try {
    const response = await fetch(WHISPER_HEALTH_URL, {
      signal: AbortSignal.timeout(2_000),
    });
    return response.ok;
  } catch {
    return false;
  }
}

async function ensureWhisper() {
  await ensureDocker();
  const inspect = await execFileAsync("docker", [
    "inspect",
    "--format",
    "{{.State.Running}}",
    WHISPER_CONTAINER,
  ]).catch(() => null);

  if (inspect === null) {
    console.log("Creating local Whisper container…");
    await execFileAsync("docker", [
      "run",
      "--detach",
      "--name",
      WHISPER_CONTAINER,
      "--restart",
      "unless-stopped",
      "--publish",
      "9000:8000",
      "--volume",
      "jarvis-hf-cache:/home/ubuntu/.cache/huggingface/hub",
      "ghcr.io/speaches-ai/speaches:latest-cpu",
    ]);
  } else if (inspect.stdout.trim() !== "true") {
    console.log("Starting local Whisper container…");
    await execFileAsync("docker", ["start", WHISPER_CONTAINER]);
  }

  console.log("Waiting for local Whisper…");
  await waitFor(whisperHealthy, "Local Whisper");
}

async function ollamaReady() {
  try {
    await execFileAsync("ollama", ["list"]);
    return true;
  } catch {
    return false;
  }
}

async function ensureOllama() {
  if (!(await commandExists("ollama"))) {
    throw new Error("Ollama is not installed. Install it from https://ollama.com.");
  }
  if (await ollamaReady()) return;

  console.log("Starting Ollama…");
  const child = spawn("ollama", ["serve"], {
    detached: true,
    stdio: "ignore",
  });
  child.unref();
  console.log("Waiting for Ollama…");
  await waitFor(ollamaReady, "Ollama");
}

async function main() {
  await ensureWhisper();
  await ensureOllama();

  console.log("Starting Jarvis…");
  const next = spawn("node_modules/.bin/next", ["dev", ...process.argv.slice(2)], {
    stdio: "inherit",
  });
  next.on("exit", (code) => process.exit(code ?? 0));
}

main().catch((error) => {
  console.error(`\nJarvis startup failed: ${error.message}`);
  process.exit(1);
});
