/**
 * Wochenreview and Wochenexperiment (F37), the two cards of the weekly report.
 *
 * `WeekReviewCard`: four findings – Ergebnis nach Kosten, Setups, Disziplin, Unsicherheit – each with its numbers and the
 * trades behind it (a button opens them as rows → trade detail). Observations with their sample, never a cause.
 *
 * `ExperimentCard`: (1) the experiment the trader accepted for THIS week, read automatically against the journal
 * (erfüllt / nicht erfüllt / zu wenig Daten / läuft) with the trades that count against the target, and (2) ONE
 * hypothesis for the NEXT week out of the coach's improvement plan – with the target value, the minimum sample, the
 * assumption behind it (labelled as one) and the evidence trades. Nothing is taken over automatically: the trader
 * accepts or declines, and can withdraw either.
 */
import { useMemo, useState } from "react";
import { accountView } from "@/domain/account";
import {
  evaluateExperiment,
  experimentForWeek,
  experimentStateOf,
  proposeExperiment,
  shiftPeriod,
  targetText,
  valueText,
  weekReview,
  withExperiment,
  withExperimentDeclined,
  withoutExperiment,
  measureNoun,
  type EvidenceGroup,
  type Experiment,
  type ExperimentResult,
  type ExperimentStatus,
  type ReviewFinding,
  type ReviewTone,
} from "@/domain/reports";
import type { EnrichedTrade } from "@/domain/types";
import { cn } from "@/lib/cn";
import { Badge, type BadgeTone } from "@/primitives/Badge";
import { Button } from "@/primitives/Button";
import { Card } from "@/primitives/Card";
import { useJournal } from "@/store/journalStore";
import { pushToast } from "@/store/uiStore";
import { analyse } from "@/views/coach/hooks";
import { KV, SampleLine } from "@/views/coach/ui";
import { TradeList } from "@/views/insights/ui";
import type { ReportPage } from "./hooks";

const TONE_CLASS: Readonly<Record<ReviewTone, string>> = { win: "text-win", loss: "text-loss", fg: "text-fg", mute: "text-mute" };
const STATUS_TONE: Readonly<Record<ExperimentStatus, BadgeTone>> = { erfüllt: "win", "nicht erfüllt": "loss", "zu wenig Daten": "mute", läuft: "warn" };

/** A button that opens the trades of an evidence group as rows. */
function EvidenceToggle({ g, byId, id }: { g: EvidenceGroup; byId: ReadonlyMap<string, EnrichedTrade>; id: string }) {
  const [open, setOpen] = useState(false);
  const trades = g.ids.map((x) => byId.get(x)).filter((t): t is EnrichedTrade => !!t);
  if (!trades.length) return null;
  return (
    <div className="grid gap-1.5">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        data-testid="review-evidence-toggle"
        className="touch-hit flex min-h-9 w-fit items-center gap-1.5 rounded-full border border-line-2 px-3 py-1 text-[11.5px] text-mute transition-colors hover:border-steel/40 hover:text-fg"
      >
        <span>
          {g.label} · {g.total} Trade{g.total === 1 ? "" : "s"} {open ? "ausblenden" : "öffnen"}
        </span>
      </button>
      {open && <TradeList trades={trades} group={`review-${id}`} max={REVIEW_ROWS} />}
    </div>
  );
}
const REVIEW_ROWS = 6;

function Finding({ f, byId }: { f: ReviewFinding; byId: ReadonlyMap<string, EnrichedTrade> }) {
  return (
    <li className="grid gap-2 rounded-xl border border-line bg-ink-950/50 px-3 py-3" data-testid="review-finding" data-finding={f.id}>
      <div className="flex min-w-0 flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <span className="text-[10px] font-semibold uppercase tracking-[0.1em] text-mute">{f.title}</span>
        <SampleLine n={f.n} />
      </div>
      <p className={cn("text-[13.5px] leading-snug", TONE_CLASS[f.tone])}>{f.headline}</p>
      <div className="grid gap-1 text-[12px] leading-relaxed text-mute">
        {f.lines.map((l, i) => (
          <p key={i}>{l}</p>
        ))}
      </div>
      {f.evidence.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {f.evidence.map((g) => (
            <EvidenceToggle key={g.label} g={g} byId={byId} id={`${f.id}-${g.label}`} />
          ))}
        </div>
      )}
    </li>
  );
}

export function WeekReviewCard({ page, className }: { page: ReportPage; className?: string }) {
  const { report, events, settings, enriched } = page;
  const review = useMemo(() => weekReview({ report, events, settings }), [report, events, settings]);
  const byId = useMemo(() => new Map(enriched.map((t) => [t.id, t])), [enriched]);
  return (
    <Card title="Wochenreview" note="Ergebnis nach Kosten, Setups, Disziplin – und wie sicher das alles ist." className={className} data-testid="week-review" data-level={review.level} innerClassName="grid content-start gap-3">
      {review.findings.length === 0 ? (
        <p className="text-[12.5px] leading-relaxed text-mute">Keine abgeschlossenen Trades in dieser Woche – es gibt nichts zu bewerten.</p>
      ) : (
        <ul className="grid gap-3" aria-label="Befunde der Woche">
          {review.findings.map((f) => (
            <Finding key={f.id} f={f} byId={byId} />
          ))}
        </ul>
      )}
    </Card>
  );
}

