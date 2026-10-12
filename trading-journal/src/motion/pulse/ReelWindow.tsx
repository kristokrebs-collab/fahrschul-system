import { useEffect, useLayoutEffect, useRef, type ReactNode } from "react";
import { cn } from "@/lib/cn";
import { easeOutCubic } from "@/motion/pulse/engine";
import { createTimeline, type Timeline } from "@/motion/pulse/textKit";
import { useFxPlay } from "@/motion/fx/shared";
import { useReducedFx } from "@/motion/useReducedFx";

/**
 * pulse-motion `reel-collage` (measured) as a reusable montage → collage: two headline lines frame a window in which
 * the reels (screenshots, example setups, cards) hard-cut faster and faster; the window collapses (`scaleY`, 340 ms
 * ease-out cubic) while the lines close in, the lines swap text, then lines and cards spread out from the centre into
 * a tableau (440 ms, cards from 72 % of their distance at scale .86, 22 ms apart) – and it rests there (finite;
 * `loop` repeats every 3.2 s while on screen).
 *
 * Every phase is a pure function of the run time (`reelAt`, `collapseAt`, `spreadAt`); one timeline (`createTimeline`:
 * pauses off screen / hidden tab) writes `transform` / `opacity` only when a value changes. All geometry is in
 * container units (`cqw` / `cqh`, the stage is a size container), so nothing is measured. The stage is a `figure`
 * with `label`; the montage copies are aria-hidden, the tableau cards stay reachable. Reduced motion: the tableau.
 */
export const CONFIG = {
  loop: 3200,
  /** last cut of the montage (pack: 7 reels cut at 0 … 835 ms, growing durations) */
  lastCut: 835,
  cutCurve: 1.25,
  collapseAt: 906,
  collapseDur: 340,
  swapAt: 1531,
  spreadAt: 1690,
  spreadDur: 440,
  cardFade: 260,
  cardStagger: 22,
  cardStartK: 0.72,
  cardStartScale: 0.86,
  /** window size (share of the stage) and the line offsets around it */
  window: { w: 0.4, h: 0.5 },
  lineGap: 3, // cqh between a line and the collapsed window
  /** tableau: line offsets from the centre (cqw / cqh, pack −118/−173 and 70/162 px at 1234 × 673) */
  spreadTop: [-9.6, -25.7] as const,
  spreadBot: [5.7, 24.1] as const,
  /** tableau card slots (centre x / y, width as shares of the stage; pack positions) */
  slots: [
    [0.234, 0.404, 0.143],
    [0.409, 0.496, 0.192],
    [0.645, 0.272, 0.219],
    [0.61, 0.568, 0.189],
    [0.292, 0.768, 0.203],
    [0.772, 0.743, 0.193],
  ] as const,
} as const;

/** Start time (ms) of reel `i` of `n` – cuts get slower towards the end, like the pack. */
export function reelStart(i: number, n: number): number {
  if (n <= 1) return 0;
  return CONFIG.lastCut * Math.pow(i / (n - 1), CONFIG.cutCurve);
}

/** Index of the reel showing at `t` ms (−1 once the window collapsed). */
export function reelAt(t: number, n: number): number {
  if (t >= CONFIG.collapseAt + CONFIG.collapseDur || n === 0) return -1;
  let idx = 0;
  for (let i = 0; i < n; i++) if (t >= reelStart(i, n)) idx = i;
  return idx;
}

/** Collapse progress 0..1 (ease-out cubic). */
export function collapseAt(t: number): number {
  return easeOutCubic((t - CONFIG.collapseAt) / CONFIG.collapseDur);
}

/** Spread progress 0..1 (ease-out cubic). */
export function spreadAt(t: number): number {
  return easeOutCubic((t - CONFIG.spreadAt) / CONFIG.spreadDur);
}

export interface ReelWindowProps {
  reels: readonly ReactNode[];
  /** Headline lines around the window. */
  lines: readonly [string, string];
  /** Lines after the collapse (default: `lines`). */
  swapLines?: readonly [string, string];
  /** Tableau cards (default: the first six reels). */
  cards?: readonly ReactNode[];
  play?: number | boolean;
  /** Play once on first view (default true). */
  playOnView?: boolean;
  loop?: boolean;
  label: string;
  /** The stage needs a size (default aspect 16 / 9). */
  className?: string;
  onDone?: () => void;
}

