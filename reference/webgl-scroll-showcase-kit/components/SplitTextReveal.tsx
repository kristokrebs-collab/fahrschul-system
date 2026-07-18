"use client";

/**
 * Großflächige Hintergrundschrift ("Drink Freeze") die beim Scroll verblasst,
 * plus zentrierte Wort-Reveal-Animation ("EXPERIENCE") die sich in der Mitte teilt.
 * Nutzt split-type (frei, kein GSAP-Club-Plugin nötig) statt SplitText.
 */

import { useEffect, useRef } from "react";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import SplitType from "split-type";

gsap.registerPlugin(ScrollTrigger);

export function BackgroundWordmark({ text, className }: { text: string; className?: string }) {
  const ref = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    if (!ref.current) return;
    const tween = gsap.to(ref.current, {
      opacity: 0,
      scale: 1.08,
      ease: "none",
      scrollTrigger: {
        trigger: ref.current,
        start: "top top",
        end: "+=100%",
        scrub: true,
      },
    });
    return () => tween.scrollTrigger?.kill();
  }, []);

  return (
    <h1
      ref={ref}
      className={
        className ??
        "pointer-events-none select-none font-serif text-[18vw] leading-none text-white/10"
      }
    >
      {text}
    </h1>
  );
}

/** Wort fadet mittig ein, teilt sich dann horizontal und verschwindet (EXPERIENCE-Moment) */
export function SplitRevealWord({ text }: { text: string }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const leftRef = useRef<HTMLSpanElement>(null);
  const rightRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (!containerRef.current || !leftRef.current || !rightRef.current) return;

    const split = new SplitType(containerRef.current.querySelector("h2")!, { types: "chars" });

    const tl = gsap.timeline({
      scrollTrigger: {
        trigger: containerRef.current,
        start: "top center",
        end: "+=120%",
        scrub: true,
      },
    });

    tl.from(split.chars, { opacity: 0, y: 40, stagger: 0.02, ease: "power2.out" })
      .to(leftRef.current, { xPercent: -140, opacity: 0, ease: "power1.in" }, "split")
      .to(rightRef.current, { xPercent: 140, opacity: 0, ease: "power1.in" }, "split");

    return () => {
      tl.scrollTrigger?.kill();
      split.revert();
    };
  }, []);

  const mid = Math.ceil(text.length / 2);

  return (
    <div ref={containerRef} className="relative flex h-screen items-center justify-center overflow-hidden">
      <h2 className="absolute text-6xl font-sans font-medium tracking-tight text-white md:text-8xl">
        <span ref={leftRef}>{text.slice(0, mid)}</span>
        <span ref={rightRef}>{text.slice(mid)}</span>
      </h2>
    </div>
  );
}
