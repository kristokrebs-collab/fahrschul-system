/**
 * „Verpasste Chancen“ (F32): signals the app raised (valid entry of the Einstiegs-Check, Box-zu-Box setup, confirmed own
 * key level) that the journal holds NO trade for – „regelgerecht, nicht gehandelt“ – listed with the actions „Im Labor
 * testen“ („Diese Idee testen“ where the source can be translated, else the Labor page) and „Beobachten“.
 *
 * Each signal carries its OUTCOME, evaluated automatically (`signalAuto.ts`: quietly, in idle moments, from the cached or loaded
 * real candles; „Neu berechnen“ reads again at once): the real candles after the signal decide Ziel zuerst / Stopp zuerst / noch
 * offen / nicht auswertbar (`@/domain/missed/outcome`; same candle → the stop counts, disclosed). From 20 missed signals with an
 * outcome the traits of the missed winners are set against the missed losers – always with counterexamples and the sample, never
 * with a cause (`@/domain/missed/traits`).
 *
 * Honest about the data: the archive starts empty (signals were only toast text before) and fills from now on, on this
 * device, while the app is open. Whether a signal was skipped on purpose or overlooked is not known to the journal either –
 * the inbox lets the trader say so.
 */
import { useMemo, useState } from "react";
import { compareTraits, matchSignals, MISSED_WINDOW_MS, SIGNAL_ARCHIVE_CAP, SIGNAL_ARCHIVE_DAYS, SKIP_LABEL, SOURCE_LABEL, TRAIT_DIM_LABEL, TRAIT_MIN_DECIDED, type SignalRow, type TraitReport, type TraitRow } from "@/domain/missed";
import type { EnrichedTrade } from "@/domain/types";
import { cn } from "@/lib/cn";
import { pct0 } from "@/lib/format";
import { setSignalWatched, useSignalArchive } from "@/market/signalArchive";
import { Badge } from "@/primitives/Badge";
import { ArchiveBasis } from "./BasisLine";
import { Button } from "@/primitives/Button";
import { Card } from "@/primitives/Card";
import { EmptyState } from "@/primitives/EmptyState";
import { navigate } from "@/store/router";
import { TestIdeaButton } from "@/views/labor/TestIdeaButton";
import { useOutcomeState } from "./signalOutcomes";
import { ideaInputOf, OUTCOME_STRINGS, OutcomeBadge, OutcomeControl, stamp, useOutcomes } from "./signalUi";
import { KV, SampleLine } from "./ui";

export const MISSED_STRINGS = {
  title: "Verpasste Chancen",
  note: "Signale der App, zu denen dein Journal keinen Trade hat – regelgerecht, nicht gehandelt.",
  emptyTitle: "Noch keine Signale gespeichert",
  emptyText: `Die App speichert ab jetzt jedes Signal, das sie auslöst – mit Zeit, Markt, Richtung und Quelle, nur auf diesem Gerät (die letzten ${SIGNAL_ARCHIVE_CAP}, höchstens ${SIGNAL_ARCHIVE_DAYS} Tage) und nur solange die App offen ist. Vergangenes lässt sich nicht nachtragen.`,
  noJournal: "Ohne Trades im Journal gibt es nichts, womit sich die Signale vergleichen ließen.",
  noMissed: "Zu jedem abgeschlossenen Signal gibt es einen Trade in gleicher Richtung – oder es ist noch offen.",
  limits: `Gehandelt heißt: ein Trade gleicher Richtung auf demselben Markt, von 30 Minuten vor bis ${MISSED_WINDOW_MS / 3_600_000} Stunden nach dem Signal. Ob du ein Signal bewusst ausgelassen oder übersehen hast, weiß das Journal nicht.`,
  counter: `Ob ein verpasstes Signal gut gewesen wäre, zeigt nur sein Ausgang am Kurs (er wird automatisch ausgewertet) – und auch der beschreibt dieses eine Signal, keine Ursache. Gemeinsame Merkmale der verpassten Gewinner werden erst ab ${TRAIT_MIN_DECIDED} verpassten Signalen mit Ausgang gegen die verpassten Verlierer gestellt, immer mit Gegenbeispielen und der Stichprobe; keine Ursache, keine Handlungsempfehlung.`,
  watchHint: "Markiert. Der Ausgang steht am Signal, sobald er ausgewertet ist – die Markierung hält den Fall fest.",
  traitsTitle: "Verpasste Gewinner und Verlierer im Vergleich",
  traitsNote: "Quote = Anteil der verpassten Signale mit diesem Merkmal, bei denen das Ziel zuerst kam (80 %-Intervall). „Sticht heraus“ heißt nur: das ganze Intervall liegt auf einer Seite der Gesamtquote – bei so vielen Merkmalen geschieht das auch zufällig.",
} as const;