export function ReelWindow({ reels, lines, swapLines, cards, play, playOnView = true, loop = false, label, className, onDone }: ReelWindowProps) {
  const reduced = useReducedFx();
  const stageRef = useRef<HTMLElement>(null);
  const windowRef = useRef<HTMLDivElement>(null);
  const reelRefs = useRef<(HTMLDivElement | null)[]>([]);
  const topRef = useRef<HTMLSpanElement>(null);
  const botRef = useRef<HTMLSpanElement>(null);
  const topText = useRef<HTMLSpanElement>(null);
  const botText = useRef<HTMLSpanElement>(null);
  const cardRefs = useRef<(HTMLDivElement | null)[]>([]);
  const tl = useRef<Timeline | null>(null);
  const tableau = (cards ?? reels).slice(0, CONFIG.slots.length);
  const swap = swapLines ?? lines;
  const live = useRef({ lines, swap, n: reels.length, m: tableau.length, loop, onDone });
  useLayoutEffect(() => {
    live.current = { lines, swap, n: reels.length, m: tableau.length, loop, onDone };
  });

  /** Writes the frame at `t` ms (cache keys: DOM writes only on change). */
  const cache = useRef<Record<string, string | number>>({});
  const set = (key: string, el: HTMLElement | null | undefined, prop: "transform" | "opacity" | "text", value: string) => {
    if (!el || cache.current[key] === value) return;
    cache.current[key] = value;
    if (prop === "text") el.textContent = value;
    else el.style[prop] = value;
  };
  const render = (t: number) => {
    const { n, m, lines: l0, swap: l1 } = live.current;
    const reel = reelAt(t, n);
    for (let i = 0; i < n; i++) set(`r${i}`, reelRefs.current[i], "opacity", i === reel ? "1" : "0");
    const c = collapseAt(t);
    const sp = spreadAt(t);
    set("w", windowRef.current, "transform", `translate(-50%,-50%) scaleY(${(1 - c).toFixed(4)})`);
    set("wo", windowRef.current, "opacity", reel < 0 ? "0" : "1");
    // lines: framing the window → closing in → spreading to the tableau
    const half = (CONFIG.window.h * 100) / 2;
    const ty = (half + CONFIG.lineGap) * (1 - c) + CONFIG.lineGap * c;
    const [tx0, ty0] = CONFIG.spreadTop;
    const [bx0, by0] = CONFIG.spreadBot;
    set("t", topRef.current, "transform", `translate(calc(-50% + ${(tx0 * sp).toFixed(2)}cqw), calc(-100% - ${(ty * (1 - sp) - ty0 * sp).toFixed(2)}cqh))`);
    set("b", botRef.current, "transform", `translate(calc(-50% + ${(bx0 * sp).toFixed(2)}cqw), calc(${(ty * (1 - sp) + by0 * sp).toFixed(2)}cqh))`);
    const swapped = t >= CONFIG.swapAt;
    set("tt", topText.current, "text", swapped ? l1[0] : l0[0]);
    set("bt", botText.current, "text", swapped ? l1[1] : l0[1]);
    for (let i = 0; i < m; i++) {
      const slot = CONFIG.slots[i]!;
      const local = Math.max(0, Math.min(1, (t - CONFIG.spreadAt - i * CONFIG.cardStagger) / CONFIG.spreadDur));
      const k = easeOutCubic(local);
      const o = Math.max(0, Math.min(1, (t - CONFIG.spreadAt - i * CONFIG.cardStagger) / CONFIG.cardFade));
      // start at 72 % of the way from the centre, in units of the card's own size (no measuring)
      const dx = ((0.5 - slot[0]) / slot[2]) * 100 * CONFIG.cardStartK * (1 - k);
      const dy = ((0.5 - slot[1]) / (slot[2] * 0.62)) * 100 * CONFIG.cardStartK * (1 - k);
      const sc = CONFIG.cardStartScale + (1 - CONFIG.cardStartScale) * k;
      const el = cardRefs.current[i];
      set(`c${i}`, el, "transform", k >= 1 ? "translate(-50%,-50%)" : `translate(calc(-50% + ${dx.toFixed(2)}%), calc(-50% + ${dy.toFixed(2)}%)) scale(${sc.toFixed(4)})`);
      set(`co${i}`, el, "opacity", o.toFixed(3));
    }
  };

  const end = CONFIG.spreadAt + CONFIG.spreadDur + (Math.max(0, tableau.length - 1) * CONFIG.cardStagger);
  const start = () => {
    const stage = stageRef.current;
    if (!stage) return;
    tl.current?.stop();
    const timeline = createTimeline(stage, (e) => {
      const { loop: lp } = live.current;
      const t = lp ? e % CONFIG.loop : Math.min(e, end);
      render(t);
      if (!lp && e >= end) {
        live.current.onDone?.();
        return false;
      }
      return true;
    });
    tl.current = timeline;
    timeline.start();
  };

  // rest frame: the tableau (also the reduced-motion and pre-play state)
  useLayoutEffect(() => {
    render(reduced || !playOnView ? end : 0);
    // render only touches refs
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reduced]);

  useFxPlay(stageRef, play, playOnView, !reduced, start);
  useEffect(() => () => tl.current?.stop(), []);

  return (
    <figure ref={stageRef} aria-label={label} data-pulse="reel-window" className={cn("relative isolate m-0 aspect-[4/3] w-full sm:aspect-video overflow-hidden rounded-2xl border border-line bg-ink-950 [container-type:size]", className)}>
      {/* tableau cards (the real, reachable content) */}
      {tableau.map((card, i) => {
        const [cx, cy, w] = CONFIG.slots[i]!;
        return (
          <div
            key={i}
            ref={(el) => {
              cardRefs.current[i] = el;
            }}
            className="absolute overflow-hidden rounded-[1.2cqw] border border-white/10 bg-ink-850 shadow-[0_1.5cqw_3cqw_-1cqw_rgb(0_0_0/0.6)]"
            style={{ left: `${cx * 100}%`, top: `${cy * 100}%`, width: `${w * 100}%`, transform: "translate(-50%,-50%)" }}
          >
            {card}
          </div>
        );
      })}
      {/* the montage window */}
      <div ref={windowRef} aria-hidden="true" className="absolute left-1/2 top-1/2 overflow-hidden rounded-[0.8cqw] bg-ink-900" style={{ width: `${CONFIG.window.w * 100}%`, height: `${CONFIG.window.h * 100}%`, transform: "translate(-50%,-50%)" }}>
        {reels.map((r, i) => (
          <div
            key={i}
            ref={(el) => {
              reelRefs.current[i] = el;
            }}
            className="absolute inset-0"
            style={{ opacity: 0 }}
          >
            {r}
          </div>
        ))}
        <span className="pointer-events-none absolute inset-0 shadow-[inset_0_0_0_1px_rgb(229_32_46/0.35),inset_0_0_4cqw_rgb(229_32_46/0.12)]" />
      </div>
      {/* headline lines */}
      <span ref={topRef} className="pointer-events-none absolute left-1/2 top-1/2 whitespace-nowrap text-[4.6cqw] font-medium leading-none tracking-[-0.045em] text-fg [text-shadow:0_0.4cqw_2.4cqw_rgb(0_0_0/0.85)]" style={{ transform: "translate(-50%,-100%)" }}>
        <span ref={topText}>{lines[0]}</span>
      </span>
      <span ref={botRef} className="pointer-events-none absolute left-1/2 top-1/2 whitespace-nowrap text-[4.6cqw] font-medium leading-none tracking-[-0.045em] text-fg [text-shadow:0_0.4cqw_2.4cqw_rgb(0_0_0/0.85)]" style={{ transform: "translate(-50%,0)" }}>
        <span ref={botText}>{lines[1]}</span>
      </span>
      <figcaption className="sr-only">
        {swap[0]} {swap[1]}
      </figcaption>
    </figure>
  );
}
