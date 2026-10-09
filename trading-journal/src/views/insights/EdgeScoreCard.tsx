import { AnimatePresence, motion } from "motion/react";
import { useMemo, useRef, useState } from "react";
import { EDGE_MIN_TRADES, EMPTY, edgeScore, edgeTimeline, explainEdge, TITLES, type EdgeAxis, type EdgeAxisKey, type EdgeResult } from "@/domain/insights";
import { cn } from "@/lib/cn";
import { monthLabel } from "@/lib/dates";
import { signed } from "@/lib/format";
import { MotionNumber } from "@/motion/MotionNumber";
import { spring, stagger, tween } from "@/motion/tokens";
import { useReducedFx } from "@/motion/useReducedFx";
import { EmptyState } from "@/primitives/EmptyState";
import { Collapse } from "@/primitives/Expander";
import { useSeenOnce } from "@/primitives/revealValue";
import { Bar } from "@/views/overview/Bar";
import { InsightCard, useInsightsBase } from "./ui";

const W = 300;
const H = 236;
const CX = 150;
const CY = 116;
const R = 78;

/** Vertex of axis `i` (0 = top, clockwise) at `value` 0…100. */
function vertex(i: number, value: number): [number, number] {
  const a = -Math.PI / 2 + (i * Math.PI) / 3;
  const r = (R * Math.max(0, Math.min(100, value))) / 100;
  return [CX + r * Math.cos(a), CY + r * Math.sin(a)];
}
const ring = (v: number) => Array.from({ length: 6 }, (_, i) => vertex(i, v).map((n) => n.toFixed(1)).join(",")).join(" ");

/** Label anchor of axis `i`: outside the vertex, aligned away from the centre. */
function labelPos(i: number): { x: number; y: number; anchor: "start" | "middle" | "end" } {
  const a = -Math.PI / 2 + (i * Math.PI) / 3;
  const x = CX + (R + 12) * Math.cos(a);
  const y = CY + (R + 12) * Math.sin(a);
  const anchor = Math.abs(Math.cos(a)) < 0.2 ? "middle" : Math.cos(a) > 0 ? "start" : "end";
  return { x, y: i === 0 ? y - 12 : i === 3 ? y + 6 : y - 4, anchor };
}

/**
 * Six-axis radar as inline SVG (no chart library): the score polygon grows from the centre on first view
 * (transform scale on `spring.smooth`), its vertices pop one after another; an account switch crossfades to the new
 * polygon. The selected axis is lit. Label + points sit outside each vertex, short labels below 340 px card width.
 */
