"use client";

/**
 * Produktdemontage (DRIP-Deckel hebt ab): Teile eines 3D-Modells trennen sich
 * beim Scroll entlang der Y-Achse, Detail-Texte links/rechts faden synchron um.
 */

import { useEffect, useMemo, useRef } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { createScrubTrigger } from "../lib/lenis-gsap-setup";
import gsap from "gsap";

type ExplodePart = {
  mesh: THREE.Object3D;
  restY: number;
  explodeOffsetY: number; // wie weit sich das Teil beim Peak abhebt
};

function ExplodingAssembly({
  parts,
  progressRef,
}: {
  parts: { object: THREE.Object3D; offset: number }[];
  progressRef: { current: number };
}) {
  const explodeParts = useMemo<ExplodePart[]>(
    () =>
      parts.map((p) => ({
        mesh: p.object,
        restY: p.object.position.y,
        explodeOffsetY: p.offset,
      })),
    [parts]
  );

  useFrame(() => {
    // Peak bei progress ~0.5 (Deckel oben), zurück auf 0 bei progress 1 (Deckel wieder drauf)
    const p = progressRef.current;
    const explodeAmount = p < 0.5 ? p / 0.5 : 1 - (p - 0.5) / 0.5;

    explodeParts.forEach((part) => {
      part.mesh.position.y = part.restY + part.explodeOffsetY * explodeAmount;
    });
  });

  return (
    <group>
      {explodeParts.map((p, i) => (
        <primitive key={i} object={p.mesh} />
      ))}
    </group>
  );
}

export function ExplodedProductView({
  parts,
  leftDetail,
  rightDetail,
}: {
  parts: { object: THREE.Object3D; offset: number }[];
  leftDetail: { early: string; late: string };
  rightDetail: { early: string; late: string };
}) {
  const sectionRef = useRef<HTMLDivElement>(null);
  const leftRef = useRef<HTMLDivElement>(null);
  const rightRef = useRef<HTMLDivElement>(null);
  const progressRef = useRef({ current: 0 });

  useEffect(() => {
    if (!sectionRef.current) return;
    const trigger = createScrubTrigger(sectionRef.current, (p) => {
      progressRef.current.current = p;

      // Textwechsel synchron zum Explode-Peak
      const showLate = p > 0.45 && p < 0.85;
      gsap.to([leftRef.current, rightRef.current], {
        opacity: showLate ? 1 : 0,
        duration: 0.3,
        overwrite: "auto",
      });
    });
    return () => trigger.kill();
  }, []);

  return (
    <div ref={sectionRef} className="relative h-[250vh]">
      <div className="sticky top-0 flex h-screen items-center justify-between px-12">
        <div ref={leftRef} className="max-w-xs text-lg font-medium opacity-0">
          {rightDetail.late}
        </div>

        <div className="h-[70vh] w-full max-w-xl">
          <Canvas camera={{ position: [0, 0, 6], fov: 32 }}>
            <ambientLight intensity={0.7} />
            <directionalLight position={[2, 5, 3]} intensity={1} />
            <ExplodingAssembly parts={parts} progressRef={progressRef.current} />
          </Canvas>
        </div>

        <div ref={rightRef} className="max-w-xs text-right text-lg font-medium opacity-0">
          {leftDetail.late}
        </div>
      </div>
    </div>
  );
}
