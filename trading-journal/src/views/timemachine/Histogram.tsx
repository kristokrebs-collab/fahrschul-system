/**
 * Histogram of the results (SVG, Nothing style): one column per slice of 0,25 R (wider for wide ranges), height = share of the
 * runs. Columns left of 0 (losses) are hatched, the others solid – position, hatching and the axis labels carry the meaning,
 * colour does not. The stop and the target are marked on the R axis, the tallest columns carry their share as text, the exact
 * numbers sit behind „Zahlen zur Verteilung“. Hover / touch reads one column. The columns grow from the base line once when first
 * seen (`spring.enter`, transform only); reduced motion shows the end state.
 */
import { motion } from "motion/react";
import { useId, useMemo, useRef, useState, type PointerEvent } from "react";
import { count, pc, rPlain, rr, type TmResult } from "@/domain/timemachine";
import { themePaint } from "@/lib/themePaint";
import { spring, stagger } from "@/motion/tokens";
import { useReducedFx } from "@/motion/useReducedFx";
import { useSeenOnce } from "@/primitives/revealValue";
import { histGeometry } from "./geometry";
import { useWidth } from "./parts";
import { TM } from "./strings";

const H = 200;
const NUM = new Intl.NumberFormat("de-DE", { maximumFractionDigits: 1 });
const rTick = (v: number): string => (Math.abs(v) < 1e-9 ? "0" : `${v > 0 ? "+" : "−"}${NUM.format(Math.abs(v))} R`);