/* ------------------------------------------------------------------ experiment */

function ResultBlock({ e, r, byId }: { e: Experiment; r: ExperimentResult; byId: ReadonlyMap<string, EnrichedTrade> }) {
  const flagged = r.flagged.filter((t) => byId.has(t.id));
  return (
    <div className="grid gap-2" data-testid="experiment-result" data-status={r.status}>
      <div className="flex flex-wrap items-center gap-2">
        <span data-testid="experiment-status">
          <Badge tone={STATUS_TONE[r.status]} dot>
            {r.status}
          </Badge>
        </span>
        <span className="min-w-0 text-[13px] text-fg">{e.title}</span>
      </div>
      <p className="text-[12px] leading-relaxed text-mute">{e.hypothesis}</p>
      <div className="grid">
        <KV label="Sollwert" value={`${measureNoun(e.measure)}: ${targetText(e)}`} />
        <KV label="Ist" value={valueText(e.measure, r.actual, r.n)} tone={r.status === "erfüllt" ? "win" : r.status === "nicht erfüllt" ? "loss" : "mute"} />
        <KV label="Stichprobe" value={<SampleLine n={r.n} minN={r.minTrades} />} />
      </div>
      <p className="text-[12px] leading-relaxed text-mute" data-testid="experiment-text">
        {r.text}
      </p>
      {flagged.length > 0 && (
        <div className="grid gap-1">
          <span className="text-[10px] font-semibold uppercase tracking-[0.1em] text-faint">{e.measure.kind === "journalRate" ? "Trades ohne Review" : "Trades, die gegen das Ziel zählen"}</span>
          <TradeList trades={flagged} group={`experiment-${e.id}`} max={6} />
        </div>
      )}
    </div>
  );
}