const SHOWN = 6;
/** Long values wrap under their label on a phone instead of running out of the card. */
const KV_STACK = "max-sm:flex-col max-sm:items-start max-sm:gap-0.5";

function Row({ r, now }: { r: SignalRow; now: number }) {
  const e = r.event;
  const idea = ideaInputOf(e);
  const outcome = useOutcomeState().outcomes.get(e.id);
  return (
    <li className="grid gap-2 rounded-xl border border-line bg-ink-950/50 px-3 py-2.5" data-testid="missed-row" data-source={e.source} data-side={e.side ?? ""}>
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <span className="num font-mono text-[11.5px] text-faint">{stamp(e.at)}</span>
        <span className={cn("text-[11px] font-semibold uppercase tracking-wide", e.side === "short" ? "text-loss" : "text-win")}>{e.side === "short" ? "▼ Short" : "▲ Long"}</span>
        <Badge tone="mute">{SOURCE_LABEL[e.source]}</Badge>
        {(e.symbol || e.tf) && <span className="num font-mono text-[11.5px] text-mute">{[e.symbol, e.tf].filter(Boolean).join(" · ")}</span>}
        {e.watch && <Badge tone="steel">beobachtet</Badge>}
        {e.skip && <Badge tone="warn">ausgelassen: {SKIP_LABEL[e.skip]}</Badge>}
      </div>
      <p className="text-[12.5px] leading-snug text-fg">{e.label}</p>
      {e.detail && <p className="text-[11.5px] leading-snug text-mute">{e.detail}</p>}
      <OutcomeBadge o={outcome} event={e} now={now} />
      <div className="flex flex-wrap items-center gap-2">
        {idea ? (
          <TestIdeaButton input={idea} size="sm" label="Im Labor testen" testId="missed-test" />
        ) : (
          <Button size="sm" variant="secondary" onClick={() => navigate("labor")} data-testid="missed-test" title="Öffnet das Labor – für diese Quelle gibt es keinen Regelentwurf">
            Im Labor testen
          </Button>
        )}
        <Button size="sm" variant="secondary" aria-pressed={e.watch} onClick={() => setSignalWatched(e.id, !e.watch)} data-testid="missed-watch">
          {e.watch ? "Nicht mehr beobachten" : "Beobachten"}
        </Button>
      </div>
      {e.watch && <p className="text-[11px] text-faint">{MISSED_STRINGS.watchHint}</p>}
    </li>
  );
}

const rateText = (t: TraitRow): string => `${pct0(t.rate)} (${pct0(t.lo)} … ${pct0(t.hi)})`;

