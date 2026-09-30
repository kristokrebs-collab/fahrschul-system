/**
 * "Kontostand" equity curve – Recharts AreaChart, 1:1 with the bundle (Plan 5.7, brief read_stats §7).
 * Data shape = `stats.equity`: `[{ i: 0, v: start, t: null }, { i: 1, v, t: Trade }, …]`.
 * M0: `isAnimationActive={false}` (bundle parity); the container fades in via Motion elsewhere.
 */
import { memo, useId } from "react";
import { Area, AreaChart, CartesianGrid, ReferenceLine, Tooltip, XAxis, YAxis } from "recharts";
import type { Trade } from "@/domain/types";
import { ChartContainer, type ChartConfig } from "@/ui/chart";
import { cn } from "@/lib/cn";
import { fmt, tradeTime } from "./format";
import { TOOLTIP_CLASS } from "./tooltip";

export interface EquityPoint {
  /** 0 = start, n = n-th closed trade */
  i: number;
  /** balance after trade `i` */
  v: number;
  t: Trade | null;
}

export interface EquityChartProps {
  points: EquityPoint[];
  /** start capital (reference line) */
  start: number;
  /** current balance → accent colour (`#f2f2f2` ≥ start, `#ff4d4f` below) */
  balance: number;
  currency: string;
  /** px, default 268 */
  height?: number;
  className?: string;
}

export const EQUITY_COLORS = { up: "#f2f2f2", down: "#ff4d4f", strokeStart: "#5f5f5f", grid: "#1c1c1c", ref: "#3a3a3a", tick: "#5f5f5f" } as const;
export const TICK_STYLE = { fill: "#5f5f5f", fontSize: 11, fontFamily: "IBM Plex Mono, monospace" } as const;

export const equityAccent = (balance: number, start: number): string => (balance >= start ? EQUITY_COLORS.up : EQUITY_COLORS.down);
export const equityTickLabel = (i: number): string => (i === 0 ? "Start" : "#" + i);

const config: ChartConfig = { v: { label: "Kontostand", color: "#f2f2f2" } };

interface TipProps {
  active?: boolean;
  payload?: ReadonlyArray<{ payload?: unknown }>;
  currency: string;
}

function EquityTip({ active, payload, currency }: TipProps) {
  const p = payload?.[0]?.payload as EquityPoint | undefined;
  if (!active || !p) return null;
  const t = p.t;
  const pnl = t?.pnl ?? null;
  return (
    <div className={TOOLTIP_CLASS}>
      <div className="text-mute">{t ? `Trade #${p.i} · ${fmt.date(new Date(tradeTime(t)))}` : "Start"}</div>
      {t ? (
        <div className="mt-1 flex justify-between gap-4">
          <span className="text-mute">P&L</span>
          <span className={cn("num font-mono font-medium", pnl != null && pnl < 0 ? "text-loss" : "text-win")}>
            {fmt.signed(pnl)} {currency}
          </span>
        </div>
      ) : null}
      <div className="flex justify-between gap-4">
        <span className="text-mute">Kontostand</span>
        <span className="num font-mono font-medium">
          {fmt.n0(p.v)} {currency}
        </span>
      </div>
    </div>
  );
}

export const EquityChart = memo(function EquityChart({ points, start, balance, currency, height = 268, className }: EquityChartProps) {
  const id = useId().replace(/:/g, "");
  const accent = equityAccent(balance, start);
  const fillId = `eqFill-${id}`;
  const strokeId = `eqStroke-${id}`;
  return (
    <ChartContainer
      config={config}
      className={cn("aspect-auto w-full", className)}
      style={{ height }}
      role="img"
      aria-label="Kontostand-Verlauf"
    >
      <AreaChart data={points} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
        <defs>
          <linearGradient id={fillId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={accent} stopOpacity={0.32} />
            <stop offset="100%" stopColor={accent} stopOpacity={0} />
          </linearGradient>
          <linearGradient id={strokeId} x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor={EQUITY_COLORS.strokeStart} />
            <stop offset="100%" stopColor={accent} />
          </linearGradient>
        </defs>
        <CartesianGrid stroke={EQUITY_COLORS.grid} strokeDasharray="0" vertical={false} />
        <XAxis dataKey="i" tickLine={false} axisLine={false} minTickGap={28} tick={TICK_STYLE} tickFormatter={equityTickLabel} />
        <YAxis width={62} tickLine={false} axisLine={false} domain={["auto", "auto"]} tick={TICK_STYLE} tickFormatter={fmt.mio} />
        <ReferenceLine y={start} stroke={EQUITY_COLORS.ref} strokeDasharray="3 4" />
        <Tooltip
          cursor={{ stroke: "#5f5f5f", strokeWidth: 1 }}
          content={(p) => <EquityTip active={p.active} payload={p.payload} currency={currency} />}
        />
        <Area
          type="linear"
          dataKey="v"
          stroke={`url(#${strokeId})`}
          strokeWidth={2}
          fill={`url(#${fillId})`}
          isAnimationActive={false}
          dot={false}
          activeDot={{ r: 5, fill: accent, stroke: "#0a0a0a", strokeWidth: 2 }}
        />
      </AreaChart>
    </ChartContainer>
  );
});
