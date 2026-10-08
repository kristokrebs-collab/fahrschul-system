import { motion } from "motion/react";
import { useMemo, useRef, type PointerEvent } from "react";
import { drawdownReport, EMPTY, explainDrawdown, TITLES } from "@/domain/insights";
import { cn } from "@/lib/cn";
import { tradeTime } from "@/lib/dates";
import { date as fmtDate, n0, n2, pct } from "@/lib/format";
import { tween } from "@/motion/tokens";
import { useReducedFx } from "@/motion/useReducedFx";
import { EmptyState } from "@/primitives/EmptyState";
import { useSeenOnce } from "@/primitives/revealValue";
import { InsightCard, Stat, useInsightsBase } from "./ui";

const H = 120;

/**
 * Under-water curve (fraction below the running peak after each trade) as an SVG area that wipes in from the left on
 * first view (clip-path). Pointer / finger over it shows the drawdown at that trade: the guide line moves by
 * transform and the readout is written straight to the DOM – no React render per move, one rect read per press. It
 * grows to the height its card leaves (min. 120 px); with ≤ 40 trades every trade is a dot on the curve.
 */
function Underwater({ points, minDD }: { points: { dd: number; label: string }[]; minDD: number }) {
  const reduced = useReducedFx();
  const root = useRef<HTMLDivElement>(null);
  const seen = useSeenOnce(root);
  const guide = useRef<HTMLSpanElement>(null);
  const readout = useRef<HTMLSpanElement>(null);
  const rect = useRef<DOMRect | null>(null);
  const n = points.length;
  const W = Math.max(1, n - 1);
  const floor = Math.min(-0.0001, minDD);
  const y = (dd: number) => (dd / floor) * (H - 4);
  const line = points.map((p, i) => `${i ? "L" : "M"}${i},${y(p.dd).toFixed(2)}`).join("");
  const area = `${line}L${W},0L0,0Z`;

  const show = (clientX: number) => {
    const r = rect.current;
    const g = guide.current;
    const o = readout.current;
    if (!r || !g || !o || n < 2) return;
    const f = Math.max(0, Math.min(1, (clientX - r.left) / r.width));
    const i = Math.round(f * W);
    const p = points[i]!;
    g.style.opacity = "1";
    g.style.transform = `translateX(${((i / W) * r.width).toFixed(1)}px)`;
    o.textContent = `${p.label} · ${p.dd < 0 ? pct(p.dd) : "am Hoch"}`;
  };
  const enter = (e: PointerEvent<HTMLDivElement>) => {
    rect.current = e.currentTarget.getBoundingClientRect();
    show(e.clientX);
  };
  const leave = () => {
    rect.current = null;
    if (guide.current) guide.current.style.opacity = "0";
    if (readout.current) readout.current.textContent = "";
  };

  // few trades: every trade gets a dot on the curve (HTML dots – the SVG is stretched, circles would turn into ellipses)
  const dots = n <= 40 ? points.map((p, i) => ({ left: `${(i / W) * 100}%`, top: `${((y(p.dd) + 2) / H) * 100}%`, low: p.dd <= minDD })) : [];
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-1.5">
      <div
        ref={root}
        className="relative flex-1"
        style={{ minHeight: H, touchAction: "pan-y" }}
        onPointerEnter={enter}
        onPointerDown={enter}
        onPointerMove={(e) => rect.current && show(e.clientX)}
        onPointerLeave={leave}
        onPointerCancel={leave}
        aria-hidden="true"
      >
        <motion.div
          className="absolute inset-0"
          initial={reduced ? false : { clipPath: "inset(0 100% 0 0)" }}
          animate={{ clipPath: seen || reduced ? "inset(0 0% 0 0)" : "inset(0 100% 0 0)" }}
          transition={tween.draw}
        >
          <svg viewBox={`0 -2 ${W} ${H}`} preserveAspectRatio="none" className="h-full w-full overflow-visible">
            <line x1="0" x2={W} y1="0" y2="0" stroke="#2c2c2c" vectorEffect="non-scaling-stroke" />
            <path d={area} fill="rgb(255 77 79 / 0.16)" />
            <path d={line} fill="none" stroke="#ff4d4f" strokeWidth="1.5" vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
          </svg>
          {dots.map((d, i) => (
            <span key={i} className={cn("absolute size-[5px] -translate-x-1/2 -translate-y-1/2 rounded-full", d.low ? "bg-loss" : "bg-[#ff4d4f]/70")} style={{ left: d.left, top: d.top }} />
          ))}
        </motion.div>
        <span ref={guide} className="pointer-events-none absolute inset-y-0 left-0 w-px bg-fg/50 opacity-0 transition-opacity duration-150" />
      </div>
      <div className="flex min-h-4 items-center justify-between gap-2 text-[11px] text-faint">
        <span>Start</span>
        <span ref={readout} className="num truncate font-mono text-fg" />
        <span>jetzt</span>
      </div>
    </div>
  );
}

