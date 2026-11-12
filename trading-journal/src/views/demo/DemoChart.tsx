/**
 * Static SVG chart of the demo (no library, no animation): the example candles, optional horizontal lines (entry, stop, target,
 * the alarm level) and numbered marks. Candle colour is the candle's direction only; every line and mark is also named in words
 * (on the line and in the list under the chart), nothing is understood by colour alone. It measures its own width so the
 * labels keep their size on a phone. The caller labels it (`label`) – it is a picture, the numbers sit next to it in text.
 */
import { useRef } from "react";
import type { Bar } from "@/domain/backtest/types";
import { cn } from "@/lib/cn";
import { price as fmtPrice } from "@/lib/format";
import { useWidth } from "@/views/timemachine/parts";

export interface ChartLine {
  price: number;
  label: string;
  tone: "entry" | "stop" | "target" | "level";
}
export interface ChartMark {
  /** index into `bars` */
  index: number;
  /** the number written on the mark (matches the list under the chart) */
  n: number;
  price: number;
}

const TONE: Record<ChartLine["tone"], string> = { entry: "text-fg", stop: "text-loss", target: "text-win", level: "text-signal" };
const DASH: Record<ChartLine["tone"], string | undefined> = { entry: "2 3", stop: "5 3", target: undefined, level: "7 3" };
const LABEL_H = 13;

export function DemoChart({ bars, lines = [], marks = [], label, height = 230, className, testId = "demo-chart" }: { bars: readonly Bar[]; lines?: readonly ChartLine[]; marks?: readonly ChartMark[]; label: string; height?: number; className?: string; testId?: string }) {
  const host = useRef<HTMLDivElement>(null);
  const W = useWidth(host, 520);
  const padX = 6;
  const padTop = 10;
  const padBottom = 14;
  const prices = [...bars.flatMap((b) => [b.h, b.l]), ...lines.map((l) => l.price)];
  const lo0 = prices.length ? Math.min(...prices) : 0;
  const hi0 = prices.length ? Math.max(...prices) : 1;
  const pad = (hi0 - lo0) * 0.05 || 1;
  const lo = lo0 - pad;
  const hi = hi0 + pad;
  const y = (v: number): number => padTop + ((hi - v) / (hi - lo)) * (height - padTop - padBottom);
  const n = Math.max(1, bars.length);
  const step = (W - padX * 2) / n;
  const x = (i: number): number => padX + step * (i + 0.5);
  const bodyW = Math.min(9, Math.max(1.2, step * 0.62));
  // labels of the lines: kept apart vertically
  const placed: { l: ChartLine; ly: number }[] = [];
  for (const l of [...lines].sort((a, b) => y(a.price) - y(b.price))) {
    const base = y(l.price) - 4;
    const prev = placed[placed.length - 1];
    placed.push({ l, ly: prev && base - prev.ly < LABEL_H ? prev.ly + LABEL_H : base });
  }
  // marks on neighbouring candles would overlap on a phone: a later mark steps down (with a short leader line to its candle)
  const spread: { m: ChartMark; cy: number }[] = [];
  for (const m of marks) {
    let cy = y(m.price);
    while (spread.some((s) => Math.abs(x(s.m.index) - x(m.index)) < 15 && Math.abs(s.cy - cy) < 15)) cy += 15;
    spread.push({ m, cy });
  }
  return (
    <div ref={host} className={cn("w-full min-w-0", className)} data-testid={testId}>
      <svg width={W} height={height} viewBox={`0 0 ${W} ${height}`} role="img" aria-label={label} className="block max-w-full select-none">
        <rect x={0} y={0} width={W} height={height} rx={10} className="fill-ink-950/50" />
        {bars.map((b, i) => {
          const up = b.c >= b.o;
          return (
            <g key={i} className={up ? "text-win" : "text-loss"} stroke="currentColor" fill="currentColor">
              <line x1={x(i)} x2={x(i)} y1={y(b.h)} y2={y(b.l)} strokeWidth={1} />
              <rect x={x(i) - bodyW / 2} y={Math.min(y(b.o), y(b.c))} width={bodyW} height={Math.max(1, Math.abs(y(b.o) - y(b.c)))} stroke="none" fillOpacity={up ? 0.35 : 0.85} />
            </g>
          );
        })}
        {placed.map(({ l, ly }) => (
          <g key={l.label} className={TONE[l.tone]}>
            <line x1={padX} x2={W - padX} y1={y(l.price)} y2={y(l.price)} stroke="currentColor" strokeWidth={1.25} strokeDasharray={DASH[l.tone]} />
            <text x={padX + 4} y={ly} fill="currentColor" fontSize={11} className="font-mono" paintOrder="stroke" stroke="rgb(0 0 0 / 0.55)" strokeWidth={3}>
              {l.label} {fmtPrice(l.price)}
            </text>
          </g>
        ))}
        {spread.map(({ m, cy }) => (
          <g key={m.n} className="text-signal">
            {cy !== y(m.price) && <line x1={x(m.index)} x2={x(m.index)} y1={y(m.price)} y2={cy} stroke="currentColor" strokeWidth={1} />}
            <circle cx={x(m.index)} cy={cy} r={7} fill="var(--color-ink-950)" stroke="currentColor" strokeWidth={1.5} />
            <text x={x(m.index)} y={cy + 3.5} textAnchor="middle" fontSize={10} fontWeight={600} fill="currentColor" className="font-mono">
              {m.n}
            </text>
          </g>
        ))}
      </svg>
    </div>
  );
}
