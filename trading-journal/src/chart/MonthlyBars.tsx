/**
 * "P&L pro Monat" – Recharts BarChart, 1:1 with the bundle (Plan 5.7, brief read_stats §7).
 * Data shape = `stats.months` (last 12): `{ key: "2026-09", label: "Sep 26", net, n, winRate }`.
 * Bars are `#f2f2f2` for net ≥ 0 and `#5f5f5f` below zero (monochrome per the lead's brief;
 * the bundle used win/loss green/red – switch `MONTH_COLORS` if the 1:1 look wins).
 *
 * Motion: the first time the chart is in view every bar grows out of the zero line (`scaleY` on `spring.cards`,
 * staggered by `stagger.cards`); hovering a month dims its siblings (CSS opacity, toggled through data attributes –
 * no React render). Reduced motion: static bars, instant dim.
 */
import { motion } from "motion/react";
import { memo, useEffect, useMemo, useRef, useState, type ReactElement } from "react";
import { Bar, BarChart, CartesianGrid, Cell, ReferenceLine, Tooltip, XAxis, YAxis } from "recharts";
import { ChartContainer, type ChartConfig } from "@/ui/chart";
import { cn } from "@/lib/cn";
import { canObserveInView, observeInView } from "@/motion/inView";
import { spring, stagger } from "@/motion/tokens";
import { useReducedFx } from "@/motion/useReducedFx";
import { fmt } from "./format";
import { TOOLTIP_CLASS } from "./tooltip";
import { EQUITY_COLORS, TICK } from "./EquityChart";

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
  /** Fill the free height of a flex column (a stretched grid card), `height` being the minimum. */
  fill?: boolean;
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

/** Time a grown bar's `spring.cards` needs to settle after its delay (s, generous). */
const GROW_SETTLE_S = 1.2;

/** Grow delay of bar `index` (capped like every stagger in the app). */
export const barDelay = (index: number): number => Math.min(Math.max(0, index), stagger.max) * stagger.cards;

/** Recharts' `activeTooltipIndex` (number, numeric string or nothing) → bar index, `-1` for none. */
export function toBarIndex(v: unknown): number {
  const n = typeof v === "number" ? v : typeof v === "string" && v !== "" ? Number(v) : Number.NaN;
  return Number.isInteger(n) && n >= 0 ? n : -1;
}

interface ShapeProps {
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  fill?: string;
  payload?: unknown;
  index?: number;
}

interface GrowProps {
  /** animate the entrance at all (off under reduced motion / without IntersectionObserver) */
  grow: boolean;
  /** the chart has been in view */
  revealed: boolean;
  /** the bars grew already: a bar mounted now (the live chart drawn again after its static stand-in) starts grown */
  grown: boolean;
}

const BAR_CLASS = "transition-opacity duration-200 [[data-hovering]_&:not([data-hot])]:opacity-40";

function RoundedBar({ x = 0, y = 0, width = 0, height = 0, fill, payload, index = 0, grow, revealed, grown }: ShapeProps & GrowProps): ReactElement | null {
  const positive = ((payload as MonthBucket | undefined)?.net ?? 0) >= 0;
  const d = roundedBarPath({ x, y, width, height, positive });
  if (!d) return null;
  if (!grow) return <path d={d} fill={fill} data-bar={index} className={BAR_CLASS} />;
  return (
    <motion.path
      d={d}
      fill={fill}
      data-bar={index}
      className={BAR_CLASS}
      // grow out of the zero line: the bottom edge of a gain, the top edge of a loss
      style={{ originY: positive ? 1 : 0 }}
      initial={grown ? false : { scaleY: 0 }}
      animate={{ scaleY: revealed ? 1 : 0 }}
      transition={{ ...spring.cards, delay: barDelay(index) }}
    />
  );
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

export const MonthlyBars = memo(function MonthlyBars({ months, currency, height = 240, fill: fillRow = false, className }: MonthlyBarsProps) {
  const reduced = useReducedFx();
  const wrap = useRef<HTMLDivElement>(null);
  const hot = useRef(-1);
  const [grow] = useState(() => canObserveInView());
  const [revealed, setRevealed] = useState(false);
  const animateIn = grow && !reduced;
  // the entrance is over (or never ran): a bar mounted later (the live chart drawn again after its static stand-in)
  // starts grown
  const [grown, setGrown] = useState(!animateIn);
  useEffect(() => {
    if (grown || !revealed) return;
    const t = setTimeout(() => setGrown(true), (barDelay(months.length) + GROW_SETTLE_S) * 1000);
    return () => clearTimeout(t);
  }, [grown, revealed, months.length]);
  // static SVG on a hidden keep-alive page: before the first view (bars at 0 – the reveal changes the key, so the live
  // chart grows them) and once grown, never while the bars grow (a freeze would keep them half grown)
  const freezeKey = useMemo(() => (grown ? [months] : revealed ? undefined : [months, "ungrown"]), [grown, revealed, months]);

  useEffect(() => {
    const el = wrap.current;
    if (!el || !animateIn || revealed) return;
    const off = observeInView(el, (inView) => {
      if (inView) setRevealed(true);
    });
    return off;
  }, [animateIn, revealed]);

  // sibling dim: one data attribute on the wrapper and one on the hovered bar, CSS does the rest
  const setHot = (i: number) => {
    const el = wrap.current;
    if (!el || i === hot.current) return;
    if (hot.current >= 0) el.querySelector(`[data-bar="${hot.current}"]`)?.removeAttribute("data-hot");
    hot.current = i;
    if (i < 0) {
      el.removeAttribute("data-hovering");
      return;
    }
    el.setAttribute("data-hovering", "");
    el.querySelector(`[data-bar="${i}"]`)?.setAttribute("data-hot", "");
  };

  return (
    <div ref={wrap} className={cn("w-full", fillRow && "flex flex-1 flex-col", className)}>
      {/* frozen (static SVG) on the hidden keep-alive overview; Recharts' tooltip and keyboard layer need the live chart,
          so a pointer or focus draws it again */}
      <ChartContainer
        config={config}
        className={cn("aspect-auto w-full", fillRow && "flex-1")}
        style={fillRow ? { minHeight: height } : { height }}
        role="img"
        aria-label="P&L pro Monat"
        freezeKey={freezeKey}
        thawOnInteract
      >
        <BarChart
          data={months}
          margin={{ top: 8, right: 4, bottom: 0, left: 0 }}
          onMouseMove={(s) => setHot(toBarIndex(s.activeTooltipIndex))}
          onMouseLeave={() => setHot(-1)}
        >
          <CartesianGrid stroke={EQUITY_COLORS.grid} vertical={false} />
          <XAxis dataKey="label" tickLine={false} axisLine={false} tick={TICK} />
          <YAxis width={56} tickLine={false} axisLine={false} interval={0} tick={TICK} tickFormatter={fmt.mio} />
          <ReferenceLine y={0} stroke={EQUITY_COLORS.ref} />
          <Tooltip
            cursor={{ fill: "rgb(255 255 255 / 0.04)" }}
            content={(p) => <MonthTip active={p.active} payload={p.payload} currency={currency} />}
          />
          <Bar dataKey="net" maxBarSize={36} isAnimationActive={false} shape={(p: ShapeProps) => <RoundedBar {...p} grow={animateIn} revealed={revealed} grown={grown} />}>
            {months.map((m) => (
              <Cell key={m.key} fill={monthFill(m.net)} />
            ))}
          </Bar>
        </BarChart>
      </ChartContainer>
    </div>
  );
});
