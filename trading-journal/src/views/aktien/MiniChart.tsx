/**
 * The chart preview of a hit: the candles the rule read, as a small static SVG – wick and body per candle, the rule's
 * levels as dashed lines with their price, and a thin line where the rule matched. No library, no animation, no data beyond
 * what the hit already carries (`Hit.preview`), so opening it costs nothing and it can never show something else than what the
 * rule saw.
 */
import { useMemo } from "react";
import type { Level, Mark, ScanCandle } from "@/domain/scanner";
import { clockText, priceText } from "@/domain/scanner";

interface Props {
  candles: readonly ScanCandle[];
  levels: readonly Level[];
  marks: readonly Mark[];
  /** time zone for the time under the chart (`America/New_York`, `UTC`); daily candles show dates */
  timeZone: string;
  daily: boolean;
  label: string;
}

const W = 340;
const H = 132;
const PAD = { l: 6, r: 74, t: 10, b: 18 };

const dateText = (ms: number): string => new Intl.DateTimeFormat("de-DE", { day: "2-digit", month: "2-digit", timeZone: "UTC" }).format(new Date(ms));

export function MiniChart({ candles, levels, marks, timeZone, daily, label }: Props) {
  const geo = useMemo(() => {
    const n = candles.length;
    if (!n) return null;
    const prices = [...candles.flatMap((c) => [c.high, c.low]), ...levels.map((l) => l.price)];
    let lo = Math.min(...prices);
    let hi = Math.max(...prices);
    if (hi === lo) {
      hi += 1;
      lo -= 1;
    }
    const pad = (hi - lo) * 0.06;
    lo -= pad;
    hi += pad;
    const x0 = PAD.l;
    const x1 = W - PAD.r;
    const step = (x1 - x0) / n;
    const y = (p: number): number => PAD.t + ((hi - p) / (hi - lo)) * (H - PAD.t - PAD.b);
    const x = (i: number): number => x0 + step * (i + 0.5);
    return { n, step, x, y, x0, x1 };
  }, [candles, levels]);
  if (!geo) return null;
  const { step, x, y, x0, x1 } = geo;
  // price labels at the right edge: lines that lie close together keep their labels apart
  const labelY = new Map<string, number>();
  let prev = -Infinity;
  for (const l of [...levels].sort((a, b) => y(a.price) - y(b.price))) {
    const at = Math.max(y(l.price), prev + 11);
    labelY.set(l.label, at);
    prev = at;
  }
  const body = Math.max(1.2, Math.min(9, step * 0.62));
  const stamp = (ms: number): string => (daily ? dateText(ms) : clockText(ms, timeZone));
  const first = candles[0]!;
  const last = candles[candles.length - 1]!;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={label} className="block h-auto w-full max-w-[420px] overflow-visible" data-testid="aktien-minichart" preserveAspectRatio="xMidYMid meet">
      {levels.map((l) => (
        <g key={l.label}>
          <line x1={x0} x2={x1} y1={y(l.price)} y2={y(l.price)} stroke="currentColor" className="text-signal" strokeWidth={1} strokeDasharray="4 3" opacity={0.8} />
          <text x={W - PAD.r + 4} y={(labelY.get(l.label) ?? y(l.price)) + 3} fontSize={9.5} className="fill-current text-mute" fontFamily="ui-monospace, monospace">
            {priceText(l.price)}
          </text>
        </g>
      ))}
      {marks.map((m) => {
        const i = candles.findIndex((c) => c.time === m.time);
        if (i < 0) return null;
        return (
          <g key={`${m.label}-${m.time}`}>
            <line x1={x(i)} x2={x(i)} y1={PAD.t - 4} y2={H - PAD.b} stroke="currentColor" className="text-faint" strokeWidth={0.8} strokeDasharray="1.5 2.5" />
            <text x={Math.min(x(i), x1 - 4)} y={PAD.t - 4} fontSize={9} textAnchor="middle" className="fill-current text-faint">
              {m.label}
            </text>
          </g>
        );
      })}
      {candles.map((c, i) => {
        const up = c.close >= c.open;
        const top = y(Math.max(c.open, c.close));
        const h = Math.max(1, Math.abs(y(c.open) - y(c.close)));
        return (
          <g key={c.time} className={up ? "text-win" : "text-loss"}>
            <line x1={x(i)} x2={x(i)} y1={y(c.high)} y2={y(c.low)} stroke="currentColor" strokeWidth={1} />
            <rect x={x(i) - body / 2} y={top} width={body} height={h} fill="currentColor" />
          </g>
        );
      })}
      <text x={x0} y={H - 4} fontSize={9.5} className="fill-current text-faint">
        {stamp(first.time)}
      </text>
      <text x={x1} y={H - 4} fontSize={9.5} textAnchor="end" className="fill-current text-faint">
        {stamp(last.time)}
        {daily ? "" : ` ${timeZone === "UTC" ? "UTC" : "NY"}`}
      </text>
    </svg>
  );
}
