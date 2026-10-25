/**
 * „Signalbilanz“ (F25): every archived entry signal by kind, setup or timeframe – how many, how many traded / left out /
 * expired, and, as the outcomes get evaluated (automatically, see `signalAuto.ts`), the hit rate and the mean R with the sample and
 * the uncertainty of EACH row; then „deine Trades gegen alle Signale“ with the selection effect named (`SELECTION_NOTE`). Pure
 * numbers from `@/domain/missed/balance`; the outcomes come from the shared state (`signalOutcomes.ts`).
 *
 * Rows are stacked blocks, not a table: at 390 px there is no horizontal scroll.
 */
import { useMemo, useState } from "react";
import type { Interval } from "@/domain/analytics/stats";
import { BALANCE_GROUP_LABEL, BASIS_FILTER_LABEL, buildBalance, SELECTION_NOTE, type BalanceGroup, type BalanceRow, type BasisFilter, type Reading } from "@/domain/missed";
import type { EnrichedTrade } from "@/domain/types";
import { cn } from "@/lib/cn";
import { pct0, r as fmtR } from "@/lib/format";
import { useSignalArchive } from "@/market/signalArchive";
import { Badge } from "@/primitives/Badge";
import { Card } from "@/primitives/Card";
import { EmptyState } from "@/primitives/EmptyState";
import { Chip, OUTCOME_STRINGS, OutcomeControl, useOutcomes } from "./signalUi";
import { KV, SampleLine } from "./ui";

export const BALANCE_STRINGS = {
  title: "Signalbilanz",
  note: "Alle Einstiegs-Signale je Art, Setup und Zeiteinheit – mit dem, was danach am Kurs geschah.",
  emptyTitle: "Noch keine Signale für eine Bilanz",
  emptyText: "Sobald die App Einstiegs-Signale festgehalten hat (siehe Posteingang), erscheinen sie hier nach Art, Setup und Zeiteinheit.",
  pendingHint: "Die Ausgänge werden automatisch ausgewertet – bis dahin gibt es nur die Zahlen zu Gehandelt, Ausgelassen und Abgelaufen.",
  cmpTitle: "Deine Trades gegen alle Signale",
  cmpNone: "Für den Vergleich fehlen Signale mit Ausgang oder gebuchte Trades dazu.",
  rate: "Trefferquote = Ziel zuerst ÷ (Ziel + Stopp zuerst), mit 80 %-Intervall. Offene und nicht auswertbare Signale zählen nicht mit.",
} as const;

const ivR = (i: Interval | null): string => (i ? `${fmtR(i.lo)} … ${fmtR(i.hi)}` : "–");
const ivP = (i: Interval | null): string => (i ? `${pct0(i.lo)} … ${pct0(i.hi)}` : "–");

function RowView({ r }: { r: BalanceRow }) {
  return (
    <li className="grid gap-2 rounded-xl border border-line bg-ink-950/50 px-3 py-2.5" data-testid="balance-row" data-key={r.key} data-n={r.n} data-decided={r.decided}>
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <h3 className="min-w-0 text-[13px] font-semibold text-fg">{r.label}</h3>
        <SampleLine n={r.n} />
      </div>
      <div className="grid grid-cols-2 gap-x-4 sm:grid-cols-4">
        <KV label="Gehandelt" value={r.traded} />
        <KV label="Ausgelassen" value={r.left} />
        <KV label="Abgelaufen" value={r.expired} />
        <KV label="Laufend" value={r.running} />
      </div>
      {r.pending === r.n ? (
        <p className="text-[11.5px] text-faint">Ausgang noch nicht ausgewertet.</p>
      ) : (
        <div className="grid gap-1 border-t border-line pt-2">
          <div className="grid grid-cols-2 gap-x-4 sm:grid-cols-4">
            <KV label="Ziel zuerst" value={r.target} tone="win" />
            <KV label="Stopp zuerst" value={r.stop} tone="loss" />
            <KV label="Noch offen" value={r.open} tone="mute" />
            <KV label="Nicht auswertbar" value={r.unusable} tone="mute" />
          </div>
          <div className="grid gap-x-4 sm:grid-cols-2">
            <KV label="Trefferquote" value={r.hitRate == null ? "–" : pct0(r.hitRate)} />
            <KV label="Ø R" value={r.avgR == null ? "–" : fmtR(r.avgR)} tone={r.avgR == null ? "mute" : r.avgR > 0 ? "win" : r.avgR < 0 ? "loss" : "fg"} />
          </div>
          <p className="num font-mono text-[10.5px] leading-snug text-faint" data-testid="balance-unc">
            n {r.decided} entschieden · Stichprobe {r.level}
            {r.hitCi ? ` · Quote ${ivP(r.hitCi)}` : ""}
            {r.rCi ? ` · Ø R ${ivR(r.rCi)}` : ""}
            {r.pending > 0 ? ` · ${r.pending} ohne Ausgang` : ""}
          </p>
        </div>
      )}
    </li>
  );
}

