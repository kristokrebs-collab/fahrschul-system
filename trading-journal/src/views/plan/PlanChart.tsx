/**
 * The picture of the plan: the candles of the session with the opening range as a band, the signal as a vertical line and
 * entry, stop and target as horizontal lines. A small SVG (no chart library, nothing animated): the candles are drawn from the
 * same data the numbers come from, so the picture cannot say more than the numbers. Labels are HTML on top of the drawing, so
 * the text stays sharp at any width; they are spread apart when levels lie close together.
 */
import { useMemo } from "react";
import { clockIn, priceText, zoneLabel, type EntrySignal, type RangeInfo } from "@/domain/plan";
import type { Side } from "@/domain/types";
import { cn } from "@/lib/cn";
import type { Candle } from "@/market/types";

export interface PlanChartProps {
  candles: readonly Candle[];
  intervalMs: number;
  openMs: number;
  closeMs: number;
  tz: string;
  range: RangeInfo | null;
  signal: EntrySignal | null;
  side: Side | null;
  entry: number | null;
  stop: number | null;
  target: number | null;
  flatByMs: number | null;
  tick: number;
  /** the session is over: the picture starts at the open, else it follows the newest candles */
  past: boolean;
  className?: string;
}

const W = 640;
const H = 240;
const MAX_CANDLES = 100;
const BEFORE = 6;
/** Minimum distance between two labels, in percent of the height. */
const GAP = 8.5;

interface Label {
  key: string;
  text: string;
  y: number;
  tone: string;
}

/** Spreads labels top to bottom so that none covers another. */
export function spreadLabels(labels: readonly Label[], gap = GAP): Array<Label & { top: number }> {
  const sorted = [...labels].sort((a, b) => a.y - b.y);
  const out: Array<Label & { top: number }> = [];
  let prev = -Infinity;
  for (const l of sorted) {
    const top = Math.max(l.y, prev + gap);
    out.push({ ...l, top });
    prev = top;
  }
  // pushed past the bottom: shift the stack back up
  const over = (out[out.length - 1]?.top ?? 0) - (100 - 4);
  if (over > 0) for (const o of out) o.top = Math.max(2, o.top - over);
  return out;
}

