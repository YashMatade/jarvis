"use client";

import { useRef, useMemo, useEffect } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import EnergyCore from "./EnergyCore";
import HexFragments from "./HexFragments";
import VoiceWaveform from "./Voicewaveform";
import { NexusState } from "./types";
import type { LiveProfile } from "./nexusProfile";

interface NexusCoreProps {
  state: NexusState;
  audioLevel: number;
  profile: React.MutableRefObject<LiveProfile>;
}

export default function NexusCore({
  state,
  audioLevel,
  profile,
}: NexusCoreProps) {
  const sphereRef = useRef<THREE.Group>(null);

  // Create materials ONCE with useMemo
  const { fresnelMaterial, darkCoreMaterial } = useMemo(() => {
    const fresnelMat = new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uEnergy: { value: profile.current.energy },
        uInstability: { value: 0 },
        uColor1: { value: profile.current.primary },
        uColor2: { value: profile.current.secondary },
      },
      vertexShader: `
        uniform float uTime;
        uniform float uInstability;
        varying vec3 vNormal;
        varying vec3 vViewDir;
        float hash(vec3 p) {
          return fract(sin(dot(p, vec3(12.9898, 78.233, 45.164))) * 43758.5453);
        }
        void main() {
          vec3 jittered = position * (1.0 + hash(position * 6.0 + uTime) * uInstability * 0.015);
          vec4 mvPosition = modelViewMatrix * vec4(jittered, 1.0);
          vNormal = normalize(mat3(modelViewMatrix) * normal);
          vViewDir = normalize(-mvPosition.xyz);
          gl_Position = projectionMatrix * mvPosition;
        }
      `,
      fragmentShader: `
        uniform float uTime;
        uniform float uEnergy;
        uniform vec3 uColor1;
        uniform vec3 uColor2;
        varying vec3 vNormal;
        varying vec3 vViewDir;
        
        void main() {
          float fresnel = pow(1.0 - abs(dot(vNormal, vViewDir)), 3.5);
          float pulse = sin(uTime * 1.5) * 0.1 + 0.9;
          vec3 color = mix(uColor2, uColor1, fresnel * pulse * uEnergy);
          float alpha = 0.3 + fresnel * 0.5 * uEnergy;
          gl_FragColor = vec4(color, clamp(alpha, 0.0, 1.0));
        }
      `,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });

    const darkMat = new THREE.MeshBasicMaterial({
      color: "#01050b",
      transparent: true,
      opacity: 0.8,
      depthWrite: false,
    });

    return { fresnelMaterial: fresnelMat, darkCoreMaterial: darkMat };
  }, []);

  useEffect(() => {
    return () => {
      fresnelMaterial.dispose();
      darkCoreMaterial.dispose();
    };
  }, [fresnelMaterial, darkCoreMaterial]);

  // Update uniforms in useFrame instead of recreating materials
  useFrame(({ clock, mouse }) => {
    const t = clock.elapsedTime;
    const p = profile.current;

    if (sphereRef.current) {
      // Slow constant rotation
      sphereRef.current.rotation.y += 0.0015;
      sphereRef.current.rotation.x += 0.0005;

      // Subtle mouse follow - use lerp to prevent snapping
      const targetY = mouse.x * 0.1;
      const targetX = -mouse.y * 0.08;
      sphereRef.current.rotation.y +=
        (targetY - sphereRef.current.rotation.y) * 0.01;
      sphereRef.current.rotation.x +=
        (targetX - sphereRef.current.rotation.x) * 0.01;
    }

    // Update uniforms
    const currentEnergy =
      p.energy + (state === "speaking" ? audioLevel * 0.3 : 0);
    fresnelMaterial.uniforms.uTime.value = t;
    fresnelMaterial.uniforms.uEnergy.value = currentEnergy;
    fresnelMaterial.uniforms.uInstability.value = p.instability;

    darkCoreMaterial.opacity = Math.min(0.95, 0.8 + currentEnergy * 0.1);
  });

  return (
    <group ref={sphereRef}>
      {/* Main sphere with Fresnel glow */}
      <mesh>
        <sphereGeometry args={[1.0, 128, 128]} />
        <primitive object={fresnelMaterial} attach="material" />
      </mesh>

      {/* Inner dark core */}
      <mesh>
        <sphereGeometry args={[0.97, 64, 64]} />
        <primitive object={darkCoreMaterial} attach="material" />
      </mesh>

      {/* Energy core */}
      <EnergyCore profile={profile} audioLevel={audioLevel} />

      {/* Hexagonal fragments */}
      <HexFragments profile={profile} />

      {/* Audio-reactive waveform ring, most visible while speaking/listening */}
      <VoiceWaveform profile={profile} audioLevel={audioLevel} state={state} />
    </group>
  );
}
