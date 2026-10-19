import { motion } from "motion/react";
import type { SVGProps } from "react";
import { cn } from "@/lib/cn";

export type IconName =
  | "grid"
  | "list"
  | "target"
  | "sliders"
  | "plus"
  | "x"
  | "search"
  // feature pages (P14): 24er viewBox, stroke 1.8
  | "candles"
  | "chart"
  | "shield"
  | "coach"
  | "report"
  | "flask"
  | "sprout"
  | "users"
  | "gauge"
  | "user"
  | "tag"
  | "compass";

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
    case "candles":
      return (
        <svg {...p} strokeWidth="1.8" strokeLinejoin="round">
          <path d="M6 3v4M6 15v6M12 3v2M12 12v9M18 6v3M18 17v3" />
          <rect x="4" y="7" width="4" height="8" rx="1" />
          <rect x="10" y="5" width="4" height="7" rx="1" />
          <rect x="16" y="9" width="4" height="8" rx="1" />
        </svg>
      );
    case "chart":
      return (
        <svg {...p} strokeWidth="1.8" strokeLinejoin="round">
          <path d="M3 3v18h18" />
          <path d="M7 15l4-4 3 3 5-6" />
          <circle cx="19" cy="8" r="1.2" fill="currentColor" />
        </svg>
      );
    case "shield":
      return (
        <svg {...p} strokeWidth="1.8" strokeLinejoin="round">
          <path d="M12 3l8 3v6c0 4.5-3.4 8-8 9-4.6-1-8-4.5-8-9V6z" />
          <path d="M12 8v5M12 16v.5" />
        </svg>
      );
    case "coach":
      return (
        <svg {...p} strokeWidth="1.8" strokeLinejoin="round">
          <path d="M4 5h16v11H9l-5 4z" />
          <path d="M8.5 10.5h.01M12 10.5h.01M15.5 10.5h.01" strokeWidth="2.4" />
        </svg>
      );
    case "report":
      return (
        <svg {...p} strokeWidth="1.8" strokeLinejoin="round">
          <path d="M6 3h8l4 4v14H6z" />
          <path d="M14 3v4h4M9 17v-3M12 17v-5M15 17v-2" />
        </svg>
      );
    case "flask":
      return (
        <svg {...p} strokeWidth="1.8" strokeLinejoin="round">
          <path d="M9 3h6M10 3v6L4.5 19a1.5 1.5 0 0 0 1.3 2h12.4a1.5 1.5 0 0 0 1.3-2L14 9V3" />
          <path d="M7 15h10" />
        </svg>
      );
    case "sprout":
      return (
        <svg {...p} strokeWidth="1.8" strokeLinejoin="round">
          <path d="M12 21V11" />
          <path d="M12 11C12 7 9 5 4 5c0 4 3 6 8 6zM12 13c0-4 3-6 8-6 0 4-3 6-8 6z" />
        </svg>
      );
    case "users":
      return (
        <svg {...p} strokeWidth="1.8" strokeLinejoin="round">
          <circle cx="9" cy="8" r="3.5" />
          <path d="M2.5 20c.7-3.6 3.3-5.5 6.5-5.5s5.8 1.9 6.5 5.5" />
          <path d="M16 4.6a3.5 3.5 0 0 1 0 6.8M18 14.8c2 .7 3.2 2.4 3.5 5.2" />
        </svg>
      );
    case "gauge":
      return (
        <svg {...p} strokeWidth="1.8" strokeLinejoin="round">
          <path d="M4.5 18a9 9 0 1 1 15 0" />
          <path d="M12 14l4-5" />
          <circle cx="12" cy="14" r="1.4" fill="currentColor" />
        </svg>
      );
    case "user":
      return (
        <svg {...p} strokeWidth="1.8" strokeLinejoin="round">
          <circle cx="12" cy="8" r="4" />
          <path d="M4 21c.9-4.2 4-6.5 8-6.5s7.1 2.3 8 6.5" />
        </svg>
      );
    case "tag":
      return (
        <svg {...p} strokeWidth="1.8" strokeLinejoin="round">
          <path d="M3 12V4a1 1 0 0 1 1-1h8l9 9-9 9z" />
          <circle cx="8" cy="8" r="1.5" />
        </svg>
      );
    case "compass":
      return (
        <svg {...p} strokeWidth="1.8" strokeLinejoin="round">
          <circle cx="12" cy="12" r="9" />
          <path d="M15.5 8.5l-2 5-5 2 2-5z" />
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
