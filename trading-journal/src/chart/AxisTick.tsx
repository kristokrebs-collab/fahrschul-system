import type { SVGProps } from "react";

/** Props Recharts hands a custom `tick` renderer (the subset we draw with). */
export interface AxisTickProps {
  x?: number | string;
  y?: number | string;
  payload?: { value?: unknown };
  index?: number;
  textAnchor?: SVGProps<SVGTextElement>["textAnchor"];
  verticalAnchor?: "start" | "middle" | "end";
  tickFormatter?: (value: never, index: number) => string;
}

/** Recharts' `Text` baseline shift per vertical anchor (its cap height 0.71em; "end" sits on the line). */
const DY = { start: "0.71em", middle: "0.355em", end: undefined } as const;

/**
 * Axis tick label as a plain `<text>` – what Recharts' default tick draws, without its `Text` (per-word width
 * measuring) and without the `recharts-cartesian-axis-tick-value` class: Recharts' axis callback ref reads
 * `getComputedStyle` of the first element with that class every time the axis mounts or a keep-alive page is shown
 * again (a forced style recalc of the whole page inside the commit). Pass as `tick={axisTick(TICK_STYLE)}`.
 */
export function axisTick(style: SVGProps<SVGTextElement>) {
  return function AxisTick({ x, y, payload, index = 0, textAnchor, verticalAnchor = "end", tickFormatter }: AxisTickProps) {
    const raw = payload?.value;
    const label = tickFormatter ? tickFormatter(raw as never, index) : raw == null ? "" : String(raw);
    return (
      <text x={x} y={y} textAnchor={textAnchor} {...style}>
        <tspan x={x} dy={DY[verticalAnchor]}>
          {label}
        </tspan>
      </text>
    );
  };
}
