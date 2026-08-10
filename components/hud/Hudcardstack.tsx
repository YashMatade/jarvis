"use client";

import type { ReactNode } from "react";
import type { HudCard } from "./Types";

interface HudCardStackProps {
  cards: HudCard[];
  onClose: (id: string) => void;
}

function HudFrame({
  title,
  subtitle,
  onClose,
  children,
}: {
  title: string;
  subtitle?: string;
  onClose: () => void;
  children: ReactNode;
}) {
  return (
<div className="relative border border-cyan/30 bg-black/50 backdrop-blur-md shadow-[0_0_25px_rgba(0,255,255,0.08)] animate-in fade-in slide-in-from-right-4 duration-300">
      {/* corner brackets, HUD-style */}
      <span className="pointer-events-none absolute -top-px -left-px w-3 h-3 border-t border-l border-cyan/70" />
      <span className="pointer-events-none absolute -top-px -right-px w-3 h-3 border-t border-r border-cyan/70" />
      <span className="pointer-events-none absolute -bottom-px -left-px w-3 h-3 border-b border-l border-cyan/70" />
      <span className="pointer-events-none absolute -bottom-px -right-px w-3 h-3 border-b border-r border-cyan/70" />

      <div className="flex items-start justify-between gap-3 px-4 py-2.5 border-b border-cyan/15">
        <div className="min-w-0">
          <p className="font-mono text-[10px] tracking-[0.25em] uppercase text-cyan/90 truncate">
            {title}
          </p>
          {subtitle && (
            <p className="font-mono text-[9px] text-cyan/40 truncate">{subtitle}</p>
          )}
        </div>
        <button
          onClick={onClose}
          className="shrink-0 font-mono text-[9px] text-cyan/40 hover:text-cyan transition-colors"
          aria-label="Close panel"
        >
          [ X ]
        </button>
      </div>

      <div className="p-4">{children}</div>
    </div>    
    
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

export default function HudCardStack({ cards, onClose }: HudCardStackProps) {
  if (cards.length === 0) return null;

  return (
    <div className="fixed top-24 right-4 z-40 flex flex-col gap-3 w-[min(380px,92vw)] pointer-events-none">
      {cards.map((card) => (
        <div key={card.id} className="pointer-events-auto">
          {card.kind === "search" && (
            <HudFrame
              title={card.title}
              subtitle={`${card.results?.length ?? 0} results`}
              onClose={() => onClose(card.id)}
            >
              <ul className="flex flex-col gap-3">
                {card.results?.map((r, i) => (
                  <li key={i}>
                    <a href={r.url} target="_blank" rel="noreferrer" className="block group">
                      <p className="font-mono text-xs text-cyan group-hover:underline truncate">
                        {r.title}
                      </p>
                      <p className="font-mono text-[10px] text-cyan/40 truncate">{r.url}</p>
                      {r.snippet && (
                        <p className="text-xs text-ink/70 mt-1" style={clampStyle(2)}>
                          {r.snippet}
                        </p>
                      )}
                    </a>
                  </li>
                ))}
                {(!card.results || card.results.length === 0) && (
                  <p className="text-xs text-ink/50 font-mono">No results.</p>
                )}
              </ul>
            </HudFrame>
          )}

          {card.kind === "web" && (
            <HudFrame title={card.title} subtitle={card.subtitle} onClose={() => onClose(card.id)}>
              {card.blocked ? (
                <div className="flex flex-col items-center justify-center gap-3 py-8 text-center">
                  <p className="font-mono text-[10px] text-cyan/50 tracking-wider uppercase">
                    Site blocks embedding
                  </p>
                  <a
                    href={card.url}
                    target="_blank"
                    rel="noreferrer"
                    className="px-4 py-2 border border-cyan/40 text-cyan font-mono text-xs tracking-wider hover:bg-cyan/10 transition-colors"
                  >
                    [ LAUNCH ]
                  </a>
                </div>
              ) : (
                <div className="flex flex-col gap-2">
                  <div className="relative w-full aspect-video border border-cyan/15 bg-black/40 overflow-hidden">
                    <iframe
                      src={card.url}
                      title={card.title}
                      loading="lazy"
                      referrerPolicy="no-referrer"
                      sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
                      className="absolute inset-0 w-full h-full"
                    />
                  </div>
                  <a
                    href={card.url}
                    target="_blank"
                    rel="noreferrer"
                    className="self-end font-mono text-[10px] text-cyan/50 hover:text-cyan transition-colors"
                  >
                    Open in new tab ↗
                  </a>
                </div>
              )}
            </HudFrame>
          )}

          {card.kind === "info" && (
            <HudFrame title={card.title} subtitle={card.subtitle} onClose={() => onClose(card.id)}>
              <p className="text-xs text-ink/80 font-mono whitespace-pre-wrap">{card.body}</p>
            </HudFrame>
          )}
        </div>
      ))}
    </div>
  );
}