export function ExperimentCard({ page, className }: { page: ReportPage; className?: string }) {
  const { report, period, settings, enriched, events, days, view, acc, now } = page;
  const saveSettings = useJournal((s) => s.saveSettings);
  const [busy, setBusy] = useState(false);
  const byId = useMemo(() => new Map(enriched.map((t) => [t.id, t])), [enriched]);

  const mine = experimentForWeek(settings, period.key);
  const mineList = useMemo(() => (mine ? accountView(enriched, settings, mine.acc, { now: () => now }).list : []), [mine, enriched, settings, now]);
  const result = useMemo(() => (mine ? evaluateExperiment(mine, { list: mineList, settings, events, now }) : null), [mine, mineList, settings, events, now]);

  const nextWeek = shiftPeriod(period, 1);
  // a hypothesis for a week that is not over yet – the running week or the next one
  const open = period.kind === "week" && nextWeek.to > now && !report.empty;
  const accepted = experimentForWeek(settings, nextWeek.key);
  const proposal = useMemo(() => {
    if (!open || accepted) return null;
    const a = analyse(view, settings, events, days, Math.floor(now / 3_600_000) * 3_600_000 + 1);
    return proposeExperiment({ recs: a.recs, settings, events, list: view.list, acc, sourceWeek: period });
  }, [open, accepted, view, settings, events, days, now, acc, period]);
  const declined = !!proposal?.declined;

  if (period.kind !== "week") return null;
  if (!mine && !open) return null;

  const run = async (fn: () => Promise<void>, ok: { title: string; detail: string }) => {
    if (busy) return;
    setBusy(true);
    try {
      await fn();
      pushToast({ kind: "success", ...ok });
    } catch {
      pushToast({ kind: "error", title: "Nicht gespeichert", detail: "Bitte noch einmal versuchen." });
    } finally {
      setBusy(false);
    }
  };
  const accept = () => {
    if (!proposal) return;
    void run(() => saveSettings(withExperiment(settings, { ...proposal.experiment, acceptedAt: new Date().toISOString() })), { title: "Experiment angenommen", detail: `Der Bericht der Woche ${nextWeek.short} prüft es automatisch.` });
  };
  const decline = () => {
    if (!proposal) return;
    void run(() => saveSettings(withExperimentDeclined(settings, proposal.experiment.id)), { title: "Vorschlag abgelehnt", detail: "Er kommt für diese Woche nicht wieder." });
  };
  const undo = (id: string, detail: string) => void run(() => saveSettings(withoutExperiment(settings, id)), { title: "Zurückgenommen", detail });

  const evidence = (ids: readonly string[]): EnrichedTrade[] => ids.map((x) => byId.get(x)).filter((t): t is EnrichedTrade => !!t);
  const stateCount = experimentStateOf(settings).experiments.length;
  return (
    <Card title="Wochenexperiment" note="Eine prüfbare Hypothese. Du nimmst sie an oder lehnst sie ab – nichts passiert automatisch." className={className} data-testid="week-experiment" data-count={stateCount} innerClassName="grid content-start gap-4">
      {mine && result && (
        <section className="grid gap-2" aria-label="Experiment dieser Woche">
          <h3 className="text-[10px] font-semibold uppercase tracking-[0.1em] text-mute">Experiment dieser Woche</h3>
          <ResultBlock e={mine} r={result} byId={byId} />
        </section>
      )}

      {open && (
        <section className={cn("grid gap-2", mine && "border-t border-line pt-4")} aria-label="Hypothese für die nächste Woche" data-testid="experiment-next">
          <h3 className="text-[10px] font-semibold uppercase tracking-[0.1em] text-mute">Für nächste Woche · {nextWeek.short}</h3>
          {accepted ? (
            <div className="grid gap-2" data-testid="experiment-accepted">
              <Badge tone="steel" dot className="w-fit">
                angenommen
              </Badge>
              <p className="text-[13px] text-fg">{accepted.title}</p>
              <p className="text-[12px] leading-relaxed text-mute">{accepted.hypothesis}</p>
              <KV label="Sollwert" value={`${measureNoun(accepted.measure)}: ${targetText(accepted)}`} />
              <KV label="Mindeststichprobe" value={`${accepted.minTrades} Trades`} />
              <div className="flex flex-wrap gap-2">
                <Button variant="ghost" size="sm" disabled={busy} onClick={() => undo(accepted.id, "Das Experiment ist wieder offen.")} data-testid="experiment-withdraw">
                  Zurückziehen
                </Button>
              </div>
            </div>
          ) : !proposal ? (
            <p className="text-[12.5px] leading-relaxed text-mute" data-testid="experiment-none">
              Kein Vorschlag: Der Plan des Coachs enthält noch nichts, das sich in einer Woche messen lässt. Dafür braucht es Muster mit genug Belegen (Verhalten, Journal, ein wiederkehrend teures Setup) – „Fokus“-Empfehlungen haben keinen natürlichen Sollwert.
            </p>
          ) : (
            <div className="grid gap-2.5" data-testid="experiment-proposal" data-declined={declined ? "1" : "0"}>
              <p className="text-[13.5px] leading-snug text-fg">{proposal.experiment.title}</p>
              <p className="text-[12px] leading-relaxed text-mute">Hypothese: {proposal.experiment.hypothesis}</p>
              <p className="rounded-xl border border-line bg-ink-950/50 px-3 py-2 text-[12.5px] leading-snug text-fg" data-testid="experiment-target">
                {proposal.target}
              </p>
              <p className="text-[11.5px] leading-relaxed text-faint">
                In dieser Woche ({period.short}): {proposal.experiment.baseline.value == null ? "nicht messbar" : valueText(proposal.experiment.measure, proposal.experiment.baseline.value, proposal.experiment.baseline.n)}. Ein Urteil gibt es erst ab {proposal.experiment.minTrades} Trades in der Woche – darunter heißt es „zu wenig Daten“.
              </p>
              <p className="text-[11.5px] leading-relaxed text-faint">Annahme dahinter, in einer Woche nicht prüfbar: {proposal.experiment.why}</p>
              {proposal.skipped > 0 && <p className="text-[11.5px] text-faint">{proposal.skipped === 1 ? "Eine stärkere Empfehlung hat" : `${proposal.skipped} stärkere Empfehlungen haben`} keinen messbaren Sollwert und wurde übersprungen.</p>}
              {evidence(proposal.experiment.evidence).length > 0 && (
                <div className="grid gap-1">
                  <span className="text-[10px] font-semibold uppercase tracking-[0.1em] text-faint">Belege aus dem Journal</span>
                  <TradeList trades={evidence(proposal.experiment.evidence)} group="experiment-evidence" max={4} />
                </div>
              )}
              {declined ? (
                <div className="flex flex-wrap items-center gap-2">
                  <Badge tone="mute">abgelehnt</Badge>
                  <Button variant="ghost" size="sm" disabled={busy} onClick={() => undo(proposal.experiment.id, "Der Vorschlag ist wieder offen.")} data-testid="experiment-undecline">
                    Wieder öffnen
                  </Button>
                </div>
              ) : (
                <div className="flex flex-wrap gap-2">
                  <Button variant="primary" disabled={busy} onClick={accept} data-testid="experiment-accept">
                    Experiment annehmen
                  </Button>
                  <Button variant="ghost" disabled={busy} onClick={decline} data-testid="experiment-decline">
                    Ablehnen
                  </Button>
                </div>
              )}
            </div>
          )}
        </section>
      )}
    </Card>
  );
}
