/**
 * Building blocks of the signal chain cards (F25 Bilanz, F27 Qualität, F28 Posteingang, F32 Verpasste Chancen): the time stamp,
 * filter chips, the outcome badge, the shared outcome control („Wird automatisch ausgewertet.“, status line, „Neu berechnen“)
 * and the translation of an archived event into an input of „Diese Idee testen“.
 */
import { chipClass } from "@/primitives/chip";
import { useEffect } from "react";
import type { BoxSetupLike } from "@/domain/lab/idea";
import type { IdeaInput } from "@/domain/lab/idea";
import type { BoxTf } from "@/domain/boxes";
import type { Strength } from "@/domain/signals/verdict";
import { isDecided, newestClosedBar, outcomeText, type SignalEvent, type SignalOutcome } from "@/domain/missed";
import { cn } from "@/lib/cn";
import { date as fmtDate, time as fmtTime } from "@/lib/format";
import { ddmmHHmm } from "@/market/format";
import type { Source } from "@/market/types";
import { Badge, type BadgeTone } from "@/primitives/Badge";
import { Button } from "@/primitives/Button";
import { SOURCE_LABEL } from "@/ui/SourceStand";
import { requestAutoOutcomes, retainAuto } from "./signalAuto";
import { computeOutcomes, outcomeEvents, primeOutcomes, useOutcomeState } from "./signalOutcomes";

export const stamp = (ms: number): string => {
  const d = new Date(ms);
  return `${fmtDate(d)} ${fmtTime(d)}`;
};

/** Filter chip (`aria-pressed`), 44 px tap area on coarse pointers. */
export function Chip({ on, onClick, children, testId }: { on: boolean; onClick: () => void; children: React.ReactNode; testId?: string }) {
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={onClick}
      data-testid={testId}
      className={chipClass(on, { size: "sm" })}
    >
      {children}
    </button>
  );
}

const OUTCOME_TONE: Readonly<Record<SignalOutcome["kind"], BadgeTone>> = { target: "win", stop: "loss", open: "mute", unusable: "warn" };

/** What stands where the outcome is not there yet – by what is really going on, never a guess at the result. */
function OutcomePending({ event, now }: { event?: SignalEvent; now?: number }) {
  const st = useOutcomeState();
  const fresh = event != null && now != null && newestClosedBar(now) < event.at;
  const text = fresh
    ? OUTCOME_STRINGS.waitCandle
    : st.status === "loading" || st.auto.phase === "running"
      ? OUTCOME_STRINGS.reading
      : st.auto.phase === "queued"
        ? OUTCOME_STRINGS.soon
        : st.auto.phase === "paused"
          ? `Noch nicht ausgewertet – pausiert, ${st.auto.why ?? "die App hält sich zurück"}.`
          : OUTCOME_STRINGS.notYet;
  return (
    <span className="text-[11.5px] text-faint" data-testid="outcome-pending" data-phase={st.auto.phase}>
      {text}
    </span>
  );
}

/** The outcome of one signal as a badge with its plain-language line (`title` carries the marks it was read with). */
export function OutcomeBadge({ o, event, now }: { o: SignalOutcome | undefined; event?: SignalEvent; now?: number }) {
  if (!o) return <OutcomePending event={event} now={now} />;
  const marks = o.entry != null && o.stop != null && o.target != null ? `Einstieg ${o.entry} · Stopp ${o.stop} · Ziel ${o.target}` : undefined;
  return (
    <Badge tone={OUTCOME_TONE[o.kind]} title={marks} className="max-w-full whitespace-normal text-left" >
      <span data-testid="outcome" data-kind={o.kind} data-basis={o.basis ?? ""}>
        {outcomeText(o)}
      </span>
    </Badge>
  );
}

export const OUTCOME_STRINGS = {
  button: "Neu berechnen",
  busy: "Rechne …",
  auto: "Wird automatisch ausgewertet.",
  autoPaused: "Automatische Auswertung pausiert",
  autoRunning: "Gerade läuft ein Lauf im Hintergrund.",
  autoQueued: "Der nächste Lauf wartet auf einen ruhigen Moment.",
  never: "Noch nicht berechnet.",
  notYet: "Noch nicht ausgewertet.",
  soon: "Wird gleich automatisch ausgewertet.",
  reading: "Wird ausgewertet …",
  waitCandle: "Wartet auf die erste volle Kerze nach dem Signal.",
  hint: "Dafür lädt die App im Leerlauf die echten Kerzen nach jedem Signal (nur Marktdaten, nichts aus deinem Journal) und liest daraus, ob Ziel oder Stopp zuerst kam. Ein erreichtes Ziel oder ein erreichter Stopp bleibt gespeichert und wird nie neu geladen; ein offenes Signal wird erst mit neuen Kerzen neu gelesen. „Neu berechnen“ liest offene und nicht auswertbare Signale sofort neu.",
  none: "Keine Einstiegs-Signale, für die ein Ausgang berechnet werden könnte.",
  rules:
    "Gelesen wird ab der ersten Kerze, die nach dem Signal öffnet. Stopp und Ziel sind die Marken des Signals; fehlt eine, gilt das Standardmaß (Stopp 1,5 × ATR, Ziel 2 R) und der Ausgang ist so gekennzeichnet. Liegen Stopp und Ziel in derselben Kerze, zählt der Stopp. Ohne Gebühren, Funding und Schlupf – es ist der Kursverlauf, kein gebuchter Trade.",
} as const;

