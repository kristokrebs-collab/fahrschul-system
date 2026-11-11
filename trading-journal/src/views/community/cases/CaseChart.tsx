import { motion } from "motion/react";
import { cn } from "@/lib/cn";
import { price as fmtPrice } from "@/lib/format";
import { tween } from "@/motion/tokens";
import { useReducedFx } from "@/motion/useReducedFx";
import { CASES, INTERVAL_LABEL } from "@/social/caseStrings";
import type { CaseBar } from "@/social/cases";
import type { CaseInfo } from "@/social/contract";

const W = 640;
const H = 260;
const PAD = 16;

const stamp = (t: number) => new Date(t).toLocaleString("de-DE", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });

export interface CaseChartProps {
  /** Candles up to and including the anchor – all a reader sees before the hypothesis. */
  visible: readonly CaseBar[];
  /** The candles after the anchor – only passed once the reader may see them (the axes cannot leak them before). */
  future: readonly CaseBar[];
  frame: Pick<CaseInfo, "pair" | "interval" | "horizon">;
  /** Half-width of the "sideways" zone in % (shown with the future). */
  bandPct?: number | null;
  /** Close of the last candle of the question, drawn as a dot when known. */
  end?: number | null;
  className?: string;
}

/**
 * The candles of a Chartfall as plain SVG (no chart library): wicks and bodies, the anchor candle's close as a dashed
 * line, the sideways zone and the end point once the future may be seen. The x grid always has room for `horizon`
 * more candles, and the price range comes from what is DRAWN – before the reveal nothing of the future is in the
 * picture, not even in the scale. Labels are HTML on top (crisp at any width); the picture fades in (opacity only).
 */
export function CaseChart({ visible, future, frame, bandPct = null, end = null, className }: CaseChartProps) {
  const reduced = useReducedFx();
  const shown = [...visible, ...future];
  if (!visible.length) return null;
  const anchor = visible[visible.length - 1]!;
  const lo0 = Math.min(...shown.map((b) => b.low));
  const hi0 = Math.max(...shown.map((b) => b.high));
  const zone: [number, number] | null = bandPct != null && future.length > 0 ? [anchor.close * (1 - bandPct / 100), anchor.close * (1 + bandPct / 100)] : null;
  const lo = Math.min(lo0, zone?.[0] ?? lo0);
  const hi = Math.max(hi0, zone?.[1] ?? hi0);
  const span = hi - lo || Math.abs(hi) * 0.01 || 1;
  const slots = visible.length + frame.horizon;
  const step = W / slots;
  const x = (i: number) => (i + 0.5) * step;
  const y = (p: number) => PAD + (1 - (p - lo) / span) * (H - PAD * 2);
  const body = Math.max(1.4, step * 0.62);
  const futureX = visible.length * step;
  const pct = (v: number, total: number) => `${(v / total) * 100}%`;
  const draw = (b: CaseBar, i: number, dim: boolean) => {
    const up = b.close >= b.open;
    const top = y(Math.max(b.open, b.close));
    const h = Math.max(1, Math.abs(y(b.open) - y(b.close)));
    return (
      <g key={b.time} className={cn(up ? "fill-win stroke-win" : "fill-loss stroke-loss", dim && "opacity-80")}>
        <line x1={x(i)} x2={x(i)} y1={y(b.high)} y2={y(b.low)} strokeWidth="1" vectorEffect="non-scaling-stroke" />
        <rect x={x(i) - body / 2} y={top} width={body} height={h} stroke="none" />
      </g>
    );
  };
  const endIdx = visible.length - 1 + frame.horizon;
  return (
    <figure className={cn("grid gap-1.5", className)} data-testid="case-chart" data-future={future.length > 0 ? "shown" : "hidden"}>
      <div className="relative overflow-hidden rounded-xl border border-line bg-ink-950/50" style={{ aspectRatio: `${W} / ${H}` }}>
        <motion.svg
          key={future.length > 0 ? "full" : "blind"}
          viewBox={`0 0 ${W} ${H}`}
          preserveAspectRatio="none"
          className="absolute inset-0 size-full"
          role="img"
          aria-label={CASES.chartLabel(frame.pair, INTERVAL_LABEL[frame.interval], visible.length, stamp(anchor.time), fmtPrice(anchor.close))}
          initial={reduced ? false : { opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={tween.reveal}
        >
          {[0.25, 0.5, 0.75].map((f) => (
            <line key={f} x1="0" x2={W} y1={PAD + f * (H - PAD * 2)} y2={PAD + f * (H - PAD * 2)} className="stroke-line" strokeWidth="1" vectorEffect="non-scaling-stroke" />
          ))}
          <rect x={futureX} y="0" width={W - futureX} height={H} className="fill-white/[0.025]" />
          {zone && <rect x={futureX} y={y(zone[1])} width={W - futureX} height={Math.max(1, y(zone[0]) - y(zone[1]))} className="fill-white/[0.07] stroke-line-2" strokeDasharray="4 4" strokeWidth="1" vectorEffect="non-scaling-stroke" />}
          <line x1="0" x2={W} y1={y(anchor.close)} y2={y(anchor.close)} className="stroke-mute" strokeDasharray="3 4" strokeWidth="1" vectorEffect="non-scaling-stroke" />
          <line x1={x(visible.length - 1)} x2={x(visible.length - 1)} y1="0" y2={H} className="stroke-signal" strokeDasharray="2 4" strokeWidth="1" vectorEffect="non-scaling-stroke" />
          {visible.map((b, i) => draw(b, i, false))}
          {future.map((b, i) => draw(b, visible.length + i, true))}
        </motion.svg>
        <span className="pointer-events-none absolute right-2 top-1 font-mono text-[10px] text-faint">{fmtPrice(hi0)}</span>
        <span className="pointer-events-none absolute bottom-1 right-2 font-mono text-[10px] text-faint">{fmtPrice(lo0)}</span>
        <span className="pointer-events-none absolute left-2 font-mono text-[10px] text-mute" style={{ top: pct(y(anchor.close), H), transform: "translateY(-120%)" }}>
          {CASES.refMark} {fmtPrice(anchor.close)}
        </span>
        <span className="pointer-events-none absolute top-1 -translate-x-full pr-1 font-mono text-[10px] uppercase tracking-[0.1em] text-signal" style={{ left: pct(x(visible.length - 1), W) }}>
          {CASES.anchorMark}
        </span>
        {future.length === 0 && (
          <span className="pointer-events-none absolute inset-y-0 grid place-items-center px-2 text-center font-mono text-[10.5px] uppercase tracking-[0.1em] text-faint" style={{ left: pct(futureX, W), right: 0 }} data-testid="case-hidden">
            {frame.horizon} Kerzen · ?
          </span>
        )}
        {zone && (
          <span className="pointer-events-none absolute right-2 font-mono text-[10px] text-faint" style={{ top: pct(y(zone[1]), H), transform: "translateY(-105%)" }}>
            {CASES.zone}
          </span>
        )}
        {end != null && future.length > 0 && (
          <span aria-hidden="true" className="pointer-events-none absolute size-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-ink-900 bg-signal" style={{ left: pct(x(endIdx), W), top: pct(y(end), H) }} />
        )}
      </div>
      <figcaption className="flex flex-wrap justify-between gap-x-3 font-mono text-[10.5px] text-faint">
        <span>{stamp(visible[0]!.time)}</span>
        <span className="text-mute">{stamp(anchor.time)}</span>
        <span>{future.length > 0 ? stamp(future[future.length - 1]!.time) : ""}</span>
      </figcaption>
    </figure>
  );
}
