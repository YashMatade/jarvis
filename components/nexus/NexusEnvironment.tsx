"use client";

import { useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import type { LiveProfile } from "./nexusProfile";

interface NexusEnvironmentProps {
  profile: React.MutableRefObject<LiveProfile>;
}

export default function NexusEnvironment({ profile }: NexusEnvironmentProps) {
  const bgRef = useRef<THREE.Color>(null);
  const fogRef = useRef<THREE.Fog>(null);
  const lightRef = useRef<THREE.AmbientLight>(null);

  useFrame(() => {
    const p = profile.current;
    if (bgRef.current) {
      bgRef.current.copy(p.background);
    }
    if (fogRef.current) {
      fogRef.current.color.copy(p.fog);
    }
    if (lightRef.current) {
      lightRef.current.color.copy(p.primary);
      lightRef.current.intensity = 0.08 + p.energy * 0.06;
    }
  });

  return (
    <>
      <color attach="background" args={["#000205"]} ref={bgRef} />
      <fog ref={fogRef} attach="fog" args={["#000205", 3, 8]} />
      <ambientLight ref={lightRef} intensity={0.1} color="#003366" />
    </>
  );
}
