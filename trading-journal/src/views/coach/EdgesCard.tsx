/**
 * "Leaks & Edges" (P04): what makes and what costs money – single factors and 2-way combinations from the edge finder
 * (`findEdges`: Welch test against the rest, Benjamini-Hochberg over every candidate, bootstrap intervals, stability
 * over both halves). Only "klar" / "Tendenz" items are listed ("trade the best, fuck the rest"), the top 3 per side;
 * the rest unfolds. Every item shows n, the minimum sample, Ø against the rest with the interval, a confidence meter
 * and a what-if ("Ohne … : +x R") with its interval; its trades unfold. A leak card gets one red `SpotlightSweep` when
 * it first comes into view; edges carry a `ConfidenceMeter`.
 */
import { useId, useMemo, useState } from "react";
import { whatIf, type EdgeCandidate, type EdgeReport } from "@/domain/coach";
import { cn } from "@/lib/cn";
import { pct0, r as fmtR, signed } from "@/lib/format";
import { ConfidenceMeter } from "@/motion/fx/ConfidenceMeter";
import { SpotlightSweep } from "@/motion/fx/SpotlightSweep";
import { Card } from "@/primitives/Card";
import { Collapse, Expander } from "@/primitives/Expander";
import { EmptyState } from "@/primitives/EmptyState";
import { EvidenceTrades, SampleLine, VerdictBadge } from "./ui";

const TOP = 3;

const unitText = (v: number | null | undefined, unit: "R" | "money", cur: string): string => (v == null || !Number.isFinite(v) ? "–" : unit === "R" ? fmtR(v) : `${signed(v, 0)} ${cur}`);

function EdgeItem({ c, closed, cur, minN, kind }: { c: EdgeCandidate; closed: EdgeCandidate["trades"]; cur: string; minN: number; kind: "edge" | "leak" }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const wi = useMemo(() => {
    const ids = new Set(c.trades.map((t) => t.id));
    return whatIf(closed, (t) => ids.has(t.id), kind === "leak" ? "skip" : "only", c.unit, c.label);
  }, [c, closed, kind]);
  const ciText = c.ci ? `${unitText(c.ci.lo, c.unit, cur)} … ${unitText(c.ci.hi, c.unit, cur)}` : "–";
  const tone = kind === "edge" ? "text-win" : "text-loss";
  return (
    <li className={cn("relative grid gap-2 overflow-hidden rounded-2xl border bg-ink-950/50 p-3.5", kind === "leak" ? "border-loss/20" : "border-win/15")} data-testid={`coach-${kind}`} data-id={c.id}>
      {kind === "leak" && <SpotlightSweep tone="signal" />}
      <div className="flex min-w-0 items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[13.5px] font-semibold leading-snug text-fg [overflow-wrap:anywhere]">{c.label}</p>
          <p className="mt-0.5 text-[12px] text-mute">
            Ø <span className={cn("num font-mono", tone)}>{unitText(c.mean, c.unit, cur)}</span> statt {unitText(c.restMean, c.unit, cur)} · {pct0(c.winRate)} Win-Rate
          </p>
        </div>
        <VerdictBadge verdict={c.verdict} className="shrink-0" />
      </div>
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1.5">
        {kind === "edge" ? <ConfidenceMeter value={c.confidence} label="Konfidenz" cols={12} size={3} gap={2} /> : <span className="num font-mono text-[12px] text-mute">Konfidenz {c.confidence} %</span>}
        <SampleLine n={c.n} minN={minN} />
      </div>
      <dl className="grid grid-cols-1 gap-x-4 gap-y-1 text-[11.5px] sm:grid-cols-2">
        <div className="flex justify-between gap-2">
          <dt className="text-faint">Spanne (80 %)</dt>
          <dd className="num font-mono text-mute">{ciText}</dd>
        </div>
        <div className="flex justify-between gap-2">
          <dt className="text-faint">{kind === "leak" ? "Ohne diese Trades" : "Nur diese Trades"}</dt>
          <dd className={cn("num font-mono", wi.delta >= 0 ? "text-win" : "text-loss")}>
            {kind === "leak" ? unitText(wi.delta, c.unit, cur) : `Ø ${unitText(wi.meanAfter, c.unit, cur)}`}
          </dd>
        </div>
      </dl>
      <div className="flex items-center justify-between gap-2">
        <span className="text-[11px] text-faint">{c.halves.stable ? "stabil in beiden Hälften" : c.halves.stable === false ? "nicht stabil über die Zeit" : "Hälften zu klein"}</span>
        <Expander open={open} onToggle={() => setOpen((o) => !o)} label={`Belege: ${c.label}`} controls={id} className="touch-hit" />
      </div>
      <Collapse open={open} id={id}>
        <EvidenceTrades trades={[...c.trades].sort((a, b) => Math.abs(b.pnl ?? 0) - Math.abs(a.pnl ?? 0)).slice(0, 8)} group={`coach-edge-${c.id}`} play={open} />
      </Collapse>
    </li>
  );
}