/** Where the candles of a run came from, in the words of the Quelle line. */
export const outcomeSourceText = (s: Source | null): string => {
  const feed = "Kerzen 15 Minuten";
  if (s === "cache") return `${SOURCE_LABEL.cache} (Binance USDⓈ-M, ${feed})`;
  return `${SOURCE_LABEL[s ?? "binance"]}, ${feed}`;
};

/**
 * The shared outcome state plus the control that recomputes it. Primes from the cache once per archive, and – while a card that
 * shows outcomes is open – asks the automatic evaluation (`signalAuto.ts`) to read what is missing.
 */
export function useOutcomes(events: readonly SignalEvent[]) {
  const st = useOutcomeState();
  useEffect(() => {
    primeOutcomes(events);
    requestAutoOutcomes("page");
  }, [events]);
  useEffect(() => retainAuto(), []);
  const entries = outcomeEvents(events);
  const decided = entries.filter((e) => isDecided(st.outcomes.get(e.id))).length;
  return { ...st, entries: entries.length, decided, run: () => void computeOutcomes(events, Date.now(), { via: "manual" }) };
}

/** „Neu berechnen“ with the automatic status and „Zuletzt berechnet“; shared by the cards that show outcomes (they read the same state). */
export function OutcomeControl({ events, className }: { events: readonly SignalEvent[]; className?: string }) {
  const o = useOutcomes(events);
  if (!o.entries) return null;
  const loading = o.status === "loading";
  const paused = o.auto.phase === "paused";
  return (
    <div className={cn("grid gap-1.5", className)} data-testid="outcome-control" data-status={o.status} data-auto={o.auto.phase}>
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" variant="secondary" onClick={o.run} disabled={loading} data-testid="outcome-run">
          {loading ? OUTCOME_STRINGS.busy : OUTCOME_STRINGS.button}
        </Button>
        <span className="num font-mono text-[11px] text-faint" aria-live="polite">
          {loading && o.progress && o.progress.total > 0 ? `Seite ${Math.min(o.progress.done, o.progress.total)} von ${o.progress.total}` : `${o.decided} von ${o.entries} mit Ausgang`}
        </span>
      </div>
      <p className="text-[11.5px] leading-snug text-mute" data-testid="outcome-auto">
        {paused ? `${OUTCOME_STRINGS.autoPaused}: ${o.auto.why ?? "die App hält sich zurück"}. „${OUTCOME_STRINGS.button}“ rechnet trotzdem.` : OUTCOME_STRINGS.auto}
        {!paused && loading && o.via === "auto" ? ` ${OUTCOME_STRINGS.autoRunning}` : ""}
        {!paused && !loading && o.auto.phase === "queued" ? ` ${OUTCOME_STRINGS.autoQueued}` : ""}
      </p>
      <p className="num text-[11px] leading-snug text-faint" data-testid="outcome-stand">
        {o.at != null ? `Zuletzt berechnet: ${ddmmHHmm(o.at)}${o.via === "auto" ? " (automatisch)" : o.via === "manual" ? " (von dir gestartet)" : ""} · Quelle: ${outcomeSourceText(o.source)}` : OUTCOME_STRINGS.never}
      </p>
      {o.error && (
        <p role="status" className="text-[11.5px] leading-snug text-warn" data-testid="outcome-error">
          {o.error}
        </p>
      )}
      <p className="text-[11px] leading-snug text-faint">{OUTCOME_STRINGS.hint}</p>
    </div>
  );
}

const BOX_TFS: readonly string[] = ["4h", "1d", "1w"];
const strengthOf = (v: number | null): Strength => (Math.max(1, Math.min(4, Math.round(v ?? 1))) as Strength);

/**
 * The input of „Diese Idee testen“ for an archived event, or `null` when the source has no translation: the entry check (its
 * strength and label), a Box setup (the marks and kind stored with it – the reasons of the setup are not stored, so the draft
 * rests on the kind and the plan). Key-level hits have none.
 */
export function ideaInputOf(e: SignalEvent): IdeaInput | null {
  if (!e.side) return null;
  const symbol = e.symbol || null;
  if (e.source === "entry") return { kind: "signal", symbol, baseTf: e.tf, verdict: { side: e.side, valid: true, strength: strengthOf(e.strength), label: e.label } };
  if (e.source === "box" && e.name && e.price != null && e.stop != null && e.grade && e.setupKind && e.tf && BOX_TFS.includes(e.tf)) {
    const kinds = ["range", "breakout", "retest", "fakeout", "pre"];
    if (!kinds.includes(e.setupKind) || !["A+", "A", "B", "C"].includes(e.grade)) return null;
    const setup: BoxSetupLike = { side: e.side, kind: e.setupKind as BoxSetupLike["kind"], grade: e.grade as BoxSetupLike["grade"], title: e.name, entry: e.price, stop: e.stop, rr: e.rr, reasons: [], targets: e.target != null ? [{ price: e.target }] : [] };
    return { kind: "box", symbol, tf: e.tf as BoxTf, setup, boxBars: null };
  }
  return null;
}
