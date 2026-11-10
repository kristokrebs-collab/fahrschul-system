/**
 * Shared bits of the Markt page (P02): grade in dot-matrix digits, timeframe chip, price text, the live distance of the
 * price to a box edge (a MotionValue, zero renders per tick) and the edge a setup lives on.
 */
import { useTransform, type MotionValue } from "motion/react";
import { fmt } from "@/chart/format";
import type { Box, BoxSetup, BoxTf, Grade } from "@/domain/boxes";
import { cn } from "@/lib/cn";
import { priceMv } from "@/market/motionValues";
import { DotMatrixText } from "@/motion/fx/DotMatrixText";
import { RollingDigits } from "@/motion/RollingDigits";
import { TF_TEXT } from "./strings";

export const price = (p: number | null | undefined): string => fmt.price(p);
export const pct1 = (v: number): string => `${fmt.n1(v)} %`;
export const rrText = (rr: number | null | undefined): string => (rr == null || !Number.isFinite(rr) ? "–" : fmt.n1(rr));

/**
 * The grade as dot-matrix digits: `A+` in the signal red with its bloom (the one accent), `A` in white, B / C muted.
 * The text stays the accessible name (`role="img"`).
 */
export function GradeMatrix({ grade, size = 4, className }: { grade: Grade; size?: number; className?: string }) {
  const tone = grade === "A+" ? "signal" : grade === "A" ? "fg" : "mute";
  return <DotMatrixText text={grade} width={2} align="left" tone={tone} size={size} gap={Math.max(1, Math.round(size / 2))} glow={grade === "A+" || grade === "A"} label={`Note ${grade}`} className={className} />;
}

export function TfChip({ tf, className }: { tf: BoxTf; className?: string }) {
  return <span className={cn("num inline-flex items-center rounded-md border border-line-2 px-1.5 py-px font-mono text-[10.5px] text-mute", className)}>{TF_TEXT[tf]}</span>;
}

/**
 * The box edge a setup lives on: a range / fakeout long on the support (bottom), a breakout / retest / preparation long
 * on the resistance (top); shorts mirrored.
 */
export function edgeOf(s: Pick<BoxSetup, "side" | "kind">, b: Pick<Box, "top" | "bottom">): number {
  const atSupport = s.kind === "range" || s.kind === "fakeout";
  return s.side === "long" ? (atSupport ? b.bottom : b.top) : atSupport ? b.top : b.bottom;
}

/** Live distance of the price to `edge` in % (MotionValue: follows every print without a React render). */
export function useEdgeDistance(edge: number): MotionValue<number> {
  return useTransform(priceMv, (p) => (p > 0 && edge > 0 ? (Math.abs(p - edge) / p) * 100 : 0));
}

/** `0,42 %` as rolling digits on the live price. */
export function EdgeDistance({ edge, className }: { edge: number; className?: string }) {
  const d = useEdgeDistance(edge);
  return (
    <span className={cn("num inline-flex items-baseline gap-0.5 font-mono", className)}>
      <RollingDigits source={d} decimals={2} formatLabel={(v) => `${fmt.n2(v)} Prozent`} />
      <span className="text-faint">%</span>
    </span>
  );
}
