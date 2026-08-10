"use client";

import { useRef, useMemo, useEffect } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import type { LiveProfile } from "./nexusProfile";

interface EnergyCoreProps {
  profile: React.MutableRefObject<LiveProfile>;
  audioLevel: number;
}

const SPIKE_COUNT = 8;
const dummy = new THREE.Object3D();

export default function EnergyCore({ profile, audioLevel }: EnergyCoreProps) {
  const coreRef = useRef<THREE.Group>(null);
  const glowRef = useRef<THREE.Mesh>(null);
  const spikesRef = useRef<THREE.InstancedMesh>(null);

  const icosahedron = useMemo(() => new THREE.IcosahedronGeometry(0.08, 2), []);
  const outerSphere = useMemo(() => new THREE.SphereGeometry(0.18, 32, 32), []);
  const spikeGeometry = useMemo(() => new THREE.SphereGeometry(0.02, 8, 8), []);
  const glowMaterial = useMemo(
    () =>
      new THREE.MeshBasicMaterial({
        color: profile.current.primary,
        transparent: true,
        opacity: 0.15,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      }),
    [],
  );
  const spikeMaterial = useMemo(
    () =>
      new THREE.MeshBasicMaterial({
        color: profile.current.accent,
        transparent: true,
        opacity: 0.8,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      }),
    [],
  );

  const coreMaterial = useMemo(() => {
    return new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uIntensity: { value: profile.current.coreIntensity },
        uInstability: { value: 0 },
        uColor1: { value: profile.current.primary },
        uColor2: { value: profile.current.secondary },
      },
      vertexShader: `
        uniform float uTime;
        uniform float uInstability;
        varying vec3 vNormal;
        varying vec3 vPosition;
        // cheap hash-based noise, good enough for a subtle jitter
        float hash(vec3 p) {
          return fract(sin(dot(p, vec3(12.9898, 78.233, 45.164))) * 43758.5453);
        }
        void main() {
          vNormal = normalize(normalMatrix * normal);
          vPosition = position;
          float jitter = hash(position * 10.0 + uTime) * uInstability * 0.08;
          vec3 displaced = position * (1.0 + jitter);
          gl_Position = projectionMatrix * modelViewMatrix * vec4(displaced, 1.0);
        }
      `,
      fragmentShader: `
        uniform float uTime;
        uniform float uIntensity;
        uniform vec3 uColor1;
        uniform vec3 uColor2;
        varying vec3 vNormal;
        varying vec3 vPosition;
        
        void main() {
          float pulse = sin(uTime * 3.0) * 0.3 + 0.7;
          float glow = pow(1.0 - abs(dot(vNormal, vec3(0.0, 0.0, 1.0))), 3.0);
          vec3 color = mix(uColor2, uColor1, glow * pulse);
          float alpha = (0.6 + glow * 0.4) * uIntensity * pulse;
          gl_FragColor = vec4(color, alpha);
        }
      `,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
  }, []);

  // Position the spike instances once.
  useEffect(() => {
    const mesh = spikesRef.current;
    if (!mesh) return;
    for (let i = 0; i < SPIKE_COUNT; i++) {
      const angle = (i / SPIKE_COUNT) * Math.PI * 2;
      dummy.position.set(Math.cos(angle) * 0.12, Math.sin(angle) * 0.12, 0);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
    }
    mesh.instanceMatrix.needsUpdate = true;
  }, []);

  // Dispose GPU resources on unmount.
  useEffect(() => {
    return () => {
      icosahedron.dispose();
      outerSphere.dispose();
      spikeGeometry.dispose();
      glowMaterial.dispose();
      spikeMaterial.dispose();
      coreMaterial.dispose();
    };
  }, [
    icosahedron,
    outerSphere,
    spikeGeometry,
    glowMaterial,
    spikeMaterial,
    coreMaterial,
  ]);

  useFrame(({ clock }) => {
    const t = clock.elapsedTime;
    const p = profile.current;
    const pulse = Math.sin(t * 2.5) * 0.15 + 1;
    const audioPulse = 1 + audioLevel * 0.3;

    if (coreRef.current) {
      coreRef.current.rotation.y += 0.01;
      coreRef.current.rotation.x += 0.005;
    }

    if (glowRef.current) {
      const scale = pulse * audioPulse * p.coreIntensity;
      glowRef.current.scale.setScalar(1 + (scale - 1) * 0.5);
      glowMaterial.opacity = 0.15 * p.coreIntensity * audioPulse;
    }

    if (spikesRef.current) {
      spikesRef.current.rotation.z = t * 0.4 * (1 + p.instability);
      spikeMaterial.opacity = 0.5 + p.coreIntensity * 0.4;
    }

    coreMaterial.uniforms.uTime.value = t;
    coreMaterial.uniforms.uIntensity.value = p.coreIntensity * audioPulse;
    coreMaterial.uniforms.uInstability.value = p.instability;
  });

  return (
    <group ref={coreRef}>
      {/* Inner geometric core */}
      <mesh geometry={icosahedron} material={coreMaterial} />

      {/* Outer glow sphere */}
      <mesh ref={glowRef} geometry={outerSphere} material={glowMaterial} />

      {/* Energy spikes, instanced for a single draw call */}
      <instancedMesh
        ref={spikesRef}
        args={[spikeGeometry, spikeMaterial, SPIKE_COUNT]}
      />
    </group>
  );
}
