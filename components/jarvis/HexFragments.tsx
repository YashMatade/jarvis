"use client";

import { useMemo, useRef, useEffect } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import type { LiveProfile } from "./jarvisProfile";

interface HexFragmentsProps {
  profile: React.MutableRefObject<LiveProfile>;
}

const FRAGMENT_COUNT = 12;
const dummy = new THREE.Object3D();

export default function HexFragments({ profile }: HexFragmentsProps) {
  const groupRef = useRef<THREE.Group>(null);
  const meshRef = useRef<THREE.InstancedMesh>(null);

  const fragments = useMemo(() => {
    return Array.from({ length: FRAGMENT_COUNT }, () => {
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.acos(2 * Math.random() - 1);
      const r = 1.05 + Math.random() * 0.3;

      return {
        position: new THREE.Vector3(
          Math.sin(phi) * Math.cos(theta) * r,
          Math.sin(phi) * Math.sin(theta) * r,
          Math.cos(phi) * r,
        ),
        rotation: new THREE.Euler(
          Math.random() * Math.PI,
          Math.random() * Math.PI,
          Math.random() * Math.PI,
        ),
        scale: 0.5 + Math.random() * 1.5,
        speed: 0.3 + Math.random() * 0.7,
      };
    });
  }, []);

  const geometry = useMemo(() => {
    const hexShape = new THREE.Shape();
    const size = 0.04;
    for (let i = 0; i < 6; i++) {
      const angle = (i / 6) * Math.PI * 2;
      if (i === 0)
        hexShape.moveTo(Math.cos(angle) * size, Math.sin(angle) * size);
      else hexShape.lineTo(Math.cos(angle) * size, Math.sin(angle) * size);
    }
    hexShape.closePath();
    return new THREE.ShapeGeometry(hexShape);
  }, []);

  const material = useMemo(
    () =>
      new THREE.MeshBasicMaterial({
        color: profile.current.primary,
        transparent: true,
        opacity: 0.3,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide,
      }),
    [],
  );

  useEffect(() => {
    return () => {
      geometry.dispose();
      material.dispose();
    };
  }, [geometry, material]);

  useFrame((_, delta) => {
    const mesh = meshRef.current;
    const group = groupRef.current;
    if (!mesh || !group) return;
    const p = profile.current;

    group.rotation.y += delta * 0.1 * p.energy;
    group.rotation.x += delta * 0.05 * p.energy;

    for (let i = 0; i < FRAGMENT_COUNT; i++) {
      const frag = fragments[i];
      frag.rotation.z += delta * frag.speed * p.energy;

      dummy.position.copy(frag.position);
      dummy.rotation.copy(frag.rotation);
      dummy.scale.setScalar(frag.scale);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
    }
    mesh.instanceMatrix.needsUpdate = true;

    material.color.lerp(p.primary, 0.05);
    material.opacity = 0.3 + p.energy * 0.4;
  });

  return (
    <group ref={groupRef}>
      <instancedMesh
        ref={meshRef}
        args={[geometry, material, FRAGMENT_COUNT]}
      />
    </group>
  );
}