/**
 * `Drawdown` (Tradezella drawdown widget + recovery): under-water curve, max. drawdown (% / money / date), current
 * drawdown and what it takes to get back, Ø drawdown, recovery factor, longest phase under water.
 */
export function DrawdownCard() {
  const { view, cur } = useInsightsBase();
  const rep = useMemo(() => drawdownReport({ ...view, net: view.g.net }), [view]);
  const points = useMemo(
    () => rep.points.map((p) => ({ dd: p.dd, label: p.t ? fmtDate(tradeTime(p.t)) : "Start" })),
    [rep.points],
  );
  const minDD = Math.min(0, ...rep.points.map((p) => p.dd));
  const longest = rep.longest;

  return (
    <InsightCard title={TITLES.drawdown} explain={() => explainDrawdown(rep, view.g, cur)} data-testid="insights-drawdown">
      {!view.closed.length ? (
        <EmptyState title={EMPTY.trades.title} text={EMPTY.trades.text} />
      ) : (
        // the curve takes the height the row leaves (the card stretches to its neighbour), the tiles stay compact
        <div className="flex flex-1 flex-col gap-4">
          {rep.maxDD < 0 ? <Underwater points={points} minDD={minDD} /> : <EmptyState title={EMPTY.drawdown.title} text={EMPTY.drawdown.text} line={false} className="min-h-[120px] flex-1" />}
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            <Stat label="Max. Drawdown" value={pct(rep.maxDD)} tone={rep.maxDD < 0 ? "text-loss" : "text-fg"} sub={rep.maxDD < 0 ? `${n0(-rep.maxDDAbs)} ${cur}${rep.troughAt ? ` · ${fmtDate(rep.troughAt)}` : ""}` : "–"} />
            <Stat label="Aktuell" value={pct(rep.current)} tone={rep.current < 0 ? "text-loss" : "text-win"} sub={rep.current < 0 ? `${pct(rep.needed)} bis zum Hoch` : "am Höchststand"} />
            <Stat label="Ø Drawdown" value={rep.avgDD == null ? "–" : pct(rep.avgDD)} sub="unter Wasser" />
            <Stat label="Erholungs-Faktor" value={rep.recovery == null ? "–" : n2(rep.recovery)} tone={cn(rep.recovery != null && (rep.recovery >= 1 ? "text-win" : "text-loss"))} sub="Netto ÷ max. DD" />
            <Stat
              className="col-span-2"
              label="Längste Phase"
              value={longest ? `${longest.trades} ${longest.trades === 1 ? "Trade" : "Trades"}` : "–"}
              sub={longest ? `${Math.round(longest.days)} Tage${longest.to == null ? " · läuft" : ""}` : "nie unter Wasser"}
            />
          </div>
        </div>
      )}
    </InsightCard>
  );
}
