"use client";

/**
 * Theme-Switch per Scroll-Trigger, ausgelöst durch einen "Kamera-Zoom"-Moment:
 * - ZOI: Schwarz -> radialer Rot-Orange-Verlauf im Finale
 * - DRIP: Beige (Light) -> Tiefschwarz beim Makro-Zoom in die Flasche, danach zurück
 *
 * Prinzip: kein CSS-Klassenwechsel (harter Cut), sondern GSAP-Interpolation
 * von CSS-Variablen, damit der Übergang butterweich ist.
 */

import { useEffect, useRef } from "react";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";

gsap.registerPlugin(ScrollTrigger);

export type ThemeStop = {
  /** Scroll-Trigger-Element, bei dessen Erreichen der Übergang startet */
  atSelector: string;
  background: string; // z.B. "radial-gradient(120% 120% at 50% 30%, #ff5a1f 0%, #d81e1e 60%, #05070a 100%)"
  foreground: string; // Textfarbe für diesen Abschnitt
  durationVh?: number; // wie viel Scrollstrecke der Übergang braucht (Default 60vh)
};

export function BackgroundModeSwitch({
  stops,
  children,
}: {
  stops: ThemeStop[];
  children: React.ReactNode;
}) {
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!rootRef.current) return;
    const root = rootRef.current;
    const triggers: ScrollTrigger[] = [];

    stops.forEach((stop) => {
      const target = document.querySelector(stop.atSelector);
      if (!target) return;

      const tween = gsap.timeline({
        scrollTrigger: {
          trigger: target,
          start: "top center",
          end: `+=${stop.durationVh ?? 60}%`,
          scrub: 1,
        },
      });

      // CSS-Variablen weich interpolieren statt background hart zu setzen
      tween.to(root, {
        "--scene-bg": stop.background,
        "--scene-fg": stop.foreground,
        ease: "none",
      } as gsap.TweenVars);

      triggers.push(tween.scrollTrigger!);
    });

    return () => triggers.forEach((t) => t.kill());
  }, [stops]);

  return (
    <div
      ref={rootRef}
      className="transition-none"
      style={{
        // @ts-expect-error -- CSS custom properties
        "--scene-bg": stops[0]?.background ?? "#05070a",
        "--scene-fg": stops[0]?.foreground ?? "#ffffff",
        background: "var(--scene-bg)",
        color: "var(--scene-fg)",
      }}
    >
      {children}
    </div>
  );
}

/**
 * Beispiel-Konfiguration für ZOI ICE TEA:
 *
 * <BackgroundModeSwitch stops={[
 *   { atSelector: "#hero", background: "#05070a", foreground: "#ffffff" },
 *   { atSelector: "#experience", background: "radial-gradient(circle at 50% 40%, #0a3d3a, #05070a)", foreground: "#ffffff" },
 *   { atSelector: "#finale", background: "radial-gradient(120% 120% at 50% 30%, #ff5a1f, #d81e1e 70%)", foreground: "#0c0c0d" },
 * ]}>
 */
