"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { useSpeech } from "@/lib/useSpeech";
import { useWhisperSpeech } from "@/lib/useWhisperSpeech";
import { useTTS } from "@/lib/useTTS";
import {
  voiceStartedListening,
  voiceStoppedListening,
  voiceStartedSpeaking,
  voiceStoppedSpeaking,
  VoiceState,
  hasWebSpeech,
} from "@/lib/voice";
import { errMsg } from "@/lib/errors";
import type { OllamaToolCall } from "@/lib/ollama";
import JarvisSceneClient from "./jarvis/JarvisSceneClient";
import HudCardStack from "./hud/Hudcardstack";
import { extractHudCards } from "./hud/Extracthudcards";
import type { HudCard } from "./hud/Types";
import type { ProfileCardData } from "@/lib/types";

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

interface AgentContext {
  agentId: string;
  agentName: string;
  task: string;
}

interface MovieLocationPrompt {
  text: string;
  detectedLocation: string;
  phase: "confirm" | "awaiting_city";
}

interface ChatApiResponse {
  status?: "done" | "needs_confirmation" | "ok";
  pendingToolCall?: PendingConfirmation;
  agentContext?: AgentContext;
  agentRun?: boolean;
  messages?: Msg[];
  workerMessages?: Msg[];
  awaitingAgentReply?: boolean;
  uiCards?: ProfileCardData[];
}

type JarvisState = "sleeping" | "idle" | "listening" | "thinking" | "speaking";

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

function isWebSearchRequest(text: string): boolean {
  return /\b(search|google|weather|forecast|news|headlines|latest|current|today)\b|\blook\s+up\b|\bfind\s+(?:.+\s+)?(?:online|on\s+(?:the\s+)?web|on\s+(?:the\s+)?internet)\b/i.test(
    text,
  );
}

function isMovieRequest(text: string): boolean {
  return /\b(movie|movies|cinema|showtimes?|film|ticket)s?\b/i.test(text);
}

function getCurrentCoordinates(): Promise<string | null> {
  if (typeof navigator === "undefined" || !navigator.geolocation) {
    return Promise.resolve(null);
  }

  return new Promise((resolve) => {
    navigator.geolocation.getCurrentPosition(
      (position) => {
        const { latitude, longitude } = position.coords;
        resolve(`${latitude.toFixed(4)}, ${longitude.toFixed(4)}`);
      },
      () => resolve(null),
      { enableHighAccuracy: true, timeout: 10_000, maximumAge: 60_000 },
    );
  });
}

async function resolveMovieLocation(): Promise<string> {
  const coordinates = await getCurrentCoordinates();
  if (!coordinates) return "";

  try {
    const response = await fetch("/api/location", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ coordinates }),
    });
    if (response.ok) {
      const data: { location?: string } = await response.json();
      if (data.location) return data.location;
    }
  } catch {
    // The coordinates remain a usable fallback if place-name lookup fails.
  }

  return coordinates;
}

