"use client";

import { useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { Line } from "@react-three/drei";
import * as THREE from "three";
import type { LiveProfile } from "./jarvisProfile";

interface EnergyStreamsProps {
  profile: React.MutableRefObject<LiveProfile>;
}

export default function EnergyStreams({ profile }: EnergyStreamsProps) {
  const groupRef = useRef<THREE.Group>(null);

  const streams = useMemo(() => {
    return Array.from({ length: 5 }, (_, i) => {
      const points: THREE.Vector3[] = [];
      const startTheta = (i / 5) * Math.PI * 2;
      const startPhi = Math.random() * Math.PI;

      for (let j = 0; j <= 50; j++) {
        const t = j / 50;
        const theta = startTheta + t * Math.PI * 1.5;
        const phi = startPhi + Math.sin(t * Math.PI) * 0.5;
        const r = 1.05 + Math.sin(t * Math.PI * 2) * 0.15;

        points.push(
          new THREE.Vector3(
            Math.sin(phi) * Math.cos(theta) * r,
            Math.sin(phi) * Math.sin(theta) * r,
            Math.cos(phi) * r,
          ),
        );
      }

      return points;
    });
  }, []);

  useFrame((_, delta) => {
    if (!groupRef.current) return;
    const p = profile.current;
    groupRef.current.rotation.y += delta * 0.15 * p.streamActivity;
    groupRef.current.rotation.x += delta * 0.08 * p.streamActivity;

    groupRef.current.children.forEach((child, i) => {
      const mat = (child as unknown as { material?: THREE.Material })
        .material as
        | (THREE.Material & { color: THREE.Color; opacity: number })
        | undefined;
      if (mat) {
        mat.color
          .copy(i % 2 === 0 ? p.primary : p.secondary)
          .lerp(p.accent, 0.3);
        mat.opacity = (0.15 + p.energy * 0.3) * p.streamActivity;
      }
    });
  });

  return (
    <group ref={groupRef}>
      {streams.map((points, i) => (
        <Line
          key={i}
          points={points}
          color={i % 2 === 0 ? "#00ffff" : "#0088ff"}
          transparent
          opacity={0.15}
          depthWrite={false}
          blending={THREE.AdditiveBlending}
          lineWidth={0.5}
        />
      ))}
    </group>
  );
}
