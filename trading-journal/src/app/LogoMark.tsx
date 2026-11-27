/**
 * The brand mark as SVG that draws itself (`logoSeq.ts`): every stroke after the one before, the whole in ≤ 1.2 s, once per session (after the
 * intro's stage has lifted) and on demand (`replayLogo`, Einstellungen › Darstellung › Bewegung). Under reduced motion – and in the second tile
 * face, `still` – it is simply there. The timing is one `Element.animate` per stroke with a delay from the pure timeline, so a measurement
 * through the Animations API (`document.getAnimations()`) sees exactly the order and the gaps that were planned; they are cancelled when done and the
 * mark rests in its plain drawn state (no dash left behind). Only `stroke-dashoffset` and `opacity` run, on a 24 px drawing.
 *
 * More than one mark in `LOGO_MARKS`: logo 1 is finished before logo 2 starts (each mark is shown in its window); at the end the first mark – the
 * brand mark – is what rests.
 */
import { useEffect, useRef, useState } from "react";
import { LOGO_MARKS, logoSeen, logoTimeline, markLogoSeen, markWindow, useLogoReplays, type LogoMark as Mark } from "@/app/logoSeq";
import { useIntroPhase } from "@/intro/introStore";
import { cn } from "@/lib/cn";
import { useReducedFx } from "@/motion/useReducedFx";

const EASE = "cubic-bezier(0.22, 1, 0.36, 1)";
/** Time after the planned end before the animations are taken away (ms): a late frame must not cut the last stroke. */
const TAIL_MS = 80;

export function LogoMark({ marks = LOGO_MARKS, still = false, className }: { marks?: readonly Mark[]; still?: boolean; className?: string }) {
  const reduced = useReducedFx();
  const phase = useIntroPhase();
  const replays = useLogoReplays();
  const svg = useRef<SVGSVGElement>(null);
  const [seenAtMount] = useState(logoSeen);
  const [finished, setFinished] = useState({ first: false, replays });
  const pending = !still && !reduced && ((!seenAtMount && !finished.first) || replays > finished.replays);
  const running = pending && phase !== "stage";
  const waiting = pending && phase === "stage";

  useEffect(() => {
    const root = svg.current;
    if (!running || !root || typeof root.animate !== "function") {
      if (running) queueMicrotask(() => setFinished((f) => ({ first: true, replays: Math.max(f.replays, replays) })));
      return;
    }
    const slots = logoTimeline(marks);
    const total = slots.length ? slots[slots.length - 1]!.start + slots[slots.length - 1]!.duration : 0;
    const anims: Animation[] = [];
    const paths = Array.from(root.querySelectorAll<SVGPathElement>("[data-logo-stroke]"));
    for (const s of slots) {
      const el = paths.find((p) => p.dataset.mark === String(s.mark) && p.dataset.stroke === String(s.stroke));
      if (!el) continue;
      anims.push(el.animate([{ strokeDashoffset: 1 }, { strokeDashoffset: 0 }], { delay: s.start, duration: s.duration, easing: EASE, fill: "both" }));
    }
    // several logos: each one is there from its first stroke to a moment after its last; the next one starts only then
    if (marks.length > 1) {
      marks.forEach((_, i) => {
        const w = markWindow(slots, i);
        const g = root.querySelector<SVGGElement>(`[data-logo-mark="${i}"]`);
        if (!w || !g) return;
        const last = i === marks.length - 1;
        anims.push(g.animate(last ? [{ opacity: 0 }, { opacity: 1 }] : [{ opacity: 1 }, { opacity: 1 }, { opacity: 0 }], { delay: w.start, duration: Math.max(1, w.end - w.start), fill: "both" }));
      });
    }
    const done = setTimeout(() => {
      markLogoSeen();
      setFinished((f) => ({ first: true, replays: Math.max(f.replays, replays) }));
    }, total + TAIL_MS);
    return () => {
      clearTimeout(done);
      for (const a of anims) a.cancel();
    };
  }, [running, marks, replays]);

  // before the sequence starts (the intro's stage still covers the app) the strokes wait undrawn; at rest only the brand mark is there
  const shown = running ? marks : marks.slice(0, 1);
  return (
    <svg ref={svg} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className={cn("size-[22px]", className)} data-logo={running ? "run" : waiting ? "wait" : "rest"}>
      {shown.map((m, i) => (
        <g key={m.id} data-logo-mark={i} style={running && marks.length > 1 ? { opacity: 0 } : undefined}>
          {m.paths.map((d, j) => (
            <path key={j} d={d} pathLength={1} data-logo-stroke="" data-mark={i} data-stroke={j} style={running || waiting ? { strokeDasharray: 1, strokeDashoffset: 1 } : undefined} />
          ))}
        </g>
      ))}
    </svg>
  );
}
