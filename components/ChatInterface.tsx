"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useSpeech } from "@/lib/useSpeech";
import { useTTS } from "@/lib/useTTS";
import { errMsg } from "@/lib/errors";
import type { OllamaToolCall } from "@/lib/ollama";
import NexusSceneClient from "./nexus/NexusSceneClient";
import HudCardStack from "./hud/Hudcardstack";
import { extractHudCards } from "./hud/Extracthudcards";
import type { HudCard } from "./hud/Types";

interface Msg {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  tool_calls?: OllamaToolCall[];
  tool_name?: string;
}

interface PendingConfirmation {
  name: string;
  arguments: Record<string, unknown>;
}

interface ChatApiResponse {
  status?: "needs_confirmation" | "ok";
  pendingToolCall?: PendingConfirmation;
  messages?: Msg[];
}

type NexusState = "sleeping" | "idle" | "listening" | "thinking" | "speaking";

// Finds the most recently appended assistant message with content.
// (`Array.prototype.find` returns the FIRST match, which is wrong here —
// after multiple turns that keeps re-selecting the very first reply.)
function latestAssistantMessage(messages: Msg[] | undefined): Msg | undefined {
  if (!messages) return undefined;
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === "assistant" && messages[i].content) {
      return messages[i];
    }
  }
  return undefined;
}