export function PlanChart({ candles, intervalMs, openMs, closeMs, tz, range, signal, side, entry, stop, target, flatByMs, tick, past, className }: PlanChartProps) {
  const view = useMemo(() => {
    const start = openMs - BEFORE * intervalMs;
    const inSession = candles.filter((c) => c.time >= start && c.time < closeMs && [c.open, c.high, c.low, c.close].every(Number.isFinite));
    const shown = past ? inSession.slice(0, MAX_CANDLES) : inSession.slice(-MAX_CANDLES);
    if (!shown.length) return null;
    const levels = [range?.high, range?.low, entry, stop, target].filter((x): x is number => typeof x === "number" && Number.isFinite(x));
    let lo = Math.min(...shown.map((c) => c.low), ...levels);
    let hi = Math.max(...shown.map((c) => c.high), ...levels);
    const pad = (hi - lo || Math.abs(hi) * 0.01 || 1) * 0.07;
    lo -= pad;
    hi += pad;
    const t0 = shown[0]!.time;
    const t1 = shown[shown.length - 1]!.time + intervalMs;
    return { shown, lo, hi, t0, t1 };
  }, [candles, intervalMs, openMs, closeMs, range, entry, stop, target, past]);

  if (!view) {
    return (
      <div className={cn("grid h-[242px] place-items-center sm:h-[282px] rounded-xl border border-dashed border-line-2 bg-ink-950/40 px-4 text-center text-[12.5px] text-mute", className)} data-testid="hplan-chart-empty">
        Noch keine Kerzen zu zeigen.
      </div>
    );
  }
  const { shown, lo, hi, t0, t1 } = view;
  const x = (t: number): number => ((t - t0) / (t1 - t0)) * W;
  const y = (p: number): number => H - ((p - lo) / (hi - lo)) * H;
  const cw = W / shown.length;
  const body = Math.max(1.2, cw * 0.6);
  const price = (p: number): string => priceText(p, tick);
  const labels: Label[] = [];
  if (range) {
    labels.push({ key: "high", text: `Range-Hoch ${price(range.high)}`, y: (y(range.high) / H) * 100, tone: "text-mute" });
    labels.push({ key: "low", text: `Range-Tief ${price(range.low)}`, y: (y(range.low) / H) * 100, tone: "text-mute" });
  }
  if (entry != null) labels.push({ key: "entry", text: `Einstieg ${price(entry)}`, y: (y(entry) / H) * 100, tone: "text-fg" });
  if (stop != null) labels.push({ key: "stop", text: `Stop ${price(stop)}`, y: (y(stop) / H) * 100, tone: "text-loss" });
  if (target != null) labels.push({ key: "target", text: `Ziel ${price(target)}`, y: (y(target) / H) * 100, tone: "text-win" });
  const spread = spreadLabels(labels);
  const line = { vectorEffect: "non-scaling-stroke" } as const;
  const caption = `Kerzen ${clockIn(shown[0]!.time, tz)} bis ${clockIn(shown[shown.length - 1]!.time, tz)} Uhr (${zoneLabel(shown[0]!.time, tz)})`;
  const summary = [range ? `Range ${price(range.low)} bis ${price(range.high)}` : null, signal ? `Signal ${signal.side === "long" ? "Long" : "Short"} um ${clockIn(signal.barClose, tz)} Uhr zu ${price(signal.price)}` : null, entry != null ? `Einstieg ${price(entry)}` : null, stop != null ? `Stop ${price(stop)}` : null, target != null ? `Ziel ${price(target)}` : null]
    .filter(Boolean)
    .join(", ");

  return (
    <figure className={cn("grid gap-1.5", className)} data-testid="hplan-chart" data-side={side ?? undefined}>
      <div className="relative h-[220px] w-full overflow-hidden rounded-xl border border-line bg-ink-950/60 sm:h-[260px]" role="img" aria-label={`Kerzenbild der Sitzung. ${summary || "Noch ohne Plan."}`}>
        <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="absolute inset-0 size-full" aria-hidden="true">
          {range && <rect x={x(range.startMs)} y={y(range.high)} width={Math.max(0, x(range.endMs) - x(range.startMs))} height={Math.max(0, y(range.low) - y(range.high))} fill="currentColor" className="text-white/[0.06]" />}
          {range && (
            <>
              <line x1={x(range.startMs)} x2={W} y1={y(range.high)} y2={y(range.high)} stroke="currentColor" strokeWidth="1" strokeDasharray="3 4" className="text-faint-line" {...line} />
              <line x1={x(range.startMs)} x2={W} y1={y(range.low)} y2={y(range.low)} stroke="currentColor" strokeWidth="1" strokeDasharray="3 4" className="text-faint-line" {...line} />
            </>
          )}
          {shown.map((c) => {
            const cx = x(c.time + intervalMs / 2);
            const up = c.close >= c.open;
            const col = up ? "var(--color-win)" : "var(--color-loss)";
            const top = y(Math.max(c.open, c.close));
            const bottom = y(Math.min(c.open, c.close));
            return (
              <g key={c.time} opacity={c.closed ? 1 : 0.5}>
                <line x1={cx} x2={cx} y1={y(c.high)} y2={y(c.low)} stroke={col} strokeWidth="1" {...line} />
                <rect x={cx - body / 2} y={top} width={body} height={Math.max(1, bottom - top)} fill={col} />
              </g>
            );
          })}
          {entry != null && <line x1={0} x2={W} y1={y(entry)} y2={y(entry)} stroke="var(--color-fg)" strokeWidth="1.2" {...line} />}
          {stop != null && <line x1={0} x2={W} y1={y(stop)} y2={y(stop)} stroke="var(--color-loss)" strokeWidth="1.2" strokeDasharray="6 4" {...line} />}
          {target != null && <line x1={0} x2={W} y1={y(target)} y2={y(target)} stroke="var(--color-win)" strokeWidth="1.2" strokeDasharray="6 4" {...line} />}
          {signal && signal.barClose >= t0 && signal.barClose <= t1 && <line x1={x(signal.barClose)} x2={x(signal.barClose)} y1={0} y2={H} stroke="var(--color-fg)" strokeWidth="1" strokeDasharray="2 4" opacity="0.7" {...line} />}
          {flatByMs != null && flatByMs >= t0 && flatByMs <= t1 && <line x1={x(flatByMs)} x2={x(flatByMs)} y1={0} y2={H} stroke="var(--color-warn)" strokeWidth="1" strokeDasharray="2 4" opacity="0.8" {...line} />}
        </svg>
        <ul className="pointer-events-none absolute inset-0" aria-hidden="true">
          {spread.map((l) => (
            <li key={l.key} className={cn("num absolute right-1.5 -translate-y-1/2 rounded-md bg-ink-950/85 px-1.5 py-0.5 font-mono text-[10.5px] leading-none", l.tone)} style={{ top: `${l.top}%` }} data-level={l.key}>
              {l.text}
            </li>
          ))}
          {signal && signal.barClose >= t0 && signal.barClose <= t1 && (
            <li className="num absolute top-1.5 -translate-x-1/2 rounded-md bg-ink-950/85 px-1.5 py-0.5 font-mono text-[10.5px] leading-none text-fg" style={{ left: `${Math.min(86, Math.max(14, (x(signal.barClose) / W) * 100))}%` }} data-level="signal">
              Signal {clockIn(signal.barClose, tz)}
            </li>
          )}
        </ul>
      </div>
      <figcaption className="num text-[11.5px] text-mute">{caption}</figcaption>
    </figure>
  );
}
