"use client";

/**
 * Violette konzentrische Halbkreise ("Schallwelle") zur Visualisierung von
 * Kennzahlen wie Akkukapazität. Reines CSS/SVG, kein WebGL nötig -> leichtgewichtig.
 */

import { useEffect, useRef } from "react";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";

gsap.registerPlugin(ScrollTrigger);

export function PulseRings({
  label,
  value,
  ringCount = 4,
  color = "#9b5cff",
}: {
  label: string;
  value: string;
  ringCount?: number;
  color?: string;
}) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!containerRef.current) return;
    const rings = containerRef.current.querySelectorAll("[data-ring]");

    const tl = gsap.timeline({
      scrollTrigger: {
        trigger: containerRef.current,
        start: "top 70%",
        toggleActions: "play none none reverse",
      },
    });

    tl.from(rings, {
      scale: 0.4,
      opacity: 0,
      stagger: 0.15,
      duration: 0.9,
      ease: "power2.out",
    }).to(
      rings,
      {
        scale: 1.15,
        opacity: 0,
        stagger: 0.15,
        duration: 1.4,
        ease: "power1.out",
        repeat: -1,
      },
      "-=0.3"
    );

    return () => tl.scrollTrigger?.kill();
  }, []);

  return (
    <div ref={containerRef} className="relative flex h-64 w-64 items-center justify-center">
      {Array.from({ length: ringCount }).map((_, i) => (
        <span
          key={i}
          data-ring
          className="absolute rounded-full border"
          style={{
            width: `${40 + i * 20}%`,
            height: `${40 + i * 20}%`,
            borderColor: color,
            boxShadow: `0 0 24px ${color}55`,
          }}
        />
      ))}
      <div className="relative z-10 text-center">
        <div className="text-3xl font-semibold" style={{ color }}>
          {value}
        </div>
        <div className="text-sm uppercase tracking-wide text-current/60">{label}</div>
      </div>
    </div>
  );
}
