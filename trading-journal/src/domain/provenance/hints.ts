/**
 * Hinweise für „Herkunft nachtragen“ (F24): zu einem Trade ohne Herkunft das Signal der App, das zeitlich zu ihm passt (gleiche
 * Seite, gleicher Markt, im Fenster der Verpassten Chancen: 30 Minuten davor bis 6 Stunden danach). Ein Hinweis ist KEINE
 * Zuordnung – dass ein Signal zur Uhrzeit passt, belegt nicht, dass der Händler seinetwegen eingestiegen ist. Die Liste zeigt
 * ihn, der Händler entscheidet; geschrieben wird erst sein Klick. Rein, deterministisch.
 */
import type { SignalEvent } from "../missed/archive";
import { tradeMatchesSignal } from "../missed/match";
import type { EnrichedTrade } from "../types";
import { tradeTime } from "@/lib/dates";

export interface DecisionHint {
  tradeId: string;
  eventId: string;
  /** minutes from the signal to the trade (negative: the trade came first) */
  gapMin: number;
  /** the signal in words */
  label: string;
}

/** For each trade the nearest matching entry signal (by time), if any. */
export function signalHints(trades: readonly EnrichedTrade[], events: readonly SignalEvent[]): Map<string, DecisionHint> {
  const entries = events.filter((e) => e.entry && e.side);
  const out = new Map<string, DecisionHint>();
  if (!entries.length) return out;
  for (const t of trades) {
    const at = +tradeTime(t);
    if (!Number.isFinite(at)) continue;
    let best: SignalEvent | null = null;
    for (const e of entries) {
      if (!tradeMatchesSignal(e, t)) continue;
      if (!best || Math.abs(at - e.at) < Math.abs(at - best.at)) best = e;
    }
    if (best) out.set(t.id, { tradeId: t.id, eventId: best.id, gapMin: Math.round((at - best.at) / 60_000), label: best.label || "Signal" });
  }
  return out;
}
