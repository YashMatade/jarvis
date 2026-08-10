"use client";

import { useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { Line } from "@react-three/drei";
import * as THREE from "three";
import type { LiveProfile } from "./nexusProfile";

interface HolographicGridProps {
  profile: React.MutableRefObject<LiveProfile>;
}

export default function HolographicGrid({ profile }: HolographicGridProps) {
  const groupRef = useRef<THREE.Group>(null);
  const sweepRef = useRef<THREE.Mesh>(null);
  const sweepMaterial = useRef<THREE.ShaderMaterial | null>(null);

  const gridLines = useMemo(() => {
    const lines: THREE.Vector3[][] = [];
    const radius = 1.02;

    // Horizontal rings
    for (let i = 1; i < 8; i++) {
      const phi = (i / 8) * Math.PI;
      const r = Math.sin(phi) * radius;
      const y = Math.cos(phi) * radius;
      const points: THREE.Vector3[] = [];
      for (let j = 0; j <= 80; j++) {
        const theta = (j / 80) * Math.PI * 2;
        points.push(
          new THREE.Vector3(Math.cos(theta) * r, y, Math.sin(theta) * r),
        );
      }
      lines.push(points);
    }

    // Vertical arcs
    for (let i = 0; i < 12; i++) {
      const theta = (i / 12) * Math.PI * 2;
      const points: THREE.Vector3[] = [];
      for (let j = 0; j <= 60; j++) {
        const phi = (j / 60) * Math.PI;
        points.push(
          new THREE.Vector3(
            Math.sin(phi) * Math.cos(theta) * radius,
            Math.cos(phi) * radius,
            Math.sin(phi) * Math.sin(theta) * radius,
          ),
        );
      }
      lines.push(points);
    }

    // Diagonal arcs
    for (let i = 0; i < 6; i++) {
      const startAngle = (i / 6) * Math.PI * 2;
      const points: THREE.Vector3[] = [];
      for (let j = 0; j <= 50; j++) {
        const t = j / 50;
        const theta = startAngle + t * Math.PI * 0.8;
        const phi = t * Math.PI;
        points.push(
          new THREE.Vector3(
            Math.sin(phi) * Math.cos(theta) * radius,
            Math.cos(phi) * radius,
            Math.sin(phi) * Math.sin(theta) * radius,
          ),
        );
      }
      lines.push(points);
    }

    return lines;
  }, []);

  // A thin, rotating sweep plane, like a radar scan, that brightens the
  // grid lines it passes near. Purely cosmetic and cheap: one extra mesh.
  const sweepGeometry = useMemo(
    () => new THREE.CircleGeometry(1.35, 64, 0, Math.PI / 10),
    [],
  );

  useFrame(({ clock }, delta) => {
    if (!groupRef.current) return;
    const p = profile.current;
    groupRef.current.rotation.y += delta * 0.08;
    groupRef.current.rotation.x += delta * 0.03;

    groupRef.current.children.forEach((child) => {
      if (child === sweepRef.current) return;
      const mat = (child as unknown as { material?: THREE.Material })
        .material as
        | (THREE.Material & { color: THREE.Color; opacity: number })
        | undefined;
      if (mat) {
        mat.color.copy(p.secondary).lerp(p.primary, 0.6);
        mat.opacity = 0.06 + p.energy * 0.1;
      }
    });

    if (sweepRef.current) {
      sweepRef.current.rotation.z = clock.elapsedTime * (0.4 + p.energy * 0.3);
    }
    if (sweepMaterial.current) {
      sweepMaterial.current.uniforms.uColor.value = p.accent;
      sweepMaterial.current.uniforms.uOpacity.value = 0.05 + p.energy * 0.12;
    }
  });

  return (
    <group ref={groupRef}>
      {gridLines.map((points, i) => (
        <Line
          key={i}
          points={points}
          color="#0066aa"
          transparent
          opacity={0.06}
          depthWrite={false}
          blending={THREE.AdditiveBlending}
          lineWidth={0.3}
        />
      ))}

      <mesh ref={sweepRef} geometry={sweepGeometry}>
        <shaderMaterial
          ref={sweepMaterial}
          transparent
          depthWrite={false}
          blending={THREE.AdditiveBlending}
          side={THREE.DoubleSide}
          uniforms={{
            uColor: { value: new THREE.Color("#00ffff") },
            uOpacity: { value: 0.08 },
          }}
          vertexShader={`
            varying vec2 vUv;
            void main() {
              vUv = uv;
              gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
            }
          `}
          fragmentShader={`
            uniform vec3 uColor;
            uniform float uOpacity;
            varying vec2 vUv;
            void main() {
              float fade = smoothstep(0.0, 1.0, vUv.x);
              gl_FragColor = vec4(uColor, fade * uOpacity);
            }
          `}
        />
      </mesh>
    </group>
  );
}
