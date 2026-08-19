"use client";

import { useEffect, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import type { HudCard, HudCardKind } from "./Types";

interface HudCardStackProps {
  cards: HudCard[];
  onClose: (id: string) => void;
}

// Per-kind accent so the stack reads at a glance — cyan for search
// (default telemetry channel), violet for embedded external feeds,
// amber for raw info/fallback payloads.
const KIND_ACCENT: Record<HudCardKind, { rgb: string; readout: string }> = {
  search: { rgb: "56, 217, 255", readout: "QUERY" },
  web: { rgb: "167, 139, 250", readout: "FEED" },
  info: { rgb: "255, 176, 84", readout: "DATA" },
};

function KindIcon({ kind }: { kind: HudCardKind }) {
  const common = "h-3 w-3 shrink-0";
  if (kind === "search") {
    return (
      <svg
        viewBox="0 0 16 16"
        fill="none"
        className={common}
        aria-hidden="true"
      >
        <circle cx="7" cy="7" r="4.5" stroke="currentColor" strokeWidth="1.4" />
        <path
          d="M10.5 10.5L14 14"
          stroke="currentColor"
          strokeWidth="1.4"
          strokeLinecap="round"
        />
      </svg>
    );
  }
  if (kind === "web") {
    return (
      <svg
        viewBox="0 0 16 16"
        fill="none"
        className={common}
        aria-hidden="true"
      >
        <circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="1.3" />
        <path
          d="M2 8h12M8 2c1.8 1.7 2.7 3.8 2.7 6S9.8 12.3 8 14c-1.8-1.7-2.7-3.8-2.7-6S6.2 3.7 8 2z"
          stroke="currentColor"
          strokeWidth="1.1"
        />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 16 16" fill="none" className={common} aria-hidden="true">
      <rect
        x="2.5"
        y="2.5"
        width="11"
        height="11"
        rx="1.5"
        stroke="currentColor"
        strokeWidth="1.3"
      />
      <path
        d="M8 5.5v.01M6.5 11h3M8 7.2v3.3"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinecap="round"
      />
    </svg>
  );
}

// Ring telemetry badge: a rotating dashed ring around the kind icon,
// like a targeting reticle locking on. Purely decorative, motion-safe.
function TelemetryRing({ accent }: { accent: string }) {
  return (
    <span className="pointer-events-none absolute inset-0 -m-1.5">
      <svg
        viewBox="0 0 32 32"
        className="h-8 w-8 motion-safe:animate-[spin_7s_linear_infinite] motion-reduce:hidden"
      >
        <circle
          cx="16"
          cy="16"
          r="14.5"
          fill="none"
          stroke={`rgba(${accent}, 0.45)`}
          strokeWidth="1"
          strokeDasharray="3 5"
        />
      </svg>
    </span>
  );
}

function HudFrame({
  kind,
  title,
  subtitle,
  index,
  onClose,
  children,
}: {
  kind: HudCardKind;
  title: string;
  subtitle?: string;
  index: number;
  onClose: () => void;
  children: ReactNode;
}) {
  const accent = KIND_ACCENT[kind].rgb;
  const notch = 14; // px, size of the angled header-corner cut

  return (
    <section
      className="hud-card group/card relative border bg-[#020608]/95 backdrop-blur-xl motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-right-3 motion-safe:duration-300 motion-reduce:transition-none"
      style={
        {
          "--accent": accent,
          animationDelay: `${Math.min(index, 6) * 60}ms`,
          animationFillMode: "backwards",
          borderColor: `rgba(${accent}, 0.35)`,
          boxShadow: `0 18px 60px rgba(0,0,0,0.6), 0 0 32px rgba(${accent}, 0.12), inset 0 0 40px rgba(${accent}, 0.02)`,
          clipPath: `polygon(0 0, calc(100% - ${notch}px) 0, 100% ${notch}px, 100% 100%, ${notch}px 100%, 0 calc(100% - ${notch}px))`,
        } as React.CSSProperties
      }
    >
      {/* reticle tick marks at each true corner, independent of the clip */}
      <span
        className="pointer-events-none absolute -top-px -left-px h-4 w-4 border-t-2 border-l-2 opacity-90"
        style={{ borderColor: `rgb(${accent})` }}
      />
      <span
        className="pointer-events-none absolute -bottom-px -right-px h-4 w-4 border-b-2 border-r-2 opacity-90"
        style={{ borderColor: `rgb(${accent})` }}
      />
      <span
        className="pointer-events-none absolute -bottom-px -left-px h-3 w-3 border-b-2 border-l-2 opacity-70"
        style={{ borderColor: `rgb(${accent})` }}
      />

      {/* slow vertical scan sweep, faint, sits behind content */}
      <div
        className="pointer-events-none absolute inset-0 overflow-hidden opacity-[0.06] motion-reduce:hidden"
        aria-hidden="true"
      >
        <div
          className="absolute inset-x-0 h-16 motion-safe:animate-[hud-scan_5s_ease-in-out_infinite]"
          style={{
            background: `linear-gradient(to bottom, transparent, rgb(${accent}), transparent)`,
          }}
        />
      </div>

      <div
        className="relative flex items-start justify-between gap-4 border-b px-5 py-3"
        style={{
          borderColor: `rgba(${accent}, 0.2)`,
          background: `rgba(${accent}, 0.05)`,
        }}
      >
        <div className="flex min-w-0 items-start gap-3">
          <span className="relative mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center">
            <TelemetryRing accent={accent} />
            <span
              className="relative flex h-5 w-5 items-center justify-center border"
              style={{
                borderColor: `rgba(${accent}, 0.5)`,
                color: `rgb(${accent})`,
              }}
            >
              <KindIcon kind={kind} />
            </span>
          </span>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span
                className="h-1.5 w-1.5 shrink-0 rounded-full motion-safe:animate-pulse"
                style={{
                  background: `rgb(${accent})`,
                  boxShadow: `0 0 6px rgb(${accent})`,
                }}
                aria-hidden="true"
              />
              <p
                className="truncate font-mono text-[11px] font-semibold uppercase tracking-[0.2em]"
                style={{ color: `rgb(${accent})` }}
              >
                {title}
              </p>
            </div>
            {subtitle && (
              <p className="mt-1 truncate pl-3.5 font-mono text-[10px] leading-relaxed text-white/45">
                {subtitle}
              </p>
            )}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <span
            className="hidden font-mono text-[9px] uppercase tracking-[0.25em] text-white/30 sm:inline"
            aria-hidden="true"
          >
            {KIND_ACCENT[kind].readout}
          </span>
          <button
            onClick={onClose}
            className="border px-2 py-1 font-mono text-[10px] text-white/60 transition-colors hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2"
            style={
              {
                borderColor: `rgba(${accent}, 0.25)`,
                "--tw-outline-color": `rgb(${accent})`,
              } as React.CSSProperties
            }
            onMouseEnter={(e) => {
              e.currentTarget.style.borderColor = `rgba(${accent}, 0.7)`;
              e.currentTarget.style.background = `rgba(${accent}, 0.1)`;
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.borderColor = `rgba(${accent}, 0.25)`;
              e.currentTarget.style.background = "transparent";
            }}
            aria-label="Close panel"
          >
            ×
          </button>
        </div>
      </div>

      <div className="relative p-4">{children}</div>

      {/* footer readout strip — thin, quiet, closes the HUD framing */}
      <div
        className="relative flex items-center justify-between border-t px-5 py-1.5 font-mono text-[9px] uppercase tracking-[0.2em] text-white/25"
        style={{ borderColor: `rgba(${accent}, 0.15)` }}
      >
        <span>link stable</span>
        <span>{String(index + 1).padStart(2, "0")}</span>
      </div>
    </section>
  );
}

function clampStyle(lines: number): React.CSSProperties {
  return {
    display: "-webkit-box",
    WebkitLineClamp: lines,
    WebkitBoxOrient: "vertical",
    overflow: "hidden",
  };
}

function InfoBriefing({ body }: { body?: string }) {
  const sections = (body || "")
    .split(/\n\s*\n/)
    .map((section) => section.trim())
    .filter(Boolean);

  return (
    <div className="space-y-4">
      {sections.map((section, sectionIndex) => {
        const lines = section.split("\n").filter(Boolean);
        const fields = lines.map((line) => line.match(/^([^:\n]{1,30}):\s+(.+)$/));
        const isFieldGroup = lines.length > 0 && fields.every(Boolean);

        if (isFieldGroup) {
          return (
            <dl
              key={sectionIndex}
              className="divide-y divide-[rgba(255,176,84,0.12)] border-y border-[rgba(255,176,84,0.16)]"
            >
              {fields.map((field, index) => (
                <div key={index} className="grid grid-cols-[minmax(88px,0.36fr)_1fr] gap-4 px-1 py-2.5">
                  <dt className="font-mono text-[9px] uppercase tracking-[0.16em] text-[rgba(255,176,84,0.65)]">
                    {field?.[1]}
                  </dt>
                  <dd className="min-w-0 break-words font-display text-sm leading-5 text-white/85">
                    {field?.[2]}
                  </dd>
                </div>
              ))}
            </dl>
          );
        }

        const isList = lines.length > 1 && lines.every((line) => /^[-*•]\s+/.test(line));
        if (isList) {
          return (
            <ul key={sectionIndex} className="space-y-2 border-l border-[rgba(255,176,84,0.35)] pl-4">
              {lines.map((line, index) => (
                <li key={index} className="font-display text-sm leading-6 text-white/80">
                  {line.replace(/^[-*•]\s+/, "")}
                </li>
              ))}
            </ul>
          );
        }

        return (
          <p
            key={sectionIndex}
            className={
              sectionIndex === 0
                ? "font-display text-[15px] leading-6 text-white/95"
                : "font-display text-sm leading-6 text-white/78"
            }
          >
            {section}
          </p>
        );
      })}
    </div>
  );
}

export default function HudCardStack({ cards, onClose }: HudCardStackProps) {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  if (!mounted || cards.length === 0) return null;

  return createPortal(
    <>
      {/* Scoped keyframes + thin themed scrollbars. Kept out of Tailwind
          since scan-sweep and scrollbar-* utilities need extra config. */}
      <style>{`
        @keyframes hud-scan {
          0%   { transform: translateY(-100%); }
          50%  { transform: translateY(340%); }
          100% { transform: translateY(-100%); }
        }
        .hud-stack::-webkit-scrollbar,
        .hud-card ul::-webkit-scrollbar {
          width: 5px;
        }
        .hud-stack::-webkit-scrollbar-track,
        .hud-card ul::-webkit-scrollbar-track {
          background: transparent;
        }
        .hud-stack::-webkit-scrollbar-thumb,
        .hud-card ul::-webkit-scrollbar-thumb {
          background: rgba(56, 217, 255, 0.25);
        }
        .hud-stack::-webkit-scrollbar-thumb:hover,
        .hud-card ul::-webkit-scrollbar-thumb:hover {
          background: rgba(56, 217, 255, 0.45);
        }
      `}</style>

      <div
        className="hud-stack pointer-events-none flex flex-col gap-4"
        style={{
          position: "fixed",
          top: "6rem",
          right: "1rem",
          zIndex: 9999,
          width: "min(400px, calc(100vw - 2rem))",
          maxHeight: "calc(100vh - 6.5rem)",
          overflowY: "auto",
        }}
      >
        {cards.map((card, index) => (
          <div key={card.id} className="pointer-events-auto">
            {card.kind === "search" && (
              <HudFrame
                kind="search"
                title={card.title}
                subtitle={`${card.results?.length ?? 0} result${card.results?.length === 1 ? "" : "s"} retrieved`}
                index={index}
                onClose={() => onClose(card.id)}
              >
                <ul className="max-h-[48vh] space-y-2.5 overflow-y-auto pr-1">
                  {card.results?.map((r, i) => (
                    <li key={i}>
                      <a
                        href={r.url}
                        target="_blank"
                        rel="noreferrer"
                        className="group/item relative block overflow-hidden border border-[rgba(56,217,255,0.18)] bg-[rgba(56,217,255,0.025)] px-4 py-3.5 transition-colors hover:border-[rgba(56,217,255,0.55)] hover:bg-[rgba(56,217,255,0.07)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[rgb(56,217,255)] focus-visible:outline-offset-2"
                      >
                        <span className="pointer-events-none absolute inset-y-0 left-0 w-0 bg-[rgb(56,217,255)] transition-all duration-200 group-hover/item:w-0.5" />
                        <div className="flex items-start gap-3">
                          <span className="mt-0.5 font-mono text-[10px] tabular-nums text-[rgba(56,217,255,0.5)]">
                            {String(i + 1).padStart(2, "0")}
                          </span>
                          <div className="min-w-0 flex-1">
                            <p className="line-clamp-2 font-display text-[15px] font-medium leading-5 text-cyan-50 group-hover/item:underline">
                              {r.title}
                            </p>
                            <p className="mt-1 truncate font-mono text-[9px] text-white/40">
                              {r.url}
                            </p>
                            {r.snippet && (
                              <p
                                className="mt-2 font-display text-xs leading-5 text-white/70"
                                style={clampStyle(1)}
                              >
                                {r.snippet}
                              </p>
                            )}
                          </div>
                        </div>
                      </a>
                    </li>
                  ))}
                  {(!card.results || card.results.length === 0) && (
                    <p className="border border-dashed border-[rgba(56,217,255,0.2)] px-4 py-5 text-center font-mono text-xs text-white/45">
                      No results returned.
                    </p>
                  )}
                </ul>
              </HudFrame>
            )}

            {card.kind === "web" && (
              <HudFrame
                kind="web"
                title={card.title}
                subtitle={card.subtitle}
                index={index}
                onClose={() => onClose(card.id)}
              >
                {card.blocked ? (
                  <div className="flex flex-col items-center justify-center gap-3 border border-dashed border-[rgba(167,139,250,0.25)] py-9 text-center">
                    <p className="font-mono text-[11px] uppercase tracking-wider text-[rgba(167,139,250,0.85)]">
                      Feed blocks external embed
                    </p>
                    <a
                      href={card.url}
                      target="_blank"
                      rel="noreferrer"
                      className="border border-[rgba(167,139,250,0.5)] px-4 py-2.5 font-mono text-xs tracking-wider text-[rgb(167,139,250)] transition-colors hover:bg-[rgba(167,139,250,0.1)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[rgb(167,139,250)] focus-visible:outline-offset-2"
                    >
                      Open in new tab
                    </a>
                  </div>
                ) : (
                  <div className="flex flex-col gap-3">
                    <div className="relative aspect-video w-full overflow-hidden border border-[rgba(167,139,250,0.25)] bg-black/60">
                      <iframe
                        src={card.url}
                        title={card.title}
                        loading="lazy"
                        referrerPolicy="no-referrer"
                        sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
                        className="absolute inset-0 h-full w-full"
                      />
                    </div>
                    <a
                      href={card.url}
                      target="_blank"
                      rel="noreferrer"
                      className="self-end font-mono text-[11px] text-[rgba(167,139,250,0.7)] transition-colors hover:text-[rgb(167,139,250)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[rgb(167,139,250)] focus-visible:outline-offset-2"
                    >
                      Open in new tab ↗
                    </a>
                  </div>
                )}
              </HudFrame>
            )}

            {card.kind === "info" && (
              <HudFrame
                kind="info"
                title={card.title}
                subtitle={card.subtitle}
                index={index}
                onClose={() => onClose(card.id)}
              >
                <InfoBriefing body={card.body} />
              </HudFrame>
            )}
          </div>
        ))}
      </div>
    </>,
    document.body,
  );
}
