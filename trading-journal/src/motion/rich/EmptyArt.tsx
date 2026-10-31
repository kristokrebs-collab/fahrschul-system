import { useRef, type CSSProperties } from "react";
import { EMPTY_ART_H, EMPTY_ART_W, type EmptyArtKind } from "@/primitives/emptyArt";
import { useIdleGate } from "./idle";
import "./art.css";

/** The twelve points of the `burst` ring: the form they land on, and where each starts (fixed offsets – no randomness at render). */
const RING = Array.from({ length: 12 }, (_, i) => {
  const a = (i / 12) * Math.PI * 2;
  return { x: 32 + Math.cos(a) * 13, y: 20 + Math.sin(a) * 13, fx: Math.cos(a * 2.3 + 1) * 26, fy: Math.sin(a * 1.7 + 2) * 20, d: (i % 6) * 0.07 };
});

/**
 * A small running picture for an empty state (rich pages, mounted lazily by `EmptyState`): a line that draws itself, a
 * dot with two small ones in orbit, or points that fly together into a ring. SVG + CSS keyframes (`rich.css`), transform and
 * opacity only (the line draw is a stroke offset – a paint, no layout), slow cycles with a long rest, paused while off
 * screen or in a hidden tab. Decorative: `aria-hidden`; reduced motion never mounts this.
 */
export default function EmptyArt({ kind }: { kind: EmptyArtKind }) {
  const ref = useRef<SVGSVGElement>(null);
  useIdleGate(ref);
  return (
    <svg
      ref={ref}
      aria-hidden="true"
      focusable="false"
      viewBox={`0 0 ${EMPTY_ART_W} ${EMPTY_ART_H}`}
      width={EMPTY_ART_W}
      height={EMPTY_ART_H}
      className="rich-art text-mute"
      data-testid="empty-art"
      data-kind={kind}
    >
      {kind === "draw" && (
        <>
          <path d="M3 37H61M3 37V4" className="rich-art__axis" />
          <path d="M5 31L16 22L26 26L38 11L48 17L59 5" pathLength={1} className="rich-art__line" />
          <circle cx="59" cy="5" r="2.4" className="rich-art__end" />
        </>
      )}
      {kind === "orbit" && (
        <>
          <ellipse cx="32" cy="20" rx="26" ry="10" className="rich-art__axis" transform="rotate(-18 32 20)" />
          <ellipse cx="32" cy="20" rx="17" ry="17" className="rich-art__axis" />
          <circle cx="32" cy="20" r="3.2" className="rich-art__core" />
          <g className="rich-art__spin rich-art__spin--a">
            <circle cx="49" cy="20" r="2" className="rich-art__dot" />
          </g>
          <g className="rich-art__spin rich-art__spin--b">
            <circle cx="6" cy="20" r="1.6" className="rich-art__dot" />
          </g>
        </>
      )}
      {kind === "burst" &&
        RING.map((p, i) => (
          <circle key={i} cx={p.x} cy={p.y} r="1.7" className="rich-art__spark" style={{ "--fx": `${p.fx}px`, "--fy": `${p.fy}px`, "--d": `${p.d}s` } as CSSProperties} />
        ))}
    </svg>
  );
}
