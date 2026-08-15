"use client";

import { useCallback, useRef, useState } from "react";

interface TTSOptions {
  onStart?: () => void;
  onEnd?: () => void;
  onError?: (error: Error) => void;
}

const STATUS_RESPONSES = {
  waking: "Nexus is awake!",
  sleeping: "Going to sleep mode. Call me when you need me.",
  searching: "Processing",
  processing: "Processing",
  found: "I found the information. Here's what I discovered.",
  error: "I encountered an issue. Let me try again.",
};

export function useTTS() {
  const [speaking, setSpeaking] = useState(false);
  const [loading, setLoading] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);

  const speak = useCallback(async (text: string, options?: TTSOptions) => {
    if (!text.trim()) return;

    try {
      // Cancel any ongoing speech
      cancel();

      setLoading(true);
      setSpeaking(false);

      const controller = new AbortController();
      abortControllerRef.current = controller;

      console.log("Requesting TTS for:", text.substring(0, 50));

      const response = await fetch("/api/tts", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ text }),
        signal: controller.signal,
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.details || "Failed to generate speech");
      }

      const audioBlob = await response.blob();

      if (audioBlob.size === 0) {
        throw new Error("Received empty audio");
      }

      const audioUrl = URL.createObjectURL(audioBlob);

      const audio = new Audio(audioUrl);
      audioRef.current = audio;

      audio.onplay = () => {
        setLoading(false);
        setSpeaking(true);
        options?.onStart?.();
        console.log("Audio playback started");
      };

      audio.onended = () => {
        setSpeaking(false);
        URL.revokeObjectURL(audioUrl);
        audioRef.current = null;
        options?.onEnd?.();
        console.log("Audio playback ended");
      };

      audio.onerror = (e) => {
        setSpeaking(false);
        setLoading(false);
        URL.revokeObjectURL(audioUrl);
        audioRef.current = null;
        const error = new Error("Audio playback failed");
        options?.onError?.(error);
        console.error("Audio error:", e);
      };

      await audio.play();
    } catch (error: any) {
      if (error.name === "AbortError") {
        console.log("TTS request aborted");
        return;
      }

      setLoading(false);
      setSpeaking(false);
      const err = error instanceof Error ? error : new Error("TTS failed");
      options?.onError?.(err);
      console.error("TTS Error:", error);
    }
  }, []);

  const speakStatus = useCallback(
    async (status: keyof typeof STATUS_RESPONSES) => {
      await speak(STATUS_RESPONSES[status]);
    },
    [speak],
  );
  const cancel = useCallback(() => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current = null;
    }
    setSpeaking(false);
    setLoading(false);
  }, []);

  return {
    speak,
    cancel,
    speaking,
    loading,
    speakStatus,
    STATUS_RESPONSES,
  };
}
