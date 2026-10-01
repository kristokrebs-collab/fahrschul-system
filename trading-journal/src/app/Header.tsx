import { motion, useScroll, useSpring, useTransform, type Variants } from "motion/react";
import { EdgeBlur, type BlurBand } from "@/app/BottomFade";
import { HeaderTicker } from "@/app/HeaderTicker";
import type { StoreMode } from "@/domain/types";
import { StatusPill, type StatusTone } from "@/motion/StatusPill";
import { spring } from "@/motion/tokens";
import { useReducedFx } from "@/motion/useReducedFx";
import { Magnetic } from "@/primitives/Magnetic";
import { SplitText } from "@/primitives/SplitText";
import { Icon } from "@/primitives/icons";
import { MODE_LABELS, useJournal } from "@/store/journalStore";
import { navigate } from "@/store/router";
import { useUi } from "@/store/uiStore";

export const WORDMARK = "Trade Journal";
export const SUBTITLE = "Makro & Scalp · Entscheidungen, Win-Rate, Backtest";
export const HEADER_CTA = "Trade eintragen";

const MODE_TONE: Record<StoreMode, StatusTone> = { cloud: "live", local: "warn", error: "error", connecting: "muted" };

/** Scroll distance (px) over which the header's hairline, shadow and edge blur come in. */
const EDGE_RANGE = 24;
/**
 * Blur bands of the strip under the header (grows toward the header). OFF for perf (`[]` → shade + hairline only), like
 * `BOTTOM_BANDS`: the strip is only visible while scrolled, i.e. exactly while content moves under it, so every scroll
 * frame re-ran the backdrop blur in the display compositor (perf harness `scrollTrades` @120 Hz: dropped frames 130 → 58
 * without it). Re-enable with e.g. `[{ blur: 1, from: 0, to: 0.7 }, { blur: 3, from: 0.35, to: 1 }]`.
 */
const TOP_BANDS: readonly BlurBand[] = [];

/** Pure: progress bar value – 0 at the top and on pages that do not scroll (Motion reports 1 for a zero-length scroll). */
export function scrollBar(scrollY: number, progress: number): number {
  if (!(scrollY > 0) || !Number.isFinite(progress)) return 0;
  return Math.min(1, Math.max(0, progress));
}

/** Logo tile: flips to its white back face on hover (`spring.tilt`), squashes on press (`spring.press`). */
const TILE: Variants = {
  rest: { rotateY: 0, scale: 1 },
  flip: { rotateY: 180 },
  press: { scale: 0.92 },
};
const TILE_TRANSITION = { rotateY: spring.tilt, scale: spring.press };

/**
 * Scroll-linked chrome under the header: a hairline and a soft shade that fade in over the first `EDGE_RANGE` px, a
 * progressive blur strip for content passing under the bar, and the 1 px signal-red reading-progress bar (`scaleX`,
 * smoothed on `spring.smooth`; raw under reduced motion). All transform / opacity; decorative.
 */
function HeaderEdge() {
  const reduced = useReducedFx();
  const { scrollY, scrollYProgress } = useScroll();
  const edge = useTransform(scrollY, [0, EDGE_RANGE], [0, 1]);
  const hairline = useTransform(edge, [0, 1], [0.35, 1]);
  // a backdrop blur under opacity < 1 samples nothing, so the strip is switched, not faded
  const blurVisibility = useTransform(scrollY, (y) => (y > 2 ? "visible" : "hidden"));
  const raw = useTransform(() => scrollBar(scrollY.get(), scrollYProgress.get()));
  const smooth = useSpring(raw, spring.smooth);
  const progress = reduced ? raw : smooth;
  return (
    <div aria-hidden="true" className="pointer-events-none absolute inset-x-0 bottom-0">
      {TOP_BANDS.length > 0 && (
        <motion.div className="absolute inset-x-0 top-0 h-5" style={{ visibility: blurVisibility }}>
          <EdgeBlur bands={TOP_BANDS} toward="top" className="absolute inset-0" />
        </motion.div>
      )}
      <motion.div className="absolute inset-x-0 top-0 h-6 bg-gradient-to-b from-ink-950/55 to-transparent" style={{ opacity: edge }} />
      <motion.div className="absolute inset-x-0 -top-px h-px bg-line-2" style={{ opacity: hairline }} />
      <motion.div className="absolute inset-x-0 -top-px h-px origin-left bg-signal" style={{ scaleX: progress }} />
    </div>
  );
}

/**
 * Sticky app header (Plan 2.5 "Header", 6.6): logo tile `₿` → overview (3D flip on hover, press squash), `SplitText`
 * wordmark (once per session), subtitle, live market ticker, sync pill (`hidden md:inline-flex`), Magnetic →
 * `.shiny-cta` `Trade eintragen` (label `max-sm:sr-only`) opening the editor without a morph source. Scroll-linked
 * hairline / shade (edge blur off, `TOP_BANDS`) and the red reading-progress bar sit on its bottom edge.
 */
export function Header() {
  const mode = useJournal((s) => s.mode);
  const openEditor = useUi((s) => s.openEditor);
  const reduced = useReducedFx();
  const label = MODE_LABELS[mode];
  return (
    <header className="sticky top-[env(safe-area-inset-top,0px)] z-40 bg-ink-900/[0.97]">
      <div className="mx-auto flex h-16 max-w-[1320px] items-center justify-between gap-3 px-4 sm:px-6">
        <motion.button
          type="button"
          onClick={() => navigate("overview")}
          className="flex min-w-0 items-center gap-3 text-left"
          aria-label="Übersicht"
          initial={false}
          animate="rest"
          whileHover={reduced ? undefined : "flip"}
          whileTap="press"
        >
          <motion.span
            aria-hidden="true"
            variants={TILE}
            transition={TILE_TRANSITION}
            style={{ transformPerspective: 600 }}
            className="relative size-9 shrink-0 [transform-style:preserve-3d]"
          >
            <span className="absolute inset-0 grid place-items-center rounded-xl border border-line-2 bg-gradient-to-br from-ink-700 to-ink-900 font-mono text-[15px] font-semibold text-fg [backface-visibility:hidden]">
              ₿
            </span>
            <span className="absolute inset-0 grid place-items-center rounded-xl border border-white/80 bg-fg font-mono text-[15px] font-semibold text-ink-950 [backface-visibility:hidden] [transform:rotateY(180deg)]">
              ₿
              <span className="absolute right-1.5 top-1.5 size-1 rounded-full bg-signal" />
            </span>
          </motion.span>
          <span className="min-w-0">
            <SplitText text={WORDMARK} className="hidden text-[15px] font-semibold tracking-tight sm:inline-flex" />
            <span className="hidden truncate text-[11px] text-faint sm:block">{SUBTITLE}</span>
          </span>
        </motion.button>
        <div className="flex shrink-0 items-center gap-3">
          <HeaderTicker />
          <span className="hidden md:inline-flex" title={label.text}>
            <StatusPill tone={MODE_TONE[mode]} expanded label={label.text} feed="sync" />
          </span>
          <Magnetic intensity={0.25} range={120}>
            <button type="button" onClick={() => openEditor()} className="shiny-cta inline-flex items-center gap-2 max-sm:!px-3">
              <span className="size-3.5 [&>svg]:size-full" aria-hidden="true">
                <Icon name="plus" />
              </span>
              <span className="max-sm:sr-only">{HEADER_CTA}</span>
            </button>
          </Magnetic>
        </div>
      </div>
      <HeaderEdge />
    </header>
  );
}
