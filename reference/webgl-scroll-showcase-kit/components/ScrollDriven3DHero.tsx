"use client";

/**
 * Scroll-getriebenes 3D-Hero: Eiswürfel→Dose-Morph (ZOI) bzw.
 * Flaschen-Rotation/Scale-zur-Mitte (DRIP).
 * Bindet scrollProgress (0..1) direkt an mesh.rotation / position / scale.
 */

import { useRef, useMemo } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import { Environment, Float, MeshTransmissionMaterial, useGLTF } from "@react-three/drei";
import * as THREE from "three";
import { createScrubTrigger } from "../lib/lenis-gsap-setup";
import { useEffect } from "react";

type ScrollState = {
  progress: number; // 0 = Hero-Start, 1 = Section-Ende
};

function ProductModel({ url, scrollState }: { url: string; scrollState: ScrollState }) {
  const group = useRef<THREE.Group>(null!);
  const { scene } = useGLTF(url);

  useFrame(() => {
    if (!group.current) return;
    const p = scrollState.progress;

    // Morph: aus dem "eingefrorenen" Zustand (klein, zentriert, keine Rotation)
    // in die "herausgelöste" Präsentation (groß, Richtung Betrachter, leichte Drehung)
    group.current.scale.setScalar(THREE.MathUtils.lerp(0.6, 1.4, p));
    group.current.position.z = THREE.MathUtils.lerp(0, 2.2, p);
    group.current.rotation.y = THREE.MathUtils.lerp(0, Math.PI * 0.35, p);
    group.current.rotation.x = THREE.MathUtils.lerp(0.15, 0, p);
  });

  return (
    <group ref={group}>
      <primitive object={scene} />
    </group>
  );
}

/** Fotorealistischer Eis-Look für den ZOI-Eiswürfel via drei's Transmission-Material */
export function IceShell({ children }: { children: React.ReactNode }) {
  return (
    <mesh scale={1.6}>
      <boxGeometry args={[1, 1, 1]} />
      <MeshTransmissionMaterial
        transmission={1}
        thickness={0.6}
        roughness={0.12}
        chromaticAberration={0.04}
        anisotropy={0.3}
        distortion={0.15}
        distortionScale={0.4}
        temporalDistortion={0.1}
        ior={1.31} // Wasser-/Eis-Brechungsindex
        color="#bfe9ff"
      />
      {children}
    </mesh>
  );
}

export function ScrollDriven3DHero({ modelUrl }: { modelUrl: string }) {
  const sectionRef = useRef<HTMLDivElement>(null);
  const scrollState = useMemo<ScrollState>(() => ({ progress: 0 }), []);

  useEffect(() => {
    if (!sectionRef.current) return;
    const trigger = createScrubTrigger(sectionRef.current, (p) => {
      scrollState.progress = p;
    });
    return () => trigger.kill();
  }, [scrollState]);

  return (
    <div ref={sectionRef} className="relative h-[300vh]">
      <div className="sticky top-0 h-screen w-full">
        <Canvas camera={{ position: [0, 0, 5], fov: 35 }}>
          <ambientLight intensity={0.6} />
          <directionalLight position={[3, 4, 2]} intensity={1.2} />
          <Environment preset="city" />
          <Float speed={1.2} rotationIntensity={0.15} floatIntensity={0.3}>
            <ProductModel url={modelUrl} scrollState={scrollState} />
          </Float>
        </Canvas>
      </div>
    </div>
  );
}

useGLTF.preload; // Hinweis: im echten Einsatz konkretes Modell preloaden, z.B. useGLTF.preload('/models/bottle.glb')
