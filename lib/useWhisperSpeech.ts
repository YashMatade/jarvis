"use client";

import { useCallback, useEffect, useRef, useState } from "react";

type ResultHandler = (text: string) => void;
type InterimHandler = (text: string) => void;

const SPEECH_THRESHOLD = 0.025;
const SILENCE_MS = 850;

/**
 * Records speech in the browser and sends each completed utterance to the
 * local Whisper endpoint. No browser speech-recognition service is involved.
 */
export function useWhisperSpeech() {
  const [listening, setListening] = useState(false);
  const [supported, setSupported] = useState(false);
  const [audioLevel, setAudioLevel] = useState(0);
  const [interimTranscript, setInterimTranscript] = useState("");

  const streamRef = useRef<MediaStream | null>(null);
  const contextRef = useRef<AudioContext | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const animationRef = useRef<number | null>(null);
  const lastSpeechAtRef = useRef(0);
  const runningRef = useRef(false);
  const resultRef = useRef<ResultHandler | null>(null);
  const interimRef = useRef<InterimHandler | null>(null);

  useEffect(() => {
    setSupported(
      Boolean(
        navigator.mediaDevices &&
        typeof MediaRecorder !== "undefined",
      ),
    );
  }, []);

  const transcribe = useCallback(async (blob: Blob) => {
    if (blob.size < 1_000) return;
    const form = new FormData();
    form.set("audio", blob, "utterance.webm");

    try {
      const response = await fetch("/api/stt", { method: "POST", body: form });
      if (!response.ok) throw new Error("Local transcription failed");
      const data = (await response.json()) as { text?: string };
      const text = data.text?.trim();
      if (text) {
        setInterimTranscript("");
        resultRef.current?.(text);
      }
    } catch (error) {
      console.error("Whisper transcription error:", error);
    }
  }, []);

  const finishUtterance = useCallback(() => {
    const recorder = recorderRef.current;
    if (!recorder || recorder.state === "inactive") return;
    recorder.stop();
  }, []);

  const startListening = useCallback(
    async (onResult: ResultHandler, onInterim?: InterimHandler) => {
      resultRef.current = onResult;
      interimRef.current = onInterim ?? null;
      if (runningRef.current) return;

      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        if (!runningRef.current && streamRef.current) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }
        runningRef.current = true;
        streamRef.current = stream;
        setListening(true);

        const context = new AudioContext();
        contextRef.current = context;
        const analyser = context.createAnalyser();
        analyser.fftSize = 1024;
        context.createMediaStreamSource(stream).connect(analyser);
        const samples = new Uint8Array(analyser.fftSize);

        const recordUtterance = () => {
          if (recorderRef.current?.state === "recording") return;
          chunksRef.current = [];
          const recorder = new MediaRecorder(stream, {
            mimeType: MediaRecorder.isTypeSupported("audio/webm")
              ? "audio/webm"
              : undefined,
          });
          recorder.ondataavailable = (event) => {
            if (event.data.size) chunksRef.current.push(event.data);
          };
          recorder.onstop = () => {
            const blob = new Blob(chunksRef.current, { type: recorder.mimeType });
            recorderRef.current = null;
            void transcribe(blob);
          };
          recorderRef.current = recorder;
          recorder.start();
        };

        const monitor = () => {
          if (!runningRef.current) return;
          analyser.getByteTimeDomainData(samples);
          let total = 0;
          for (const value of samples) total += Math.abs(value - 128) / 128;
          const level = total / samples.length;
          setAudioLevel(level);

          const now = performance.now();
          if (level >= SPEECH_THRESHOLD) {
            lastSpeechAtRef.current = now;
            recordUtterance();
            const marker = "Listening…";
            setInterimTranscript(marker);
            interimRef.current?.(marker);
          } else if (
            recorderRef.current?.state === "recording" &&
            now - lastSpeechAtRef.current > SILENCE_MS
          ) {
            finishUtterance();
          }
          animationRef.current = requestAnimationFrame(monitor);
        };
        monitor();
      } catch (error) {
        runningRef.current = false;
        setListening(false);
        console.error("Microphone access error:", error);
      }
    },
    [finishUtterance, transcribe],
  );

  const stopListening = useCallback(() => {
    runningRef.current = false;
    if (animationRef.current !== null) cancelAnimationFrame(animationRef.current);
    animationRef.current = null;
    finishUtterance();
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    void contextRef.current?.close();
    contextRef.current = null;
    resultRef.current = null;
    interimRef.current = null;
    setListening(false);
    setAudioLevel(0);
    setInterimTranscript("");
  }, [finishUtterance]);

  useEffect(() => stopListening, [stopListening]);

  return { startListening, stopListening, listening, supported, audioLevel, interimTranscript };
}