// Keep UI formatting, URLs, and Markdown syntax out of the subtitle and TTS
// payload. The chat log still retains the original response for reference.
function spokenAnswer(content: string): string {
  const structuredCardStart = content.indexOf('{"name"');
  const answer =
    structuredCardStart === -1
      ? content
      : content.slice(0, structuredCardStart).trim();

  return answer
    .replace(/```[\s\S]*?```/g, "")
    .replace(/\[([^\]]+)\]\(https?:\/\/[^)]+\)/g, "$1")
    .replace(/https?:\/\/\S+/g, "")
    .replace(/[\*_~`#>|]/g, "")
    .replace(/≈/g, "about ")
    .replace(/&/g, "and")
    .replace(/[\[\]{}()]/g, " ")
    .replace(/\s*[–—]\s*/g, ", ")
    .replace(/\s+-\s+/g, ", ")
    .replace(/\b(\d+)\s*[×x]\s+(shows?|tickets?)\b/gi, "$1 $2")
    .replace(/[•]/g, ". ")
    .replace(/\s{2,}/g, " ")
    .trim();
}

// Voice answers are often a mix of a clear conclusion, follow-up detail, and
// occasional lists. Present those as a compact briefing instead of a terminal
// dump, while leaving the original message untouched in the chat history.
function AnswerBriefing({ text }: { text: string }) {
  const sections = text
    .split(/\n\s*\n/)
    .map((section) => section.trim())
    .filter(Boolean);

  const renderSection = (section: string, index: number): ReactNode => {
    const lines = section.split("\n").filter(Boolean);
    const isList = lines.length > 1 && lines.every((line) => /^[-*•]\s+/.test(line));

    if (isList) {
      return (
        <ul key={`${section}-${index}`} className="mt-3 space-y-2 border-l border-cyan/25 pl-4">
          {lines.map((line, lineIndex) => (
            <li key={lineIndex} className="font-display text-sm leading-6 text-slate-200/85">
              {line.replace(/^[-*•]\s+/, "")}
            </li>
          ))}
        </ul>
      );
    }

    return (
      <p
        key={`${section}-${index}`}
        className={
          index === 0
            ? "font-display text-[17px] font-medium leading-7 text-white sm:text-lg"
            : "font-display text-sm leading-6 text-slate-200/80"
        }
      >
        {section}
      </p>
    );
  };

  return <div className="space-y-3">{sections.map(renderSection)}</div>;
}

// Each browser session gets a stable conversation id (kept in localStorage) so
// Jarvis can persist and restore the conversation across page reloads.
function getOrCreateConversationId(): string {
  if (typeof window === "undefined") return `conv-${Date.now()}`;
  const existing = localStorage.getItem("jarvis-conversation-id");
  if (existing) return existing;
  const id = `conv-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  localStorage.setItem("jarvis-conversation-id", id);
  return id;
}

export default function ChatInterface() {
  const [jarvisState, setJarvisState] = useState<JarvisState>("sleeping");
  const [subtitle, setSubtitle] = useState("");
  const [showChat, setShowChat] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [systemTime, setSystemTime] = useState("");
  const [messages, setMessages] = useState<Msg[]>([]);
  const [textInput, setTextInput] = useState("");
  const [pending, setPending] = useState<PendingConfirmation | null>(null);
  const [pendingAgentContext, setPendingAgentContext] =
    useState<AgentContext | null>(null);
  const [hudCards, setHudCards] = useState<HudCard[]>([]);

  const messagesRef = useRef<Msg[]>([]);
  const pendingWorkerMessagesRef = useRef<Msg[] | null>(null);
  const activeAgentContextRef = useRef<AgentContext | null>(null);
  const activeAgentDisplayHistoryRef = useRef<Msg[] | null>(null);
  const subtitleTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const errorTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const stateRef = useRef<JarvisState>("sleeping");
  const logEndRef = useRef<HTMLDivElement | null>(null);
  const subtitlePanelRef = useRef<HTMLDivElement | null>(null);
  const pendingSearchCardIdRef = useRef<string | null>(null);
  const turnHudCardIdsRef = useRef(new Set<string>());
  const latestVoiceHandlerRef = useRef<(text: string) => void>(() => {});
  const movieLocationPromptRef = useRef<MovieLocationPrompt | null>(null);
  const resolvedMovieLocationRef = useRef<string | null>(null);
  const conversationIdRef = useRef<string>(getOrCreateConversationId());

  const closeTurnHudCards = useCallback(() => {
    // State updates are queued. Copy the IDs before clearing the ref so the
    // updater still knows which panels belong to the just-finished response.
    const cardIds = new Set(turnHudCardIdsRef.current);
    if (cardIds.size > 0) {
      setHudCards((prev) => prev.filter((card) => !cardIds.has(card.id)));
    }
    turnHudCardIdsRef.current.clear();
    pendingSearchCardIdRef.current = null;
  }, []);

  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

  useEffect(() => {
    stateRef.current = jarvisState;
  }, [jarvisState]);

  // Restore the persisted conversation for this session on mount.
  useEffect(() => {
    const id = conversationIdRef.current;
    fetch(`/api/chat?conversationId=${encodeURIComponent(id)}`)
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (data?.messages && data.messages.length > 0) {
          setMessages(data.messages);
          messagesRef.current = data.messages;
        }
      })
      .catch(() => {
        // No persisted conversation — start fresh.
      });
  }, []);

  // Auto-scroll the log to the newest message.
  useEffect(() => {
    if (showChat) logEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, showChat]);

  // Reset the long-subtitle panel scroll whenever a new subtitle arrives.
  useEffect(() => {
    if (subtitlePanelRef.current) subtitlePanelRef.current.scrollTop = 0;
  }, [subtitle]);

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

  const browserSpeech = useSpeech();
  const whisperSpeech = useWhisperSpeech();
  const {
    startListening,
    stopListening,
    listening,
    supported,
    audioLevel,
  } =
    process.env.NEXT_PUBLIC_JARVIS_STT_PROVIDER === "whisper"
      ? whisperSpeech
      : browserSpeech;
  const { speak: ttsSpeak, speakStatus } = useTTS();

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

  const resumeListening = useCallback(() => {
    setTimeout(() => {
      if (stateRef.current === "sleeping") return;
      startListening(latestVoiceHandlerRef.current, (interim) => {
        if (interim && stateRef.current !== "speaking") {
          showSubtitle(`"${interim}"`);
        }
      });
    }, 250);
  }, [startListening, showSubtitle]);

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
      agentContext?: AgentContext | null,
    ): Promise<void> => {
      // Do not let recognition consume Jarvis's own status/final speech.
      // It is restarted explicitly once playback completes.
      stopListening();
      setJarvisState("thinking");
      showSubtitle("Processing...");

      const latestUserText = [...history]
        .reverse()
        .find((message) => message.role === "user")?.content;
      // Speak the existing status prompts while the request is in flight.
      // The answer's TTS call cancels this status line as soon as it is ready.
      void speakStatus(
        latestUserText && isWebSearchRequest(latestUserText)
          ? "searching"
          : "processing",
      );

      try {
        const res = await fetch("/api/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            messages: history,
            conversationId: conversationIdRef.current,
            ...(resolveToolCall ? { resolveToolCall } : {}),
            ...(agentContext ? { agentContext } : {}),
          }),
        });

        if (!res.ok) {
          throw new Error(`Request failed (${res.status})`);
        }

        const data: ChatApiResponse = await res.json();

        if (data.messages) {
          // A worker keeps its own private tool transcript. Keep the user's
          // main chat readable by showing the original request and only the
          // worker's final answer, while retaining its full transcript solely
          // for a confirmation/resume request.
          const workerAnswer = latestAssistantMessage(data.messages);
          if (data.agentRun && !activeAgentDisplayHistoryRef.current) {
            activeAgentDisplayHistoryRef.current = history;
          }
          const agentDisplayHistory =
            activeAgentDisplayHistoryRef.current || history;
          const displayMessages = data.agentRun
            ? data.status === "needs_confirmation" || !workerAnswer
              ? agentDisplayHistory
              : [...agentDisplayHistory, workerAnswer]
            : data.messages;
          setMessages(displayMessages);
          messagesRef.current = displayMessages;

          if (data.agentRun && data.workerMessages && data.agentContext) {
            pendingWorkerMessagesRef.current = data.workerMessages;
            const continuesAgentRun =
              data.awaitingAgentReply || data.status === "needs_confirmation";
            activeAgentContextRef.current = continuesAgentRun
              ? data.agentContext
              : null;
            if (!continuesAgentRun) {
              activeAgentDisplayHistoryRef.current = null;
            }
          } else if (data.agentRun) {
            pendingWorkerMessagesRef.current = null;
            activeAgentContextRef.current = null;
            activeAgentDisplayHistoryRef.current = null;
          }

          const newCards = extractHudCards(
            data.messages,
            history.length,
            data.uiCards,
          );
          if (newCards.length > 0) {
            newCards.forEach((card) => turnHudCardIdsRef.current.add(card.id));
            const pendingSearchCardId = pendingSearchCardIdRef.current;
            // Replace the temporary searching panel with the completed
            // result, keeping the response in one compact right-side slot.
            setHudCards((prev) =>
              [
                ...prev.filter((card) => card.id !== pendingSearchCardId),
                ...newCards,
              ].slice(-4),
            );
            pendingSearchCardIdRef.current = null;
          }
        }

        if (data.status === "needs_confirmation" && data.pendingToolCall) {
          setPending(data.pendingToolCall);
          setPendingAgentContext(data.agentContext || null);
          setJarvisState("idle");
          showSubtitle("Confirmation required. Say approve or deny.");
          return;
        }

        const assistantMsg = latestAssistantMessage(data.messages);

        if (assistantMsg?.content) {
          const answer = spokenAnswer(assistantMsg.content);
          if (!answer) {
            stateRef.current = "idle";
            setJarvisState("idle");
            showSubtitle("");
            closeTurnHudCards();
            resumeListening();
            return;
          }
          setJarvisState("speaking");
          showSubtitle(answer);

          await ttsSpeak(answer, {
            onEnd: () => {
              stateRef.current = "idle";
              setJarvisState("idle");
              showSubtitle("");
              closeTurnHudCards();
              resumeListening();
            },
            onError: () => {
              stateRef.current = "idle";
              setJarvisState("idle");
              showSubtitle("");
              closeTurnHudCards();
              resumeListening();
            },
          });
        } else {
          setJarvisState("idle");
          showSubtitle("");
          closeTurnHudCards();
          resumeListening();
        }
      } catch (err) {
        setJarvisState("idle");
        showSubtitle("Sorry, I encountered an error.", 2000);
        showError(errMsg(err));
        resumeListening();
      }
    },
    [
      ttsSpeak,
      speakStatus,
      stopListening,
      showSubtitle,
      showError,
      closeTurnHudCards,
      resumeListening,
    ],
  );

  // `startListening` is only wired up once (see effect below), so this
  // ref always points at the *current* handleVoiceInput. That avoids
  // tearing down and rebuilding the recognizer on every state change,
  // which was previously spinning up overlapping recognizer instances
  // and double-submitting the same utterance.
  // Handle voice/text input
  const handleVoiceInput = useCallback(
    async (text: string, selectedMovieLocation?: string) => {
      if (
        !text ||
        stateRef.current === "speaking" ||
        stateRef.current === "thinking"
      )
        return;

      const lower = text.toLowerCase();
      const resolvedMovieLocation =
        selectedMovieLocation ?? resolvedMovieLocationRef.current;
      resolvedMovieLocationRef.current = null;

      // Wake up from sleep
      if (stateRef.current === "sleeping") {
        if (
          lower.includes("wake up") ||
          lower.includes("hey jarvis") ||
          lower.includes("jarvis")
        ) {
          setJarvisState("speaking");
          showSubtitle("At your service, sir.");

          await ttsSpeak("At your service, sir.", {
            onEnd: () => {
              setJarvisState("idle");
              showSubtitle("");
            },
          });
        }
        return;
      }

      const movieLocationPrompt = movieLocationPromptRef.current;
      if (movieLocationPrompt) {
        stopListening();
        const prompt = movieLocationPrompt;
        const confirmed =
          /\b(yes|yeah|yep|correct|confirm|use it|search there|that'?s right)\b/i.test(
            text,
          );
        const rejected = /\b(no|nope|wrong|change it|different)\b/i.test(text);

        if (
          prompt.phase === "confirm" &&
          confirmed &&
          prompt.detectedLocation
        ) {
          movieLocationPromptRef.current = null;
          resolvedMovieLocationRef.current = prompt.detectedLocation;
          void latestVoiceHandlerRef.current(prompt.text);
          return;
        }

        if (prompt.phase === "confirm" && rejected) {
          movieLocationPromptRef.current = {
            ...prompt,
            phase: "awaiting_city",
          };
          setJarvisState("speaking");
          showSubtitle("Tell me the city or area to search.");
          await ttsSpeak("Okay. Tell me the city or area to search.", {
            onEnd: () => {
              setJarvisState("idle");
              showSubtitle("");
              resumeListening();
            },
          });
          return;
        }

        // A city spoken in response to either prompt is used directly.
        movieLocationPromptRef.current = null;
        resolvedMovieLocationRef.current = text.trim();
        void latestVoiceHandlerRef.current(prompt.text);
        return;
      }

      // Leave completed results on screen until the user dismisses them.
      // This is checked before sending text to the model, so it works as a
      // direct voice command and does not produce an unnecessary AI reply.
      if (
        /\b(close|dismiss|hide)\s+(?:the\s+)?(?:pop\s*-?\s*up|card|panel|search(?:\s+results)?)\b/i.test(
          lower,
        )
      ) {
        setHudCards([]);
        turnHudCardIdsRef.current.clear();
        pendingSearchCardIdRef.current = null;
        setJarvisState("speaking");
        showSubtitle("Closing the panel.");
        await ttsSpeak("Closing the panel.", {
          onEnd: () => {
            setJarvisState("idle");
            showSubtitle("");
          },

          onError: () => {
            setJarvisState("idle");
            showSubtitle("");
          },
        });
        return;
      }

      // Sleep command
      if (
        lower.includes("go to sleep") ||
        lower.includes("sleep jarvis") ||
        lower.includes("goodnight")
      ) {
        stopListening();
        setJarvisState("speaking");
        showSubtitle("Going to sleep mode...");

        await ttsSpeak("Going to sleep mode. Call me when you need me, sir.", {
          onEnd: () => {
            setJarvisState("sleeping");
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

      let requestText = text;
      if (isMovieRequest(text) && !resolvedMovieLocation) {
        stopListening();
        showSubtitle("Checking your location for nearby cinemas...");
        const detectedLocation = await resolveMovieLocation();
        const hasDetectedLocation = Boolean(detectedLocation);
        movieLocationPromptRef.current = {
          text,
          detectedLocation,
          phase: hasDetectedLocation ? "confirm" : "awaiting_city",
        };
        setJarvisState("speaking");
        const prompt = hasDetectedLocation
          ? `I found ${detectedLocation}. Should I search for movies there? Say yes, no, or tell me another city.`
          : "I could not detect your location. Tell me the city or area to search.";
        showSubtitle(prompt);
        await ttsSpeak(prompt, {
          onEnd: () => {
            setJarvisState("idle");
            showSubtitle("");
            resumeListening();
          },
        });
        return;
      }
      if (resolvedMovieLocation) {
        requestText = `${text}\n\nUser-confirmed movie-search location: ${resolvedMovieLocation}. Use only this location for nearby cinema results.`;
      }

      const next: Msg[] = [
        ...messagesRef.current,
        { role: "user", content: requestText },
      ];
      setMessages(next);
      messagesRef.current = next;

      if (activeAgentContextRef.current) {
        activeAgentDisplayHistoryRef.current = next;
      }

      // Open feedback immediately for an explicit search request. This is
      // independent of the model's eventual wording/tool choice, so the HUD
      // never stays silent while a web lookup is underway.
      if (isWebSearchRequest(text) || isMovieRequest(text)) {
        const cardId = `search-request-${Date.now()}`;
        pendingSearchCardIdRef.current = cardId;
        turnHudCardIdsRef.current.add(cardId);
        setHudCards((prev) =>
          [
            ...prev,
            {
              id: cardId,
              kind: "info" as const,
              title: "WEB SEARCH",
              subtitle: isMovieRequest(text)
                ? "Nearby cinemas and showtimes"
                : text,
              body: isMovieRequest(text)
                ? "Finding nearby movies…"
                : "Searching online…",
            },
          ].slice(-4),
        );
      }

      const activeAgentContext = activeAgentContextRef.current;
      const workerHistory = pendingWorkerMessagesRef.current;
      const requestHistory =
        activeAgentContext && workerHistory
          ? [...workerHistory, { role: "user" as const, content: requestText }]
          : next;
      await callAssistant(requestHistory, undefined, activeAgentContext);
    },
    [
      ttsSpeak,
      startListening,
      stopListening,
      showSubtitle,
      callAssistant,
      resumeListening,
    ],
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
    const agentContext = pendingAgentContext;
    setPendingAgentContext(null);
    const workerMessages = pendingWorkerMessagesRef.current;
    await callAssistant(
      workerMessages || messagesRef.current,
      { approved },
      agentContext,
    );
  };

  const handleCloseCard = useCallback((id: string) => {
    setHudCards((prev) => prev.filter((c) => c.id !== id));
  }, []);

  // Handle proactive events from the server (reminders, system alerts) that
  // arrive via SSE. Only speaks when Jarvis is idle; if it's mid-response or
  // sleeping, the event is shown as a card + subtitle so nothing is lost.
  const handleProactiveEvent = useCallback(
    async (event: {
      type: string;
      title: string;
      body: string;
      reminderId?: number;
    }) => {
      const body = (event.body || "").trim();
      const title = (event.title || "Jarvis").trim();
      if (!body) return;

      const cardId = `proactive-${Date.now()}`;
      setHudCards((prev) =>
        [
          ...prev.filter((c) => c.id !== cardId),
          {
            id: cardId,
            kind: "info" as const,
            title,
            subtitle: body,
            body: `${title}: ${body}`,
          },
        ].slice(-4),
      );

      showSubtitle(body);
      if (stateRef.current === "idle") {
        setJarvisState("speaking");
        await ttsSpeak(body, {
          onEnd: () => {
            stateRef.current = "idle";
            setJarvisState("idle");
            showSubtitle("");
            resumeListening();
          },
          onError: () => {
            stateRef.current = "idle";
            setJarvisState("idle");
            showSubtitle("");
            resumeListening();
          },
        });
      }
    },
    [showSubtitle, resumeListening, ttsSpeak],
  );

  // Keep a ref to the latest handler so the SSE connection never captures a
  // stale closure.
  const proactiveHandlerRef = useRef(handleProactiveEvent);
  useEffect(() => {
    proactiveHandlerRef.current = handleProactiveEvent;
  }, [handleProactiveEvent]);

  // Open a Server-Sent Events connection to receive proactive alerts
  // (reminders, system health) with automatic reconnection + backoff.
  useEffect(() => {
    let source: EventSource | null = null;
    let retries = 0;
    let closed = false;

    const connect = () => {
      if (closed) return;
      source?.close();
      source = new EventSource("/api/events");

      const onEvent = (e: MessageEvent) => {
        try {
          const data = JSON.parse(e.data) as {
            type: string;
            title: string;
            body: string;
            reminderId?: number;
          };
          void proactiveHandlerRef.current(data);
        } catch {
          // Ignore malformed messages.
        }
      };

      source.addEventListener("reminder", onEvent);
      source.addEventListener("notification", onEvent);
      source.addEventListener("system", onEvent);

      source.onopen = () => {
        retries = 0;
      };

      source.onerror = () => {
        source?.close();
        if (closed) return;
        retries++;
        const delay = Math.min(30_000, 1_000 * 2 ** retries);
        setTimeout(connect, delay);
      };
    };

    connect();
    return () => {
      closed = true;
      source?.close();
    };
  }, []);

  return (
    <div className="min-h-screen w-full flex flex-col bg-[#010308] relative overflow-x-hidden">
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
              JARVIS
            </h1>
            <span
              className={`w-1.5 h-1.5 rounded-full ${
                jarvisState === "sleeping"
                  ? "bg-cyan/20"
                  : "bg-cyan animate-pulse"
              }`}
            />
            <span className="font-mono text-[10px] text-cyan/40 tracking-[0.3em] uppercase">
              {jarvisState === "sleeping" ? "SLEEP_MODE" : "ACTIVE"}
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
        {/* 3D Jarvis Scene */}
        <div className="w-full flex-1 relative">
          <JarvisSceneClient state={jarvisState} audioLevel={audioLevel} />
        </div>

        {/* Subtitle Overlay */}
        <div
          className={`absolute bottom-32 left-6 right-6 flex justify-center pointer-events-none transition-[right] duration-300 ${
            hudCards.length > 0 ? "lg:right-[29rem]" : ""
          }`}
          aria-live="polite"
        >
          {subtitle && subtitle.length > 140 ? (
            // Long transcript — show it in a proper HUD panel instead of a
            // single tall paragraph so it stays readable and scrollable.
            <div
              ref={subtitlePanelRef}
              className="subtitle-panel w-full max-w-2xl max-h-[38vh] overflow-y-auto border border-cyan/20 bg-black/85 backdrop-blur-md px-6 py-4 animate-in fade-in slide-in-from-bottom-2 duration-300 pointer-events-auto"
              style={{
                boxShadow:
                  "0 12px 40px rgba(0,0,0,0.5), 0 0 24px rgba(0,255,255,0.06), inset 0 0 40px rgba(0,255,255,0.02)",
              }}
            >
              <div className="mb-2.5 flex items-center gap-2">
                <span className="h-1.5 w-1.5 rounded-full bg-cyan animate-pulse" />
                <span className="font-mono text-[9px] uppercase tracking-[0.3em] text-cyan/50">
                  N E X U S
                </span>
              </div>
              <AnswerBriefing text={subtitle} />
            </div>
          ) : (
            // Short status/interim — keep the clean centered one-liner.
            <div className="min-h-[48px] flex w-full items-center justify-center">
              {subtitle && (
                <div className="max-w-xl border-l-2 border-cyan/60 bg-black/70 px-4 py-2 text-center shadow-[0_0_22px_rgba(0,255,255,0.06)] animate-in fade-in slide-in-from-bottom-2 duration-300">
                  <p className="font-display text-[15px] leading-6 text-slate-100/90">
                    {subtitle}
                  </p>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Status */}
        <div className="absolute bottom-20 left-0 right-0 flex justify-center pointer-events-none">
          <span className="font-mono text-[10px] text-cyan/40 tracking-[0.3em] uppercase">
            {jarvisState === "sleeping" && "SAY 'WAKE UP JARVIS'"}
            {jarvisState === "idle" && "LISTENING..."}
            {jarvisState === "thinking" && "Processing..."}
            {jarvisState === "speaking" && "SPEAKING..."}
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
                        {m.role === "user" ? "[ YOU ]" : "[ JARVIS ]"}
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
          <span>SYS: {jarvisState.toUpperCase()}</span>
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
                {pendingAgentContext && (
                  <p className="text-[10px] text-amber-400/70 font-mono mb-2">
                    Requested by: {pendingAgentContext.agentName}
                  </p>
                )}
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
        .subtitle-panel {
          scrollbar-width: thin;
          scrollbar-color: rgba(0, 255, 255, 0.25) transparent;
        }
        .subtitle-panel::-webkit-scrollbar {
          width: 4px;
        }
        .subtitle-panel::-webkit-scrollbar-track {
          background: rgba(0, 255, 255, 0.05);
        }
        .subtitle-panel::-webkit-scrollbar-thumb {
          background: rgba(0, 255, 255, 0.2);
          border-radius: 2px;
        }
        .subtitle-panel::-webkit-scrollbar-thumb:hover {
          background: rgba(0, 255, 255, 0.3);
        }
      `}</style>
    </div>
  );
}
