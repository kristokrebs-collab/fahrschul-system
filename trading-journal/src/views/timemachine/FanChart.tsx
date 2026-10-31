/**
 * The fan of simulated price paths (SVG, Nothing style): the price after the entry in R (1 R = entry → stop), the 90 % and 50 %
 * bands of ALL runs with their median, a few single paths that end where the trade ended (▲ target · ✕ stop · ◆ moved stop),
 * the stop line (dashed, labelled) and the target line (solid, labelled). Every encoding has a second carrier next to colour:
 * line styles, marker shapes, labels on the lines, a legend with the same shapes, and the numbers in a table behind
 * „Zahlen zum Fächer“. Hover / touch / ← → read the bands at one candle.
 * Motion: the data wipes in from the left once when first seen (`tween.draw`, clip-path); reduced motion draws the end state.
 */
import { motion } from "motion/react";
import { useId, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import { durationText, pc0, rPlain, rr, TM_INTERVAL_TEXT, type TmResult } from "@/domain/timemachine";
import { themePaint } from "@/lib/themePaint";
import { tween } from "@/motion/tokens";
import { useReducedFx } from "@/motion/useReducedFx";
import { useSeenOnce } from "@/primitives/revealValue";
import { fanGeometry } from "./geometry";
import { useWidth } from "./parts";
import { TM } from "./strings";

const H = 260;
const NUM = new Intl.NumberFormat("de-DE", { maximumFractionDigits: 1 });
const tickText = (v: number): string => (Math.abs(v) < 1e-9 ? "0" : `${v > 0 ? "+" : "−"}${NUM.format(Math.abs(v))}`);

/** A marker at the end of a drawn path: the shape tells the outcome. */
function Marker({ kind, x, y }: { kind: "target" | "stop" | "moved" | "neither"; x: number; y: number }) {
  const stroke = themePaint("#f2f2f2");
  if (kind === "target") return <circle cx={x} cy={y} r={3.4} fill={stroke} data-marker="target" />;
  if (kind === "stop")
    return (
      <path d={`M${x - 3.2} ${y - 3.2}L${x + 3.2} ${y + 3.2}M${x + 3.2} ${y - 3.2}L${x - 3.2} ${y + 3.2}`} stroke={stroke} strokeWidth={1.6} strokeLinecap="round" fill="none" data-marker="stop" />
    );
  return <path d={`M${x} ${y - 3.8}L${x + 3.8} ${y}L${x} ${y + 3.8}L${x - 3.8} ${y}Z`} fill="none" stroke={stroke} strokeWidth={1.4} data-marker="moved" />;
}

export function FanChart({ result }: { result: TmResult }) {
  const { fan } = result.sim;
  const reduced = useReducedFx();
  const wrap = useRef<HTMLDivElement>(null);
  const w = useWidth(wrap, 560);
  const seen = useSeenOnce(wrap);
  const geo = useMemo(() => fanGeometry(fan, result.targetR, w, H), [fan, result.targetR, w]);
  const n = fan.steps.length - 1;
  const [cursor, setCursor] = useState<number | null>(null);
  const k = cursor ?? n;
  const uid = useId().replace(/[^a-zA-Z0-9]/g, "");
  const on = seen || reduced;
  const unit = TM_INTERVAL_TEXT[result.interval];

  if (!geo) return <div ref={wrap} className="h-[260px]" data-testid="tm-fan" />;
  const { box } = geo;
  const innerW = geo.w - box.l - box.r;
  const innerH = geo.h - box.t - box.b;
  const b = fan.bands;
  const at = (kk: number) => ({ p5: b.p5[kk]!, p25: b.p25[kk]!, p50: b.p50[kk]!, p75: b.p75[kk]!, p95: b.p95[kk]! });
  const here = at(k);

  const pick = (e: PointerEvent<SVGRectElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    const rel = (e.clientX - r.left) / Math.max(1, r.width);
    setCursor(Math.max(0, Math.min(n, Math.round(rel * n))));
  };
  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const step = e.shiftKey ? 5 : 1;
    if (e.key === "ArrowLeft") setCursor(Math.max(0, k - step));
    else if (e.key === "ArrowRight") setCursor(Math.min(n, k + step));
    else if (e.key === "Home") setCursor(0);
    else if (e.key === "End") setCursor(null);
    else return;
    e.preventDefault();
  };

  const ink = themePaint("#f2f2f2");
  const faint = themePaint("#5f5f5f");
  const mute = themePaint("#9b9b9b");
  const grid = themePaint("#1c1c1c");
  const label = `Fächer der simulierten Kursverläufe in R. Nach ${durationText(n, result.interval)} liegt der Median bei ${rr(at(n).p50)}, 90 % der Läufe zwischen ${rr(at(n).p5)} und ${rr(at(n).p95)}. Stop bei −1 R, Ziel bei ${rPlain(result.targetR)}.`;
  const numberSteps = [...new Set([0, Math.round(n / 4), Math.round(n / 2), Math.round((3 * n) / 4), n])];

  return (
    <div className="grid gap-2" data-testid="tm-fan" data-drawn={on ? "true" : "false"}>
      <div
        ref={wrap}
        className="relative min-w-0 rounded-xl border border-line bg-ink-950/60 outline-none focus-visible:border-white/40"
        tabIndex={0}
        role="group"
        aria-label={`${label} Mit den Pfeiltasten eine Kerze wählen.`}
        onKeyDown={onKey}
        onBlur={() => setCursor(null)}
      >
        <svg width={geo.w} height={geo.h} viewBox={`0 0 ${geo.w} ${geo.h}`} className="block max-w-full" role="img" aria-label={label}>
          <defs>
            <clipPath id={`tm-fan-${uid}`}>
              <rect x={box.l} y={box.t} width={innerW} height={innerH} />
            </clipPath>
          </defs>
          {/* y grid and labels */}
          {geo.yTicks.map((t) => (
            <g key={t}>
              <line x1={box.l} x2={box.l + innerW} y1={geo.y(t)} y2={geo.y(t)} stroke={grid} strokeWidth={1} />
              <text x={box.l - 6} y={geo.y(t)} textAnchor="end" dominantBaseline="middle" fontSize={10} fill={mute} className="num font-mono">
                {tickText(t)}
              </text>
            </g>
          ))}
          <text x={4} y={box.t + 2} fontSize={10} fill={faint} className="font-mono">
            {TM.fan.axisY}
          </text>
          {/* x ticks */}
          {geo.xTicks.map((t) => (
            <g key={t}>
              <line x1={geo.x(t)} x2={geo.x(t)} y1={box.t + innerH} y2={box.t + innerH + 4} stroke={faint} strokeWidth={1} />
              <text x={geo.x(t)} y={box.t + innerH + 16} textAnchor={t === 0 ? "start" : t === n ? "end" : "middle"} fontSize={10} fill={mute} className="num font-mono">
                {t}
              </text>
            </g>
          ))}
          <text x={box.l + innerW} y={geo.h - 5} textAnchor="end" fontSize={10} fill={faint} className="font-mono">
            {TM.fan.axisX} ({unit} je Kerze)
          </text>
          {/* entry, stop (dashed) and target (solid) */}
          <line x1={box.l} x2={box.l + innerW} y1={geo.zeroY} y2={geo.zeroY} stroke={mute} strokeWidth={1} strokeDasharray="1 4" strokeLinecap="round" />
          <line x1={box.l} x2={box.l + innerW} y1={geo.stopY} y2={geo.stopY} stroke={ink} strokeOpacity={0.75} strokeWidth={1.2} strokeDasharray="6 4" data-line="stop" />
          <line x1={box.l} x2={box.l + innerW} y1={geo.targetY} y2={geo.targetY} stroke={ink} strokeOpacity={0.9} strokeWidth={1.4} data-line="target" />
          <g fontSize={10.5} className="font-mono" fill={ink} paintOrder="stroke" stroke="var(--color-ink-950, #0a0a0a)" strokeWidth={3} strokeLinejoin="round">
            <text x={box.l + innerW - 4} y={geo.targetY - 5} textAnchor="end">
              {TM.fan.targetLine} {rr(result.targetR).replace(/^\+/, "+")}
            </text>
            <text x={box.l + innerW - 4} y={geo.stopY + 13} textAnchor="end">
              {TM.fan.stopLine} −1,00 R
            </text>
            <text x={box.l + 4} y={geo.zeroY - 5} textAnchor="start" fill={mute}>
              {TM.fan.entry}
            </text>
          </g>
          {/* the data: bands, median, single paths */}
          <g clipPath={`url(#tm-fan-${uid})`}>
            <motion.g initial={reduced ? false : { clipPath: "inset(0 100% 0 0)" }} animate={{ clipPath: on ? "inset(0 0% 0 0)" : "inset(0 100% 0 0)" }} transition={tween.draw}>
              <path d={geo.band90} fill={ink} fillOpacity={0.06} stroke={ink} strokeOpacity={0.28} strokeDasharray="2 3" strokeWidth={1} data-band="90" />
              <path d={geo.band50} fill={ink} fillOpacity={0.11} data-band="50" />
              {geo.paths.map((p, i) => (
                <g key={i} data-path={p.kind}>
                  <path d={p.d} fill="none" stroke={ink} strokeOpacity={0.3} strokeWidth={1} strokeLinejoin="round" />
                  {p.end && <Marker kind={p.kind} x={p.end.x} y={p.end.y} />}
                </g>
              ))}
              <path d={geo.median} fill="none" stroke={ink} strokeWidth={1.8} strokeLinejoin="round" data-line="median" />
            </motion.g>
          </g>
          {/* the cursor */}
          {cursor != null && <line x1={geo.x(k)} x2={geo.x(k)} y1={box.t} y2={box.t + innerH} stroke={ink} strokeOpacity={0.6} strokeWidth={1} />}
          <rect
            x={box.l}
            y={box.t}
            width={innerW}
            height={innerH}
            fill="transparent"
            onPointerMove={pick}
            onPointerDown={pick}
            onPointerLeave={(e) => e.pointerType === "mouse" && setCursor(null)}
            style={{ touchAction: "pan-y" }}
          />
        </svg>
      </div>
      <p className="num min-h-5 text-[12px] leading-snug text-mute" data-testid="tm-fan-readout" data-step={k}>
        {k === n ? `${TM.fan.atEnd} (${durationText(n, result.interval)})` : `Nach ${durationText(k, result.interval)}`}: Median <span className="text-fg">{rr(here.p50)}</span> · 90 % der Läufe zwischen {rr(here.p5)} und {rr(here.p95)} · 50 % zwischen {rr(here.p25)} und {rr(here.p75)}
      </p>
      <ul className="flex flex-wrap gap-x-4 gap-y-1 text-[11.5px] text-mute" aria-label="Zeichenerklärung">
        <li className="flex items-center gap-1.5">
          <span aria-hidden="true" className="inline-block h-2.5 w-5 rounded-sm border border-line-2 bg-fg/10" />
          {TM.fan.legendBand}
        </li>
        <li className="flex items-center gap-1.5">
          <span aria-hidden="true" className="inline-block h-0.5 w-5 rounded bg-fg" />
          {TM.fan.legendMedian}
        </li>
        <li className="flex items-center gap-1.5">
          <span aria-hidden="true">●</span>
          {TM.fan.legendTarget}
        </li>
        <li className="flex items-center gap-1.5">
          <span aria-hidden="true">✕</span>
          {TM.fan.legendStop}
        </li>
        {result.sim.moved.k > 0 && (
          <li className="flex items-center gap-1.5">
            <span aria-hidden="true">◇</span>
            {TM.fan.legendMoved}
          </li>
        )}
      </ul>
      <details className="text-[12px] text-mute">
        <summary className="cursor-pointer select-none py-1 pointer-coarse:min-h-11 pointer-coarse:py-3">{TM.fan.numbers}</summary>
        <div className="overflow-x-auto">
          <table className="num mt-1 w-full min-w-[420px] border-collapse text-right font-mono text-[11.5px]" data-testid="tm-fan-table">
            <caption className="sr-only">Perzentile des Kurses in R nach Kerzen</caption>
            <thead>
              <tr className="text-faint">
                <th scope="col" className="py-1 pr-2 text-left font-medium">Kerze</th>
                {["5 %", "25 %", "Median", "75 %", "95 %"].map((c) => (
                  <th key={c} scope="col" className="py-1 pl-2 font-medium">
                    {c}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {numberSteps.map((s) => {
                const v = at(s);
                return (
                  <tr key={s} className="border-t border-line">
                    <th scope="row" className="py-1 pr-2 text-left font-normal">
                      {s}
                    </th>
                    {[v.p5, v.p25, v.p50, v.p75, v.p95].map((x, i) => (
                      <td key={i} className="py-1 pl-2">
                        {rr(x)}
                      </td>
                    ))}
                  </tr>
                );
              })}
            </tbody>
          </table>
          <p className="mt-1 text-[11px] text-mute">
            Am Ende der Sitzung liegt der Kurs in {pc0(result.sim.endR.above)} der Läufe im Plus (über dem Einstieg, in Richtung des Trades) – unabhängig davon, ob der Trade vorher am Stop oder Ziel endete.
          </p>
        </div>
      </details>
    </div>
  );
}

export default FanChart;
