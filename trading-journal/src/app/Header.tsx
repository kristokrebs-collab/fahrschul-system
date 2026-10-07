import { motion, useScroll, useSpring, useTransform, type Variants } from "motion/react";
import { useState } from "react";
import { EdgeBlur, type BlurBand } from "@/app/BottomFade";
import { openCommandNav, useCommandNavOpen, COMMAND_NAV_ID } from "@/app/CommandNav";
import { FullscreenButton } from "@/app/DisplayActions";
import { HeaderTicker } from "@/app/HeaderTicker";
import type { StoreMode } from "@/domain/types";
import { replayIntro, useIntroPhase, useIntroSettled, type IntroPhase } from "@/intro/introStore";
import { AsciiCascade } from "@/motion/pulse/AsciiCascade";
import { DancingLetters } from "@/motion/pulse/DancingLetters";
import { StatusPill, type StatusTone } from "@/motion/StatusPill";
import { spring, tween } from "@/motion/tokens";
import { useReducedFx } from "@/motion/useReducedFx";
import { Magnetic } from "@/primitives/Magnetic";
import { Icon } from "@/primitives/icons";
import { modeLabelFor, useJournal } from "@/store/journalStore";
import { navigate } from "@/store/router";
import { useUi } from "@/store/uiStore";

export const WORDMARK = "Trade Journal";
export const SUBTITLE = "Makro & Scalp · Entscheidungen, Win-Rate, Backtest";
export const HEADER_CTA = "Trade eintragen";
export const MENU_LABEL = "Navigation öffnen";

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

/** Pure: header position for the intro phase – parked above the edge while the stage covers the app, else in place. */
export function headerIntroTarget(phase: IntroPhase): { y: string; opacity: number } {
  return phase === "stage" ? { y: "-110%", opacity: 0 } : { y: "0%", opacity: 1 };
}

/**
 * Wordmark: dancing letters on hover (hover devices, pack `dancing-letters`, off while an intro runs); `decode` > 0
 * swaps in the ASCII cascade (pack `text-ascii-cascade`) for one play – after the intro stage when the click replayed
 * the intro – then the dancing word comes back. Exactly one
 * of the two is mounted, so the real text "Trade Journal" exists once (sr-only). The subtitle below fades out while
 * the cascade's glyphs fall past it (they never overlap readable text), and back in on the resolve.
 */
function Wordmark({ decode, onDecoded }: { decode: number; onDecoded: () => void }) {
  const settled = useIntroSettled();
  const phase = useIntroPhase();
  // a replayed intro covers the header first: the decode waits for the "build", when the header slides back in
  const decoding = decode > 0 && phase !== "stage";
  return (
    <span className="min-w-0">
      <span className="hidden text-[15px] font-semibold leading-snug tracking-tight sm:block">
        {decoding ? <AsciiCascade key={decode} text={WORDMARK} onDone={onDecoded} /> : <DancingLetters text={WORDMARK} disabled={!settled} />}
      </span>
      <span
        className="hidden truncate text-[11px] text-faint transition-opacity sm:block"
        style={{ opacity: decoding ? 0 : 1, transitionDuration: `${(decoding ? tween.exit : tween.fade).duration}s` }}
      >
        {SUBTITLE}
      </span>
    </span>
  );
}

/** Three short bars (pack hamburger, Nothing grey); opens the full-screen command navigation (⌘K / Ctrl+K). */
function MenuButton() {
  const open = useCommandNavOpen();
  return (
    <button
      type="button"
      onClick={() => openCommandNav()}
      aria-label={MENU_LABEL}
      aria-haspopup="dialog"
      aria-expanded={open}
      aria-controls={open ? COMMAND_NAV_ID : undefined}
      title="Navigation (⌘K / Strg+K)"
      className="touch-hit group/menu relative grid size-9 shrink-0 place-items-center rounded-xl border border-line-2 bg-ink-850 text-mute transition-colors duration-200 hover:border-white/40 hover:text-fg"
    >
      <span aria-hidden="true" className="flex w-4 flex-col gap-[3px]">
        <span className="h-px w-full bg-current transition-transform duration-200 ease-out group-hover/menu:translate-x-[2px]" />
        <span className="h-px w-full bg-current" />
        <span className="h-px w-2/3 bg-current transition-transform duration-200 ease-out group-hover/menu:translate-x-[3px]" />
      </span>
    </button>
  );
}

