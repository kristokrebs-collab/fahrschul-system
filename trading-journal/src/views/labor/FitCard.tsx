/**
 * „Passt zu dir?“ (F49): the card under the diagnosis of a finished Labor run. It holds what the tested idea DEMANDS (win
 * rate, time in a trade, losing runs, drawdown depth, trade frequency, time windows, risk, rule discipline – all from the
 * run's trades) against what the trader's own journal SHOWS, as a list of agreements and frictions with both figures
 * side by side. No total score, no verdict, no advice to trade or to skip; every statement carries its sample, and a
 * statement the journal cannot support yet is „nicht beurteilbar“ with the reason.
 *
 * Lazy chunk of `LaborView`. Reads the shown run (`useLabor`) and the journal (`useEnriched`, the coach's behaviour
 * events); it changes neither (`diagnoseRun` and the extras are not touched). Nothing leaves the browser.
 */
import { memo, useMemo } from "react";
import { compareFit, journalProfile, strategyFacts, type FitItem, type FitReport } from "@/domain/fit";
import { exitsText, activeLeaves } from "@/domain/lab/rules/tree";
import { cn } from "@/lib/cn";
import { date as fmtDate } from "@/lib/format";
import { Badge } from "@/primitives/Badge";
import { Card } from "@/primitives/Card";
import { useEnriched, useJournal } from "@/store/journalStore";
import { eventsOf } from "@/views/coach/hooks";
import { useLabor, type LabConfig } from "./laborStore";
import { LABOR } from "./strings";

const F = LABOR.fit;

const NAMES: Readonly<Record<string, string>> = { custom: "Eigene Idee", box: "Box-zu-Box", mcb: "MCB-Leiter", rules: "Regel-Baukasten" };

/**
 * The rule parts the idea is made of, for the statement „Regelumfang“: „Eigene Idee“ = the active conditions and the exit
 * rules (target, break-even, trailing, partial, time stop, opposite signal); „Regel-Baukasten“ = its conditions and the
 * fixed stop and target (no further exit rules); the templates Box and MCB have a fixed logic and are not counted.
 */
export function ruleParts(strategy: string, cfg: LabConfig | null): { conds: number; exits: number } | null {
  if (!cfg) return null;
  if (strategy === "custom" && cfg.custom?.sides) return { conds: activeLeaves(cfg.custom).length, exits: exitsText(cfg.custom).length };
  if (strategy === "rules" && Array.isArray(cfg.rules?.conds)) return { conds: cfg.rules.conds.length, exits: 0 };
  return null;
}

/** The comparison for the shown run (null before a result). Exported for tests. */
export function useFit(): FitReport | null {
  const result = useLabor((s) => s.result);
  const runCfg = useLabor((s) => s.runCfg);
  const enriched = useEnriched();
  const settings = useJournal((s) => s.settings);
  const days = useJournal((s) => s.days);
  return useMemo(() => {
    if (!result) return null;
    const strategy = strategyFacts({
      name: result.name ?? NAMES[result.strategy] ?? result.strategy,
      from: result.from,
      to: result.to,
      riskPct: runCfg?.riskPct ?? null,
      maxDD: result.stats.maxDD,
      trades: result.trades,
      interval: result.interval,
      rules: ruleParts(result.strategy, runCfg),
    });
    return compareFit(strategy, journalProfile(enriched, settings, eventsOf(enriched, settings, days), days));
  }, [result, runCfg, enriched, settings, days]);
}

const KIND_TONE = { friction: "warn", match: "teal", unknown: "mute" } as const;

function Item({ it }: { it: FitItem }) {
  return (
    <li className="grid gap-2 rounded-xl border border-line bg-ink-950/30 p-3" data-testid="fit-item" data-id={it.id} data-kind={it.kind}>
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone={KIND_TONE[it.kind]}>{F.kind[it.kind]}</Badge>
        <h4 className="text-[13px] font-semibold text-fg">{it.title}</h4>
      </div>
      <p className="text-[13px] leading-snug text-mute">{it.text}</p>
      {it.evidence.length > 0 && (
        <dl className="grid gap-x-4 sm:grid-cols-2">
          {it.evidence.map((e) => (
            <div key={e.label} className="flex min-w-0 flex-wrap items-baseline justify-between gap-x-3 border-b border-line/60 py-1 text-[12px]">
              <dt className="text-faint">{e.label}</dt>
              <dd className="num min-w-0 text-right font-mono text-fg/90">{e.value}</dd>
            </div>
          ))}
        </dl>
      )}
      {it.caveat && <p className="text-[11px] leading-snug text-faint">{it.caveat}</p>}
    </li>
  );
}

function Group({ kind, items }: { kind: FitItem["kind"]; items: readonly FitItem[] }) {
  if (!items.length) return null;
  return (
    <section className="grid gap-2" data-testid={`fit-group-${kind}`} aria-label={F.group[kind]}>
      <h3 className="label flex items-center gap-2">
        <span className={cn("size-1.5 rounded-full", kind === "friction" ? "bg-warn" : kind === "match" ? "bg-aqua" : "bg-faint")} aria-hidden="true" />
        {F.group[kind]} · {items.length}
      </h3>
      <ul className="grid gap-2">
        {items.map((it) => (
          <Item key={it.id} it={it} />
        ))}
      </ul>
    </section>
  );
}

export const FitCard = memo(function FitCard({ className }: { className?: string }) {
  const report = useFit();
  if (!report) return null;
  const s = report.strategy;
  const j = report.profile;
  return (
    <Card title={F.title} note={F.note} className={className} data-testid="labor-fit" data-status={report.status}>
      <div className="grid gap-5">
        <p className="text-[11.5px] leading-snug text-faint" data-testid="fit-sample">
          {s ? F.sampleIdea(s.name, s.n, fmtDate(new Date(s.from)), fmtDate(new Date(s.to))) : null} {j ? F.sampleJournal(j.n) : null}
        </p>
        {report.status !== "ok" ? (
          <p className="rounded-xl border border-line bg-ink-950/40 p-3 text-[13px] leading-snug text-mute" data-testid="fit-empty">
            {report.reason}
          </p>
        ) : (
          <div className="grid gap-5" data-testid="fit-items">
            <Group kind="friction" items={report.items.filter((i) => i.kind === "friction")} />
            <Group kind="match" items={report.items.filter((i) => i.kind === "match")} />
            <Group kind="unknown" items={report.items.filter((i) => i.kind === "unknown")} />
          </div>
        )}
        <p className="rounded-xl border border-line p-3 text-[11.5px] leading-snug text-mute" data-testid="fit-caveat">
          {F.caveat}
        </p>
      </div>
    </Card>
  );
});

export default FitCard;
