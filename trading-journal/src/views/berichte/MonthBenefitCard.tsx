/**
 * „Was hat dir das Journal diesen Monat gebracht?“ (F60): the month report's look back at what the journal and the app
 * demonstrably did – counted from what is recorded (`monthBenefit` in `@/domain/reports/benefit`). No avoided rule violations
 * (nobody can count what did not happen), no money „saved“, no estimate, no cause.
 *
 * A trace that does not reach back to the month's start (the signal archive and the Zustellprotokoll are short and live on this
 * device only) is flagged as incomplete next to its number – a missing record is never read as „none happened“.
 */
import { useMemo } from "react";
import { BENEFIT_LIMITS, monthBenefit, type BenefitExperiment, type MonthBenefit } from "@/domain/reports";
import { cn } from "@/lib/cn";
import { pct0 } from "@/lib/format";
import { useDeliveryLog } from "@/market/keylevels/deliveryLog";
import { useSignalArchive } from "@/market/signalArchive";
import { Badge, type BadgeTone } from "@/primitives/Badge";
import { Card } from "@/primitives/Card";
import { EmptyState } from "@/primitives/EmptyState";
import { stamp } from "@/views/coach/signalUi";
import { KV } from "@/views/coach/ui";
import type { ReportPage } from "./hooks";

export const BENEFIT_STRINGS = {
  title: "Was hat dir das Journal diesen Monat gebracht?",
  note: "Nur gezählt, was protokolliert ist – keine Schätzung, keine Geldbeträge.",
  emptyTitle: "Für diesen Monat ist nichts protokolliert",
  emptyText: "Weder Trades noch Alarme, Check-ins oder Experimente. Sobald es etwas gibt, steht es hier – gezählt, nicht gedeutet.",
} as const;

const STATUS_TONE: Readonly<Record<BenefitExperiment["status"], BadgeTone>> = { erfüllt: "win", "nicht erfüllt": "loss", "zu wenig Daten": "mute", läuft: "steel" };

/** „n von m“ with the share, `–` without a base. */
const share = (k: number, n: number): string => (n > 0 ? `${k} von ${n} (${pct0(k / n)})` : "–");

function Block({ title, children, testId }: { title: string; children: React.ReactNode; testId: string }) {
  return (
    <section className="grid content-start gap-1" aria-label={title} data-testid={testId}>
      <h3 className="text-[10px] font-semibold uppercase tracking-[0.1em] text-mute">{title}</h3>
      {children}
    </section>
  );
}

const Gap = ({ children }: { children: React.ReactNode }) => <p className="mt-1 text-[11px] leading-snug text-warn">{children}</p>;

