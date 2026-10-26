import { motion } from "motion/react";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { cn } from "@/lib/cn";
import { DotMatrix } from "@/motion/DotMatrix";
import { RevealGroup, RevealItem } from "@/motion/Reveal";
import { fxTiming, spring, stagger, tween } from "@/motion/tokens";
import { useReducedFx } from "@/motion/useReducedFx";
import { COMMUNITY } from "@/social/strings";
import { Glyph, type SocialGlyph } from "@/social/ui/glyphs";
import { constellation, constellationFrames } from "./constellation";

/**
 * The community glyph: three dot-matrix people build up from the middle once (frames at the matrix rate), then rest
 * on the final picture – finite, no loop. Reduced motion: the final picture.
 */
export function Constellation({ size = 5, gap = 2, tone = "fg", className }: { size?: number; gap?: number; tone?: "fg" | "mute"; className?: string }) {
  const reduced = useReducedFx();
  const frames = useMemo(() => constellationFrames(), []);
  const final = useMemo(() => constellation(), []);
  const [done, setDone] = useState(reduced);
  useEffect(() => {
    if (reduced) return;
    const id = setTimeout(() => setDone(true), (frames.length * 1000) / fxTiming.matrixFps);
    return () => clearTimeout(id);
  }, [reduced, frames.length]);
  return (
    <span aria-hidden="true" className={cn("inline-block", className)}>
      {done ? <DotMatrix pattern={final} size={size} gap={gap} tone={tone} /> : <DotMatrix frames={frames} fps={fxTiming.matrixFps} size={size} gap={gap} tone={tone} />}
    </span>
  );
}

/** The privacy promises as chips that rise in one after another. */
export function Principles({ className, delay = 0.15 }: { className?: string; delay?: number }) {
  const reduced = useReducedFx();
  return (
    <ul className={cn("flex flex-wrap gap-2", className)} aria-label="Grundsätze">
      {COMMUNITY.principles.map((p, i) => (
        <motion.li
          key={p}
          className="flex items-center gap-1.5 rounded-full border border-line-2 bg-ink-950/50 px-3 py-1 text-[12px] text-mute"
          initial={reduced ? false : { opacity: 0, y: 6, scale: 0.96 }}
          animate={{ opacity: 1, y: 0, scale: 1, transitionEnd: { transform: "none" } }}
          transition={{ default: { ...spring.pop, delay: delay + i * stagger.lead }, opacity: { ...tween.fade, delay: delay + i * stagger.lead } }}
        >
          <Glyph name="check" className="size-3 text-win" />
          {p}
        </motion.li>
      ))}
    </ul>
  );
}

const FEATURE_GLYPH: Record<(typeof COMMUNITY.features)[number]["key"], SocialGlyph> = { board: "trophy", groups: "users", mentor: "mentor" };

/** What the community offers – three tiles WITHOUT numbers (nothing that could pass for real data). */
export function FeatureTiles({ className }: { className?: string }) {
  const reduced = useReducedFx();
  return (
    <RevealGroup className={cn("grid gap-3 sm:grid-cols-3", className)}>
      {COMMUNITY.features.map((f) => (
        <RevealItem key={f.key} className="flex gap-3 rounded-2xl border border-line bg-ink-900 p-4">
          <motion.span
            className="grid size-10 shrink-0 place-items-center rounded-xl border border-line-2 bg-ink-950 text-fg"
            initial={reduced ? false : { scale: 0.6, rotate: -8 }}
            whileInView={{ scale: 1, rotate: 0, transitionEnd: { transform: "none" } }}
            viewport={{ once: true }}
            transition={spring.pop}
          >
            <Glyph name={FEATURE_GLYPH[f.key]} className="size-5" />
          </motion.span>
          <span className="grid gap-0.5">
            <span className="text-[14px] font-semibold">{f.title}</span>
            <span className="text-[12.5px] leading-snug text-mute">{f.text}</span>
          </span>
        </RevealItem>
      ))}
    </RevealGroup>
  );
}

/** A small mono caption above a block. */
export function Caption({ children, className }: { children: ReactNode; className?: string }) {
  return <span className={cn("font-mono text-[10.5px] uppercase tracking-[0.14em] text-faint", className)}>{children}</span>;
}

/** Progress hairline (scaleX from the left, `spring.bar`), e.g. trades towards the ranking minimum. */
export function Progress({ value, tone = "fg", className }: { value: number; tone?: "fg" | "win" | "signal"; className?: string }) {
  const reduced = useReducedFx();
  const v = Math.max(0, Math.min(1, value));
  return (
    <span aria-hidden="true" className={cn("block h-1 overflow-hidden rounded-full bg-white/[0.06]", className)}>
      <motion.span
        className={cn("block h-full origin-left rounded-full", tone === "win" ? "bg-win" : tone === "signal" ? "bg-signal" : "bg-fg")}
        initial={reduced ? false : { scaleX: 0 }}
        whileInView={{ scaleX: v }}
        viewport={{ once: true }}
        animate={reduced ? { scaleX: v } : undefined}
        transition={spring.bar}
      />
    </span>
  );
}
