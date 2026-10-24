/**
 * "Was habe ich gelernt?": what the optimiser has learned from the user's decisions and from the live checks – with numbers and
 * sample sizes, and an honest "zu wenig Daten" wherever a rate would only be noise. Read from `settings.evolve`.
 */
import { useMemo } from "react";
import { evolveCfgOf, learnedSummary, type KindRow, type Rate } from "@/domain/evolve";
import { cn } from "@/lib/cn";
import { Card } from "@/primitives/Card";
import { useJournal } from "@/store/journalStore";
import { dec } from "./fmt";
import { DISCLAIMER, EVOLVE } from "./strings";

const Lr = EVOLVE.learned;
const pc = (v: number): number => Math.round(v * 100);

function RateLine({ label, rate, n, text, few, testId }: { label: string; rate: Rate | null; n: number; text: (r: Rate) => string; few: (n: number) => string; testId: string }) {
  return (
    <div className="grid gap-0.5 rounded-xl border border-line bg-ink-950/50 px-3 py-2" data-testid={testId}>
      <span className="text-[10.5px] font-semibold uppercase tracking-[0.1em] text-mute">{label}</span>
      <span className={cn("text-[12.5px] leading-snug", !rate && "text-faint")}>{rate ? text(rate) : few(n)}</span>
    </div>
  );
}

function KindTable({ rows, label }: { rows: KindRow[]; label: string }) {
  if (!rows.length) return null;
  return (
    <div className="grid gap-1.5" role="table" aria-label={label}>
      <div role="row" className="hidden grid-cols-[minmax(0,1fr)_9rem_9rem_3.5rem] gap-2 px-3 text-[10.5px] font-semibold uppercase tracking-[0.1em] text-mute sm:grid">
        <span role="columnheader">{Lr.colKind}</span>
        <span role="columnheader">{Lr.colDecisions}</span>
        <span role="columnheader">{Lr.colLive}</span>
        <span role="columnheader" className="text-right">{Lr.colWeight}</span>
      </div>
      {rows.map((r) => (
        <div key={r.kind} role="row" data-testid="evolve-learned-kind" data-kind={r.kind} className="grid gap-x-2 gap-y-0.5 rounded-xl border border-line bg-ink-950/50 px-3 py-2 text-[12px] sm:grid-cols-[minmax(0,1fr)_9rem_9rem_3.5rem] sm:items-center">
          <span role="cell" className="font-medium">{r.label}</span>
          <span role="cell" className="num text-mute">
            {r.acc} {Lr.accepted} · {r.rej} {Lr.rejected}
          </span>
          <span role="cell" className="num text-mute">
            {r.good} {Lr.confirmed} · {r.bad} {Lr.below}
          </span>
          <span role="cell" className="num sm:text-right" title={Lr.weightHint}>
            {dec(r.weight, 1)}
          </span>
          <span role="cell" className={cn("text-[11.5px] sm:col-span-4", r.note ? "text-mute" : "text-faint")}>
            {r.note ?? Lr.tooFew}
          </span>
        </div>
      ))}
    </div>
  );
}

export function LearnedCard({ className }: { className?: string }) {
  const raw = useJournal((s) => s.settings.evolve);
  const sum = useMemo(() => learnedSummary(evolveCfgOf(raw)), [raw]);
  return (
    <Card title={Lr.title} note={Lr.sub} className={className} data-testid="evolve-learned" data-empty={sum.empty ? "yes" : "no"}>
      <div className="grid gap-3">
        {sum.empty ? (
          <p className="text-[12.5px] leading-relaxed text-mute" data-testid="evolve-learned-empty">
            {Lr.empty}
          </p>
        ) : (
          <>
            <div className="grid gap-2 sm:grid-cols-3">
              <RateLine label={Lr.accept} rate={sum.acceptRate} n={sum.decided} text={(r) => Lr.acceptText(r.k, r.n, pc(r.p), pc(r.ci.lo), pc(r.ci.hi))} few={Lr.acceptFew} testId="evolve-learned-accept" />
              <RateLine label={Lr.hit} rate={sum.live.rate} n={sum.live.n} text={(r) => Lr.hitText(r.k, r.n, pc(r.p), pc(r.ci.lo), pc(r.ci.hi))} few={Lr.hitFew} testId="evolve-learned-hit" />
              <div className="grid gap-0.5 rounded-xl border border-line bg-ink-950/50 px-3 py-2" data-testid="evolve-learned-match">
                <span className="text-[10.5px] font-semibold uppercase tracking-[0.1em] text-mute">{Lr.match}</span>
                <span className={cn("text-[12.5px] leading-snug", sum.match.avgDevPct == null && "text-faint")}>{sum.match.avgDevPct != null ? Lr.matchText(sum.match.n, sum.match.avgDevPct) : Lr.matchFew(sum.match.n)}</span>
              </div>
            </div>
            {sum.notes.map((n) => (
              <p key={n} className="text-[11.5px] leading-relaxed text-faint">
                {n}
              </p>
            ))}
            <div className="grid gap-1.5">
              <h4 className="text-[10.5px] font-semibold uppercase tracking-[0.1em] text-mute">{Lr.kinds}</h4>
              {sum.kinds.length ? <KindTable rows={sum.kinds} label={Lr.kinds} /> : <p className="text-[12px] text-faint">{Lr.tooFew}</p>}
              {sum.filters.length > 0 && (
                <p className="text-[11.5px] text-faint">
                  {Lr.filters}: {sum.filters.map((f) => `${f.label} (${f.acc + f.rej} Entscheidungen, ${f.good + f.bad} Live-Urteile)`).join(" · ")}
                </p>
              )}
              <p className="text-[11.5px] leading-relaxed text-faint">
                {Lr.weightHint} {Lr.attribution}
              </p>
            </div>
            {sum.trials > 0 && <p className="text-[11.5px] text-faint">{Lr.trials(sum.trials, sum.strategies)}</p>}
          </>
        )}
        <p className="text-[11.5px] text-faint" data-testid="evolve-disclaimer">
          {DISCLAIMER}
        </p>
      </div>
    </Card>
  );
}
