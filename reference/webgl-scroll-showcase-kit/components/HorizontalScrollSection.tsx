"use client";

/**
 * Vertikales Scrollen wandelt sich in horizontales Scrollen um
 * (riesige halbtransparente Hintergrundschrift "South Africa" gleitet seitwärts),
 * plus feine Progress-Bar am unteren Rand.
 */

import { useEffect, useRef } from "react";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";

gsap.registerPlugin(ScrollTrigger);

export function HorizontalScrollSection({
  bigLabel,
  children,
}: {
  bigLabel: string;
  children: React.ReactNode;
}) {
  const outerRef = useRef<HTMLDivElement>(null);
  const trackRef = useRef<HTMLDivElement>(null);
  const progressRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!outerRef.current || !trackRef.current) return;

    const track = trackRef.current;
    const scrollDistance = () => track.scrollWidth - window.innerWidth;

    const st = ScrollTrigger.create({
      trigger: outerRef.current,
      start: "top top",
      end: () => `+=${scrollDistance()}`,
      pin: true,
      scrub: 1,
      invalidateOnRefresh: true,
      onUpdate: (self) => {
        gsap.set(track, { x: -self.progress * scrollDistance() });
        if (progressRef.current) {
          gsap.set(progressRef.current, { scaleX: self.progress });
        }
      },
    });

    return () => st.kill();
  }, []);

  return (
    <div ref={outerRef} className="relative h-screen overflow-hidden bg-black">
      <span className="pointer-events-none absolute inset-0 flex items-center whitespace-nowrap font-serif text-[22vw] text-white/10">
        {bigLabel}
      </span>

      <div ref={trackRef} className="relative flex h-full w-max items-center gap-16 px-[10vw]">
        {children}
      </div>

      <div className="absolute bottom-6 left-0 right-0 mx-[10vw] h-px bg-white/15">
        <div
          ref={progressRef}
          className="h-full origin-left bg-white"
          style={{ transform: "scaleX(0)" }}
        />
      </div>
    </div>
  );
}
