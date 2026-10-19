/**
 * „Verpasste Chancen“ (F32): signals the app raised (valid entry of the Einstiegs-Check, Box-zu-Box setup, confirmed own
 * key level) that the journal holds NO trade for – „regelgerecht, nicht gehandelt“ – listed with the actions „Im Labor
 * testen“ (opens the Labor page; a rule draft from a signal does not exist yet) and „Beobachten“ (a mark on the event).
 *
 * Honest about the data: the archive starts empty (signals were only toast text before) and fills from now on, on this
 * device, while the app is open. A missed signal has no recorded outcome (the price path after it is not stored), so the
 * recurring traits of the missed cases are NOT set against comparable failures here – the card says what would have to be
 * stored for that, names the sample, and claims no cause. Whether a signal was skipped on purpose or overlooked is not
 * known to the journal either.
 */
import { useMemo, useState } from "react";
import { matchSignals, MISSED_WINDOW_MS, SIGNAL_ARCHIVE_CAP, SIGNAL_ARCHIVE_DAYS, SOURCE_LABEL, type SignalRow } from "@/domain/missed";
import type { EnrichedTrade } from "@/domain/types";
import { cn } from "@/lib/cn";
import { date as fmtDate, time as fmtTime } from "@/lib/format";
import { setSignalWatched, useSignalArchive } from "@/market/signalArchive";
import { Badge } from "@/primitives/Badge";
import { Button } from "@/primitives/Button";
import { Card } from "@/primitives/Card";
import { EmptyState } from "@/primitives/EmptyState";
import { navigate } from "@/store/router";
import { KV, SampleLine } from "./ui";

export const MISSED_STRINGS = {
  title: "Verpasste Chancen",
  note: "Signale der App, zu denen dein Journal keinen Trade hat – regelgerecht, nicht gehandelt.",
  emptyTitle: "Noch keine Signale gespeichert",
  emptyText: `Bisher stand ein Signal nur als Meldung auf dem Bildschirm – nichts davon wurde festgehalten, also lässt sich Vergangenes nicht nachtragen. Ab jetzt speichert die App jedes Signal, das sie auslöst (gültiger Einstieg, Box-Setup, bestätigte Schlüsselmarke) mit Zeit, Markt, Richtung und Quelle – nur auf diesem Gerät, die letzten ${SIGNAL_ARCHIVE_CAP}, höchstens ${SIGNAL_ARCHIVE_DAYS} Tage, und nur solange die App offen ist.`,
  noJournal: "Ohne Trades im Journal gibt es nichts, womit sich die Signale vergleichen ließen.",
  noMissed: "Zu jedem abgeschlossenen Signal gibt es einen Trade in gleicher Richtung – oder es ist noch offen.",
  limits: `Gehandelt heißt: ein Trade gleicher Richtung auf demselben Markt, von 30 Minuten vor bis ${MISSED_WINDOW_MS / 3_600_000} Stunden nach dem Signal. Ob du ein Signal bewusst ausgelassen oder übersehen hast, weiß das Journal nicht.`,
  counter: "Gemeinsame Merkmale der verpassten Signale werden hier nicht ausgewertet: Dafür müsste zu jedem Signal sein Ausgang gespeichert sein (Kursverlauf bis Ziel oder Stop), um sie gegen vergleichbare Fehlsignale zu stellen – das fehlt, denn gespeichert wird nur das Ereignis. Solange gilt: keine Aussage darüber, ob die verpassten Signale gut gewesen wären, und keine Ursache.",
  watchHint: "Markiert. Der Ausgang wird noch nicht automatisch verfolgt – die Markierung hält den Fall nur fest.",
} as const;

const SHOWN = 6;

function stamp(ms: number): string {
  const d = new Date(ms);
  return `${fmtDate(d)} ${fmtTime(d)}`;
}

function Row({ r }: { r: SignalRow }) {
  const e = r.event;
  return (
    <li className="grid gap-2 rounded-xl border border-line bg-ink-950/50 px-3 py-2.5" data-testid="missed-row" data-source={e.source} data-side={e.side ?? ""}>
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <span className="num font-mono text-[11.5px] text-faint">{stamp(e.at)}</span>
        <span className={cn("text-[11px] font-semibold uppercase tracking-wide", e.side === "short" ? "text-loss" : "text-win")}>{e.side === "short" ? "▼ Short" : "▲ Long"}</span>
        <Badge tone="mute">{SOURCE_LABEL[e.source]}</Badge>
        {(e.symbol || e.tf) && <span className="num font-mono text-[11.5px] text-mute">{[e.symbol, e.tf].filter(Boolean).join(" · ")}</span>}
        {e.watch && <Badge tone="steel">beobachtet</Badge>}
      </div>
      <p className="text-[12.5px] leading-snug text-fg">{e.label}</p>
      {e.detail && <p className="text-[11.5px] leading-snug text-mute">{e.detail}</p>}
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" variant="ghost" onClick={() => navigate("labor")} data-testid="missed-test" title="Öffnet das Labor – ein Regelentwurf aus dem Signal wird noch nicht erzeugt">
          Im Labor testen
        </Button>
        <Button size="sm" variant="ghost" aria-pressed={e.watch} onClick={() => setSignalWatched(e.id, !e.watch)} data-testid="missed-watch">
          {e.watch ? "Nicht mehr beobachten" : "Beobachten"}
        </Button>
      </div>
      {e.watch && <p className="text-[11px] text-faint">{MISSED_STRINGS.watchHint}</p>}
    </li>
  );
}

export function MissedCard({ list, now, className }: { list: readonly EnrichedTrade[]; now: number; className?: string }) {
  const events = useSignalArchive();
  const [all, setAll] = useState(false);
  const rep = useMemo(() => matchSignals(events, list, now), [events, list, now]);
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
            <KV label="Einstiegs-Signale" value={`${rep.rows.length} (${rep.traded.length} gehandelt · ${rep.missed.length} nicht gehandelt · ${rep.open.length} offen)`} />
            <KV label="Weitere Ereignisse" value={`${rep.context} (Ausbrüche, Ziele … – keine Einstiege)`} />
          </div>
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
                  <Row key={r.event.id} r={r} />
                ))}
              </ul>
              {rep.missed.length > SHOWN && (
                <button type="button" onClick={() => setAll((v) => !v)} className="touch-hit w-fit text-[12px] text-mute underline decoration-line-2 underline-offset-4 hover:text-fg">
                  {all ? "Weniger anzeigen" : `Alle ${rep.missed.length} anzeigen`}
                </button>
              )}
            </div>
          )}
        </>
      )}
      <div className="grid gap-1.5 border-t border-line pt-3 text-[11.5px] leading-relaxed text-faint" data-testid="missed-limits">
        <p>{MISSED_STRINGS.limits}</p>
        <p data-testid="missed-counter">
          {MISSED_STRINGS.counter}
          {rep.missed.length > 0 ? ` Stichprobe: ${rep.missed.length} verpasste, ${rep.traded.length} gehandelte Signale.` : ""}
        </p>
      </div>
    </Card>
  );
}
