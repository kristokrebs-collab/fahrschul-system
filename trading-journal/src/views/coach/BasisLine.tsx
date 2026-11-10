/**
 * Quellenzeilen der Coach-Seite (F27): every figure names where it comes from and how far it reaches. The cards of the page that
 * read the journal share ONE line at the top (the journal on this device, how many trades, from which to which trade); the
 * signal cards (Posteingang, Verpasste Chancen, Signalbilanz) each end with their own line about the signal archive – a local
 * record that is filled only while the app is open. Pure presentation of numbers the caller already has; a missing time is
 * said as „keine Daten“ by `SourceStand`.
 */
import type { SignalEvent } from "@/domain/missed";
import type { EnrichedTrade } from "@/domain/types";
import { tradeTime } from "@/lib/dates";
import { SourceStand, type StandPart } from "@/ui/SourceStand";

const plural = (n: number, one: string, many: string): string => `${n} ${n === 1 ? one : many}`;

/** First and last time (ms) of a list of times, `null` when empty. */
function span(times: readonly number[]): { first: number | null; last: number | null } {
  const t = times.filter((x) => Number.isFinite(x));
  return t.length ? { first: Math.min(...t), last: Math.max(...t) } : { first: null, last: null };
}

/** „Quelle: Dein Journal auf diesem Gerät · 124 Trades (31 geschlossen) · ältester Trade … · neuester Trade …“ */
export function JournalBasis({ trades, closed, className }: { trades: readonly EnrichedTrade[]; closed: number; className?: string }) {
  const { first, last } = span(trades.map((t) => +tradeTime(t)));
  const parts: StandPart[] = trades.length ? [{ label: "ältester Trade", at: first, long: true }, { label: "neuester Trade", at: last, long: true }] : [];
  return <SourceStand source={`Dein Journal auf diesem Gerät · ${trades.length ? `${plural(trades.length, "Trade", "Trades")} (${closed} geschlossen)` : "noch keine Trades"} – lokal gerechnet, nichts davon kommt von der Börse`} parts={parts} className={className} testId="coach-basis" />;
}

/** „Quelle: Signalarchiv dieses Geräts (nur bei offener App gesammelt) · 57 Signale · ältestes … · neuestes …“ */
export function ArchiveBasis({ events, className, testId = "archive-basis" }: { events: readonly SignalEvent[]; className?: string; testId?: string }) {
  const { first, last } = span(events.map((e) => e.at));
  const parts: StandPart[] = events.length ? [{ label: "ältestes Signal", at: first, long: true }, { label: "neuestes Signal", at: last, long: true }] : [];
  return <SourceStand source={`Signalarchiv dieses Geräts (nur bei offener App gesammelt) · ${events.length ? plural(events.length, "Ereignis", "Ereignisse") : "noch leer"}`} parts={parts} className={className} testId={testId} />;
}
