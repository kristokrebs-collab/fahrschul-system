"use client";

/**
 * Asymmetrisches Masonry-Raster aus kleinen quadratischen Bildern,
 * die sanft und versetzt (Stagger) ein-/ausblenden ("Erinnerungsfragmente").
 */

import { useEffect, useRef } from "react";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";

gsap.registerPlugin(ScrollTrigger);

type MasonryItem = {
  src: string;
  alt: string;
  span?: "sm" | "md" | "lg"; // Höhen-Variation für Asymmetrie
};

const SPAN_CLASS: Record<NonNullable<MasonryItem["span"]>, string> = {
  sm: "h-40",
  md: "h-56",
  lg: "h-72",
};

export function MasonryFadeGrid({ items }: { items: MasonryItem[] }) {
  const gridRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!gridRef.current) return;
    const tiles = gridRef.current.querySelectorAll("[data-tile]");

    const tl = gsap.timeline({
      scrollTrigger: {
        trigger: gridRef.current,
        start: "top 80%",
        end: "bottom 20%",
        scrub: 1,
      },
    });

    tl.from(tiles, {
      opacity: 0,
      y: 30,
      scale: 0.92,
      stagger: { each: 0.06, from: "random" },
      ease: "power2.out",
    }).to(
      tiles,
      {
        opacity: 0.15,
        stagger: { each: 0.05, from: "random" },
        ease: "power1.inOut",
      },
      "+=0.3"
    );

    return () => tl.scrollTrigger?.kill();
  }, [items]);

  return (
    <div
      ref={gridRef}
      className="grid grid-cols-2 gap-3 p-6 md:grid-cols-4 md:gap-4"
    >
      {items.map((item, i) => (
        <div
          key={item.src + i}
          data-tile
          className={`overflow-hidden rounded-lg bg-blue-500/10 ${SPAN_CLASS[item.span ?? "md"]}`}
        >
          <img src={item.src} alt={item.alt} className="h-full w-full object-cover" loading="lazy" />
        </div>
      ))}
    </div>
  );
}