function Figures({ b }: { b: MonthBenefit }) {
  const a = b.alerts;
  return (
    <div className="grid gap-x-8 gap-y-5 md:grid-cols-2">
      <Block title="Geprüfte Einstiege" testId="benefit-entries">
        <KV label="Trades im Monat" value={b.trades} />
        <KV label="Mit Einstiegs-Check zum Zeitpunkt des Eintrags" value={share(b.entries.checked, b.trades)} />
        <KV label="Mit Box-zu-Box-Kontext" value={share(b.entries.boxContext, b.trades)} />
      </Block>
      <Block title="Alarme" testId="benefit-alerts">
        <KV label="Einstiegs-Signale festgehalten" value={a.signals} />
        <KV label="Weitere Ereignisse (Ausbrüche, Ziele …)" value={a.context} />
        <KV label="Meldungen gesendet (Zustellprotokoll)" value={`${a.sent} (Check ${a.sentSignal} · Box ${a.sentBox} · Marken ${a.sentKey})`} />
        {!a.archive.complete && <Gap>{a.archive.oldest == null ? "Das Signalarchiv ist leer – es hat in diesem Zeitraum nichts festgehalten (nicht: nichts ist passiert)." : `Das Signalarchiv reicht nur bis ${stamp(a.archive.oldest)} zurück – davor fehlt es.`}</Gap>}
        {!a.log.complete && a.log.oldest != null && <Gap>Das Zustellprotokoll (die letzten 200 Zeilen) reicht nur bis {stamp(a.log.oldest)} zurück.</Gap>}
      </Block>
      <Block title="Regeln" testId="benefit-rules">
        <KV label="Checkliste vollständig" value={share(b.rules.checklistComplete, b.rules.checklistTrades)} />
        <KV label="Checkliste unvollständig" value={b.rules.checklistIncomplete} tone={b.rules.checklistIncomplete > 0 ? "warn" : "fg"} />
        <KV label="Protokollierte Regelverstöße" value={b.rules.violations} tone={b.rules.violations > 0 ? "loss" : "fg"} />
        <KV label="Plan befolgt" value={share(b.rules.planFollowed, b.rules.planTrades)} />
      </Block>
      <Block title="Verlustlimit" testId="benefit-limits">
        <KV label="Tage über dem Tageslimit" value={b.limits.dayBreaches} tone={b.limits.dayBreaches > 0 ? "loss" : "fg"} />
        <KV label="Trades über dem Limit pro Trade" value={b.limits.overLimit} tone={b.limits.overLimit > 0 ? "loss" : "fg"} />
      </Block>
      <Block title="Reviews und Check-ins" testId="benefit-review">
        <KV label="Trades mit Review" value={share(b.review.reviewed, b.review.trades)} />
        <KV label="Tage mit Check-in" value={b.checkins.days} />
      </Block>
      <Block title="Experimente" testId="benefit-experiments">
        {b.experiments.items.length === 0 ? (
          <p className="text-[12.5px] leading-relaxed text-mute">Kein angenommenes Wochenexperiment in diesem Monat.</p>
        ) : (
          <>
            <KV label="Erfüllt · nicht erfüllt · zu wenig Daten · läuft" value={`${b.experiments.met} · ${b.experiments.missed} · ${b.experiments.thin} · ${b.experiments.running}`} />
            <ul className="mt-1 grid gap-1.5">
              {b.experiments.items.map((x) => (
                <li key={x.id} className="grid gap-0.5" data-testid="benefit-experiment" data-status={x.status}>
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                    <Badge tone={STATUS_TONE[x.status]}>{x.status}</Badge>
                    <span className="min-w-0 text-[12.5px] text-fg">{x.title}</span>
                    <span className="num font-mono text-[11px] text-faint">{x.week}</span>
                  </div>
                  <p className="text-[11px] leading-snug text-faint">{x.text}</p>
                </li>
              ))}
            </ul>
          </>
        )}
      </Block>
    </div>
  );
}

export function MonthBenefitCard({ page, className }: { page: ReportPage; className?: string }) {
  const signals = useSignalArchive();
  const log = useDeliveryLog();
  const { report, settings, events, days, now } = page;
  const list = page.view.list;
  const b = useMemo(() => monthBenefit({ report, list, settings, events, days, signals, log, now }), [report, list, settings, events, days, signals, log, now]);
  const title = report.period.to > now && report.period.from <= now ? BENEFIT_STRINGS.title : `Was hat dir das Journal im ${report.period.label} gebracht?`;
  return (
    <Card title={title} note={BENEFIT_STRINGS.note} className={className} data-testid="benefit-card" data-empty={b.empty} innerClassName="grid content-start gap-4">
      {b.empty ? <EmptyState title={BENEFIT_STRINGS.emptyTitle} text={BENEFIT_STRINGS.emptyText} line={false} /> : <Figures b={b} />}
      <div className={cn("grid gap-1.5 border-t border-line pt-3 text-[11.5px] leading-relaxed text-faint")} data-testid="benefit-limits-text">
        {BENEFIT_LIMITS.map((t) => (
          <p key={t}>{t}</p>
        ))}
      </div>
    </Card>
  );
}
