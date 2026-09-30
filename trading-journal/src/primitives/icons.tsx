import { motion } from "motion/react";
import type { SVGProps } from "react";
import { cn } from "@/lib/cn";

export type IconName = "grid" | "list" | "target" | "sliders" | "plus" | "x" | "search";

type SvgProps = Omit<SVGProps<SVGSVGElement>, "children">;

const BASE: SvgProps = { viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeLinecap: "round", "aria-hidden": true };

/** Inline SVG icon map (Bundle `Jr`): 24×24, `stroke="currentColor"`, weights 1.8 / 2 / 2.4. No icon package. */
export function Icon({ name, className, ...props }: { name: IconName } & SvgProps) {
  const p = { ...BASE, className, ...props };
  switch (name) {
    case "grid":
      return (
        <svg {...p} strokeWidth="1.8" strokeLinejoin="round">
          <rect x="3" y="3" width="7" height="9" rx="1.5" />
          <rect x="14" y="3" width="7" height="5" rx="1.5" />
          <rect x="14" y="12" width="7" height="9" rx="1.5" />
          <rect x="3" y="16" width="7" height="5" rx="1.5" />
        </svg>
      );
    case "list":
      return (
        <svg {...p} strokeWidth="1.8" strokeLinejoin="round">
          <path d="M3 17l6-6 4 4 8-8" />
          <path d="M14 7h7v7" />
        </svg>
      );
    case "target":
      return (
        <svg {...p} strokeWidth="1.8">
          <circle cx="12" cy="12" r="9" />
          <circle cx="12" cy="12" r="5" />
          <circle cx="12" cy="12" r="1.2" fill="currentColor" />
        </svg>
      );
    case "sliders":
      return (
        <svg {...p} strokeWidth="1.8">
          <path d="M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1 14h6M9 8h6M17 16h6" />
        </svg>
      );
    case "plus":
      return (
        <svg {...p} strokeWidth="2.4">
          <path d="M12 5v14M5 12h14" />
        </svg>
      );
    case "x":
      return (
        <svg {...p} strokeWidth="2">
          <path d="M6 6l12 12M18 6 6 18" />
        </svg>
      );
    case "search":
      return (
        <svg {...p} strokeWidth="2">
          <circle cx="11" cy="11" r="7" />
          <path d="m20 20-3.5-3.5" />
        </svg>
      );
  }
}

/** 12×12 plus (rotates 45° in `Expander`). */
export function GlyphPlus({ className, ...props }: SvgProps) {
  return (
    <svg viewBox="0 0 12 12" className={className} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true" {...props}>
      <path d="M6 1.5v9M1.5 6h9" />
    </svg>
  );
}

/** 12×12 close. */
export function GlyphClose({ className, ...props }: SvgProps) {
  return (
    <svg viewBox="0 0 12 12" className={className} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true" {...props}>
      <path d="M2 2l8 8M10 2 2 10" />
    </svg>
  );
}

/** 16×16 check; `drawn` animates `pathLength` 0↔1 when provided (CheckboxRow, Toast). */
export function GlyphCheck({ className, drawn, transition, strokeWidth = "2.4", ...props }: SvgProps & { drawn?: boolean; transition?: object }) {
  return (
    <svg viewBox="0 0 16 16" className={className} fill="none" stroke="currentColor" strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...props}>
      {drawn === undefined ? (
        <path d="M3.5 8.5l3 3 6-7" />
      ) : (
        <motion.path d="M3.5 8.5l3 3 6-7" initial={false} animate={{ pathLength: drawn ? 1 : 0 }} transition={transition} />
      )}
    </svg>
  );
}

/** 16×16 cross. */
export function GlyphCross({ className, ...props }: SvgProps) {
  return (
    <svg viewBox="0 0 16 16" className={className} fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...props}>
      <path d="M4 4l8 8M12 4l-8 8" />
    </svg>
  );
}

/** 16×16 info. */
export function GlyphInfo({ className, ...props }: SvgProps) {
  return (
    <svg viewBox="0 0 16 16" className={className} fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...props}>
      <path d="M8 3v6M8 12.5v.5" />
    </svg>
  );
}

const RING_C = 2 * Math.PI * 6;

export interface LiveRingProps extends SvgProps {
  /** 0..1 – remaining share of the refresh interval. */
  progress: number;
  /** `animate-spin` while a refresh is in flight. */
  spinning?: boolean;
  /** Stroke override for the progress arc (default `currentColor`; stale feeds use `#e5202e`). */
  stroke?: string;
}

/**
 * Live ring: two circles r 6 stroke 2, track `strokeOpacity .2`, `-rotate-90`,
 * `transition: stroke-dashoffset 1s linear` (CSS), `animate-spin` while refreshing.
 */
export function LiveRing({ progress, spinning, stroke = "currentColor", className, ...props }: LiveRingProps) {
  const p = Math.max(0, Math.min(1, progress));
  return (
    <svg viewBox="0 0 16 16" className={cn("-rotate-90", spinning && "animate-spin", className)} fill="none" strokeWidth="2" aria-hidden="true" {...props}>
      <circle cx="8" cy="8" r="6" stroke="currentColor" strokeOpacity="0.2" />
      <circle
        cx="8"
        cy="8"
        r="6"
        stroke={stroke}
        strokeLinecap="round"
        strokeDasharray={RING_C}
        strokeDashoffset={RING_C * (1 - p)}
        style={{ transition: "stroke-dashoffset 1s linear" }}
      />
    </svg>
  );
}
