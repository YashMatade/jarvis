import { NextResponse } from "next/server";
import { exec } from "child_process";
import { promisify } from "util";
import { writeFile, readFile, unlink, mkdir } from "fs/promises";
import path from "path";
import { existsSync } from "fs";

const execAsync = promisify(exec);

export async function POST(request: Request) {
  try {
    const { text } = await request.json();

    if (!text || typeof text !== "string") {
      return NextResponse.json({ error: "Text is required" }, { status: 400 });
    }

    // Sanitize text to prevent command injection
    const sanitizedText = text.replace(/['"`$\\!&|;<>*?{}[\]()]/g, "");

    const timestamp = Date.now();
    const tmpDir = path.join(process.cwd(), "tmp");
    const textFile = path.join(tmpDir, `input_${timestamp}.txt`);
    const audioFile = path.join(tmpDir, `output_${timestamp}.mp3`);

    // Ensure tmp directory exists
    if (!existsSync(tmpDir)) {
      await mkdir(tmpDir, { recursive: true });
    }

    // Write text to temporary file
    await writeFile(textFile, sanitizedText, "utf-8");

    console.log(
      `Generating speech for text: "${sanitizedText.substring(0, 50)}..."`,
    );

    // Call Python script
    const pythonScript = path.join(process.cwd(), "scripts", "tts_edge.py");

    try {
      const { stdout, stderr } = await execAsync(
        `python3 "${pythonScript}" "${textFile}" "${audioFile}"`,
        { timeout: 30000 }, // 30 second timeout
      );

      if (stderr) {
        console.warn("Python stderr:", stderr);
      }
      console.log("Python stdout:", stdout);
    } catch (execError: any) {
      console.error("Python execution error:", execError);
      throw new Error(`TTS generation failed: ${execError.message}`);
    }

    // Check if audio file was created
    if (!existsSync(audioFile)) {
      throw new Error("Audio file was not generated");
    }

    // Read the generated audio file
    const audioBuffer = await readFile(audioFile);

    if (audioBuffer.length === 0) {
      throw new Error("Generated audio file is empty");
    }

    // Cleanup temporary files
    Promise.all([
      unlink(textFile).catch((err) =>
        console.warn("Failed to delete text file:", err),
      ),
      unlink(audioFile).catch((err) =>
        console.warn("Failed to delete audio file:", err),
      ),
    ]);

    console.log(`Successfully generated audio: ${audioBuffer.length} bytes`);

    return new NextResponse(audioBuffer, {
      headers: {
        "Content-Type": "audio/mpeg",
        "Content-Length": audioBuffer.byteLength.toString(),
        "Cache-Control": "no-cache",
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
