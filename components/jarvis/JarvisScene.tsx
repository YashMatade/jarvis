"use client";

import { Suspense } from "react";
import { Canvas } from "@react-three/fiber";
import { PerspectiveCamera, AdaptiveDpr } from "@react-three/drei";
import {
  EffectComposer,
  Bloom,
  Vignette,
  ChromaticAberration,
} from "@react-three/postprocessing";
import * as THREE from "three";
import JarvisCore from "./JarvisCore";
import DataParticles from "./DataParticles";
import JarvisEnvironment from "./JarvisEnvironment";
import { JarvisSceneProps } from "./types";
import { useJarvisProfile } from "./jarvisProfile";

function JarvisSceneContents({
  state = "idle",
  audioLevel = 0,
  transitionMs = 900,
}: JarvisSceneProps) {
  // A single smoothly-interpolated profile shared by every part of the
  // scene, so the core, particles, environment, and post-processing all
  // transition together instead of snapping independently.
  const profile = useJarvisProfile(state, transitionMs);

  return (
    <>
      <JarvisEnvironment profile={profile} />

      <Suspense fallback={null}>
        <JarvisCore state={state} audioLevel={audioLevel} profile={profile} />
        <DataParticles profile={profile} state={state} count={400} />
      </Suspense>

      {/* Ground reflection */}
      <mesh position={[0, -1.8, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[4, 4]} />
        <meshBasicMaterial
          color="#0044aa"
          transparent
          opacity={0.02}
          depthWrite={false}
        />
      </mesh>

      <EffectComposer enabled multisampling={0}>
        <Bloom
          intensity={0.5 + profile.current.energy * 0.4}
          luminanceThreshold={0.4}
          luminanceSmoothing={0.8}
          mipmapBlur
        />
        <ChromaticAberration
          offset={
            new THREE.Vector2(
              0.0006 * profile.current.instability,
              0.0006 * profile.current.instability,
            )
          }
        />
        <Vignette eskil={false} offset={0.15} darkness={0.8} />
      </EffectComposer>
    </>
  );
}

export default function JarvisScene({
  state = "idle",
  audioLevel = 0,
  className,
  transitionMs = 900,
}: JarvisSceneProps) {
  return (
    <div className={className ?? "absolute inset-0"}>
      <Canvas
        dpr={[1, 1.5]}
        gl={{
          antialias: true,
          alpha: true,
          preserveDrawingBuffer: true,
          powerPreference: "high-performance",
        }}
        camera={{ position: [0, 0.2, 3.8], fov: 42 }}
        frameloop="always"
        performance={{ min: 0.5 }}
      >
        <PerspectiveCamera makeDefault position={[0, 0.2, 3.8]} fov={42} />
        <AdaptiveDpr pixelated={false} />
        <JarvisSceneContents
          state={state}
          audioLevel={audioLevel}
          transitionMs={transitionMs}
        />
      </Canvas>
    </div>
  );
}