/**
 * Sticky app header (Plan 2.5 "Header", 6.6): logo tile `₿` → overview + ASCII-cascade decode of the wordmark +
 * `replayIntro()` (3D flip on hover, press squash), dancing-letters wordmark, subtitle, command-nav menu button, live market ticker, sync pill (`hidden md:inline-flex`), Magnetic →
 * `.shiny-cta` `Trade eintragen` (label `max-sm:sr-only`) opening the editor without a morph source, `Vollbild` (lg+, where
 * the Fullscreen API exists). Opaque ink background. Scroll-linked hairline / shade (edge blur off, `TOP_BANDS`) and the
 * red reading-progress bar sit on its bottom edge.
 */
export function Header() {
  const mode = useJournal((s) => s.mode);
  const storage = useJournal((s) => s.storage);
  const openEditor = useUi((s) => s.openEditor);
  const reduced = useReducedFx();
  const phase = useIntroPhase();
  const [decode, setDecode] = useState(0);
  // "Nicht gespeichert" (loss) when nothing persists, else the mode label
  const label = modeLabelFor(mode, storage);
  const onLogo = () => {
    navigate("overview");
    // the intro (when it may replay) switches to "stage" synchronously, so the decode below is held until "build"
    replayIntro();
    if (!reduced) setDecode((n) => n + 1);
  };
  return (
    // opaque ink (no 97 % alpha): scrolled text must never ghost through under the header's pills (tablet audit §3.3)
    <motion.header
      className="sticky top-[env(safe-area-inset-top,0px)] z-40 bg-ink-900"
      initial={false}
      animate={reduced ? { y: "0%", opacity: 1 } : headerIntroTarget(phase)}
      // stage: parked at once (covered by the intro); build / skip / done: slides down on `spring.sheet`
      transition={phase === "stage" ? { duration: 0 } : { y: spring.sheet, opacity: tween.fade }}
    >
      <div className="mx-auto flex h-16 max-w-[1320px] items-center justify-between gap-3 px-4 sm:px-6">
        <motion.button
          type="button"
          onClick={onLogo}
          className="touch-hit flex min-w-0 items-center gap-3 text-left"
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
          <Wordmark decode={decode} onDecoded={() => setDecode(0)} />
        </motion.button>
        <div className="flex shrink-0 items-center gap-3">
          <HeaderTicker />
          <span className="hidden md:inline-flex" title={label.text}>
            <StatusPill tone={MODE_TONE[mode]} expanded label={label.text} feed="sync" />
          </span>
          {/* grey-bar fix: hide the browser UI + system bars (Fullscreen API); lg+ only (at 768 the wordmark would run into the ticker) – narrower screens reach it in the command navigation */}
          <FullscreenButton className="max-lg:hidden" />
          <MenuButton />
          <Magnetic intensity={0.25} range={120}>
            <button type="button" onClick={() => openEditor()} className="shiny-cta inline-flex items-center gap-2 max-sm:!px-3 pointer-coarse:min-h-11 pointer-coarse:min-w-11 pointer-coarse:justify-center">
              <span className="size-3.5 [&>svg]:size-full" aria-hidden="true">
                <Icon name="plus" />
              </span>
              <span className="max-sm:sr-only">{HEADER_CTA}</span>
            </button>
          </Magnetic>
        </div>
      </div>
      <HeaderEdge />
    </motion.header>
  );
}
