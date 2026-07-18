"use client";

/**
 * Finale-Sektion: mehrere hochformatige Bildkarten sliden von unten in den
 * Viewport und legen sich mit leichtem Parallax-Versatz über die große
 * Hintergrund-Typografie ("A TASTE ABOVE THE REST").
 */

import { useEffect, useRef } from "react";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";

gsap.registerPlugin(ScrollTrigger);

type Card = { src: string; alt: string; parallaxSpeed?: number };

export function ParallaxCardStack({
  headline,
  cards,
}: {
  headline: string;
  cards: Card[];
}) {
  const sectionRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!sectionRef.current) return;
    const cardEls = sectionRef.current.querySelectorAll("[data-card]");

    const enterTl = gsap.timeline({
      scrollTrigger: {
        trigger: sectionRef.current,
        start: "top 85%",
        end: "top 20%",
        scrub: 1,
      },
    });
    enterTl.from(cardEls, { yPercent: 60, opacity: 0, stagger: 0.12, ease: "power2.out" });

    // Unabhängiger Parallax-Drift pro Karte während des Durchscrollens
    cardEls.forEach((card, i) => {
      const speed = cards[i]?.parallaxSpeed ?? 0.15 + i * 0.05;
      gsap.to(card, {
        yPercent: -30 * speed * 10,
        ease: "none",
        scrollTrigger: {
          trigger: sectionRef.current,
          start: "top bottom",
          end: "bottom top",
          scrub: 1,
        },
      });
    });

    return () => {
      enterTl.scrollTrigger?.kill();
      ScrollTrigger.getAll().forEach((t) => t.trigger === sectionRef.current && t.kill());
    };
  }, [cards]);

  return (
    <div ref={sectionRef} className="relative flex min-h-screen items-center justify-center overflow-hidden">
      <span className="pointer-events-none absolute inset-0 flex items-center justify-center px-4 text-center font-black leading-[0.85] text-white/90 text-[14vw]">
        {headline}
      </span>

      <div className="relative z-10 flex gap-6 px-6">
        {cards.map((c, i) => (
          <div
            key={c.src + i}
            data-card
            className="h-[60vh] w-[22vw] min-w-[180px] overflow-hidden rounded-2xl shadow-2xl"
          >
            <img src={c.src} alt={c.alt} className="h-full w-full object-cover" loading="lazy" />
          </div>
        ))}
      </div>
    </div>
  );
}
