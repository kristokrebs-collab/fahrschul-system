/**
 * Reveal footer (pulse-motion `motion-footer` timings, in normal flow so it never covers page content): once ≥ 72 %
 * of the footer has scrolled into view (hysteresis: hidden again at ≤ 50 %) its parts fade
 * up in the pack's stagger: wordmark 450 ms / 27 px, bar 1100 ms at 380 / 460 ms, the tilted ticker band 700 ms at
 * 800 ms (−3.6° → −1.8°, 50 px), all on cubic-bezier(.16,1,.3,1). The band is an endless marquee of live journal
 * figures; the price is a MotionValue text (no React render per tick). The uncovered fraction comes from two
 * IntersectionObservers on a sentinel at the footer's top edge (no scroll listener, no layout read per frame).
 * Reduced motion: everything visible at once, the band stands still.
 */
import { motion, useMotionValue, useSpring, type MotionValue } from "motion/react";
import { memo, useEffect, useId, useLayoutEffect, useRef, useState, type CSSProperties, type PointerEvent } from "react";
import { shellStatTexts, useLivePriceText, useShellStats } from "@/app/shellStats";
import { ChartAttribution } from "@/chart/Attribution";
import { cn } from "@/lib/cn";
import { DancingSvgWord } from "@/motion/pulse/DancingLetters";
import { Marquee } from "@/motion/pulse/Marquee";
import { spring } from "@/motion/tokens";
import { useReducedFx } from "@/motion/useReducedFx";
import { useHoverRect } from "@/primitives/hoverRect";

export const FOOTER_TEXT = "TRADE JOURNAL";
export const FOOTER_TOP_LABEL = "Nach oben";
export const FOOTER_TICKER_LABEL = "Journal-Kennzahlen";

export const CONFIG = {
  revealAt: 0.72,
  hideAt: 0.5,
  ease: "cubic-bezier(.16,1,.3,1)",
  headline: { ms: 450, delay: 0, rise: 27 },
  bar: { ms: 1100, delay: 380, rise: 14 },
  links: { ms: 1100, delay: 460, rise: 14 },
  band: { ms: 700, delay: 800, rise: 50, tiltFrom: -3.6, tilt: -1.8 },
  /** Bundle `f2` stroke draw: 4 s easeInOut, once, when the footer is first uncovered */
  draw: { duration: 4, ease: "easeInOut" },
} as const;

/** Pure hysteresis: shown once the uncovered share passes `revealAt`, hidden again only below `hideAt`. */
export function nextFooterShown(prev: boolean, pastReveal: boolean, pastHide: boolean): boolean {
  if (pastReveal) return true;
  if (!pastHide) return false;
  return prev;
}

/** Inline transition for one staggered part (only while shown: hiding is instant, like the pack). */
function part(shown: boolean, reduced: boolean, t: { ms: number; delay: number; rise: number }, extra?: { from: string; to: string }): CSSProperties {
  const on = shown || reduced;
  return {
    opacity: on ? 1 : 0,
    // 2D transforms: at rest (hidden or shown) no part keeps its own compositor layer
    transform: on ? (extra?.to ?? "none") : (extra?.from ?? `translate(0,${t.rise}px)`),
    transition: shown && !reduced ? `opacity ${t.ms}ms ${CONFIG.ease} ${t.delay}ms, transform ${t.ms}ms ${CONFIG.ease} ${t.delay}ms` : "none",
  };
}

/* ------------------------------------------------------------------ wordmark */

/**
 * Outline wordmark `TRADE JOURNAL` as dancing letters (pack `dancing-letters` on SVG, hover devices): every letter
 * keeps the stroke-draw (once, when the footer is first uncovered) and the hover gradient behind a pointer-following
 * radial mask. Gradient and mask are `userSpaceOnUse` in the word box's px, so they line up across the per-letter
 * SVGs; the box is measured on resize only, the mask centre follows through MotionValues (`spring.tooltip`).
 */
