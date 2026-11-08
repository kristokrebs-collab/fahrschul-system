import { lazy, Suspense } from "react";
import { cn } from "@/lib/cn";
import { orbStill, type OrbVariant } from "@/motion/orbMath";
import { useReducedFx } from "@/motion/useReducedFx";

export type { OrbVariant } from "@/motion/orbMath";

/** The animation is its own chunk: the wrapper (this file) stays tiny; nothing of the canvas code is in the first load. */
const ThinkingOrbCanvas = lazy(() => import("@/motion/ThinkingOrbCanvas"));

export interface ThinkingOrbProps {
  /** `search` ball of dots (sync, connection check) · `calc` loose cloud (simulation, text recognition) · `plan` small ring (waiting for a third party). */
  variant: OrbVariant;
  /** Edge length in px (default 28). */
  size?: number;
  /**
   * `false`: the work is done or paused – the orb shows its still symbol and requests no frames. The host usually
   * unmounts the orb with the state instead; this is for a state that stays on screen.
   */
  active?: boolean;
  /** An accessible name. Without it the orb is decorative (`aria-hidden`) – the text beside it says what is going on. */
  label?: string;
  className?: string;
}

/** The still symbol: the same dots as one frame of the animation, as plain SVG (reduced motion, while the chunk loads, no canvas). */
export function OrbStill({ variant, size = 28, className }: Pick<ThinkingOrbProps, "variant" | "size" | "className">) {
  const dots = orbStill(variant);
  return (
    <svg viewBox="-1 -1 2 2" width={size} height={size} className={cn("block shrink-0", className)} aria-hidden="true" data-orb-still="">
      {dots.map((d, i) => (
        <circle key={i} cx={d.x} cy={d.y} r={Math.max(0.03, d.r)} fill="currentColor" fillOpacity={d.a} />
      ))}
    </svg>
  );
}

/**
 * Thinking orb (R11): a small dot picture for a waiting state. Three variants say what kind of waiting it is – never how
 * long it takes (no fake progress). Canvas, time based (the same motion at 60 and 120 Hz), the frame loop stops for a hidden
 * tab and an orb that scrolled out of view; reduced motion shows the still symbol. The colour is the text colour.
 *
 * Sizes: 20–40 px beside a line of text. The box is always `size × size` – the picture never changes the layout.
 */
export function ThinkingOrb({ variant, size = 28, active = true, label, className }: ThinkingOrbProps) {
  const reduced = useReducedFx();
  const a11y = label ? ({ role: "img", "aria-label": label } as const) : ({ "aria-hidden": true } as const);
  const box = { width: size, height: size };
  return (
    <span className={cn("inline-grid shrink-0 place-items-center text-fg", className)} style={box} data-thinking-orb={variant} data-orb-active={active && !reduced ? "" : undefined} {...a11y}>
      {reduced || !active ? (
        <OrbStill variant={variant} size={size} />
      ) : (
        <Suspense fallback={<OrbStill variant={variant} size={size} />}>
          <ThinkingOrbCanvas variant={variant} size={size} active={active} />
        </Suspense>
      )}
    </span>
  );
}
