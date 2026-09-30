/**
 * "P&L pro Monat" – Recharts BarChart, 1:1 with the bundle (Plan 5.7, brief read_stats §7).
 * Data shape = `stats.months` (last 12): `{ key: "2026-09", label: "Sep 26", net, n, winRate }`.
 * Bars are `#f2f2f2` for net ≥ 0 and `#5f5f5f` below zero (monochrome per the lead's brief;
 * the bundle used win/loss green/red – switch `MONTH_COLORS` if the 1:1 look wins).
 */
import { memo, type ReactElement } from "react";
import { Bar, BarChart, CartesianGrid, Cell, ReferenceLine, Tooltip, XAxis, YAxis } from "recharts";
import { ChartContainer, type ChartConfig } from "@/ui/chart";
import { cn } from "@/lib/cn";
import { fmt } from "./format";
import { TOOLTIP_CLASS } from "./tooltip";
import { EQUITY_COLORS, TICK_STYLE } from "./EquityChart";

export interface MonthBucket {
  /** `YYYY-MM` */
  key: string;
  /** `Sep 26` */
  label: string;
  net: number;
  /** closed trades in the month */
  n: number;
  /** 0–1 or null without trades */
  winRate: number | null;
}

export interface MonthlyBarsProps {
  months: MonthBucket[];
  currency: string;
  /** px, default 240 */
  height?: number;
  className?: string;
}

export const MONTH_COLORS = { pos: "#f2f2f2", neg: "#5f5f5f" } as const;
export const monthFill = (net: number): string => (net >= 0 ? MONTH_COLORS.pos : MONTH_COLORS.neg);

const config: ChartConfig = { net: { label: "Netto", color: "#f2f2f2" } };

export interface RoundedBarGeometry {
  x: number;
  y: number;
  width: number;
  height: number;
  positive: boolean;
}

/**
 * Path with a 4-px rounding on top (net ≥ 0) or bottom (net < 0); `radius = min(4, |h|, width/2)`.
 * Returns `null` for bars thinner than 0.5 px (skipped, as in the bundle).
 */
export function roundedBarPath(g: RoundedBarGeometry): string | null {
  const h = Math.abs(g.height);
  if (h < 0.5 || g.width <= 0) return null;
  const top = Math.min(g.y, g.y + g.height);
  const r = Math.min(4, h, g.width / 2);
  const { x, width: w } = g;
  const bottom = top + h;
  if (g.positive) {
    return `M${x},${bottom} L${x},${top + r} Q${x},${top} ${x + r},${top} L${x + w - r},${top} Q${x + w},${top} ${x + w},${top + r} L${x + w},${bottom} Z`;
  }
  return `M${x},${top} L${x + w},${top} L${x + w},${bottom - r} Q${x + w},${bottom} ${x + w - r},${bottom} L${x + r},${bottom} Q${x},${bottom} ${x},${bottom - r} Z`;
}

interface ShapeProps {
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  fill?: string;
  payload?: unknown;
}

function RoundedBar(props: ShapeProps): ReactElement | null {
  const { x = 0, y = 0, width = 0, height = 0, fill } = props;
  const net = (props.payload as MonthBucket | undefined)?.net ?? 0;
  const d = roundedBarPath({ x, y, width, height, positive: net >= 0 });
  return d ? <path d={d} fill={fill} /> : null;
}

interface TipProps {
  active?: boolean;
  payload?: ReadonlyArray<{ payload?: unknown }>;
  currency: string;
}

function MonthTip({ active, payload, currency }: TipProps) {
  const m = payload?.[0]?.payload as MonthBucket | undefined;
  if (!active || !m) return null;
  return (
    <div className={TOOLTIP_CLASS}>
      <div className="text-mute">{m.label}</div>
      <div className="mt-1 flex justify-between gap-4">
        <span className="text-mute">Netto</span>
        <span className={cn("num font-mono font-medium", m.net >= 0 ? "text-win" : "text-loss")}>
          {fmt.signed(m.net)} {currency}
        </span>
      </div>
      <div className="flex justify-between gap-4">
        <span className="text-mute">Trades</span>
        <span className="num font-mono font-medium">{m.n}</span>
      </div>
      <div className="flex justify-between gap-4">
        <span className="text-mute">Win-Rate</span>
        <span className="num font-mono font-medium">{fmt.pct0(m.winRate)}</span>
      </div>
    </div>
  );
}

export const MonthlyBars = memo(function MonthlyBars({ months, currency, height = 240, className }: MonthlyBarsProps) {
  return (
    <ChartContainer
      config={config}
      className={cn("aspect-auto w-full", className)}
      style={{ height }}
      role="img"
      aria-label="P&L pro Monat"
    >
      <BarChart data={months} margin={{ top: 8, right: 4, bottom: 0, left: 0 }}>
        <CartesianGrid stroke={EQUITY_COLORS.grid} vertical={false} />
        <XAxis dataKey="label" tickLine={false} axisLine={false} tick={TICK_STYLE} />
        <YAxis width={56} tickLine={false} axisLine={false} tick={TICK_STYLE} tickFormatter={fmt.mio} />
        <ReferenceLine y={0} stroke={EQUITY_COLORS.ref} />
        <Tooltip
          cursor={{ fill: "rgb(255 255 255 / 0.04)" }}
          content={(p) => <MonthTip active={p.active} payload={p.payload} currency={currency} />}
        />
        <Bar dataKey="net" maxBarSize={36} isAnimationActive={false} shape={<RoundedBar />}>
          {months.map((m) => (
            <Cell key={m.key} fill={monthFill(m.net)} />
          ))}
        </Bar>
      </BarChart>
    </ChartContainer>
  );
});
