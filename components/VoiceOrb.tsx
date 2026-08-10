"use client";

import { useEffect, useRef, useState } from "react";

export type OrbState = "idle" | "listening" | "thinking" | "speaking";

const STATE_COLOR: Record<OrbState, string> = {
  idle: "var(--cyan-dim)",
  listening: "var(--cyan)",
  thinking: "var(--amber)",
  speaking: "var(--cyan)",
};

const STATE_HEX: Record<OrbState, string> = {
  idle: "#0ff",
  listening: "#0ff",
  thinking: "#ffbf00",
  speaking: "#0ff",
};

export default function VoiceOrb({ state }: { state: OrbState }) {
  const color = STATE_COLOR[state];
  const hexColor = STATE_HEX[state];
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [particles] = useState(() =>
    Array.from({ length: 40 }, () => ({
      angle: Math.random() * Math.PI * 2,
      radius: 60 + Math.random() * 40,
      speed: 0.2 + Math.random() * 0.8,
      size: 1 + Math.random() * 2,
      opacity: 0.2 + Math.random() * 0.6,
      pulseSpeed: 0.02 + Math.random() * 0.05,
      pulseOffset: Math.random() * Math.PI * 2,
    })),
  );

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let animationId: number;
    let time = 0;

    const animate = () => {
      time += 0.016;
      ctx.clearRect(0, 0, canvas.width, canvas.height);

      const centerX = canvas.width / 2;
      const centerY = canvas.height / 2;

      // Draw orbital particles
      particles.forEach((p) => {
        p.angle +=
          p.speed *
          0.01 *
          (state === "thinking" ? 3 : state === "listening" ? 1.5 : 1);

        const x = centerX + Math.cos(p.angle) * p.radius;
        const y = centerY + Math.sin(p.angle) * p.radius;

        const pulse =
          Math.sin(time * p.pulseSpeed * 60 + p.pulseOffset) * 0.3 + 0.7;
        const alpha = p.opacity * pulse * (state === "idle" ? 0.3 : 1);

        ctx.beginPath();
        ctx.arc(x, y, p.size, 0, Math.PI * 2);
        ctx.fillStyle = hexColor;
        ctx.globalAlpha = alpha;
        ctx.fill();

        // Particle glow
        ctx.beginPath();
        ctx.arc(x, y, p.size * 2, 0, Math.PI * 2);
        ctx.fillStyle = hexColor;
        ctx.globalAlpha = alpha * 0.3;
        ctx.fill();
      });

      ctx.globalAlpha = 1;

      // Draw orbiting rings
      if (state === "thinking") {
        for (let i = 0; i < 3; i++) {
          const ringRadius = 100 + i * 8;
          const rotation = time * (2 - i * 0.5);

          ctx.beginPath();
          ctx.arc(
            centerX,
            centerY,
            ringRadius,
            rotation,
            rotation + Math.PI * 0.8,
          );
          ctx.strokeStyle = hexColor;
          ctx.globalAlpha = 0.2 - i * 0.05;
          ctx.lineWidth = 1;
          ctx.stroke();

          // Orbiting dot on ring
          const dotX =
            centerX + Math.cos(rotation + Math.PI * 0.8) * ringRadius;
          const dotY =
            centerY + Math.sin(rotation + Math.PI * 0.8) * ringRadius;

          ctx.beginPath();
          ctx.arc(dotX, dotY, 2, 0, Math.PI * 2);
          ctx.fillStyle = hexColor;
          ctx.globalAlpha = 0.6;
          ctx.fill();
        }
      }

      // Listening waveform
      if (state === "listening") {
        for (let i = 0; i < 3; i++) {
          const baseRadius = 70 + i * 15;
          const points = 100;

          ctx.beginPath();
          for (let j = 0; j <= points; j++) {
            const angle = (j / points) * Math.PI * 2;
            const wave =
              Math.sin(angle * 8 + time * 10 + i) *
              5 *
              (state === "listening" ? 1 : 0);
            const r = baseRadius + wave;
            const x = centerX + Math.cos(angle) * r;
            const y = centerY + Math.sin(angle) * r;

            if (j === 0) ctx.moveTo(x, y);
            else ctx.lineTo(x, y);
          }
          ctx.closePath();
          ctx.strokeStyle = hexColor;
          ctx.globalAlpha = 0.15 - i * 0.03;
          ctx.lineWidth = 1;
          ctx.stroke();
        }
      }

      // Speaking sound waves
      if (state === "speaking") {
        for (let i = 0; i < 4; i++) {
          const radius = 80 + i * 15;
          const intensity = (Math.sin(time * 5 + i) + 1) / 2;

          ctx.beginPath();
          ctx.arc(centerX, centerY, radius + intensity * 10, 0, Math.PI * 2);
          ctx.strokeStyle = hexColor;
          ctx.globalAlpha = 0.3 * (1 - i * 0.2) * intensity;
          ctx.lineWidth = 1;
          ctx.stroke();

          // Frequency bars
          const barCount = 12 + i * 4;
          for (let j = 0; j < barCount; j++) {
            const angle = (j / barCount) * Math.PI * 2;
            const barHeight =
              (Math.sin(time * 8 + j * 0.5 + i) + 1) * 8 * intensity;
            const x1 = centerX + Math.cos(angle) * (radius - 5);
            const y1 = centerY + Math.sin(angle) * (radius - 5);
            const x2 = centerX + Math.cos(angle) * (radius + barHeight);
            const y2 = centerY + Math.sin(angle) * (radius + barHeight);

            ctx.beginPath();
            ctx.moveTo(x1, y1);
            ctx.lineTo(x2, y2);
            ctx.strokeStyle = hexColor;
            ctx.globalAlpha = 0.4 * intensity;
            ctx.lineWidth = 1.5;
            ctx.stroke();
          }
        }
      }

      // Hexagonal grid overlay
      const hexSize = 20;
      const hexWidth = hexSize * 2;
      const hexHeight = Math.sqrt(3) * hexSize;

      ctx.globalAlpha = state === "idle" ? 0.03 : 0.06;
      ctx.strokeStyle = hexColor;
      ctx.lineWidth = 0.5;

      for (let row = -5; row < canvas.height / hexHeight + 5; row++) {
        for (let col = -5; col < canvas.width / hexWidth + 5; col++) {
          const x = col * hexWidth + (row % 2) * hexSize;
          const y = row * hexHeight;

          if (Math.hypot(x - centerX, y - centerY) < 120) {
            ctx.beginPath();
            for (let i = 0; i < 6; i++) {
              const angle = (i * Math.PI) / 3;
              const hx = x + Math.cos(angle) * hexSize;
              const hy = y + Math.sin(angle) * hexSize;
              if (i === 0) ctx.moveTo(hx, hy);
              else ctx.lineTo(hx, hy);
            }
            ctx.closePath();
            ctx.stroke();
          }
        }
      }

      ctx.globalAlpha = 1;
      animationId = requestAnimationFrame(animate);
    };

    animate();
    return () => cancelAnimationFrame(animationId);
  }, [state, particles, hexColor]);

  // Calculate state-specific pulse timing
  const pulseSpeed =
    state === "thinking"
      ? 0.8
      : state === "listening"
        ? 1.2
        : state === "speaking"
          ? 1.5
          : 0.5;

  return (
    <div className="relative flex items-center justify-center w-56 h-56 sm:w-72 sm:h-72">
      {/* Holographic base platform */}
      <div className="absolute bottom-0 w-3/4 h-px bg-gradient-to-r from-transparent via-cyan/30 to-transparent" />
      <div className="absolute bottom-0 w-1/2 h-[2px] bg-gradient-to-r from-transparent via-cyan/20 to-transparent blur-sm" />

      {/* Outer ring animations */}
      {state !== "idle" && (
        <>
          {/* Rotating wireframe ring */}
          <div
            className="absolute inset-0 rounded-full border-2 border-transparent"
            style={{
              borderTopColor: color,
              borderRightColor: `${color}40`,
              animation: `spin ${state === "thinking" ? 2 : 4}s linear infinite`,
              boxShadow: `0 0 20px ${hexColor}20`,
            }}
          />

          {/* Counter-rotating dashed ring */}
          <div
            className="absolute inset-4 rounded-full border border-dashed"
            style={{
              borderColor: `${color}30`,
              animation: `spin ${state === "thinking" ? 3 : 6}s linear infinite reverse`,
            }}
          />

          {/* Pulse rings */}
          <span
            className="absolute inset-0 rounded-full border animate-pulse-ring"
            style={{
              borderColor: color,
              animationDuration: `${2 / pulseSpeed}s`,
            }}
          />
          <span
            className="absolute inset-0 rounded-full border animate-pulse-ring"
            style={{
              borderColor: color,
              animationDuration: `${2.5 / pulseSpeed}s`,
              animationDelay: "0.8s",
            }}
          />
          <span
            className="absolute -inset-4 rounded-full border animate-pulse-ring"
            style={{
              borderColor: `${color}50`,
              animationDuration: `${3 / pulseSpeed}s`,
              animationDelay: "1.6s",
            }}
          />
        </>
      )}

      {/* Idle subtle rotation */}
      {state === "idle" && (
        <>
          <div
            className="absolute inset-0 rounded-full border"
            style={{
              borderColor: `${color}20`,
              animation: "spin 20s linear infinite",
            }}
          />
          <div
            className="absolute inset-2 rounded-full border border-dashed"
            style={{
              borderColor: `${color}10`,
              animation: "spin 30s linear infinite reverse",
            }}
          />
        </>
      )}

      {/* Main SVG Orb */}
      <svg viewBox="0 0 200 200" className="w-full h-full relative z-10">
        <defs>
          {/* Main gradient */}
          <radialGradient id="orbGradient" cx="50%" cy="45%" r="60%">
            <stop offset="0%" stopColor={color} stopOpacity="0.7" />
            <stop offset="40%" stopColor={color} stopOpacity="0.3" />
            <stop offset="100%" stopColor={color} stopOpacity="0.05" />
          </radialGradient>

          {/* Glow filter */}
          <filter id="glow">
            <feGaussianBlur stdDeviation="3" result="coloredBlur" />
            <feMerge>
              <feMergeNode in="coloredBlur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>

          {/* Inner glow */}
          <filter id="innerGlow">
            <feGaussianBlur stdDeviation="2" result="blur" />
            <feComposite in="SourceGraphic" in2="blur" operator="over" />
          </filter>

          {/* Scan line pattern */}
          <pattern
            id="scanlines"
            width="4"
            height="4"
            patternUnits="userSpaceOnUse"
          >
            <line
              x1="0"
              y1="0"
              x2="4"
              y2="0"
              stroke={color}
              strokeWidth="0.5"
              opacity="0.1"
            />
          </pattern>
        </defs>

        {/* Outer guide ring */}
        <circle
          cx="100"
          cy="100"
          r="92"
          fill="none"
          stroke="var(--panel-line)"
          strokeWidth="0.5"
          opacity="0.3"
        />

        {/* Notch marks */}
        {Array.from({ length: 12 }).map((_, i) => {
          const angle = (i * 30 * Math.PI) / 180;
          const x1 = 100 + Math.cos(angle) * 88;
          const y1 = 100 + Math.sin(angle) * 88;
          const x2 = 100 + Math.cos(angle) * 92;
          const y2 = 100 + Math.sin(angle) * 92;
          return (
            <line
              key={i}
              x1={x1}
              y1={y1}
              x2={x2}
              y2={y2}
              stroke={color}
              strokeWidth={i % 3 === 0 ? "1.5" : "0.5"}
              opacity={i % 3 === 0 ? 0.4 : 0.15}
            />
          );
        })}

        {/* Main dashed orbit */}
        <circle
          cx="100"
          cy="100"
          r="80"
          fill="none"
          stroke={color}
          strokeWidth="1"
          strokeDasharray="1 8"
          opacity="0.4"
          filter="url(#glow)"
        >
          {state === "thinking" && (
            <animateTransform
              attributeName="transform"
              type="rotate"
              from="0 100 100"
              to="360 100 100"
              dur="3s"
              repeatCount="indefinite"
            />
          )}
        </circle>

        {/* Secondary orbit */}
        <circle
          cx="100"
          cy="100"
          r="68"
          fill="none"
          stroke={color}
          strokeWidth="0.5"
          strokeDasharray="4 12"
          opacity="0.3"
        >
          {state !== "idle" && (
            <animateTransform
              attributeName="transform"
              type="rotate"
              from="360 100 100"
              to="0 100 100"
              dur={state === "thinking" ? "4s" : "6s"}
              repeatCount="indefinite"
            />
          )}
        </circle>

        {/* Core orb */}
        <circle
          cx="100"
          cy="100"
          r="50"
          fill="url(#orbGradient)"
          stroke={color}
          strokeWidth="2"
          filter="url(#glow)"
        >
          {state !== "idle" && (
            <animate
              attributeName="r"
              values="50;52;50"
              dur={
                state === "speaking"
                  ? "0.3s"
                  : state === "listening"
                    ? "0.5s"
                    : "1s"
              }
              repeatCount="indefinite"
            />
          )}
        </circle>

        {/* Inner rings */}
        <circle
          cx="100"
          cy="100"
          r="38"
          fill="none"
          stroke={color}
          strokeWidth="0.5"
          opacity="0.3"
        />
        <circle
          cx="100"
          cy="100"
          r="28"
          fill="none"
          stroke={color}
          strokeWidth="0.5"
          opacity="0.2"
        />

        {/* Core highlight */}
        <circle
          cx="100"
          cy="100"
          r="15"
          fill={color}
          opacity="0.15"
          filter="url(#innerGlow)"
        >
          {state !== "idle" && (
            <animate
              attributeName="opacity"
              values="0.15;0.25;0.15"
              dur={state === "speaking" ? "0.2s" : "0.8s"}
              repeatCount="indefinite"
            />
          )}
        </circle>

        {/* Center dot */}
        <circle
          cx="100"
          cy="100"
          r="3"
          fill={color}
          opacity="0.8"
          filter="url(#glow)"
        />

        {/* Scanning line effect */}
        <circle cx="100" cy="100" r="50" fill="url(#scanlines)" opacity="0.3" />

        {/* Equator line */}
        <ellipse
          cx="100"
          cy="100"
          rx="50"
          ry="8"
          fill="none"
          stroke={color}
          strokeWidth="0.5"
          opacity="0.2"
        />
      </svg>

      {/* Particle canvas overlay */}
      <canvas
        ref={canvasRef}
        width={300}
        height={300}
        className="absolute inset-0 w-full h-full pointer-events-none"
      />

      {/* Projection platform effect */}
      <div className="absolute bottom-[15%] w-32 h-32 rounded-full bg-gradient-to-b from-transparent to-cyan/5 blur-2xl" />

      {/* State label with data readout */}
      <div className="absolute bottom-0 flex flex-col items-center gap-1">
        <div className="flex items-center gap-2">
          {state !== "idle" && (
            <div className="flex gap-1">
              <span
                className="w-1 h-1 rounded-full animate-pulse"
                style={{
                  backgroundColor: color,
                  animationDuration: `${0.5 / pulseSpeed}s`,
                }}
              />
              <span
                className="w-1 h-1 rounded-full animate-pulse"
                style={{
                  backgroundColor: color,
                  animationDuration: `${0.7 / pulseSpeed}s`,
                  animationDelay: "0.2s",
                }}
              />
              <span
                className="w-1 h-1 rounded-full animate-pulse"
                style={{
                  backgroundColor: color,
                  animationDuration: `${0.9 / pulseSpeed}s`,
                  animationDelay: "0.4s",
                }}
              />
            </div>
          )}
          <span
            className="font-mono text-[10px] tracking-[0.3em] uppercase"
            style={{ color, textShadow: `0 0 10px ${hexColor}40` }}
          >
            {state === "idle" && "STANDBY"}
            {state === "listening" && "AUDIO INPUT"}
            {state === "thinking" && "PROCESSING"}
            {state === "speaking" && "OUTPUT"}
          </span>
        </div>

        {/* Data percentage */}
        {state !== "idle" && (
          <div
            className="font-mono text-[8px] tracking-wider opacity-50"
            style={{ color }}
          >
            {state === "listening" && "FREQ: 44.1kHz"}
            {state === "thinking" && "LOAD: 78%"}
            {state === "speaking" && "BITRATE: 320kbps"}
          </div>
        )}
      </div>

      <style jsx>{`
        @keyframes spin {
          from {
            transform: rotate(0deg);
          }
          to {
            transform: rotate(360deg);
          }
        }

        @keyframes pulse-ring {
          0% {
            transform: scale(1);
            opacity: 0.5;
          }
          50% {
            transform: scale(1.1);
            opacity: 0;
          }
          100% {
            transform: scale(1);
            opacity: 0;
          }
        }

        .animate-pulse-ring {
          animation: pulse-ring 2s cubic-bezier(0.4, 0, 0.6, 1) infinite;
        }
      `}</style>
    </div>
  );
}
