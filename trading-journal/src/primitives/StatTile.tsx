import { AnimatePresence, motion } from "motion/react";
import type { ReactNode } from "react";
import { cn } from "@/lib/cn";
import { MorphCard, MorphTitle } from "@/motion/MorphCard";
import { spring, tween } from "@/motion/tokens";
import { GlyphPlus } from "@/primitives/icons";

export type VerdictTone = "win" | "loss" | "warn" | "mute";

export interface StatTileProps {
  /** Fact key (`net, trades, winRate, pf, avgR, maxDD, exp, streak`) → `layoutId="morph-fact-{key}"`. */
  fact: string;
  label: string;
  value: ReactNode;
  verdict?: { tone: VerdictTone; text: string } | null;
  /** Hovered/expanded tile: `flexGrow 2`, `+` rotates 90°, verdict revealed. */
  active: boolean;
  onActivate?: () => void;
  /** Dialog body for the fact (explainer). */
  body: () => ReactNode;
  className?: string;
}

const VERDICT_TEXT: Record<VerdictTone, string> = { win: "text-win", loss: "text-loss", warn: "text-warn", mute: "text-mute" };

/**
 * Hero KPI tile (Plan 2.5 "StatTile", Plan 3.3 "KPI-Tile Hover"): `motion.div layout style={{flexGrow}}`
 * on `spring.layout`, `MorphCard id="fact-{key}"` (→ fact dialog), `+` glyph rotates 90°, verdict text
 * revealed with `clip-path: inset(0 0 100% 0) → inset(0)` + opacity + y on `tween.verdict`.
 */
export function StatTile({ fact, label, value, verdict, active, onActivate, body, className }: StatTileProps) {
  return (
    <motion.div layout transition={{ layout: spring.layout }} style={{ flexGrow: active ? 2 : 1 }} onMouseEnter={onActivate} onFocus={onActivate} className={cn("min-w-0 sm:basis-0", className)}>
      <MorphCard
        id={`fact-${fact}`}
        title={label}
        body={body}
        className={cn("h-full overflow-hidden rounded-2xl border px-3 py-2.5 transition-colors duration-300", active ? "border-white/30 bg-white/[0.07]" : "border-white/[0.06] bg-white/[0.03]")}
      >
        <motion.div layout="position">
          <MorphTitle id={`fact-${fact}`} as="dt" className="label flex items-center justify-between gap-1 whitespace-nowrap">
            <span className="truncate">{label}</span>
            <span
              aria-hidden="true"
              className={cn(
                "grid size-5 shrink-0 place-items-center rounded-full border border-line-2 text-mute transition-all duration-300 group-hover:rotate-90 group-hover:border-white/50 group-hover:text-fg",
                active && "rotate-90 border-white/50 text-fg",
              )}
            >
              <GlyphPlus className="size-3" />
            </span>
          </MorphTitle>
          <dd className="num mt-1.5 truncate whitespace-nowrap font-mono text-[17px] font-medium text-fg">{value}</dd>
          <AnimatePresence initial={false}>
            {active && verdict && (
              <motion.p
                key="verdict"
                className={cn("hidden text-[11.5px] leading-snug sm:block", VERDICT_TEXT[verdict.tone])}
                style={{ display: undefined, WebkitLineClamp: 3, WebkitBoxOrient: "vertical", marginTop: 6 }}
                initial={{ clipPath: "inset(0 0 100% 0)", opacity: 0, y: 4 }}
                animate={{ clipPath: "inset(0 0 0% 0)", opacity: 1, y: 0, transition: tween.verdict }}
                exit={{ opacity: 0, transition: tween.exit }}
              >
                {verdict.text}
              </motion.p>
            )}
          </AnimatePresence>
        </motion.div>
      </MorphCard>
    </motion.div>
  );
}
