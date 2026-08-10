"use client";

import { useMemo, useRef, useEffect } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import type { LiveProfile } from "./nexusProfile";
import type { NexusState } from "./types";

interface DataParticlesProps {
  profile: React.MutableRefObject<LiveProfile>;
  state: NexusState;
  count?: number;
}

export default function DataParticles({
  profile,
  state,
  count = 400,
}: DataParticlesProps) {
  const pointsRef = useRef<THREE.Points>(null);
  const velocitiesRef = useRef<Float32Array | null>(null);
  const burstRef = useRef(0);
  const prevStateRef = useRef<NexusState>(state);

  const { material, geometry } = useMemo(() => {
    const pos = new Float32Array(count * 3);
    const vel = new Float32Array(count * 3);

    for (let i = 0; i < count; i++) {
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.acos(2 * Math.random() - 1);
      const radius = 1.0 + Math.random() * 0.6;

      pos[i * 3] = Math.sin(phi) * Math.cos(theta) * radius;
      pos[i * 3 + 1] = Math.sin(phi) * Math.sin(theta) * radius;
      pos[i * 3 + 2] = Math.cos(phi) * radius;

      vel[i * 3] = -Math.sin(theta) * 0.01;
      vel[i * 3 + 1] = Math.cos(theta) * 0.005;
      vel[i * 3 + 2] = (Math.random() - 0.5) * 0.01;
    }

    velocitiesRef.current = vel;

    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));

    const mat = new THREE.PointsMaterial({
      color: profile.current.primary,
      size: 0.015,
      transparent: true,
      opacity: 0.35,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });

    return { material: mat, geometry: geo };
  }, [count]);

  useEffect(() => {
    return () => {
      geometry.dispose();
      material.dispose();
    };
  }, [geometry, material]);

  // Trigger a brief outward burst whenever the assistant starts speaking.
  useEffect(() => {
    if (state === "speaking" && prevStateRef.current !== "speaking") {
      burstRef.current = 1;
    }
    prevStateRef.current = state;
  }, [state]);

  useFrame((_, delta) => {
    if (!pointsRef.current) return;
    const geo = pointsRef.current.geometry;
    const pos = geo.attributes.position.array as Float32Array;
    const vel = velocitiesRef.current;
    if (!vel) return;

    const p = profile.current;
    const speed = p.particleSpeed * delta * 40;
    const clampedSpeed = Math.min(speed, 0.5);
    const burst = burstRef.current;
    if (burst > 0) burstRef.current = Math.max(0, burst - delta * 1.5);

    for (let i = 0; i < count; i++) {
      const idx = i * 3;
      const x = pos[idx];
      const y = pos[idx + 1];
      const z = pos[idx + 2];
      const dist = Math.sqrt(x * x + y * y + z * z);

      // Keep particles in range
      if (dist < 1.0 || dist > 1.6) {
        const norm = 1.02 / (dist || 0.001);
        pos[idx] *= norm;
        pos[idx + 1] *= norm;
        pos[idx + 2] *= norm;
      }

      // Move particles
      pos[idx] += vel[idx] * clampedSpeed;
      pos[idx + 1] += vel[idx + 1] * clampedSpeed;
      pos[idx + 2] += vel[idx + 2] * clampedSpeed;

      if (burst > 0 && dist > 0) {
        const push = burst * 0.01;
        pos[idx] += (x / dist) * push;
        pos[idx + 1] += (y / dist) * push;
        pos[idx + 2] += (z / dist) * push;
      }

      // Update velocity for orbital motion, with damping so speeds can't
      // run away over long sessions (the original had no decay term).
      vel[idx] += -y * 0.0005 * delta;
      vel[idx + 1] += x * 0.0005 * delta;
      vel[idx] *= 0.999;
      vel[idx + 1] *= 0.999;
      vel[idx + 2] *= 0.999;
    }

    geo.attributes.position.needsUpdate = true;

    // Smooth opacity + color updates
    material.opacity += (0.25 + p.energy * 0.45 - material.opacity) * 0.1;
    material.color.lerp(p.primary, 0.05);
  });

  return <points ref={pointsRef} geometry={geometry} material={material} />;
}
