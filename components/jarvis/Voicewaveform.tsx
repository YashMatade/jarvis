"use client";

import { useMemo, useRef, useEffect } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import type { LiveProfile } from "./jarvisProfile";
import type { JarvisState } from "./types";

interface VoiceWaveformProps {
  profile: React.MutableRefObject<LiveProfile>;
  audioLevel: number;
  state: JarvisState;
}

const BAR_COUNT = 48;
const RADIUS = 1.5;
const dummy = new THREE.Object3D();

export default function VoiceWaveform({
  profile,
  audioLevel,
  state,
}: VoiceWaveformProps) {
  const meshRef = useRef<THREE.InstancedMesh>(null);
  const materialRef = useRef<THREE.MeshBasicMaterial>(null);
  // Per-bar smoothed height and a random phase so bars don't move in lockstep.
  const bars = useMemo(
    () =>
      Array.from({ length: BAR_COUNT }, (_, i) => ({
        angle: (i / BAR_COUNT) * Math.PI * 2,
        phase: Math.random() * Math.PI * 2,
        height: 0.02,
      })),
    [],
  );

  const geometry = useMemo(() => {
    const geo = new THREE.BoxGeometry(0.006, 1, 0.006);
    geo.translate(0, 0.5, 0); // pivot at the base so scaling grows outward
    return geo;
  }, []);
  const material = useMemo(
    () =>
      new THREE.MeshBasicMaterial({
        color: "#00ffff",
        transparent: true,
        opacity: 0,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      }),
    [],
  );

  useEffect(() => {
    return () => {
      geometry.dispose();
      material.dispose();
    };
  }, [geometry, material]);

  useFrame(({ clock }) => {
    const mesh = meshRef.current;
    if (!mesh) return;
    const t = clock.elapsedTime;
    const p = profile.current;

    // Waveform is most active while listening/speaking, faint otherwise.
    const activity =
      state === "speaking" ? 1 : state === "listening" ? 0.6 : 0.15;
    const level = audioLevel * activity;

    for (let i = 0; i < BAR_COUNT; i++) {
      const bar = bars[i];
      const wobble = Math.sin(t * 4 + bar.phase) * 0.5 + 0.5;
      const target =
        0.02 + level * (0.15 + wobble * 0.2) * (0.6 + p.energy * 0.6);
      bar.height += (target - bar.height) * 0.25;

      dummy.position.set(
        Math.cos(bar.angle) * RADIUS,
        Math.sin(bar.angle) * RADIUS,
        0,
      );
      dummy.rotation.z = bar.angle - Math.PI / 2;
      dummy.scale.set(1, Math.max(bar.height, 0.005) / 1, 1);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
    }
    mesh.instanceMatrix.needsUpdate = true;

    if (materialRef.current) {
      materialRef.current.color.copy(p.accent);
      materialRef.current.opacity = 0.15 + activity * 0.5;
    }
  });

  return (
    <instancedMesh ref={meshRef} args={[geometry, undefined, BAR_COUNT]}>
      <primitive object={material} ref={materialRef} attach="material" />
    </instancedMesh>
  );
}