export function FooterOutline({ text = FOOTER_TEXT, draw = true }: { text?: string; draw?: boolean }) {
  const id = useId().replace(/:/g, "");
  const reduced = useReducedFx();
  const hoverRect = useHoverRect();
  const boxRef = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState({ w: 1000, h: 140 });
  const rawX = useMotionValue(500);
  const rawY = useMotionValue(70);
  const cx = useSpring(rawX, spring.tooltip);
  const cy = useSpring(rawY, spring.tooltip);

  useLayoutEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    const measure = () => {
      const w = Math.max(1, el.clientWidth);
      const h = Math.max(1, el.clientHeight);
      setBox((b) => (b.w === w && b.h === h ? b : { w, h }));
    };
    measure();
    if (typeof ResizeObserver !== "function") return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const at = (e: PointerEvent<HTMLDivElement>, r: DOMRect) => ({ x: e.clientX - r.left, y: e.clientY - r.top });
  const onPointerEnter = (e: PointerEvent<HTMLDivElement>) => {
    if (e.pointerType !== "mouse") return;
    const p = at(e, hoverRect.enter(e.currentTarget));
    // start the mask under the pointer instead of sweeping in from the last spot
    rawX.jump(p.x);
    rawY.jump(p.y);
    cx.jump(p.x);
    cy.jump(p.y);
  };
  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    if (e.pointerType !== "mouse") return;
    const r = hoverRect.tracks(e.currentTarget) ? hoverRect.read() : hoverRect.enter(e.currentTarget);
    if (!r) return;
    const p = at(e, r);
    rawX.set(p.x);
    rawY.set(p.y);
  };

  const defs = (
    <defs>
      <linearGradient id={`tg${id}`} gradientUnits="userSpaceOnUse" x1={0} y1={0} x2={box.w} y2={0}>
        <stop offset="0%" stopColor="#8a8a8a" />
        <stop offset="40%" stopColor="#ffffff" />
        <stop offset="65%" stopColor="#ffffff" />
        <stop offset="100%" stopColor="#e5202e" />
      </linearGradient>
      <motion.radialGradient id={`rm${id}`} gradientUnits="userSpaceOnUse" r={box.w * 0.22} cx={cx as MotionValue<number>} cy={cy as MotionValue<number>}>
        <stop offset="0%" stopColor="white" />
        <stop offset="100%" stopColor="black" />
      </motion.radialGradient>
      <mask id={`m${id}`} maskUnits="userSpaceOnUse" maskContentUnits="userSpaceOnUse" x={0} y={0} width={box.w} height={box.h}>
        <rect x={0} y={0} width={box.w} height={box.h} fill={`url(#rm${id})`} />
      </mask>
    </defs>
  );

  return (
    <div ref={boxRef} className="h-full w-full" onPointerEnter={onPointerEnter} onPointerLeave={() => hoverRect.leave()} onPointerMove={onPointerMove}>
      <DancingSvgWord text={text} className="group/word h-full w-full" textClassName="font-sans text-[clamp(36px,10.5vw,72px)] font-bold" defs={defs}>
        {(ch) => (
          <>
            {/* opacity fades on 0.2 s ease-out (= tween.fade, CSS, compositor); `hover:` variants only apply on hover devices */}
            <text dominantBaseline="middle" strokeWidth="0.4" className="fill-transparent stroke-line-2 opacity-0 transition-opacity duration-200 ease-out group-hover/word:opacity-80">
              {ch}
            </text>
            <motion.text
              dominantBaseline="middle"
              strokeWidth="0.4"
              className="fill-transparent stroke-line-2"
              initial={reduced ? false : { strokeDashoffset: 1000, strokeDasharray: 1000 }}
              animate={reduced || draw ? { strokeDashoffset: 0, strokeDasharray: 1000 } : undefined}
              transition={CONFIG.draw}
            >
              {ch}
            </motion.text>
            <text
              dominantBaseline="middle"
              strokeWidth="0.4"
              stroke={`url(#tg${id})`}
              mask={`url(#m${id})`}
              className="fill-transparent opacity-0 transition-opacity duration-200 ease-out group-hover/word:opacity-100"
            >
              {ch}
            </text>
          </>
        )}
      </DancingSvgWord>
    </div>
  );
}

/** The footer shell re-renders when it is revealed / hidden; the wordmark only cares about `draw`. */
const FooterOutlineMemo = memo(FooterOutline);

/* ------------------------------------------------------------------ ticker */

function Stat({ label, children, tone }: { label: string; children: React.ReactNode; tone?: string }) {
  return (
    <span className="flex items-baseline gap-3 whitespace-nowrap px-6">
      <span className="text-faint">{label}</span>
      <span className={cn("num text-fg", tone)}>{children}</span>
      <span aria-hidden="true" className="pl-6 text-faint">
        ✦
      </span>
    </span>
  );
}

const StatsBand = memo(function StatsBand({ paused }: { paused: boolean }) {
  const stats = useShellStats();
  const t = shellStatTexts(stats);
  const price = useLivePriceText();
  return (
    <Marquee aria-label={FOOTER_TICKER_LABEL} gap={0} fade={64} paused={paused} className="h-full font-mono text-[11.5px] font-medium uppercase tracking-[0.24em]">
      <Stat label="Netto-P&L" tone={stats.net > 0 ? "text-win" : stats.net < 0 ? "text-loss" : undefined}>
        {t.net}
      </Stat>
      <Stat label="Win-Rate">{t.winRate}</Stat>
      <Stat label="Trades">{t.trades}</Stat>
      <Stat label="Grundlagen">{t.setups}</Stat>
      {/* live price: decorative (never announced), text driven by the MotionValue */}
      <span aria-hidden="true" className="flex items-baseline gap-3 whitespace-nowrap px-6">
        <span className="text-faint">BTC</span>
        <motion.span className="num text-fg">{price}</motion.span>
        <span className="pl-6 text-faint">✦</span>
      </span>
    </Marquee>
  );
});