/** The missed winners set against the missed losers: only with a sample, always with counterexamples. */
function TraitSection({ rep }: { rep: TraitReport }) {
  return (
    <div className="grid gap-2 border-t border-line pt-3" data-testid="missed-traits" data-enough={rep.enough}>
      <div className="flex items-baseline justify-between gap-3">
        <h3 className="text-[10px] font-semibold uppercase tracking-[0.1em] text-mute">{MISSED_STRINGS.traitsTitle}</h3>
        <SampleLine n={rep.decided} minN={TRAIT_MIN_DECIDED} />
      </div>
      {!rep.enough ? (
        <p className="text-[12px] leading-relaxed text-mute" data-testid="missed-traits-blocked">
          {rep.blocked}
        </p>
      ) : (
        <>
          <p className="num font-mono text-[11px] text-faint">
            {rep.winners} verpasste Gewinner · {rep.losers} verpasste Verlierer · Gesamtquote {rep.overall == null ? "–" : pct0(rep.overall)}
          </p>
          <ul className="grid gap-2" aria-label="Merkmale im Vergleich">
            {rep.rows.map((t) => (
              <li key={`${t.dim}|${t.value}`} className="grid gap-1 rounded-xl border border-line bg-ink-950/50 px-3 py-2" data-testid="missed-trait" data-stands={t.stands ?? ""}>
                <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
                  <span className="text-[12.5px] text-fg">
                    <span className="text-faint">{TRAIT_DIM_LABEL[t.dim]}: </span>
                    {t.value}
                  </span>
                  <span className="num font-mono text-[11.5px] text-mute">
                    {t.winners} Gewinner · {t.losers} Verlierer
                  </span>
                </div>
                <p className="num font-mono text-[10.5px] text-faint">
                  Quote {rateText(t)}
                  {t.stands ? ` · sticht heraus (${t.stands === "higher" ? "darüber" : "darunter"})` : ""}
                </p>
                {t.counter.length > 0 && (
                  <ul className="grid gap-0.5" aria-label="Gegenbeispiele">
                    {t.counter.map((c) => (
                      <li key={c.id} className="text-[11px] leading-snug text-faint" data-testid="missed-counterexample">
                        Gegenbeispiel: {stamp(c.at)} · {c.symbol || "–"} {c.side === "short" ? "Short" : "Long"} – {t.rate >= (rep.overall ?? 0) ? "Stopp zuerst" : "Ziel zuerst"}
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            ))}
          </ul>
          <p className="text-[11px] leading-snug text-faint">{MISSED_STRINGS.traitsNote}</p>
        </>
      )}
    </div>
  );
}

export function MissedCard({ list, now, className }: { list: readonly EnrichedTrade[]; now: number; className?: string }) {
  const events = useSignalArchive();
  const o = useOutcomes(events);
  const [all, setAll] = useState(false);
  const rep = useMemo(() => matchSignals(events, list, now), [events, list, now]);
  const traits = useMemo(() => compareTraits(rep.missed.map((r) => r.event), o.outcomes), [rep.missed, o.outcomes]);
  const hasTrades = list.length > 0;
  const shown = all ? rep.missed : rep.missed.slice(0, SHOWN);
  return (
    <Card title={MISSED_STRINGS.title} note={MISSED_STRINGS.note} className={className} data-testid="missed-card" data-total={rep.total} data-missed={rep.missed.length} innerClassName="grid content-start gap-4">
      {rep.total === 0 ? (
        <EmptyState title={MISSED_STRINGS.emptyTitle} text={MISSED_STRINGS.emptyText} line={false} />
      ) : (
        <>
          <div className="grid">
            <KV label="Im Archiv seit" value={rep.since ? stamp(rep.since) : "–"} />
            <KV className={KV_STACK} label="Einstiegs-Signale" value={`${rep.rows.length} (${rep.traded.length} gehandelt · ${rep.missed.length} nicht gehandelt · ${rep.open.length} offen)`} />
            <KV className={KV_STACK} label="Weitere Ereignisse" value={`${rep.context} (Ausbrüche, Ziele … – keine Einstiege)`} />
          </div>
          {rep.rows.length > 0 && <OutcomeControl events={events} />}
          {!hasTrades ? (
            <p className="text-[12.5px] leading-relaxed text-mute">{MISSED_STRINGS.noJournal}</p>
          ) : rep.missed.length === 0 ? (
            <p className="text-[12.5px] leading-relaxed text-mute" data-testid="missed-none">
              {MISSED_STRINGS.noMissed}
            </p>
          ) : (
            <div className="grid gap-2">
              <div className="flex items-baseline justify-between gap-3">
                <h3 className="text-[10px] font-semibold uppercase tracking-[0.1em] text-mute">Regelgerecht, nicht gehandelt</h3>
                <SampleLine n={rep.missed.length} minN={rep.rows.length - rep.open.length} />
              </div>
              <ul className="grid gap-2" aria-label="Verpasste Signale">
                {shown.map((r) => (
                  <Row key={r.event.id} r={r} now={now} />
                ))}
              </ul>
              {rep.missed.length > SHOWN && (
                <button type="button" onClick={() => setAll((v) => !v)} className="touch-hit w-fit text-[12px] text-mute underline decoration-line-2 underline-offset-4 hover:text-fg">
                  {all ? "Weniger anzeigen" : `Alle ${rep.missed.length} anzeigen`}
                </button>
              )}
            </div>
          )}
          {hasTrades && rep.missed.length > 0 && <TraitSection rep={traits} />}
        </>
      )}
      <div className="grid gap-1.5 border-t border-line pt-3 text-[11.5px] leading-relaxed text-faint" data-testid="missed-limits">
        <p>{MISSED_STRINGS.limits}</p>
        <p data-testid="missed-counter">
          {MISSED_STRINGS.counter}
          {rep.missed.length > 0 ? ` Stichprobe: ${rep.missed.length} verpasste, ${rep.traded.length} gehandelte Signale.` : ""}
        </p>
        {rep.rows.length > 0 && <p>{OUTCOME_STRINGS.rules}</p>}
        <ArchiveBasis events={events} testId="missed-basis" />
      </div>
    </Card>
  );
}
