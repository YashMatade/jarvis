export type NexusState =
  | "sleeping"
  | "idle"
  | "listening"
  | "thinking"
  | "speaking";

export interface NexusSceneProps {
  state?: NexusState;
  audioLevel?: number;
  className?: string;
  /** ms for state-to-state visual transitions. Defaults to 900. */
  transitionMs?: number;
}

export interface NexusThemeColors {
  primary: string; // dominant glow / rim color
  secondary: string; // deep fill color
  accent: string; // hot highlight color (sparks, spikes, waveform peaks)
  fog: string;
  background: string;
}

export interface NexusProfile {
  energy: number;
  coreIntensity: number;
  particleSpeed: number;
  ringSpeed: number;
  streamActivity: number;
  /** 0 = calm/steady, 1 = jittery/glitchy (used by thinking state) */
  instability: number;
  colors: NexusThemeColors;
}

export const STATE_PROFILE: Record<NexusState, NexusProfile> = {
  sleeping: {
    energy: 0.08,
    coreIntensity: 0.15,
    particleSpeed: 0.1,
    ringSpeed: 0.08,
    streamActivity: 0.05,
    instability: 0,
    colors: {
      primary: "#0a4a6b",
      secondary: "#001522",
      accent: "#0a4a6b",
      fog: "#00050a",
      background: "#000103",
    },
  },
  idle: {
    energy: 0.25,
    coreIntensity: 0.4,
    particleSpeed: 0.3,
    ringSpeed: 0.2,
    streamActivity: 0.15,
    instability: 0,
    colors: {
      primary: "#00d9ff",
      secondary: "#003b66",
      accent: "#00ffff",
      fog: "#000205",
      background: "#000205",
    },
  },
  listening: {
    energy: 0.55,
    coreIntensity: 0.7,
    particleSpeed: 0.6,
    ringSpeed: 0.45,
    streamActivity: 0.5,
    instability: 0.05,
    colors: {
      primary: "#00ffd5",
      secondary: "#004d4d",
      accent: "#5fffe0",
      fog: "#000807",
      background: "#000807",
    },
  },
  thinking: {
    energy: 0.8,
    coreIntensity: 0.9,
    particleSpeed: 0.9,
    ringSpeed: 0.75,
    streamActivity: 0.85,
    instability: 0.65,
    colors: {
      primary: "#ff9d1f",
      secondary: "#5a2600",
      accent: "#ffd27a",
      fog: "#0a0300",
      background: "#0a0300",
    },
  },
  speaking: {
    energy: 0.9,
    coreIntensity: 1.0,
    particleSpeed: 1.0,
    ringSpeed: 0.85,
    streamActivity: 0.95,
    instability: 0.1,
    colors: {
      primary: "#e8feff",
      secondary: "#006a8f",
      accent: "#ffffff",
      fog: "#000509",
      background: "#000509",
    },
  },
};