function Column({ title, items, closed, cur, minN, kind, empty }: { title: string; items: EdgeCandidate[]; closed: EdgeCandidate["trades"]; cur: string; minN: number; kind: "edge" | "leak"; empty: string }) {
  const [more, setMore] = useState(false);
  const id = useId();
  const top = items.slice(0, TOP);
  const rest = items.slice(TOP);
  return (
    <section className="grid content-start gap-3" aria-labelledby={id}>
      <h3 id={id} className={cn("flex items-center gap-2 text-[12px] font-semibold uppercase tracking-[0.12em]", kind === "edge" ? "text-win" : "text-loss")}>
        <span aria-hidden="true" className={cn("size-1.5 rounded-full", kind === "edge" ? "bg-win" : "bg-loss")} />
        {title}
      </h3>
      {top.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-line-2 px-3.5 py-4 text-[12.5px] text-mute">{empty}</p>
      ) : (
        <ul className="grid gap-2.5">
          {top.map((c) => (
            <EdgeItem key={c.id} c={c} closed={closed} cur={cur} minN={minN} kind={kind} />
          ))}
        </ul>
      )}
      {rest.length > 0 && (
        <>
          <button type="button" onClick={() => setMore((m) => !m)} aria-expanded={more} className="touch-hit justify-self-start text-[12px] text-mute hover:text-fg">
            {more ? "Weniger zeigen" : `+${rest.length} weitere`}
          </button>
          <Collapse open={more}>
            <ul className="grid gap-2.5">
              {rest.map((c) => (
                <EdgeItem key={c.id} c={c} closed={closed} cur={cur} minN={minN} kind={kind} />
              ))}
            </ul>
          </Collapse>
        </>
      )}
    </section>
  );
}

export function EdgesCard({ edges, closed, cur, className }: { edges: EdgeReport; closed: EdgeCandidate["trades"]; cur: string; className?: string }) {
  const tooFew = edges.n < 2 * edges.minN;
  return (
    <Card title="Leaks & Edges" note={`${edges.tested} Muster getestet · FDR-korrigiert · Intervalle 80 %`} className={className} data-testid="coach-edges">
      {tooFew ? (
        <EmptyState title="Noch zu wenige Trades" text={`Leaks und Edges brauchen mindestens ${2 * edges.minN} abgeschlossene Trades (je Muster ${edges.minN}). Bisher: ${edges.n}.`} line={false} />
      ) : (
        <div className="grid gap-6 lg:grid-cols-2">
          <Column title="Deine Edges" items={edges.edges} closed={closed} cur={cur} minN={edges.minN} kind="edge" empty="Noch keine Edge, die dem Zufall standhält. Mehr Trades mit Grundlage helfen." />
          <Column title="Deine Leaks" items={edges.leaks} closed={closed} cur={cur} minN={edges.minN} kind="leak" empty="Kein Leck, das sicher Geld kostet. Weiter so." />
        </div>
      )}
    </Card>
  );
}
