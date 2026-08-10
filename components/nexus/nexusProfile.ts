"use client";

import { useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { NexusProfile, NexusState, STATE_PROFILE } from "./types";

const NUMERIC_KEYS = [
  "energy",
  "coreIntensity",
  "particleSpeed",
  "ringSpeed",
  "streamActivity",
  "instability",
] as const;

export interface LiveProfile {
  energy: number;
  coreIntensity: number;
  particleSpeed: number;
  ringSpeed: number;
  streamActivity: number;
  instability: number;
  primary: THREE.Color;
  secondary: THREE.Color;
  accent: THREE.Color;
  fog: THREE.Color;
  background: THREE.Color;
}

/**
 * Smoothly interpolates between STATE_PROFILE entries as `state` changes,
 * instead of snapping instantly. Mutates a single object in place each
 * frame so consumers can read `.current` inside useFrame without causing
 * React re-renders.
 */
export function useNexusProfile(state: NexusState, transitionMs = 900) {
  const target = STATE_PROFILE[state];

  const live = useRef<LiveProfile>(
    (() => {
      const p = STATE_PROFILE[state];
      return {
        energy: p.energy,
        coreIntensity: p.coreIntensity,
        particleSpeed: p.particleSpeed,
        ringSpeed: p.ringSpeed,
        streamActivity: p.streamActivity,
        instability: p.instability,
        primary: new THREE.Color(p.colors.primary),
        secondary: new THREE.Color(p.colors.secondary),
        accent: new THREE.Color(p.colors.accent),
        fog: new THREE.Color(p.colors.fog),
        background: new THREE.Color(p.colors.background),
      };
    })(),
  );

  const targetColors = useMemo(
    () => ({
      primary: new THREE.Color(target.colors.primary),
      secondary: new THREE.Color(target.colors.secondary),
      accent: new THREE.Color(target.colors.accent),
      fog: new THREE.Color(target.colors.fog),
      background: new THREE.Color(target.colors.background),
    }),
    [target],
  );

  useFrame((_, delta) => {
    // Roughly reach ~95% of the way to target within `transitionMs`.
    const rate = 1 - Math.pow(0.05, (delta * 1000) / Math.max(transitionMs, 1));
    const l = live.current;

    for (const key of NUMERIC_KEYS) {
      l[key] += (target[key] - l[key]) * rate;
    }

    l.primary.lerp(targetColors.primary, rate);
    l.secondary.lerp(targetColors.secondary, rate);
    l.accent.lerp(targetColors.accent, rate);
    l.fog.lerp(targetColors.fog, rate);
    l.background.lerp(targetColors.background, rate);
  });

  return live;
}

export type { NexusProfile };
