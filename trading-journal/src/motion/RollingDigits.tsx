import { motion, useSpring, useTransform, type MotionValue } from "motion/react";
import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/cn";
import { spring } from "@/motion/tokens";
import { useReducedFx } from "@/motion/useReducedFx";

const DIGITS = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9] as const;
/** Updates arriving faster than this are applied with `jump()` (no spring) – Plan 3.3 "> 4 Hz → mv.set()". */
const MAX_SPRING_HZ_INTERVAL_MS = 250;

const digitAt = (n: number, place: number) => Math.floor(n / place) % 10;

function Glyph({ mv, n }: { mv: MotionValue<number>; n: number }) {
  // distance of this glyph from the current (continuous) odometer position, folded into (−5, 5]
  const y = useTransform(mv, (p) => {
    let d = (((n - p) % 10) + 10) % 10;
    if (d > 5) d -= 10;
    return `${d * 100}%`;
  });
  return (
    <motion.span style={{ y }} className="absolute inset-0 flex items-center justify-center" aria-hidden="true">
      {n}
    </motion.span>
  );
}

/**
 * One digit column of the integer `n` at `place` (10^k): an unbounded odometer position on `spring.digit`.
 * Only this column moves when its digit changes; a wrap (9→0 / 0→9) rolls in the direction of the overall
 * value change; updates faster than 4 Hz, `instant` or reduced motion → `jump()`.
 */
function Column({ n, place, instant }: { n: number; place: number; instant: boolean }) {
  const [initial] = useState(() => digitAt(n, place));
  const mv = useSpring(initial, spring.digit);
  const track = useRef({ n, pos: initial, at: 0 });

  useEffect(() => {
    const prev = track.current;
    if (prev.n === n) return;
    const now = typeof performance !== "undefined" ? performance.now() : Date.now();
    const fast = prev.at !== 0 && now - prev.at < MAX_SPRING_HZ_INTERVAL_MS;
    const dir = n > prev.n ? 1 : -1;
    const current = ((prev.pos % 10) + 10) % 10;
    const digit = digitAt(n, place);
    let pos = prev.pos;
    if (current !== digit) {
      pos += dir > 0 ? (digit - current + 10) % 10 : -((current - digit + 10) % 10);
      if (instant || fast) mv.jump(pos);
      else mv.set(pos);
    }
    track.current = { n, pos, at: now };
  }, [n, place, instant, mv]);

  return (
    <span className="relative inline-block w-[1ch] overflow-y-clip leading-none tabular-nums">
      <span className="invisible">0</span>
      {DIGITS.map((d) => (
        <Glyph key={d} mv={mv} n={d} />
      ))}
    </span>
  );
}

export interface RollingDigitsProps {
  value: number;
  decimals?: number;
  className?: string;
  /** Force instant updates (e.g. when the feed is known to be high-frequency). */
  instant?: boolean;
  "aria-label"?: string;
}

/**
 * Live price roller (Bundle `o2`/`r2`, Plan 3.3 "Live-Preis"): de-DE grouping (`.` thousands, `,`
 * decimals, leading `−`), per-digit vertical roll on `spring.digit`, no roll on mount, direction-aware,
 * unchanged digits stay still. Reduced motion or > 4 Hz updates → `jump()`.
 * Give it `.dot-num text-[42px]` from the outside.
 */
export function RollingDigits({ value, decimals = 0, className, instant = false, "aria-label": ariaLabel }: RollingDigitsProps) {
  const reduced = useReducedFx();
  const abs = Math.abs(value);
  const scale = 10 ** decimals;
  const n = Math.round(abs * scale);
  const intCount = Math.max(1, String(Math.floor(abs)).length);
  const label =
    ariaLabel ?? (value < 0 ? "−" : "") + new Intl.NumberFormat("de-DE", { minimumFractionDigits: decimals, maximumFractionDigits: decimals }).format(abs);
  const jump = instant || reduced;

  return (
    <span className={cn("inline-flex items-center", className)} role="text" aria-label={label}>
      {value < 0 && <span aria-hidden="true">{"−"}</span>}
      {Array.from({ length: intCount }, (_, i) => {
        const k = intCount - i - 1; // integer digit index from the right
        const place = 10 ** (k + decimals);
        const group = k % 3 === 0 && k > 0;
        return (
          <span key={`p${k}`} className="inline-flex">
            <Column n={n} place={place} instant={jump} />
            {group && <span aria-hidden="true">.</span>}
          </span>
        );
      })}
      {decimals > 0 && (
        <>
          <span aria-hidden="true">,</span>
          {Array.from({ length: decimals }, (_, i) => (
            <Column key={`d${i}`} n={n} place={10 ** (decimals - i - 1)} instant={jump} />
          ))}
        </>
      )}
    </span>
  );
}
