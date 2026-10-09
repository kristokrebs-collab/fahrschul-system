import { animate, AnimatePresence, motion, useMotionValue, useTransform, type AnimationPlaybackControls } from "motion/react";
import { memo, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { cn } from "@/lib/cn";
import { canObserveInView, observeInView } from "@/motion/inView";
import { MorphCard, MorphTitle } from "@/motion/MorphCard";
import { TextRoll } from "@/motion/TextRoll";
import { spring, tween } from "@/motion/tokens";
import { useCanHover } from "@/motion/useMediaQuery";
import { useReducedFx } from "@/motion/useReducedFx";
import { GlyphPlus } from "@/primitives/icons";
import { formatRoll, parseRollValue, type RollSpec } from "@/primitives/rollValue";
import { Skeleton } from "@/primitives/Skeleton";

export type VerdictTone = "win" | "loss" | "warn" | "mute";

export interface StatTileProps {
  /** Fact key (`net, trades, winRate, pf, avgR, maxDD, exp, streak`) → `layoutId="morph-fact-{key}"`. */
  fact: string;
  label: string;
  /**
   * The value. A string counts up from zero the first time the tile is in view and rolls (slot roll, direction of
   * the change) whenever it changes later – never on mount. Any other node renders as given.
   */
  value: ReactNode;
  /** Static trailing node after the value (outside the roll), e.g. `+2 offen`. */
  suffix?: ReactNode;
  /** Characters of `suffix` (incl. its leading space) – lets a string value + suffix fit the tile (`fitValue`). */
  suffixLength?: number;
  verdict?: { tone: VerdictTone; text: string } | null;
  /** Hovered/expanded tile: lifts (transform only), `+` rotates 90°, verdict revealed. */
  active: boolean;
  onActivate?: () => void;
  /** Dialog body for the fact (explainer). */
  body: () => ReactNode;
  /** Data not loaded yet: the value is a shimmering placeholder of the same height. */
  loading?: boolean;
  className?: string;
}

const VERDICT_TEXT: Record<VerdictTone, string> = { win: "text-win", loss: "text-loss", warn: "text-warn", mute: "text-mute" };
/** Hover lift of the active tile: a transform on a non-layout wrapper, so the row never re-lays out. */
const LIFT = { scale: 1.03, y: -2 } as const;
/**
 * Label tracking for narrow tiles: the `label` utility's 0.14em needs ~160 px for `ERWARTUNGSWERT` + `+` glyph, more
 * than a tile gets on phones and in the 3-up row next to the MarketPanel at ~1024–1100 px (less still with a classic
 * scrollbar / reserved gutter). Below 11rem of tile width the tracking drops to 0.08em, so every label stays whole.
 */
const LABEL_FIT = "max-sm:tracking-[0.08em] @max-[11rem]:tracking-[0.08em]";
const REST = { scale: 1, y: 0 } as const;
/** Value type: 17 px, IBM Plex Mono advance 0.6 em; the tile's horizontal padding + border (px-3 + 2 × 1 px). */
const VALUE_PX = 17;
const MONO_ADVANCE = 0.6;
const TILE_INSET_PX = 26;

/**
 * Value font size that never ellipsizes a number (MO-01): 17 px, or smaller when `chars` monospace characters would
 * not fit the tile's own width (container units of the `@container` wrapper) – e.g. `−15.977,56 USDT` at 390 px.
 */
export function fitValue(chars: number): string | undefined {
  if (chars <= 0) return undefined;
  return `min(${VALUE_PX}px, calc((100cqw - ${TILE_INSET_PX}px) / ${(chars * MONO_ADVANCE).toFixed(2)}))`;
}

type RollDirection = "up" | "down";

function signedValue(spec: RollSpec | null): number | null {
  if (!spec) return null;
  return spec.sign === "−" || spec.sign === "-" ? -spec.value : spec.value;
}

/** Direction of a value change for the roll (`up` for a larger or non-numeric value). */
export function rollDirection(prev: string, next: string): RollDirection {
  const a = signedValue(parseRollValue(prev));
  const b = signedValue(parseRollValue(next));
  return a !== null && b !== null && b < a ? "down" : "up";
}

/** Whether `text` counts up on reveal: it carries a positive number and the browser can tell when it is in view. */
function countsUp(text: string): boolean {
  const spec = parseRollValue(text);
  return spec !== null && spec.value > 0 && canObserveInView();
}

/**
 * Count-up of a preformatted value (`62 %`, `+1,85 R`, `3× Gewinn`) from zero to its value on `spring.number` once
 * the tile is first in view (shared observer, no React render per frame). Screen readers get the final text once.
 */
function CountUp({ text, onDone }: { text: string; onDone: () => void }) {
  const spec = useMemo(() => parseRollValue(text), [text]);
  const ref = useRef<HTMLSpanElement>(null);
  const mv = useMotionValue(0);
  const shown = useTransform(mv, (n) => (spec ? formatRoll(spec, n) : text));
  useEffect(() => {
    const el = ref.current;
    if (!el || !spec) return;
    let controls: AnimationPlaybackControls | null = null;
    const unobserve = observeInView(el, (inView) => {
      if (!inView || controls) return;
      controls = animate(mv, spec.value, { ...spring.number, onComplete: onDone });
    });
    return () => {
      unobserve();
      controls?.stop();
    };
  }, [mv, spec, onDone]);
  return (
    <span ref={ref} className="relative inline-flex">
      <span className="sr-only">{text}</span>
      <motion.span aria-hidden="true">{shown}</motion.span>
    </span>
  );
}

/** String value: count-up on first reveal, then a direction-aware slot roll (`TextRoll`) on every change. */
function TileValue({ text }: { text: string }) {
  const reduced = useReducedFx();
  const [state, setState] = useState(() => ({ text, counting: !reduced && countsUp(text), dir: "up" as RollDirection }));
  if (state.text !== text) setState({ text, counting: false, dir: rollDirection(state.text, text) });
  const done = useCallback(() => setState((s) => (s.counting ? { ...s, counting: false } : s)), []);
  if (state.counting) return <CountUp text={text} onDone={done} />;
  return <TextRoll text={text} mode="roll" direction={state.dir} />;
}

/**
 * Hero KPI tile (Plan 2.5 "StatTile", Plan 3.3 "KPI-Tile Hover"): a grid item of the hero's KPI grid (2 columns on phones,
 * 3 from `sm`, 4 from `xl`; spans via `className`), `MorphCard id="fact-{key}"` (→ fact dialog, press feedback built in). On hover devices
 * the active tile lifts by transform on a wrapper outside the layout tree (`spring.hover`) and its highlight layer
 * crossfades (touch: a tap or the dialog's focus return never leaves a tile stuck lifted); the `+` glyph rotates 90°
 * and the verdict opens as a popover ABOVE the tile (out of flow, outside the card's `overflow-hidden`), revealed with
 * `clip-path: inset(0 0 100% 0) → inset(0)` + opacity + y on `tween.verdict` – hovering never re-lays out the row or
 * moves the hero headline. Memoised: hovering re-renders only the two tiles whose `active` flips.
 */
export const StatTile = memo(function StatTile({ fact, label, value, suffix, suffixLength = 0, verdict, active, onActivate, body, loading = false, className }: StatTileProps) {
  const reduced = useReducedFx();
  const canHover = useCanHover();
  const lifted = active && canHover;
  return (
    // `@container`: the label tightens its tracking by the tile's own width (`LABEL_FIT`), not by the viewport
    <div onMouseEnter={onActivate} onFocus={onActivate} className={cn("@container min-w-0", className)}>
      <motion.div className="relative h-full" initial={false} animate={lifted && !reduced ? LIFT : REST} transition={spring.hover}>
        {/* opaque surface (≈ the former white/3 % over the hero): the hero's dot matrix never shows through label or value */}
        <MorphCard id={`fact-${fact}`} title={label} body={body} className="h-full overflow-hidden rounded-2xl border border-white/[0.06] bg-ink-800 px-3 py-2.5">
          <motion.span
            aria-hidden="true"
            className="pointer-events-none absolute inset-0 rounded-[inherit] border border-white/30 bg-white/[0.04]"
            initial={false}
            animate={{ opacity: lifted ? 1 : 0 }}
            transition={tween.crossfade}
          />
          <motion.div layout="position" layoutDependency={active} className="relative">
            <MorphTitle id={`fact-${fact}`} as="dt" className={cn("label flex items-center justify-between gap-1 whitespace-nowrap", LABEL_FIT)}>
              <span className="truncate">{label}</span>
              <span
                aria-hidden="true"
                className={cn(
                  "grid size-5 shrink-0 place-items-center rounded-full border border-line-2 text-mute transition-all duration-300 group-hover:rotate-90 group-hover:border-white/50 group-hover:text-fg",
                  lifted && "rotate-90 border-white/50 text-fg",
                )}
              >
                <GlyphPlus className="size-3" />
              </span>
            </MorphTitle>
            <dd
              className="num mt-1.5 truncate whitespace-nowrap font-mono text-[17px] font-medium text-fg"
              style={typeof value === "string" ? { fontSize: fitValue(value.length + suffixLength) } : undefined}
            >
              {loading ? (
                <Skeleton className="my-[0.2em] h-[0.95em] w-14 rounded-md" />
              ) : (
                <>
                  {typeof value === "string" ? <TileValue text={value} /> : value}
                  {suffix}
                </>
              )}
            </dd>
          </motion.div>
        </MorphCard>
        {/* verdict popover: out of flow and outside the card's overflow-hidden, opening upward so it stays inside the
            hero for both tile rows (the hero section clips its bottom edge). Hover devices only: on touch the tap opens
            the dialog, which shows the verdict, and nothing would ever close a popover left by the tap or the focus
            return (no pointer leaves) */}
        <AnimatePresence initial={false}>
          {lifted && verdict && (
            <motion.p
              key="verdict"
              className={cn(
                "pointer-events-none absolute inset-x-0 bottom-full z-20 mb-1.5 rounded-xl border border-white/10 bg-ink-850 px-3 py-2 text-[11.5px] leading-snug max-sm:hidden",
                VERDICT_TEXT[verdict.tone],
              )}
              initial={{ clipPath: "inset(0 0 100% 0)", opacity: 0, y: 4 }}
              animate={{ clipPath: "inset(0 0 0% 0)", opacity: 1, y: 0, transition: tween.verdict }}
              exit={{ opacity: 0, transition: tween.exit }}
            >
              {/* no line clamp: on the padded surface it painted the 4th line into the padding and over the border
                  (OV-03); the popover grows upward instead and shows the whole verdict */}
              {verdict.text}
            </motion.p>
          )}
        </AnimatePresence>
      </motion.div>
    </div>
  );
});
