import { useEffect, useLayoutEffect, useRef } from "react";
import { cn } from "@/lib/cn";
import { useFxPlay } from "@/motion/fx/shared";
import { formatNumber } from "@/motion/MotionNumber";
import { cubicBezier } from "@/motion/pulse/engine";
import { createTimeline, hashString, type Timeline } from "@/motion/pulse/textKit";
import { ease, fxTiming, tween } from "@/motion/tokens";
import { useReducedFx } from "@/motion/useReducedFx";

/**
 * NumberCascade – a result counts up under a digit rain: every digit slot of the final value rains (re-rolls every
 * `fxTiming.cascadeReroll`, each new glyph dropping in from above) around the digit of the counting value, and the
 * slots lock from the most significant digit to the last within `tween.cascade` – each lock pops once. Separators,
 * sign and unit stay still. Built for calculator results, risk-of-ruin, records.
 *
 * Zero React renders while it runs: the slots are rendered once (from the final formatted value, so the width never
 * jumps) and the timeline (`createTimeline`: pauses off-screen) writes their text / transform / opacity only when
 * they change. The final text is an sr-only span (the accessible name never flickers); the visual layer is
 * aria-hidden. Plays on first view and on every new `play` key or value. Reduced motion: the final value at once.
 */
export const NUMBER_CASCADE = {
  /** share of the duration before the first slot locks */
  lockStart: 0.35,
  /** rain drop height (em) and the dim opacity of an unlocked slot */
  drop: 0.32,
  rainOpacity: 0.6,
  /** lock pop scale */
  pop: 1.18,
} as const;

const easeCount = cubicBezier(...ease.out);
const isDigit = (ch: string) => ch >= "0" && ch <= "9";

/** Lock time (0..1 of the run) of digit slot `k` out of `n` digit slots (most significant first). */
export function lockAt(k: number, n: number): number {
  if (n <= 1) return 1;
  return NUMBER_CASCADE.lockStart + ((1 - NUMBER_CASCADE.lockStart) * k) / (n - 1);
}

/** Deterministic rain digit of slot `k` in re-roll step `step` (no Math.random per frame). */
export function rainDigit(seed: number, k: number, step: number): number {
  let h = (seed ^ Math.imul(k + 1, 0x9e3779b1) ^ Math.imul(step + 1, 0x85ebca6b)) >>> 0;
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d) >>> 0;
  h = (h ^ (h >>> 13)) >>> 0;
  return h % 10;
}

export interface NumberCascadeProps {
  value: number;
  decimals?: number;
  prefix?: string;
  suffix?: string;
  signed?: boolean;
  /** Custom formatter (default de-DE `formatNumber`). */
  format?: (v: number) => string;
  /** Replay key. */
  play?: number | boolean;
  /** Cascade on first view (default true). A value change cascades again. */
  playOnView?: boolean;
  /** Seconds (default `tween.cascade`). */
  duration?: number;
  className?: string;
  onDone?: () => void;
}

export function NumberCascade({ value, decimals = 0, prefix = "", suffix = "", signed = false, format, play, playOnView = true, duration = tween.cascade.duration, className, onDone }: NumberCascadeProps) {
  const reduced = useReducedFx();
  const rootRef = useRef<HTMLSpanElement>(null);
  const slotsRef = useRef<HTMLSpanElement>(null);
  const tl = useRef<Timeline | null>(null);
  const fmt = (v: number) => (format ? format(v) : formatNumber(v, { decimals, prefix, suffix, signed }));
  const final = fmt(value);
  const chars = Array.from(final);
  const live = useRef({ value, final, onDone, fmt });
  useLayoutEffect(() => {
    live.current = { value, final, onDone, fmt };
  });

  const settle = () => {
    tl.current?.stop();
    const host = slotsRef.current;
    if (!host) return;
    const f = Array.from(live.current.final);
    Array.from(host.children).forEach((el, i) => {
      const span = el as HTMLElement;
      if (span.textContent !== f[i]) span.textContent = f[i] ?? "";
      span.style.transform = "";
      span.style.opacity = "";
    });
    rootRef.current?.removeAttribute("data-raining");
  };

  const run = () => {
    const host = slotsRef.current;
    const root = rootRef.current;
    if (!host || !root) return;
    tl.current?.stop();
    const { value: target, final: fin } = live.current;
    const finalChars = Array.from(fin);
    const els = Array.from(host.children) as HTMLElement[];
    const digitSlots = finalChars.map((ch, i) => (isDigit(ch) ? i : -1)).filter((i) => i >= 0);
    const nDigits = digitSlots.length;
    const seed = hashString(fin);
    const ms = duration * 1000;
    const reroll = fxTiming.cascadeReroll * 1000;
    root.setAttribute("data-raining", "");
    const shown: string[] = finalChars.map(() => "");
    const timeline = createTimeline(root, (e) => {
      const p = Math.min(1, e / ms);
      const counting = Array.from(live.current.fmt(target * easeCount(p))).filter(isDigit);
      // right-align the counting digits under the final digit slots
      const offset = nDigits - counting.length;
      const step = Math.floor(e / reroll);
      const phase = (e % reroll) / reroll;
      digitSlots.forEach((slot, k) => {
        const el = els[slot];
        if (!el) return;
        const lock = lockAt(k, nDigits);
        const locked = p >= lock;
        let ch: string;
        if (locked) ch = finalChars[slot]!;
        else {
          const base = Number(counting[k - offset] ?? "0");
          // the rain wanders around the counting digit and converges as the lock approaches
          const spread = Math.ceil(9 * (1 - p / lock)) + 1;
          ch = String((base + (rainDigit(seed, k, step) % spread)) % 10);
        }
        if (shown[slot] !== ch) {
          shown[slot] = ch;
          el.textContent = ch;
        }
        if (locked) {
          const since = (p - lock) * ms;
          const pop = since < 160 ? 1 + (NUMBER_CASCADE.pop - 1) * (1 - since / 160) : 1;
          el.style.transform = pop === 1 ? "" : `scale(${pop.toFixed(3)})`;
          el.style.opacity = "";
        } else {
          const y = -NUMBER_CASCADE.drop * (1 - easeCount(phase));
          el.style.transform = `translateY(${y.toFixed(3)}em)`;
          el.style.opacity = String(NUMBER_CASCADE.rainOpacity);
        }
      });
      if (p >= 1) {
        settle();
        live.current.onDone?.();
        return false;
      }
      return true;
    });
    tl.current = timeline;
    timeline.start();
  };

  useFxPlay(rootRef, play, playOnView, !reduced, run);

  // a NEW value cascades again (or settles at once under reduced motion); StrictMode's effect replay sees the same
  // value and does nothing
  const shownFinal = useRef(final);
  useEffect(() => {
    if (shownFinal.current === final) return;
    shownFinal.current = final;
    if (reduced) settle();
    else run();
    // run / settle only touch refs
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [final, reduced]);

  useEffect(() => () => tl.current?.stop(), []);

  return (
    <span ref={rootRef} data-fx="number-cascade" className={cn("relative inline-flex tabular-nums", className)}>
      <span className="sr-only">{final}</span>
      <span ref={slotsRef} aria-hidden="true" className="inline-flex">
        {chars.map((ch, i) => (
          <span key={`${final}-${i}`} className="inline-block whitespace-pre">
            {ch}
          </span>
        ))}
      </span>
    </span>
  );
}
