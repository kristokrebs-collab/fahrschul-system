import { motion, useMotionValueEvent, useSpring, useTransform, useVelocity, type MotionValue } from "motion/react";
import { memo, useEffect, useMemo, useRef, useState } from "react";
import { cn } from "@/lib/cn";
import { spring } from "@/motion/tokens";
import { useReducedFx } from "@/motion/useReducedFx";

/** Strip glyphs: 0–9 plus a trailing 0 so the 9 → 0 wrap stays continuous. */
const GLYPHS = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 0] as const;
/** `value` mode only: React-driven updates arriving faster than this are applied with `jump()` (Plan 3.3 "> 4 Hz → set"). */
const MAX_SPRING_HZ_INTERVAL_MS = 250;
/** `source` mode: the accessible label follows the feed at most once per second. */
const LABEL_INTERVAL_MS = 1000;
/** Motion blur: 0 px at rest, +1 px per 40 positions/s, capped at 1.5 px, quantised to .25 px so the filter string rarely changes. */
const BLUR_MAX_PX = 1.5;
const BLUR_PX_PER_VELOCITY = 1 / 40;

const mod10 = (p: number) => ((p % 10) + 10) % 10;

/**
 * Continuous odometer position of the column whose place value is `place` (1, 10, 100 … in units of the
 * lowest displayed digit) for the non-negative scaled value `x`. The lowest column follows `x` itself;
 * every higher column sits on its digit and only rolls – in lock-step with the lowest one – while all
 * columns below it pass 9 → 0, exactly like a mechanical counter. Integer `x` → integer positions.
 */
export function carryPosition(x: number, place: number): number {
  if (place <= 1) return x;
  const base = Math.floor(x / place);
  const rest = x - base * place;
  return base + Math.min(1, Math.max(0, rest - (place - 1)));
}

/** Number of integer digits shown for the non-negative value `abs` (at least one). */
export function intDigitCount(abs: number): number {
  const int = Math.floor(abs);
  return int < 1 ? 1 : Math.floor(Math.log10(int)) + 1;
}

