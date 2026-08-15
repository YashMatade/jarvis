"use client";

import { useRef, useMemo } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import type { LiveProfile } from "./nexusProfile";

interface OrbitalRingsProps {
  profile: React.MutableRefObject<LiveProfile>;
}

const RINGS = [
  {
    radiusX: 1.34,
    radiusY: 0.62,
    rotation: [0.46, 0.16, -0.22],
    speed: 0.1,
    opacity: 0.42,
  },
  {
    radiusX: 1.42,
    radiusY: 0.68,
    rotation: [-0.72, -0.22, 0.48],
    speed: -0.07,
    opacity: 0.26,
  },
  {
    radiusX: 1.23,
    radiusY: 0.58,
    rotation: [1.08, 0.32, -0.9],
    speed: 0.045,
    opacity: 0.16,
  },
] as const;

const SEGMENTS = 128;

export default function OrbitalRings({ profile }: OrbitalRingsProps) {
  const groupRef = useRef<THREE.Group>(null);

  const rings = useMemo(() => {
    return RINGS.map((config) => {
      const positions = new Float32Array(SEGMENTS * 3);
      for (let i = 0; i < SEGMENTS; i++) {
        const angle = (i / SEGMENTS) * Math.PI * 2;
        positions[i * 3] = Math.cos(angle) * config.radiusX;
        positions[i * 3 + 1] = Math.sin(angle) * config.radiusY;
      }
      return { positions, ...config };
    });
  }, []);

  useFrame((_, delta) => {
    if (!groupRef.current) return;
    const p = profile.current;
    const ringSpeed = p.ringSpeed;

    groupRef.current.children.forEach((child, i) => {
      const config = RINGS[i];
      // Each orbit keeps a recognizable plane; only its travel direction moves.
      // This prevents the rings from tumbling into an unreadable wire ball.
      child.rotation.z += delta * config.speed * ringSpeed * (0.7 + p.energy * 0.3);

      const mat = (child as THREE.LineLoop).material as THREE.LineBasicMaterial;
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
        <lineLoop
          key={i}
          rotation={ring.rotation}
        >
          <bufferGeometry>
            <bufferAttribute
              attach="attributes-position"
              args={[ring.positions, 3]}
            />
          </bufferGeometry>
          <lineBasicMaterial
            color={i % 2 === 0 ? "#00ccff" : "#0088ff"}
            transparent
            opacity={ring.opacity}
            depthWrite={false}
            blending={THREE.AdditiveBlending}
          />
        </lineLoop>
      ))}
    </group>
  );
}
