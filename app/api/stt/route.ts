import { NextResponse } from "next/server";

export const runtime = "nodejs";

const WHISPER_URL =
  process.env.WHISPER_API_URL || "http://127.0.0.1:9000/v1/audio/transcriptions";

export async function POST(request: Request) {
  try {
    const incoming = await request.formData();
    const audio = incoming.get("audio");
    if (!(audio instanceof File)) {
      return NextResponse.json({ error: "An audio file is required." }, { status: 400 });
    }

    const body = new FormData();
    body.set("file", audio, audio.name || "utterance.webm");
    body.set(
      "model",
      process.env.WHISPER_MODEL || "Systran/faster-distil-whisper-small.en",
    );
    body.set("response_format", "json");

    const response = await fetch(WHISPER_URL, {
      method: "POST",
      body,
      signal: AbortSignal.timeout(60_000),
    });
    if (!response.ok) {
      const detail = await response.text();
      return NextResponse.json(
        { error: "Whisper transcription failed.", details: detail.slice(0, 500) },
        { status: 502 },
      );
    }

    const data = (await response.json()) as { text?: string };
    return NextResponse.json({ text: data.text || "" });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: "Could not reach local Whisper.", details: message }, { status: 503 });
  }
}
