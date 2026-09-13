import { NextResponse } from "next/server";
import { spawn } from "child_process";
import { mkdtemp, readFile, rm } from "fs/promises";
import os from "os";
import path from "path";
import crypto from "crypto";

// Simple in-memory cache. Resets on server restart / cold start.
// Swap for Redis or an LRU package if you need it to persist or bound memory.
const cache = new Map<string, Buffer>();
const MAX_CACHE_ENTRIES = 100;

async function runPiper(text: string): Promise<Buffer> {
  const model = process.env.PIPER_MODEL;
  if (!model) {
    throw new Error("PIPER_MODEL must point to a local Piper .onnx voice model.");
  }

  const directory = await mkdtemp(path.join(os.tmpdir(), "jarvis-piper-"));
  try {
    return await new Promise<Buffer>((resolve, reject) => {
      let timeout: ReturnType<typeof setTimeout> | undefined;
      const output = path.join(directory, "speech.wav");
      const child = spawn(process.env.PIPER_BIN || "piper", [
        "--model",
        model,
        "--output_file",
        output,
      ]);
      let stderr = "";
      timeout = setTimeout(() => {
        child.kill();
        reject(new Error("Piper generation timed out"));
      }, 30_000);
      child.stderr.on("data", (chunk: Buffer) => (stderr += chunk.toString()));
      child.on("error", reject);
      child.on("close", async (code) => {
        if (timeout) clearTimeout(timeout);
        if (code !== 0) {
          reject(new Error(`Piper exited with code ${code}: ${stderr}`));
          return;
        }
        try {
          resolve(await readFile(output));
        } catch (error) {
          reject(error);
        }
      });
      child.stdin.end(text, "utf8");
    });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

export async function POST(request: Request) {
  try {
    let payload: { text?: unknown; voice?: unknown };
    try {
      payload = (await request.json()) as { text?: unknown; voice?: unknown };
    } catch {
      return NextResponse.json({ error: "A JSON request body is required" }, { status: 400 });
    }
    const { text, voice } = payload;

    if (!text || typeof text !== "string") {
      return NextResponse.json({ error: "Text is required" }, { status: 400 });
    }

    if (text.length > 5000) {
      return NextResponse.json(
        { error: "Text too long (max 5000 chars)" },
        { status: 400 },
      );
    }

    const provider = process.env.JARVIS_TTS_PROVIDER || "edge";
    const selectedVoice = typeof voice === "string" ? voice : "en-GB-RyanNeural";
    const cacheKey = crypto
      .createHash("sha256")
      .update(text + provider + selectedVoice + (process.env.PIPER_MODEL || ""))
      .digest("hex");

    const cached = cache.get(cacheKey);
    if (cached) {
      return new NextResponse(new Uint8Array(cached), {
        headers: {
          "Content-Type": provider === "piper" ? "audio/wav" : "audio/mpeg",
          "Content-Length": cached.byteLength.toString(),
          "Cache-Control": "public, max-age=86400",
        },
      });
    }

    const audioBuffer =
      provider === "piper"
        ? await runPiper(text)
        : await new Promise<Buffer>((resolve, reject) => {
            const pythonScript = path.join(process.cwd(), "scripts", "tts_edge.py");
            const child = spawn("python3", [pythonScript, selectedVoice]);
            const chunks: Buffer[] = [];
            let stderr = "";

            const timeout = setTimeout(() => {
              child.kill();
              reject(new Error("TTS generation timed out"));
            }, 30000);

            child.stdout.on("data", (chunk: Buffer) => chunks.push(chunk));
            child.stderr.on("data", (d: Buffer) => (stderr += d.toString()));

            child.on("close", (code) => {
              clearTimeout(timeout);
              if (code !== 0) {
                reject(new Error(`TTS script exited with code ${code}: ${stderr}`));
                return;
              }
              if (chunks.length === 0) {
                reject(new Error("No audio produced"));
                return;
              }
              resolve(Buffer.concat(chunks));
            });

            child.on("error", (err) => {
              clearTimeout(timeout);
              reject(err);
            });

            child.stdin.write(text, "utf-8");
            child.stdin.end();
          });

    // Basic cache eviction so this can't grow unbounded
    if (cache.size >= MAX_CACHE_ENTRIES) {
      const oldestKey = cache.keys().next().value;
      if (oldestKey) cache.delete(oldestKey);
    }
    cache.set(cacheKey, audioBuffer);

    console.log(`Generated audio: ${audioBuffer.length} bytes`);

    return new NextResponse(new Uint8Array(audioBuffer), {
      headers: {
        "Content-Type": provider === "piper" ? "audio/wav" : "audio/mpeg",
        "Content-Length": audioBuffer.byteLength.toString(),
        "Cache-Control": "public, max-age=86400",
      },
    });
  } catch (error: any) {
    console.error("TTS API Error:", error);
    return NextResponse.json(
      {
        error: "Failed to generate speech",
        details: error.message || "Unknown error",
      },
      { status: 500 },
    );
  }
}