function ReadingLine({ label, rd, hint }: { label: string; rd: Reading; hint?: string }) {
  return (
    <div className="grid gap-0.5 border-b border-line/70 py-1.5 last:border-b-0">
      <div className="flex min-w-0 items-baseline justify-between gap-3 text-[12.5px]">
        <span className="min-w-0 text-mute">{label}</span>
        <span className={cn("num shrink-0 font-mono", rd.avgR == null ? "text-mute" : rd.avgR > 0 ? "text-win" : rd.avgR < 0 ? "text-loss" : "text-fg")}>{rd.avgR == null ? "–" : fmtR(rd.avgR)}</span>
      </div>
      <p className="num font-mono text-[10.5px] text-faint">
        n {rd.n}
        {rd.ci ? ` · 80 %-Intervall ${ivR(rd.ci)}` : rd.n > 0 ? " · zu wenig für ein Intervall" : ""}
        {hint ? ` · ${hint}` : ""}
      </p>
    </div>
  );
}

export function SignalBalanceCard({ list, now, className }: { list: readonly EnrichedTrade[]; now: number; className?: string }) {
  const events = useSignalArchive();
  const o = useOutcomes(events);
  const [by, setBy] = useState<BalanceGroup>("type");
  const [basis, setBasis] = useState<BasisFilter>("all");
  const bal = useMemo(() => buildBalance(events, list, o.outcomes, now, by, basis), [events, list, o.outcomes, now, by, basis]);
  const c = bal.comparison;
  return (
    <Card title={BALANCE_STRINGS.title} note={BALANCE_STRINGS.note} className={className} data-testid="balance-card" data-signals={bal.signals} innerClassName="grid content-start gap-4">
      {bal.signals === 0 ? (
        <EmptyState title={BALANCE_STRINGS.emptyTitle} text={BALANCE_STRINGS.emptyText} line={false} />
      ) : (
        <>
          <OutcomeControl events={events} />
          <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Gruppieren nach">
            {(Object.keys(BALANCE_GROUP_LABEL) as BalanceGroup[]).map((g) => (
              <Chip key={g} on={by === g} onClick={() => setBy(g)} testId={`balance-by-${g}`}>
                {BALANCE_GROUP_LABEL[g]}
              </Chip>
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Basis der Ausgänge">
            {(Object.keys(BASIS_FILTER_LABEL) as BasisFilter[]).map((b) => (
              <Chip key={b} on={basis === b} onClick={() => setBasis(b)} testId={`balance-basis-${b}`}>
                {BASIS_FILTER_LABEL[b]}
              </Chip>
            ))}
            <Badge tone="mute" className="ml-auto">
              {bal.signals} Signale
            </Badge>
          </div>
          {o.decided === 0 && <p className="text-[12px] leading-relaxed text-mute">{BALANCE_STRINGS.pendingHint}</p>}
          <ul className="grid gap-2" aria-label="Bilanz je Gruppe">
            {bal.rows.map((r) => (
              <RowView key={r.key} r={r} />
            ))}
          </ul>
          <div className="grid gap-1">
            <h3 className="text-[10px] font-semibold uppercase tracking-[0.1em] text-mute">Alle Signale zusammen</h3>
            <RowView r={bal.total} />
          </div>
          <div className="grid gap-1" data-testid="balance-compare">
            <h3 className="text-[10px] font-semibold uppercase tracking-[0.1em] text-mute">{BALANCE_STRINGS.cmpTitle}</h3>
            {c.all.n === 0 && c.tradedBooked.n === 0 ? (
              <p className="text-[12.5px] leading-relaxed text-mute">{BALANCE_STRINGS.cmpNone}</p>
            ) : (
              <>
                <ReadingLine label="Alle Signale (Ausgang am Kurs)" rd={c.all} />
                <ReadingLine label="Davon gehandelt – Ausgang am Kurs" rd={c.tradedSignals} />
                <ReadingLine label="Davon gehandelt – von dir gebucht" rd={c.tradedBooked} hint="nach Gebühren" />
                <ReadingLine label="Ausgelassen oder abgelaufen – Ausgang am Kurs" rd={c.notTraded} />
                <KV label="Differenz: gebucht − alle Signale" value={c.diff == null ? "–" : fmtR(c.diff)} tone={c.diff == null ? "mute" : c.diff > 0 ? "win" : c.diff < 0 ? "loss" : "fg"} />
              </>
            )}
          </div>
          <div className="grid gap-1.5 border-t border-line pt-3 text-[11.5px] leading-relaxed text-faint">
            <p data-testid="balance-selection">{SELECTION_NOTE}</p>
            <p>{BALANCE_STRINGS.rate}</p>
            <p>{OUTCOME_STRINGS.rules}</p>
            {bal.context > 0 && <p>{bal.context} weitere Ereignisse (Ausbrüche, Ziele …) sind keine Einstiege und stehen nicht in der Bilanz.</p>}
          </div>
        </>
      )}
    </Card>
  );
}
