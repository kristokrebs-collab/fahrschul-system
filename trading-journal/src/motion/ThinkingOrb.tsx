import { lazy, Suspense } from "react";
import { cn } from "@/lib/cn";
import { orbStill, type OrbVariant } from "@/motion/orbMath";
import { RING_LOOK, RING_STILL_T, ringPath, ringPoints, type RingMood } from "@/motion/ringMath";
import { useReducedFx } from "@/motion/useReducedFx";

export type { OrbVariant } from "@/motion/orbMath";
export type { RingMood } from "@/motion/ringMath";

/** The dot pictures of R11 plus the voice ring of Runde 12. */
export type ThinkingOrbVariant = OrbVariant | "ring";

/** The animation is its own chunk: the wrapper (this file) stays tiny; nothing of the canvas code is in the first load. */
const ThinkingOrbCanvas = lazy(() => import("@/motion/ThinkingOrbCanvas"));
const VoiceRingCanvas = lazy(() => import("@/motion/VoiceRingCanvas"));

export interface ThinkingOrbProps {
  /**
   * `search` ball of dots (sync, connection check) · `calc` loose cloud (simulation, text recognition) · `plan` small ring of dots (waiting for
   * a third party) · `ring` the voice ring: a luminous, softly deformed ring (an answer is being formed, scenarios are being computed).
   */
  variant: ThinkingOrbVariant;
  /** `ring` only: `active` (the work moves visibly) · `think` (a short wait, default) · `quiet` (mono: one thin line that moves for a moment, then rests). */
  mood?: RingMood;
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
export function OrbStill({ variant, size = 28, className }: { variant: OrbVariant; size?: number; className?: string }) {
  const dots = orbStill(variant);
  return (
    <svg viewBox="-1 -1 2 2" width={size} height={size} className={cn("block shrink-0", className)} aria-hidden="true" data-orb-still="">
      {dots.map((d, i) => (
        <circle key={i} cx={d.x} cy={d.y} r={Math.max(0.03, d.r)} fill="currentColor" fillOpacity={d.a} />
      ))}
    </svg>
  );
}

/** The still ring: the same strands as one frame of the animation, as plain SVG – the text colour, the accent as a short arc, a halo unless mono. */
export function RingStill({ mood = "think", size = 28, className }: { mood?: RingMood; size?: number; className?: string }) {
  const look = RING_LOOK[mood];
  const t = RING_STILL_T[mood];
  const strands = Array.from({ length: look.layers }, (_, l) => ringPath(ringPoints(look, t, l)));
  const core = ringPoints(look, t, 0);
  // the accent: a short arc of the core strand (mono has none)
  const arc = look.spin > 0 ? "M" + core.slice(8, 20).map((p) => `${p.x.toFixed(3)} ${p.y.toFixed(3)}`).join("L") : null;
  return (
    <svg viewBox="-1 -1 2 2" width={size} height={size} className={cn("block shrink-0", className)} aria-hidden="true" data-orb-still="" data-ring-still={mood} fill="none" strokeLinejoin="round" strokeLinecap="round">
      {look.glow > 0 && <path d={strands[0]} stroke="currentColor" strokeWidth={look.core * 7} strokeOpacity={look.glow * 0.45} data-ring-halo="" />}
      {look.glow > 0 && <path d={strands[0]} stroke="currentColor" strokeWidth={look.core * 3.6} strokeOpacity={look.glow * 0.8} data-ring-halo="" />}
      {strands
        .map((d, l) => ({ d, l }))
        .reverse()
        .map(({ d, l }) => (
          <path key={l} d={d} stroke="currentColor" strokeWidth={look.core * (l === 0 ? 1 : 0.75)} strokeOpacity={l === 0 ? 1 : 0.5} />
        ))}
      {arc && <path d={arc} stroke="var(--color-signal, #ff4d3d)" strokeWidth={look.core * 1.25} />}
    </svg>
  );
}

/**
 * Thinking orb (R11) and voice ring (Runde 12): a small picture for a waiting state. The variants say what kind of waiting it is – never how
 * long it takes (no fake progress). Canvas, time based (the same motion at 60 and 120 Hz), the frame loop stops for a hidden
 * tab and an orb that scrolled out of view; reduced motion shows the still symbol. The colour is the text colour (the ring's one accent is the
 * signal red).
 *
 * Sizes: 18–40 px beside a line of text (the ring up to 64 px as the picture of a state). The box is always `size × size` – the picture never
 * changes the layout.
 */
export function ThinkingOrb({ variant, mood = "think", size = 28, active = true, label, className }: ThinkingOrbProps) {
  const reduced = useReducedFx();
  const a11y = label ? ({ role: "img", "aria-label": label } as const) : ({ "aria-hidden": true } as const);
  const box = { width: size, height: size };
  const still = variant === "ring" ? <RingStill mood={mood} size={size} /> : <OrbStill variant={variant} size={size} />;
  return (
    <span className={cn("inline-grid shrink-0 place-items-center text-fg", className)} style={box} data-thinking-orb={variant} data-ring-mood={variant === "ring" ? mood : undefined} data-orb-active={active && !reduced ? "" : undefined} {...a11y}>
      {reduced || !active ? (
        still
      ) : (
        <Suspense fallback={still}>{variant === "ring" ? <VoiceRingCanvas mood={mood} size={size} active={active} /> : <ThinkingOrbCanvas variant={variant} size={size} active={active} />}</Suspense>
      )}
    </span>
  );
}