/* ------------------------------------------------------------------ footer */

/** Watches the footer's top edge (`sentinel`) against the footer height: `true` once ≥ `revealAt` of the footer is uncovered. */
function useFooterShown(sentinel: React.RefObject<HTMLElement | null>, footer: React.RefObject<HTMLElement | null>): boolean {
  // engines without IntersectionObserver show the footer at once
  const [shown, setShown] = useState(() => typeof IntersectionObserver !== "function");
  const [height, setHeight] = useState(0);

  useLayoutEffect(() => {
    const el = footer.current;
    if (!el) return;
    const measure = () => setHeight(Math.round(el.offsetHeight));
    measure();
    if (typeof ResizeObserver !== "function") return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [footer]);

  useEffect(() => {
    const el = sentinel.current;
    if (!el || height <= 0 || typeof IntersectionObserver !== "function") return;
    const past = { reveal: false, hide: false };
    const watch = (share: number, key: "reveal" | "hide") =>
      new IntersectionObserver(
        (entries) => {
          const e = entries[entries.length - 1];
          if (!e) return;
          // the edge is past the line when it intersects the shrunken viewport or has gone above it
          past[key] = e.isIntersecting || e.boundingClientRect.top < (e.rootBounds?.top ?? 0);
          setShown((prev) => nextFooterShown(prev, past.reveal, past.hide));
        },
        { rootMargin: `0px 0px -${Math.round(height * share)}px 0px` },
      );
    const a = watch(CONFIG.revealAt, "reveal");
    const b = watch(CONFIG.hideAt, "hide");
    a.observe(el);
    b.observe(el);
    return () => {
      a.disconnect();
      b.disconnect();
    };
  }, [sentinel, height]);

  return shown;
}

/**
 * The footer (Plan 2.6 + pack `motion-footer`): ticker band, outline wordmark, the mandatory lightweight-charts
 * attribution (Plan 5.8) and a back-to-top button. Bottom padding keeps every part above the dock.
 */
export function Footer() {
  const reduced = useReducedFx();
  const sentinel = useRef<HTMLDivElement>(null);
  const footer = useRef<HTMLElement>(null);
  const shown = useFooterShown(sentinel, footer);
  const [drawn, setDrawn] = useState(false);
  if (shown && !drawn) setDrawn(true);

  const band = CONFIG.band;
  return (
    <>
      <div ref={sentinel} aria-hidden="true" className="h-px" />
      <footer ref={footer} data-shown={shown || undefined} className="relative overflow-x-clip pb-[calc(112px+var(--safe-bottom,env(safe-area-inset-bottom,0px)))] pt-10">
        <div className="relative h-14" style={{ marginInline: "-6%", ...part(shown, reduced, band, { from: `rotate(${band.tiltFrom}deg) translate(0,${band.rise}px)`, to: `rotate(${band.tilt}deg)` }) }}>
          <div className="h-full border-y border-white/[0.06] bg-black/20">
            {/* mounts on the first reveal, paused while the footer is mostly off screen, resumes where it stopped */}
            {(drawn || reduced) && <StatsBand paused={!shown} />}
          </div>
        </div>
        <div className="mx-auto mt-6 h-28 max-w-[1320px] px-4 sm:h-36 sm:px-6" style={part(shown, reduced, CONFIG.headline)}>
          <FooterOutlineMemo draw={drawn} />
        </div>
        <div className="mx-auto flex max-w-[1320px] items-end justify-between gap-4 px-4 sm:px-6">
          <div style={part(shown, reduced, CONFIG.bar)}>
            <ChartAttribution className="touch-hit-links" />
          </div>
          <div style={part(shown, reduced, CONFIG.links)}>
            <button
              type="button"
              aria-label={FOOTER_TOP_LABEL}
              onClick={() => window.scrollTo({ top: 0, behavior: reduced ? "auto" : "smooth" })}
              className="touch-hit grid size-10 place-items-center rounded-full border border-line-2 bg-ink-850 text-mute transition-[translate,color] duration-[250ms] [transition-timing-function:cubic-bezier(.16,1,.3,1)] hover:-translate-y-0.5 hover:text-fg"
            >
              <svg viewBox="0 0 16 16" className="size-4" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M8 13V3.5M4.5 7 8 3.5 11.5 7" />
              </svg>
            </button>
          </div>
        </div>
      </footer>
    </>
  );
}
