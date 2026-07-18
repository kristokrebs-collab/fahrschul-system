"use client";

/**
 * Grundgerüst: Lenis (smooth scroll) synchron zu GSAP ScrollTrigger.
 * In jedes Projekt einmal ganz oben im Layout mounten: <SmoothScrollProvider>{children}</SmoothScrollProvider>
 */

import { useEffect } from "react";
import Lenis from "lenis";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";

gsap.registerPlugin(ScrollTrigger);

export function SmoothScrollProvider({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    const lenis = new Lenis({
      duration: 1.2,
      easing: (t) => Math.min(1, 1.001 - Math.pow(2, -10 * t)),
      smoothWheel: true,
      touchMultiplier: 1.5,
    });

    // Lenis <-> ScrollTrigger Sync: beide müssen im selben Frame aktualisieren,
    // sonst gibt es Jitter zwischen 3D-Canvas und DOM-Animationen.
    lenis.on("scroll", ScrollTrigger.update);

    gsap.ticker.add((time) => {
      lenis.raf(time * 1000);
    });
    gsap.ticker.lagSmoothing(0);

    return () => {
      lenis.destroy();
      gsap.ticker.remove(ScrollTrigger.update);
    };
  }, []);

  return <>{children}</>;
}

/**
 * Helper: liefert 0..1 Scroll-Fortschritt eines Elements als GSAP-Timeline-Trigger.
 * Beispiel:
 *   useScrollScrub(heroRef, (progress) => { mesh.rotation.y = progress * Math.PI * 2 })
 */
export function createScrubTrigger(
  trigger: Element,
  onUpdate: (progress: number) => void,
  opts?: { start?: string; end?: string; pin?: boolean }
) {
  return ScrollTrigger.create({
    trigger,
    start: opts?.start ?? "top top",
    end: opts?.end ?? "bottom top",
    scrub: 1,
    pin: opts?.pin ?? false,
    onUpdate: (self) => onUpdate(self.progress),
  });
}