export default function ChatInterface() {
  const [nexusState, setNexusState] = useState<NexusState>("sleeping");
  const [subtitle, setSubtitle] = useState("");
  const [showChat, setShowChat] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [systemTime, setSystemTime] = useState("");
  const [messages, setMessages] = useState<Msg[]>([]);
  const [textInput, setTextInput] = useState("");
  const [pending, setPending] = useState<PendingConfirmation | null>(null);
  const [hudCards, setHudCards] = useState<HudCard[]>([]);

  const messagesRef = useRef<Msg[]>([]);
  const subtitleTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const errorTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const stateRef = useRef<NexusState>("sleeping");
  const logEndRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

  useEffect(() => {
    stateRef.current = nexusState;
  }, [nexusState]);

  // Auto-scroll the log to the newest message.
  useEffect(() => {
    if (showChat) logEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, showChat]);

  // System clock
  useEffect(() => {
    const updateTime = () => {
      const now = new Date();
      setSystemTime(
        now.toLocaleTimeString("en-US", {
          hour12: false,
          hour: "2-digit",
          minute: "2-digit",
          second: "2-digit",
        }),
      );
    };
    updateTime();
    const interval = setInterval(updateTime, 1000);
    return () => clearInterval(interval);
  }, []);

  const { startListening, stopListening, listening, supported, audioLevel } =
    useSpeech();
  const { speak: ttsSpeak } = useTTS();

  // Show subtitle with auto-clear
  const showSubtitle = useCallback((text: string, duration?: number) => {
    setSubtitle(text);
    if (subtitleTimeoutRef.current) clearTimeout(subtitleTimeoutRef.current);
    if (duration) {
      subtitleTimeoutRef.current = setTimeout(() => setSubtitle(""), duration);
    }
  }, []);

  const showError = useCallback((text: string, duration = 4000) => {
    setError(text);
    if (errorTimeoutRef.current) clearTimeout(errorTimeoutRef.current);
    errorTimeoutRef.current = setTimeout(() => setError(null), duration);
  }, []);

  useEffect(() => {
    return () => {
      if (subtitleTimeoutRef.current) clearTimeout(subtitleTimeoutRef.current);
      if (errorTimeoutRef.current) clearTimeout(errorTimeoutRef.current);
    };
  }, []);

  // Shared call to the assistant endpoint, used both for a fresh user
  // message and for resolving a pending tool confirmation. Centralising
  // this avoids the two call sites drifting out of sync.
  const callAssistant = useCallback(
    async (
      history: Msg[],
      resolveToolCall?: { approved: boolean },
    ): Promise<void> => {
      setNexusState("thinking");
      showSubtitle("Processing...");

      try {
        const res = await fetch("/api/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            messages: history,
            ...(resolveToolCall ? { resolveToolCall } : {}),
          }),
        });

        if (!res.ok) {
          throw new Error(`Request failed (${res.status})`);
        }

        const data: ChatApiResponse = await res.json();

        if (data.messages) {
          setMessages(data.messages);
          messagesRef.current = data.messages;

          const newCards = extractHudCards(data.messages, history.length);
          if (newCards.length > 0) {
            // Keep at most 4 panels on screen so the HUD doesn't get cluttered.
            setHudCards((prev) => [...prev, ...newCards].slice(-4));
          }
        }

        if (data.status === "needs_confirmation" && data.pendingToolCall) {
          setPending(data.pendingToolCall);
          setNexusState("idle");
          showSubtitle("Confirmation required. Say approve or deny.");
          return;
        }

        const assistantMsg = latestAssistantMessage(data.messages);

        if (assistantMsg?.content) {
          setNexusState("speaking");
          showSubtitle(assistantMsg.content);

          await ttsSpeak(assistantMsg.content, {
            onEnd: () => {
              setNexusState("idle");
              showSubtitle("");
            },
            onError: () => {
              setNexusState("idle");
              showSubtitle("");
            },
          });
        } else {
          setNexusState("idle");
          showSubtitle("");
        }
      } catch (err) {
        setNexusState("idle");
        showSubtitle("Sorry, I encountered an error.", 2000);
        showError(errMsg(err));
      }
    },
    [ttsSpeak, showSubtitle, showError],
  );

  // `startListening` is only wired up once (see effect below), so this
  // ref always points at the *current* handleVoiceInput. That avoids
  // tearing down and rebuilding the recognizer on every state change,
  // which was previously spinning up overlapping recognizer instances
  // and double-submitting the same utterance.
  const latestVoiceHandlerRef = useRef<(text: string) => void>(() => {});

  // Handle voice/text input
  const handleVoiceInput = useCallback(
    async (text: string) => {
      if (
        !text ||
        stateRef.current === "speaking" ||
        stateRef.current === "thinking"
      )
        return;

      const lower = text.toLowerCase();

      // Wake up from sleep
      if (stateRef.current === "sleeping") {
        if (
          lower.includes("wake up") ||
          lower.includes("hey nexus") ||
          lower.includes("nexus")
        ) {
          setNexusState("speaking");
          showSubtitle("All systems online sir, what are we doing today?");

          await ttsSpeak("All systems online sir, what are we doing today?", {
            onEnd: () => {
              setNexusState("idle");
              showSubtitle("");
            },
          });
        }
        return;
      }

      // Sleep command
      if (
        lower.includes("go to sleep") ||
        lower.includes("sleep nexus") ||
        lower.includes("goodnight")
      ) {
        stopListening();
        setNexusState("speaking");
        showSubtitle("Going to sleep mode...");

        await ttsSpeak("Going to sleep mode. Call me when you need me, sir.", {
          onEnd: () => {
            setNexusState("sleeping");
            showSubtitle("");
            setTimeout(() => {
              startListening(latestVoiceHandlerRef.current, (interim) => {
                if (interim) showSubtitle(`"${interim}"`);
              });
            }, 500);
          },
        });
        return;
      }

      const next: Msg[] = [
        ...messagesRef.current,
        { role: "user", content: text },
      ];
      setMessages(next);
      messagesRef.current = next;

      await callAssistant(next);
    },
    [ttsSpeak, startListening, stopListening, showSubtitle, callAssistant],
  );

  // Keep the ref pointed at the latest closure whenever it changes.
  useEffect(() => {
    latestVoiceHandlerRef.current = handleVoiceInput;
  }, [handleVoiceInput]);

  // Start listening once on mount (and whenever browser support changes).
  useEffect(() => {
    if (!supported) return;

    const timer = setTimeout(() => {
      startListening(
        (text) => latestVoiceHandlerRef.current(text),
        (interim) => {
          if (interim && stateRef.current !== "speaking") {
            showSubtitle(`"${interim}"`);
          }
        },
      );
    }, 500);

    return () => {
      clearTimeout(timer);
      stopListening();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [supported]);

  // Handle text input
  const handleTextSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const text = textInput.trim();
    if (text) {
      handleVoiceInput(text);
      setTextInput("");
    }
  };

  // Handle confirmation
  const handleConfirmation = async (approved: boolean) => {
    setPending(null);
    await callAssistant(messagesRef.current, { approved });
  };

  const handleCloseCard = useCallback((id: string) => {
    setHudCards((prev) => prev.filter((c) => c.id !== id));
  }, []);

  return (
    <div className="min-h-screen w-full flex flex-col bg-[#010308] relative overflow-hidden">
      {/* Subtle background grid */}
      <div className="absolute inset-0 pointer-events-none">
        <div
          className="absolute inset-0 opacity-[0.015]"
          style={{
            backgroundImage: `linear-gradient(rgba(0,255,255,0.3) 1px, transparent 1px), linear-gradient(90deg, rgba(0,255,255,0.3) 1px, transparent 1px)`,
            backgroundSize: "80px 80px",
          }}
        />
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] bg-cyan/5 rounded-full blur-3xl" />
      </div>

      {/* Header */}
      <header className="relative z-10 border-b border-cyan/20 bg-black/40 backdrop-blur-sm">
        <div className="flex items-center justify-between px-6 py-4">
          <div className="flex items-center gap-4">
            <h1 className="font-mono font-bold text-lg tracking-[0.4em] text-cyan">
              NEXUS
            </h1>
            <span
              className={`w-1.5 h-1.5 rounded-full ${
                nexusState === "sleeping"
                  ? "bg-cyan/20"
                  : "bg-cyan animate-pulse"
              }`}
            />
            <span className="font-mono text-[10px] text-cyan/40 tracking-[0.3em] uppercase">
              {nexusState === "sleeping" ? "SLEEP_MODE" : "ACTIVE"}
            </span>
          </div>

          <div className="flex items-center gap-4 font-mono text-[10px] text-cyan/40">
            <span className="hidden sm:inline">{systemTime}</span>
            <button
              onClick={() => setShowChat(!showChat)}
              className="text-cyan/40 hover:text-cyan transition-colors tracking-wider"
            >
              [ {showChat ? "HIDE LOG" : "SHOW LOG"} ]
            </button>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="relative z-10 flex-1 flex flex-col items-center justify-center">
        {/* 3D Nexus Scene */}
        <div className="w-full flex-1 relative">
          <NexusSceneClient state={nexusState} audioLevel={audioLevel} />
        </div>

        {/* Subtitle Overlay */}
        <div
          className="absolute bottom-32 left-0 right-0 flex justify-center pointer-events-none"
          aria-live="polite"
        >
          <div className="min-h-[48px] flex items-center justify-center px-6">
            {subtitle && (
              <p
                className="text-cyan/80 text-sm font-mono max-w-lg text-center leading-relaxed animate-in fade-in slide-in-from-bottom-2 duration-300"
                style={{ textShadow: "0 0 10px rgba(0,255,255,0.15)" }}
              >
                {subtitle}
              </p>
            )}
          </div>
        </div>

        {/* Status */}
        <div className="absolute bottom-20 left-0 right-0 flex justify-center pointer-events-none">
          <span className="font-mono text-[10px] text-cyan/40 tracking-[0.3em] uppercase">
            {nexusState === "sleeping" && "SAY 'WAKE UP NEXUS'"}
            {nexusState === "idle" && "LISTENING..."}
            {nexusState === "thinking" && "PROCESSING..."}
            {nexusState === "speaking" && "SPEAKING..."}
          </span>
        </div>

        {/* Error */}
        {error && (
          <div className="absolute bottom-8 left-0 right-0 flex justify-center">
            <div className="max-w-md border border-red-500/30 bg-red-500/5 px-4 py-2 animate-in fade-in">
              <div className="flex items-start gap-2">
                <span className="font-mono text-[10px] text-red-400 tracking-wider">
                  [ ERR ]
                </span>
                <p className="text-xs text-red-300/80 font-mono">{error}</p>
              </div>
            </div>
          </div>
        )}
      </main>

      {/* Chat Log (Hidden by default) */}
      {showChat && (
        <div className="relative z-20 border-t border-cyan/20 bg-black/60 backdrop-blur-sm">
          <div className="max-h-[30vh] overflow-y-auto custom-scrollbar p-4">
            <div className="flex flex-col gap-3">
              {messages
                .filter((m) => m.role === "user" || m.role === "assistant")
                .map((m, i) => (
                  <div
                    key={i}
                    className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}
                  >
                    <div
                      className={`max-w-[80%] p-3 border text-xs font-mono ${
                        m.role === "user"
                          ? "bg-cyan/5 border-cyan/30 text-ink/80"
                          : "bg-black/40 border-cyan/40 text-cyan/80"
                      }`}
                    >
                      <span className="text-[8px] tracking-wider opacity-50 block mb-1">
                        {m.role === "user" ? "[ YOU ]" : "[ NEXUS ]"}
                      </span>
                      {m.content}
                    </div>
                  </div>
                ))}
              <div ref={logEndRef} />
            </div>
          </div>

          {/* Text input */}
          <form
            onSubmit={handleTextSubmit}
            className="flex gap-2 p-3 border-t border-cyan/20"
          >
            <div className="flex-1 flex items-center">
              <span className="pl-3 font-mono text-cyan/50 text-sm">&gt;</span>
              <input
                value={textInput}
                onChange={(e) => setTextInput(e.target.value)}
                placeholder="type a message..."
                className="flex-1 px-3 py-2 bg-transparent font-mono text-sm outline-none placeholder:text-cyan/20 text-ink border border-cyan/20"
              />
            </div>
            <button
              type="submit"
              className="px-4 py-2 border border-cyan/40 text-cyan font-mono text-xs tracking-wider hover:bg-cyan/10 transition-colors"
            >
              [ SEND ]
            </button>
          </form>
        </div>
      )}

      {/* Footer */}
      <footer className="relative z-10 border-t border-cyan/20 bg-black/40 backdrop-blur-sm px-6 py-2">
        <div className="flex justify-between items-center font-mono text-[9px] text-cyan/30 tracking-wider">
          <span>SYS: {nexusState.toUpperCase()}</span>
          <span>VOICE: {listening ? "ACTIVE" : "STANDBY"}</span>
        </div>
      </footer>

      {/* Confirmation Modal */}
      {pending && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 px-6 backdrop-blur-md">
          <div
            className="w-full max-w-md border-2 border-amber-500/40"
            style={{ background: "rgba(0, 0, 0, 0.95)" }}
          >
            <div className="p-6 flex flex-col gap-4">
              <div className="flex items-center gap-3">
                <span className="text-2xl">⚠</span>
                <h2 className="font-mono text-sm tracking-[0.25em] uppercase text-amber-500">
                  CONFIRMATION REQUIRED
                </h2>
              </div>
              <div className="bg-amber-500/5 border border-amber-500/20 p-4">
                <p className="text-xs text-ink/80 font-mono mb-2">
                  <span className="text-amber-500">&gt;</span> Execute:{" "}
                  {pending.name}
                </p>
                <pre className="text-[11px] font-mono bg-black/50 border border-amber-500/20 p-3 text-amber-400/70 overflow-x-auto">
                  {JSON.stringify(pending.arguments, null, 2)}
                </pre>
              </div>
              <div className="flex gap-3 justify-end">
                <button
                  onClick={() => handleConfirmation(false)}
                  className="px-4 py-2 border border-red-500/30 text-red-400/70 font-mono text-xs tracking-wider hover:bg-red-500/10 transition-colors"
                >
                  [ DENY ]
                </button>
                <button
                  onClick={() => handleConfirmation(true)}
                  className="px-4 py-2 border border-amber-500/40 text-amber-500 font-mono text-xs tracking-wider hover:bg-amber-500/10 transition-colors"
                >
                  [ APPROVE ]
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Floating HUD panels — search results, opened sites, etc. */}
      <HudCardStack cards={hudCards} onClose={handleCloseCard} />

      <style jsx>{`
        .custom-scrollbar::-webkit-scrollbar {
          width: 4px;
        }
        .custom-scrollbar::-webkit-scrollbar-track {
          background: rgba(0, 255, 255, 0.05);
        }
        .custom-scrollbar::-webkit-scrollbar-thumb {
          background: rgba(0, 255, 255, 0.2);
          border-radius: 2px;
        }
        .custom-scrollbar::-webkit-scrollbar-thumb:hover {
          background: rgba(0, 255, 255, 0.3);
        }
      `}</style>
    </div>
  );
}