export function Histogram({ result }: { result: TmResult }) {
  const s = result.sim;
  const reduced = useReducedFx();
  const wrap = useRef<HTMLDivElement>(null);
  const w = useWidth(wrap, 560);
  const seen = useSeenOnce(wrap);
  const on = seen || reduced;
  const uid = useId().replace(/[^a-zA-Z0-9]/g, "");
  const keep = useMemo(() => [-1, result.targetR], [result.targetR]);
  const geo = useMemo(() => histGeometry(s.hist, s.runs, w, H, keep), [s.hist, s.runs, w, keep]);
  const [active, setActive] = useState<number | null>(null);
  if (!geo) return <div ref={wrap} className="h-[200px]" data-testid="tm-hist" />;
  const { box } = geo;
  const innerW = geo.w - box.l - box.r;
  const innerH = geo.h - box.t - box.b;
  const ink = themePaint("#f2f2f2");
  const mute = themePaint("#9b9b9b");
  const faint = themePaint("#5f5f5f");
  const grid = themePaint("#1c1c1c");
  const zeroX = geo.x(0);
  const stopX = geo.x(-1);
  const targetX = geo.x(result.targetR);
  // the columns that hold a lot get their share as text: tallest first, at most 4, never two labels closer than a label is wide
  const labelled = new Set<number>();
  for (const b of geo.bars
    .map((bar, i) => ({ i, share: bar.share, cx: bar.x + bar.w / 2 }))
    .filter((bar) => bar.share >= 0.04)
    .sort((a, b) => b.share - a.share)) {
    if (labelled.size >= 4) break;
    if ([...labelled].every((j) => Math.abs(geo.bars[j]!.x + geo.bars[j]!.w / 2 - b.cx) >= 52)) labelled.add(b.i);
  }
  // text that would run off the plot is anchored to its edge
  const anchor = (x: number): "start" | "middle" | "end" => (x + 24 > geo.w ? "end" : x - 24 < 0 ? "start" : "middle");
  const pick = (e: PointerEvent<SVGRectElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    const x = box.l + ((e.clientX - r.left) / Math.max(1, r.width)) * innerW;
    const i = geo.bars.findIndex((b) => x >= b.x - 1 && x <= b.x + b.w + 1);
    setActive(i >= 0 ? i : null);
  };
  const a = active != null ? geo.bars[active] : null;
  const label = `Verteilung der Ergebnisse von ${count(s.runs)} Läufen in R: schlechtester ${rr(s.cases.worst)}, Median ${rr(s.cases.median)}, bester ${rr(s.cases.best)}; ${pc(s.stop.p)} enden am Stop, ${pc(s.target.p)} am Ziel.`;
  return (
    <div className="grid gap-2" data-testid="tm-hist" data-drawn={on ? "true" : "false"}>
      <div ref={wrap} className="relative min-w-0 rounded-xl border border-line bg-ink-950/60">
        <svg width={geo.w} height={geo.h} viewBox={`0 0 ${geo.w} ${geo.h}`} className="block max-w-full" role="img" aria-label={label}>
          <defs>
            <pattern id={`tm-h-${uid}`} width="5" height="5" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
              <line x1="0" y1="0" x2="0" y2="5" stroke={ink} strokeOpacity={0.7} strokeWidth="1.6" />
            </pattern>
          </defs>
          {geo.yTicks.map((t) => {
            const y = box.t + innerH - (t / geo.max) * innerH;
            return (
              <g key={t}>
                <line x1={box.l} x2={box.l + innerW} y1={y} y2={y} stroke={grid} strokeWidth={1} />
                <text x={box.l - 6} y={y} textAnchor="end" dominantBaseline="middle" fontSize={10} fill={mute} className="num font-mono">
                  {Math.round(t * 100)} %
                </text>
              </g>
            );
          })}
          <line x1={box.l} x2={box.l + innerW} y1={box.t + innerH} y2={box.t + innerH} stroke={faint} strokeWidth={1} />
          {/* the columns */}
          {geo.bars.map((b, i) =>
            b.n ? (
              <motion.g key={i} data-bin={b.lo} data-loss={b.hi <= 0 ? "true" : "false"} style={{ transformBox: "fill-box", transformOrigin: "50% 100%" }} initial={reduced ? false : { scaleY: 0 }} animate={{ scaleY: on ? 1 : 0 }} transition={{ ...spring.enter, delay: reduced ? 0 : Math.min(i, stagger.max * 3) * stagger.rows }}>
                <rect x={b.x} y={b.y} width={b.w} height={b.h} fill={ink} fillOpacity={b.hi <= 0 ? 0.14 : 0.78} stroke={ink} strokeOpacity={b.hi <= 0 ? 0.55 : 0} strokeWidth={1} />
                {b.hi <= 0 && <rect x={b.x} y={b.y} width={b.w} height={b.h} fill={`url(#tm-h-${uid})`} />}
                {active === i && <rect x={b.x - 1} y={b.y - 1} width={b.w + 2} height={b.h + 2} fill="none" stroke={ink} strokeWidth={1.4} />}
              </motion.g>
            ) : null,
          )}
          {geo.bars.map((b, i) =>
            labelled.has(i) ? (
              <text key={`t${i}`} x={anchor(b.x + b.w / 2) === "end" ? b.x + b.w : b.x + b.w / 2} y={Math.max(box.t + 9, b.y - 4)} textAnchor={anchor(b.x + b.w / 2)} fontSize={10.5} fill={ink} className="num font-mono" paintOrder="stroke" stroke="var(--color-ink-950, #0a0a0a)" strokeWidth={3} strokeLinejoin="round">
                {pc(b.share)}
              </text>
            ) : null,
          )}
          {/* the axis: stop, 0, target */}
          <line x1={zeroX} x2={zeroX} y1={box.t} y2={box.t + innerH + 4} stroke={mute} strokeWidth={1} strokeDasharray="1 4" strokeLinecap="round" />
          <line x1={stopX} x2={stopX} y1={box.t + innerH} y2={box.t + innerH + 5} stroke={ink} strokeWidth={1.6} />
          <line x1={targetX} x2={targetX} y1={box.t + innerH} y2={box.t + innerH + 5} stroke={ink} strokeWidth={1.6} />
          {geo.xTicks.map((t) => (
            <text key={t} x={geo.x(t)} y={box.t + innerH + 17} textAnchor={anchor(geo.x(t))} fontSize={10} fill={mute} className="num font-mono">
              {rTick(t)}
            </text>
          ))}
          <text x={stopX} y={box.t + innerH + 29} textAnchor={anchor(stopX)} fontSize={10} fill={ink} className="font-mono">
            {TM.hist.stopBin}
          </text>
          <text x={targetX} y={box.t + innerH + 29} textAnchor={anchor(targetX)} fontSize={10} fill={ink} className="font-mono">
            {TM.hist.targetBin}
          </text>
          <text x={box.l + innerW} y={box.t + 8} textAnchor="end" fontSize={10} fill={faint} className="font-mono">
            {TM.hist.axisY}
          </text>
          <rect x={box.l} y={box.t} width={innerW} height={innerH + 4} fill="transparent" onPointerMove={pick} onPointerDown={pick} onPointerLeave={(e) => e.pointerType === "mouse" && setActive(null)} style={{ touchAction: "pan-y" }} />
        </svg>
      </div>
      <p className="num min-h-5 text-[12px] leading-snug text-mute" data-testid="tm-hist-readout">
        {a ? (
          <>
            {rr(a.lo)} bis {rr(a.hi)}: <span className="text-fg">{pc(a.share)}</span> der Läufe ({count(a.n)})
          </>
        ) : (
          <>
            Stop bei −1 R · Ziel bei {rPlain(result.targetR)} · Spalten antippen für den Anteil
          </>
        )}
      </p>
      <details className="text-[12px] text-mute">
        <summary className="cursor-pointer select-none py-1 pointer-coarse:min-h-11 pointer-coarse:py-3">{TM.hist.numbers}</summary>
        <div className="max-h-64 overflow-auto">
          <table className="num mt-1 w-full border-collapse text-right font-mono text-[11.5px]" data-testid="tm-hist-table">
            <caption className="sr-only">Anzahl der Läufe je Ergebnis-Spalte in R</caption>
            <thead>
              <tr className="text-faint">
                <th scope="col" className="py-1 pr-2 text-left font-medium">Ergebnis</th>
                <th scope="col" className="py-1 pl-2 font-medium">Läufe</th>
                <th scope="col" className="py-1 pl-2 font-medium">Anteil</th>
              </tr>
            </thead>
            <tbody>
              {s.hist.bins
                .filter((b) => b.n > 0)
                .map((b) => (
                  <tr key={b.lo} className="border-t border-line">
                    <th scope="row" className="py-1 pr-2 text-left font-normal">
                      {rr(b.lo)} bis {rr(b.hi)}
                    </th>
                    <td className="py-1 pl-2">{count(b.n)}</td>
                    <td className="py-1 pl-2">{pc(b.n / s.runs)}</td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      </details>
    </div>
  );
}

export default Histogram;
