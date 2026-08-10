export interface TTSVoice {
  name: string;
  id: string;
  description: string;
}

export const NEXUS_VOICES: TTSVoice[] = [
  {
    name: "Ryan",
    id: "en-GB-RyanNeural",
    description: "British male - Primary NEXUS voice",
  },
  {
    name: "Thomas",
    id: "en-GB-ThomasNeural",
    description: "British male - Alternative",
  },
  {
    name: "Arthur",
    id: "en-GB-ArthurNeural",
    description: "British male - Warm tone",
  },
];

export const FALLBACK_VOICES: TTSVoice[] = [
  {
    name: "Guy",
    id: "en-US-GuyNeural",
    description: "American male - Professional",
  },
  {
    name: "Davis",
    id: "en-US-DavisNeural",
    description: "American male - Deep voice",
  },
];
