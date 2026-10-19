/**
 * Building blocks of the signal chain cards (F25 Bilanz, F27 Qualität, F28 Posteingang, F32 Verpasste Chancen): the time stamp,
 * filter chips, the outcome badge, the shared „Ausgänge berechnen“ control and the translation of an archived event into an
 * input of „Diese Idee testen“.
 */
import { useEffect } from "react";
import type { BoxSetupLike } from "@/domain/lab/idea";
import type { IdeaInput } from "@/domain/lab/idea";
import type { BoxTf } from "@/domain/boxes";
import type { Strength } from "@/domain/signals/verdict";
import { isDecided, outcomeText, type SignalEvent, type SignalOutcome } from "@/domain/missed";
import { cn } from "@/lib/cn";
import { date as fmtDate, time as fmtTime } from "@/lib/format";
import { Badge, type BadgeTone } from "@/primitives/Badge";
import { Button } from "@/primitives/Button";
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
      className={cn("touch-hit inline-flex min-h-8 items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11.5px] transition-colors", on ? "border-fg/40 bg-white/[0.08] text-fg" : "border-line-2 text-mute hover:text-fg")}
    >
      {children}
    </button>
  );
}

const OUTCOME_TONE: Readonly<Record<SignalOutcome["kind"], BadgeTone>> = { target: "win", stop: "loss", open: "mute", unusable: "warn" };

/** The outcome of one signal as a badge with its plain-language line (`title` carries the marks it was read with). */
export function OutcomeBadge({ o }: { o: SignalOutcome | undefined }) {
  if (!o) return <span className="text-[11.5px] text-faint">Ausgang noch nicht berechnet</span>;
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
  button: "Ausgänge berechnen",
  busy: "Rechne …",
  again: "Erneut berechnen",
  hint: "Lädt die echten Kerzen nach jedem Signal (nur Marktdaten, nichts aus deinem Journal) und liest daraus, ob Ziel oder Stopp zuerst kam. Läuft nur auf Klick.",
  none: "Keine Einstiegs-Signale, für die ein Ausgang berechnet werden könnte.",
  rules:
    "Gelesen wird ab der ersten Kerze, die nach dem Signal öffnet. Stopp und Ziel sind die Marken des Signals; fehlt eine, gilt das Standardmaß (Stopp 1,5 × ATR, Ziel 2 R) und der Ausgang ist so gekennzeichnet. Liegen Stopp und Ziel in derselben Kerze, zählt der Stopp. Ohne Gebühren, Funding und Schlupf – es ist der Kursverlauf, kein gebuchter Trade.",
} as const;

/** The shared outcome state plus the control that computes it. Primes from the final-result cache once per archive. */
export function useOutcomes(events: readonly SignalEvent[]) {
  const st = useOutcomeState();
  useEffect(() => {
    primeOutcomes(events);
  }, [events]);
  const entries = outcomeEvents(events);
  const decided = entries.filter((e) => isDecided(st.outcomes.get(e.id))).length;
  return { ...st, entries: entries.length, decided, run: () => void computeOutcomes(events) };
}

/** „Ausgänge berechnen“ with its status line; shared by the cards that show outcomes (they read the same state). */
export function OutcomeControl({ events, className }: { events: readonly SignalEvent[]; className?: string }) {
  const o = useOutcomes(events);
  if (!o.entries) return null;
  const loading = o.status === "loading";
  return (
    <div className={cn("grid gap-1.5", className)} data-testid="outcome-control" data-status={o.status}>
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" variant="ghost" onClick={o.run} disabled={loading} data-testid="outcome-run">
          {loading ? OUTCOME_STRINGS.busy : o.status === "done" ? OUTCOME_STRINGS.again : OUTCOME_STRINGS.button}
        </Button>
        <span className="num font-mono text-[11px] text-faint" aria-live="polite">
          {loading && o.progress && o.progress.total > 0 ? `Seite ${Math.min(o.progress.done, o.progress.total)} von ${o.progress.total}` : `${o.decided} von ${o.entries} mit Ausgang`}
        </span>
      </div>
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