function Radar({ axes, selected, onSelect }: { axes: readonly EdgeAxis[]; selected: EdgeAxisKey | null; onSelect: (k: EdgeAxisKey) => void }) {
  const reduced = useReducedFx();
  const root = useRef<SVGSVGElement>(null);
  const seen = useSeenOnce(root);
  const pts = axes.map((a, i) => vertex(i, a.value));
  const poly = pts.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
  const sig = axes.map((a) => Math.round(a.value)).join("-");
  const grow = seen || reduced;
  return (
    <svg ref={root} viewBox={`0 0 ${W} ${H}`} className="mx-auto block w-full max-w-[340px] overflow-visible" role="img" aria-label={axes.map((a) => `${a.label} ${Math.round(a.value)}`).join(", ")}>
      {[25, 50, 75, 100].map((v) => (
        <polygon key={v} points={ring(v)} fill="none" stroke={v === 100 ? "#2c2c2c" : "#1f1f1f"} strokeWidth="1" />
      ))}
      {axes.map((a, i) => {
        const [x, y] = vertex(i, 100);
        return <line key={a.key} x1={CX} y1={CY} x2={x} y2={y} stroke={selected === a.key ? "#5f5f5f" : "#1f1f1f"} strokeWidth="1" />;
      })}
      <AnimatePresence initial={false}>
        <motion.g
          key={sig}
          style={{ transformOrigin: `${CX}px ${CY}px`, transformBox: "view-box" }}
          initial={grow ? { opacity: 0, scale: 0.92 } : { opacity: 0, scale: 0 }}
          animate={grow ? { opacity: 1, scale: 1 } : { opacity: 0, scale: 0 }}
          exit={{ opacity: 0, transition: tween.exit }}
          transition={{ scale: spring.smooth, opacity: tween.fade }}
        >
          <polygon points={poly} fill="rgb(242 242 242 / 0.12)" stroke="#f2f2f2" strokeWidth="1.5" strokeLinejoin="round" />
          {pts.map(([x, y], i) => (
            <motion.circle
              key={i}
              cx={x}
              cy={y}
              r={selected === axes[i]!.key ? 4 : 2.6}
              fill={selected === axes[i]!.key ? "#e5202e" : "#f2f2f2"}
              style={{ transformOrigin: `${x}px ${y}px`, transformBox: "view-box" }}
              initial={reduced ? false : { scale: 0 }}
              animate={grow ? { scale: 1 } : { scale: 0 }}
              transition={{ ...spring.pop, delay: reduced ? 0 : 0.18 + i * stagger.reveal }}
            />
          ))}
        </motion.g>
      </AnimatePresence>
      {axes.map((a, i) => {
        const p = labelPos(i);
        const on = selected === a.key;
        return (
          <g key={a.key} className="cursor-pointer" onClick={() => onSelect(a.key)}>
            <text x={p.x} y={p.y} textAnchor={p.anchor} className={cn("text-[10px] font-medium", on ? "fill-fg" : "fill-mute")}>
              {a.label}
            </text>
            <text x={p.x} y={p.y + 12} textAnchor={p.anchor} className={cn("num font-mono text-[10px]", on ? "fill-fg" : "fill-faint")}>
              {Math.round(a.value)}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

const AXIS_HINT: Record<EdgeAxisKey, string> = {
  pf: "Bruttogewinne ÷ Bruttoverluste. 1,0 → 20 Punkte, 1,8 → 50, ab 2,6 volle Punkte.",
  payoff: "Ø Gewinner ÷ Ø Verlierer. Gleiche Skala wie der Profit-Faktor.",
  dd: "Größter Rückgang vom Höchststand des Kontos. 0 % → 100, −10 % → 50, −20 % → 0.",
  winRate: "Anteil der Gewinner. 60 % bringen volle Punkte, darunter anteilig.",
  recovery: "Netto-Gewinn ÷ größter Drawdown in Geld. Ab 3,5 volle Punkte, ohne Gewinn 0.",
  consistency: "Wie viel vom Gewinn am besten Tag hängt. Bis 30 % → 100, alles an einem Tag → 0.",
};

function AxisRows({ e, selected, onSelect }: { e: EdgeResult; selected: EdgeAxisKey | null; onSelect: (k: EdgeAxisKey) => void }) {
  return (
    <ul className="grid">
      {e.axes.map((a, i) => {
        const on = selected === a.key;
        return (
          <li key={a.key} className={cn(i > 0 && "border-t border-line")}>
            <button type="button" aria-expanded={on} aria-controls={`edge-hint-${a.key}`} onClick={() => onSelect(a.key)} className="grid min-h-11 w-full gap-1.5 rounded-lg px-1 py-2 text-left">
              <span className="flex items-baseline justify-between gap-3 text-[12.5px]">
                <span className={cn("min-w-0 truncate", on ? "text-fg" : "text-mute")}>
                  {a.label} <span className="text-faint">· {Math.round(a.weight * 100)} %</span>
                </span>
                <span className="num shrink-0 font-mono text-[12px] text-mute">
                  {a.raw} <span className="text-faint">→</span> <span className="text-fg">{Math.round(a.value)}</span>
                </span>
              </span>
              <Bar value={a.value / 100} index={i} fill={a.value >= 70 ? "bg-win" : a.value >= 40 ? "bg-fg" : "bg-loss"} className="h-1" />
            </button>
            <Collapse open={on} id={`edge-hint-${a.key}`}>
              <p className="px-1 pb-2 text-[11.5px] leading-snug text-faint">{AXIS_HINT[a.key]}</p>
            </Collapse>
          </li>
        );
      })}
    </ul>
  );
}

/**
 * `Edge-Score` (Zella Score 2.0 weights, continuous axes): big Doto score that counts up on first view, change since
 * the previous month, six-axis radar and the axis rows (raw → points, tap = what the axis measures).
 */
export function EdgeScoreCard() {
  const { view } = useInsightsBase();
  const e = useMemo(() => edgeScore(view), [view]);
  const timeline = useMemo(() => edgeTimeline(view.closed, view.start), [view.closed, view.start]);
  const [selected, setSelected] = useState<EdgeAxisKey | null>(null);
  const toggle = (k: EdgeAxisKey) => setSelected((s) => (s === k ? null : k));
  const prev = timeline.length > 1 ? timeline[timeline.length - 2]! : null;
  const delta = e.score != null && prev ? e.score - prev.score : null;

  return (
    <InsightCard
      title={TITLES.edge}
      explain={() => explainEdge(e)}
      note={e.n && !e.reliable ? `aussagekräftig ab ${EDGE_MIN_TRADES} Trades (${e.n})` : undefined}
      data-testid="insights-edge"
    >
      {e.score == null ? (
        <EmptyState title={EMPTY.edge.title} text={EMPTY.edge.text} />
      ) : (
        <div className="grid gap-4">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div className="flex items-end gap-3">
              <MotionNumber value={e.score} countOnReveal className="dot-num text-[54px] leading-none text-fg" aria-label={`Edge-Score ${e.score} von 100`} />
              <span className="mb-1.5 text-[11px] uppercase tracking-[0.14em] text-faint">von 100</span>
            </div>
            {delta != null && prev && (
              <span className={cn("num mb-1.5 rounded-full border px-2.5 py-0.5 font-mono text-[11.5px]", delta > 0 ? "border-win/25 text-win" : delta < 0 ? "border-loss/25 text-loss" : "border-line-2 text-mute")}>
                {delta === 0 ? "±0" : signed(delta, 0)} seit {monthLabel(prev.key)}
              </span>
            )}
          </div>
          <Radar axes={e.axes} selected={selected} onSelect={toggle} />
          <AxisRows e={e} selected={selected} onSelect={toggle} />
        </div>
      )}
    </InsightCard>
  );
}
