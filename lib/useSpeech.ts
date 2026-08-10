"use client";

import { useCallback, useEffect, useRef, useState } from "react";

interface SpeechRecognitionResult {
  readonly isFinal: boolean;
  readonly length: number;
  [index: number]: SpeechRecognitionAlternative;
}

interface SpeechRecognitionAlternative {
  readonly transcript: string;
  readonly confidence: number;
}

interface SpeechRecognitionResultList {
  readonly length: number;
  [index: number]: SpeechRecognitionResult;
}

interface SpeechRecognitionEventLike extends Event {
  readonly resultIndex: number;
  readonly results: SpeechRecognitionResultList;
}

interface SpeechRecognitionErrorEventLike extends Event {
  readonly error: string;
  readonly message: string;
}

interface SpeechRecognitionLike extends EventTarget {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  maxAlternatives: number;
  start: () => void;
  stop: () => void;
  abort: () => void;
  onresult: ((e: SpeechRecognitionEventLike) => void) | null;
  onend: (() => void) | null;
  onerror: ((e: SpeechRecognitionErrorEventLike) => void) | null;
  onaudiostart: (() => void) | null;
  onaudioend: (() => void) | null;
  onspeechstart: (() => void) | null;
  onspeechend: (() => void) | null;
}

interface WindowWithSpeech extends Window {
  SpeechRecognition?: new () => SpeechRecognitionLike;
  webkitSpeechRecognition?: new () => SpeechRecognitionLike;
}

function detectSupport(): boolean {
  if (typeof window === "undefined") return true;
  const w = window as WindowWithSpeech;
  return Boolean(w.SpeechRecognition || w.webkitSpeechRecognition);
}

export function useSpeech() {
  const [listening, setListening] = useState(false);
  const [supported, setSupported] = useState(detectSupport);
  const [audioLevel, setAudioLevel] = useState(0);
  const [interimTranscript, setInterimTranscript] = useState("");

  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const isRunningRef = useRef(false);
  const callbackRef = useRef<((text: string) => void) | null>(null);
  const interimCallbackRef = useRef<((text: string) => void) | null>(null);

  // Initialize ONCE
  useEffect(() => {
    const w = window as WindowWithSpeech;
    const SpeechRecognitionCtor =
      w.SpeechRecognition || w.webkitSpeechRecognition;

    if (!SpeechRecognitionCtor) {
      setSupported(false);
      return;
    }

    setSupported(true);

    const recognition = new SpeechRecognitionCtor();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.maxAlternatives = 1;
    recognition.lang = "en-US";

    recognition.onspeechstart = () => {
      console.log("🗣️ Speech detected");
      setListening(true);
    };

    recognition.onspeechend = () => {
      console.log("🗣️ Speech ended");
    };

    recognition.onresult = (e: SpeechRecognitionEventLike) => {
      let finalText = "";
      let interimText = "";

      for (let i = e.resultIndex; i < e.results.length; i++) {
        const result = e.results[i];
        if (result.isFinal) {
          finalText += result[0].transcript;
        } else {
          interimText += result[0].transcript;
        }
      }

      if (interimText) {
        setInterimTranscript(interimText);
        interimCallbackRef.current?.(interimText);
      }

      if (finalText) {
        setInterimTranscript("");
        callbackRef.current?.(finalText.trim());
      }
    };

    recognition.onerror = (e: SpeechRecognitionErrorEventLike) => {
      console.log("❌ Error:", e.error);
      if (e.error === "not-allowed") {
        setListening(false);
        isRunningRef.current = false;
      }
    };

    recognition.onend = () => {
      console.log("🏁 Recognition ended, running:", isRunningRef.current);
      setListening(false);

      // Auto restart if still supposed to be running
      if (isRunningRef.current) {
        setTimeout(() => {
          if (isRunningRef.current) {
            try {
              recognition.start();
              console.log("🔄 Restarted");
            } catch (e) {
              console.log("Restart failed:", e);
              isRunningRef.current = false;
            }
          }
        }, 300);
      }
    };

    recognitionRef.current = recognition;
    console.log("✅ Recognition ready");

    return () => {
      isRunningRef.current = false;
      try {
        recognition.abort();
      } catch (e) {}
    };
  }, []);

  // Start continuous listening
  const startListening = useCallback(
    (onResult: (text: string) => void, onInterim?: (text: string) => void) => {
      const recognition = recognitionRef.current;
      if (!recognition) return;

      console.log("▶️ Start listening");
      callbackRef.current = onResult;
      interimCallbackRef.current = onInterim || null;
      isRunningRef.current = true;

      try {
        recognition.start();
        console.log("✅ Started");
      } catch (e: any) {
        if (e.message?.includes("already started")) {
          console.log("Already running");
        } else {
          console.log("Start error:", e);
        }
      }
    },
    [],
  );

  // Stop listening
  const stopListening = useCallback(() => {
    const recognition = recognitionRef.current;
    if (!recognition) return;

    console.log("⏹️ Stop listening");
    isRunningRef.current = false;
    callbackRef.current = null;
    interimCallbackRef.current = null;
    setListening(false);
    setInterimTranscript("");

    try {
      recognition.stop();
    } catch (e) {
      console.log("Stop error:", e);
    }
  }, []);

  return {
    startListening,
    stopListening,
    listening,
    supported,
    audioLevel,
    interimTranscript,
  };
}
