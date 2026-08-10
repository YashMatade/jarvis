"use client";

import { useRef, useMemo } from "react";
import { useFrame } from "@react-three/fiber";
import { Line } from "@react-three/drei";
import * as THREE from "three";
import type { LiveProfile } from "./jarvisProfile";

interface OrbitalRingsProps {
  profile: React.MutableRefObject<LiveProfile>;
}

const RINGS = [
  {
    radius: 1.15,
    tilt: [0.3, 0.5, 0],
    speed: 0.15,
    opacity: 0.35,
    segments: 200,
  },
  {
    radius: 1.22,
    tilt: [-0.4, 0.2, 0.6],
    speed: -0.12,
    opacity: 0.25,
    segments: 180,
  },
  {
    radius: 1.28,
    tilt: [0.1, -0.3, -0.4],
    speed: 0.18,
    opacity: 0.3,
    segments: 220,
  },
  {
    radius: 1.35,
    tilt: [-0.2, -0.1, 0.3],
    speed: -0.2,
    opacity: 0.2,
    segments: 160,
  },
  {
    radius: 1.42,
    tilt: [0.5, -0.4, 0.1],
    speed: 0.1,
    opacity: 0.15,
    segments: 140,
  },
];

export default function OrbitalRings({ profile }: OrbitalRingsProps) {
  const groupRef = useRef<THREE.Group>(null);

  const rings = useMemo(() => {
    return RINGS.map((config) => {
      const points: THREE.Vector3[] = [];
      for (let i = 0; i <= config.segments; i++) {
        const angle = (i / config.segments) * Math.PI * 2;
        points.push(
          new THREE.Vector3(
            Math.cos(angle) * config.radius,
            Math.sin(angle) * config.radius,
            0,
          ),
        );
      }
      return { points, ...config };
    });
  }, []);

  useFrame((_, delta) => {
    if (!groupRef.current) return;
    const p = profile.current;
    const ringSpeed = p.ringSpeed;

    groupRef.current.children.forEach((child, i) => {
      const config = RINGS[i];
      child.rotation.x += delta * config.tilt[0] * ringSpeed;
      child.rotation.y += delta * config.tilt[1] * ringSpeed;
      child.rotation.z += delta * config.speed * ringSpeed * (1 + p.energy);

      // drei's <Line> renders either a plain THREE.Line or a fat Line2;
      // both material types expose `.color`/`.opacity`, so a loose cast
      // is safer here than committing to one concrete material type.
      const mat = (child as unknown as { material?: THREE.Material })
        .material as
        | (THREE.Material & { color: THREE.Color; opacity: number })
        | undefined;
      if (mat) {
        mat.color
          .copy(i % 2 === 0 ? p.primary : p.secondary)
          .lerp(p.primary, 0.5);
        mat.opacity = config.opacity * (0.7 + p.energy * 0.3);
      }
    });
  });

  return (
    <group ref={groupRef}>
      {rings.map((ring, i) => (
        <Line
          key={i}
          points={ring.points}
          color={i % 2 === 0 ? "#00ccff" : "#0088ff"}
          transparent
          opacity={ring.opacity}
          depthWrite={false}
          blending={THREE.AdditiveBlending}
          lineWidth={0.5}
        />
      ))}
    </group>
  );
}
