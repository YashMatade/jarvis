// Voice-first UX layer for Nexus. Provides a unified interface between
// the browser's Web Speech API and optional offline STT/TTS backends.
// Exposes a consistent API the agent loop can use regardless of the backend.

// No Node imports needed — all operations happen in the browser.
// The agent loop calls startListening/speak with callbacks; the UI
// wires these to the Web Speech API or a local Piper backend.

/**
 * Current voice session state, shared between UI and agent loop.
 */
export type VoiceState = "idle" | "listening" | "speaking" | "error";

/**
 * Check if the browser's Web Speech API is available.
 */
export function hasWebSpeech(): boolean {
  return typeof window !== "undefined" && !!(window as any).SpeechRecognition;
}

/**
 * Check if Piper TTS binary is on the system PATH.
 * (Called from the browser via a pre-filter; in practice the UI checks
 * this at runtime rather than at build time.)
 */
export function hasPiper(): boolean {
  // Placeholder — the actual check happens at runtime in the UI.
  return false;
}

/**
 * Start a listening session using the specified backend.
 *
 * @param backend - "web" for browser Web Speech API, "piper-stt" for offline
 * @param onTranscript - callback called with interim + final transcripts
 * @param onFinal - callback called only when the user stops speaking
 */
export function startListening(
  backend: "web" | "piper-stt",
  onTranscript: (text: string) => void,
  onFinal: (text: string) => void,
) {
  if (backend === "web") {
    // Browser Web Speech API
    ;(window as any).recognition = new (window as any).SpeechRecognition();
    const rec = (window as any).recognition;
    rec.continuous = true;
    rec.interimResults = true;
    rec.lang = "en-US";

    rec.onresult = (e: any) => {
      const interim: string[] = [];
      let finalText = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const transcript = e.results[i][0].transcript;
        if (e.results[i].isFinal) {
          finalText += transcript;
        } else {
          interim.push(transcript);
        }
      }
      onTranscript(interim.join(" "));
      if (finalText.trim()) onFinal(finalText.trim());
    };

    rec.onerror = (e: any) => {
      console.error("Speech recognition error:", e.error);
      onTranscript("");
      onFinal("");
    };

    rec.start();
  } else if (backend === "piper-stt") {
    // Offline STT via Piper — not yet implemented for the browser.
    onTranscript("Offline STT not yet implemented — use the web backend.");
    onFinal("");
  }
}

/**
 * Speak the given text using the specified backend.
 *
 * @param text - the text to speak
 * @param onEnd - optional callback fired when playback finishes
 * @param onError - optional callback fired on error
 */
export function speak(
  text: string,
  onEnd?: () => void,
  onError?: (err: string) => void,
) {
  if (typeof text !== "string" || text.trim().length === 0) {
    onError?.("Empty text provided to speak().");
    return;
  }

  // Try Piper if available (the UI checks hasPiper() at runtime)
  if (typeof window !== "undefined" && (window as any).PiperReady) {
    // In a real implementation, we'd invoke the Piper audio pipeline.
    // For now just call onEnd to avoid hanging.
    onEnd?.();
    return;
  }

  // Fall back to browser SpeechSynthesis
  if (typeof window !== "undefined") {
    const utterance = new (window as any).SpeechSynthesisUtterance(text);
    utterance.onend = onEnd;
    utterance.onerror = (e: any) => onError?.(e.message || "TTS error");
    (window as any).speechSynthesis.speak(utterance);
    return;
  }

  onError?.("No TTS backend available");
}

/**
 * Tell the agent loop that the user started listening.
 * The UI should show the listening state and the agent should pause output.
 */
export function voiceStartedListening() {}

/**
 * Tell the agent loop that the user stopped speaking with the given transcript.
 * The agent should process the transcript as a tool call or direct command.
 */
export function voiceStoppedListening(transcript: string) {
  // Expose to the agent loop — the agent loop reads the most recent transcript
  // from its own state management.
}

/**
 * Tell the agent loop that Nexus is now speaking.
 * The UI should show the speaking state and suppress user input.
 */
export function voiceStartedSpeaking() {}

/**
 * Tell the agent loop that Nexus finished speaking.
 * The UI should return to the listening state.
 */
export function voiceStoppedSpeaking() {}