const labelFormatters = new Map<number, Intl.NumberFormat>();
function formatDe(value: number, decimals: number): string {
  let f = labelFormatters.get(decimals);
  if (!f) {
    f = new Intl.NumberFormat("de-DE", { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
    labelFormatters.set(decimals, f);
  }
  return (value < 0 ? "−" : "") + f.format(Math.abs(value));
}

/**
 * The visual column: a vertical 0–9–0 strip translated by its (unbounded) position – one transform per column.
 * Live strips get their own compositor layer (`will-change`), so a gliding price never repaints text.
 */
function StripGlyphs({ y, filter, live = false }: { y: MotionValue<string>; filter?: MotionValue<string>; live?: boolean }) {
  return (
    <span className="relative inline-block w-[1ch] overflow-y-clip leading-none tabular-nums" aria-hidden="true">
      <span className="invisible">0</span>
      <motion.span className={cn("absolute inset-0", live && "will-change-transform")} style={{ y, filter }}>
        {GLYPHS.map((d, i) => (
          <span key={i} className="absolute inset-x-0 flex h-full items-center justify-center" style={{ top: `${i * 100}%` }}>
            {d}
          </span>
        ))}
      </motion.span>
    </span>
  );
}

const stripY = (p: number) => `${-mod10(p) * 100}%`;

const SharpStrip = memo(function SharpStrip({ pos, live }: { pos: MotionValue<number>; live?: boolean }) {
  const y = useTransform(pos, stripY);
  return <StripGlyphs y={y} live={live} />;
});

/** Strip with a velocity-driven motion blur (compositor `filter`), `none` at rest so settled digits stay crisp. */
const BlurStrip = memo(function BlurStrip({ pos }: { pos: MotionValue<number> }) {
  const y = useTransform(pos, stripY);
  const velocity = useVelocity(pos);
  const filter = useTransform(velocity, (v) => {
    const px = Math.round(Math.min(BLUR_MAX_PX, Math.abs(v) * BLUR_PX_PER_VELOCITY) * 4) / 4;
    return px === 0 ? "none" : `blur(${px}px)`;
  });
  return <StripGlyphs y={y} filter={filter} live />;
});

/* ------------------------------------------------------------------------------------------------ */
/* value mode: React-driven, one spring per column, only changed digits move                          */
/* ------------------------------------------------------------------------------------------------ */

const digitAt = (n: number, place: number) => Math.floor(n / place) % 10;

/**
 * One digit column fed by React props: an unbounded odometer position on `spring.digit`. Re-renders only
 * when its own digit changes; a wrap (9→0 / 0→9) rolls in the direction of the overall value change;
 * `instant` or updates faster than 4 Hz → `jump()`.
 */
const ValueColumn = memo(function ValueColumn({ digit, dir, instant }: { digit: number; dir: 1 | -1; instant: boolean }) {
  const [initial] = useState(digit);
  const pos = useSpring(initial, spring.digit);
  const track = useRef({ digit, pos: initial, at: 0 });

  useEffect(() => {
    const prev = track.current;
    if (prev.digit === digit) return;
    const now = performance.now();
    const fast = prev.at !== 0 && now - prev.at < MAX_SPRING_HZ_INTERVAL_MS;
    const current = mod10(prev.pos);
    const next = prev.pos + (dir > 0 ? (digit - current + 10) % 10 : -((current - digit + 10) % 10));
    if (instant || fast) pos.jump(next);
    else pos.set(next);
    track.current = { digit, pos: next, at: now };
  }, [digit, dir, instant, pos]);

  return <SharpStrip pos={pos} />;
});

function ValueDigits({ value, decimals, className, decimalClassName, instant, ariaLabel }: { value: number; decimals: number; className?: string; decimalClassName?: string; instant: boolean; ariaLabel?: string }) {
  const reduced = useReducedFx();
  // overall direction of the last change (state-from-props, no refs during render)
  const [last, setLast] = useState<{ value: number; dir: 1 | -1 }>({ value, dir: 1 });
  if (last.value !== value) setLast({ value, dir: value > last.value ? 1 : -1 });
  const dir = last.value === value ? last.dir : value > last.value ? 1 : -1;

  const abs = Math.abs(value);
  const scale = 10 ** decimals;
  const n = Math.round(abs * scale);
  const intCount = intDigitCount(n / scale);
  const jump = instant || reduced;

  return (
    <span className={cn("inline-flex items-center", className)} data-rolling-digits="">
      <span className="sr-only">{ariaLabel ?? formatDe(value, decimals)}</span>
      {value < 0 && <span aria-hidden="true">{"−"}</span>}
      {Array.from({ length: intCount }, (_, i) => {
        const k = intCount - i - 1;
        return (
          <span key={`p${k}`} className="inline-flex">
            <ValueColumn digit={digitAt(n, 10 ** (k + decimals))} dir={dir} instant={jump} />
            {k % 3 === 0 && k > 0 && <span aria-hidden="true">.</span>}
          </span>
        );
      })}
      {decimals > 0 && (
        <span className={cn("inline-flex", decimalClassName)}>
          <span aria-hidden="true">,</span>
          {Array.from({ length: decimals }, (_, i) => (
            <ValueColumn key={`d${i}`} digit={digitAt(n, 10 ** (decimals - i - 1))} dir={dir} instant={jump} />
          ))}
        </span>
      )}
    </span>
  );
}

/* ------------------------------------------------------------------------------------------------ */
/* source mode: MotionValue-driven, zero React renders per tick                                        */
/* ------------------------------------------------------------------------------------------------ */

/**
 * Column of the source-mode odometer: its continuous carry position derived from the shared smoothed value. The
 * lowest column (`place === 1`) steps through whole digits of the glide (`Math.round`) and never blurs, so the last
 * digit is legible in every frame while ticks arrive faster than the glide settles; higher columns still roll in
 * lock-step on its carry.
 */
const SourceColumn = memo(function SourceColumn({ abs, place, blur }: { abs: MotionValue<number>; place: number; blur: boolean }) {
  const lowest = place === 1;
  const pos = useTransform(abs, (x) => (lowest ? Math.round(x) : carryPosition(x, place)));
  return blur && !lowest ? <BlurStrip pos={pos} /> : <SharpStrip pos={pos} live />;
});

interface Shape {
  count: number;
  negative: boolean;
}
const shapeOf = (scaled: number, scale: number): Shape => ({ count: intDigitCount(Math.abs(scaled) / scale), negative: scaled < 0 });

function SourceDigits({
  source,
  decimals,
  className,
  decimalClassName,
  blur,
  formatLabel,
  ariaLabel,
}: {
  source: MotionValue<number>;
  decimals: number;
  className?: string;
  decimalClassName?: string;
  blur: boolean;
  formatLabel?: (v: number) => string;
  ariaLabel?: string;
}) {
  const reduced = useReducedFx();
  const scale = 10 ** decimals;
  // target on the display grid (signed, in units of the lowest digit) → glide with `spring.price`, so at rest
  // every column sits exactly on a digit and in flight every frame shows a real intermediate value
  const target = useTransform(source, (v) => Math.round(v * scale));
  const smooth = useSpring(target, spring.price);
  const scaled = useTransform(() => (reduced ? target : smooth).get());
  const abs = useTransform(scaled, Math.abs);

  // the only React state: number of integer digits + sign (re-render when the price gains a digit, not per tick)
  const [shape, setShape] = useState<Shape>(() => shapeOf(scaled.get(), scale));
  useMotionValueEvent(scaled, "change", (v) => {
    const next = shapeOf(v, scale);
    setShape((prev) => (prev.count === next.count && prev.negative === next.negative ? prev : next));
  });

  const fmt = useMemo(() => formatLabel ?? ((v: number) => formatDe(v, decimals)), [formatLabel, decimals]);
  const labelRef = useRef<HTMLSpanElement>(null);
  // accessible text ≤ 1 Hz, written imperatively into the sr-only span (not a live region): a leading write after a
  // quiet second, then one trailing write
  useEffect(() => {
    if (ariaLabel !== undefined) return;
    let last = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const write = () => {
      timer = undefined;
      last = performance.now();
      const el = labelRef.current;
      const text = fmt(source.get());
      if (el && el.textContent !== text) el.textContent = text;
    };
    const off = source.on("change", () => {
      if (timer !== undefined) return;
      const wait = LABEL_INTERVAL_MS - (performance.now() - last);
      if (wait <= 0) write();
      else timer = setTimeout(write, wait);
    });
    return () => {
      off();
      if (timer !== undefined) clearTimeout(timer);
    };
  }, [source, fmt, ariaLabel]);

  const fx = blur && !reduced;
  const intCount = shape.count;
  return (
    <span className={cn("inline-flex items-center", className)} data-rolling-digits="">
      <span ref={labelRef} className="sr-only">
        {ariaLabel ?? fmt(source.get())}
      </span>
      {shape.negative && <span aria-hidden="true">{"−"}</span>}
      {Array.from({ length: intCount }, (_, i) => {
        const k = intCount - i - 1;
        return (
          <span key={`p${k}`} className="inline-flex">
            <SourceColumn abs={abs} place={10 ** (k + decimals)} blur={fx} />
            {k % 3 === 0 && k > 0 && <span aria-hidden="true">.</span>}
          </span>
        );
      })}
      {decimals > 0 && (
        <span className={cn("inline-flex", decimalClassName)}>
          <span aria-hidden="true">,</span>
          {Array.from({ length: decimals }, (_, i) => (
            <SourceColumn key={`d${i}`} abs={abs} place={10 ** (decimals - i - 1)} blur={fx} />
          ))}
        </span>
      )}
    </span>
  );
}

interface RollingDigitsCommon {
  /** Decimal digits (default 0). */
  decimals?: number;
  className?: string;
  /** Class for the `,` + decimal columns (e.g. `text-mute` to dim the tenths of a live price). */
  decimalClassName?: string;
  /** Static accessible text override (rendered in the sr-only span). */
  "aria-label"?: string;
}

export type RollingDigitsProps = RollingDigitsCommon &
  (
    | {
        /** React-driven value: per-column springs (`spring.digit`), only changed digits move. */
        value: number;
        source?: undefined;
        /** Force instant updates. */
        instant?: boolean;
        blur?: undefined;
        formatLabel?: undefined;
      }
    | {
        value?: undefined;
        /** Live MotionValue (e.g. `priceMv`): one `spring.price` glide drives every column, no React render per tick. */
        source: MotionValue<number>;
        instant?: undefined;
        /** Velocity motion blur on fast columns (default true; off under reduced motion). */
        blur?: boolean;
        /** Accessible text from the raw source value (default de-DE with `decimals`), updated ≤ 1 Hz. */
        formatLabel?: (v: number) => string;
      }
  );

/**
 * Odometer digits (Bundle `o2`/`r2`, Plan 3.3 "Live-Preis"): de-DE grouping (`.` thousands, `,` decimals,
 * leading `−`), vertical digit strips, no roll on mount. Style from outside: `className="dot-num text-[42px]"`.
 * Accessibility: the formatted value (or `aria-label`) is the text of a leading `.sr-only` span; every visual column
 * and separator is `aria-hidden` (the CountUp / TextRoll pattern – no `role="text"`, no name on a generic element).
 * The root carries `data-rolling-digits`.
 *
 * - `value`: React-driven; each column springs on `spring.digit` straight to its new digit in the direction of
 *   the change, unchanged digits stay still; reduced motion, `instant` or > 4 Hz updates → `jump()`.
 * - `source`: a MotionValue is rounded to the display grid and glides on ONE `spring.price`; every column derives
 *   a continuous carry position from it (mechanical odometer: the lowest digit steps through whole digits, higher
 *   digits roll in lock-step on carry) and fast higher columns get a 0–1.5 px motion blur. Zero React renders per
 *   tick – only a change of the integer digit count or the sign re-renders; the accessible text updates ≤ 1 Hz.
 *   Reduced motion → follows the source without spring or blur.
 */
export function RollingDigits(props: RollingDigitsProps) {
  const { decimals = 0, className, decimalClassName, "aria-label": ariaLabel } = props;
  if (props.source) {
    return (
      <SourceDigits
        source={props.source}
        decimals={decimals}
        className={className}
        decimalClassName={decimalClassName}
        blur={props.blur ?? true}
        formatLabel={props.formatLabel}
        ariaLabel={ariaLabel}
      />
    );
  }
  return <ValueDigits value={props.value ?? 0} decimals={decimals} className={className} decimalClassName={decimalClassName} instant={props.instant ?? false} ariaLabel={ariaLabel} />;
}
