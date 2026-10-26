/**
 * Verlauf eines Signals (F25/F28): the history of ONE signal as dated lines – what the app raised, what happened to the same box /
 * key level before and after (a lifecycle: preparation → confirmation → retest → invalidation, setup → breakout → retest → target
 * or failed), what the trader did with it (stored with the time), the trade the journal holds for it, the end of the window and
 * the outcome the candles gave. Pure, deterministic; nothing is invented: a line exists only where the archive, the journal or an
 * evaluated outcome says so, with that source's own time (the time of the trade, the candle that decided it – not the time the
 * app noticed).
 *
 * What it is not: a log of changes to the signal's stop or target (a signal's marks are fixed when it is raised; a new mark
 * is a new event of the same box / level and shows up as a line of the lifecycle).
 */
import type { EnrichedTrade } from "../types";
import { tradeTime } from "@/lib/dates";
import { SKIP_LABEL, type SignalEvent, type SkipReason } from "./archive";
import { signalKindLabel } from "./inbox";
import { MISSED_WINDOW_MS, tradeMatchesSignal } from "./match";
import { outcomeText, type SignalOutcome } from "./outcome";

export type HistoryKind = "raised" | "stage" | "seen" | "skip" | "unskip" | "watch" | "unwatch" | "link" | "unlink" | "trade" | "window" | "outcome";

export interface HistoryLine {
  at: number;
  kind: HistoryKind;
  text: string;
  /** read from the journal / the candles / the clock, not stored on the event */
  derived: boolean;
  /** the line belongs to another event of the same box / level (the lifecycle), not to this signal itself */
  sibling: boolean;
}

/** Which events belong to one box / one key level: `null` for the Einstiegs-Check and a scanner row (no lifecycle). */
export function lifecycleKey(e: Pick<SignalEvent, "source" | "ref" | "symbol">): string | null {
  if (e.source === "key") return e.ref ? `key|${e.ref}` : null;
  if (e.source === "box" && e.ref) {
    // phase alerts are `p:SYMBOL:BOXID:PHASE`, setups `s:SYMBOL:BOXID:GRADE` – the box id is the third part
    const parts = e.ref.split(":");
    if ((parts[0] === "p" || parts[0] === "s") && parts.length >= 4 && parts[2]) return `box|${e.symbol}|${parts[2]}`;
  }
  return null;
}

const tradeText = (t: EnrichedTrade): string => `Trade im Journal: ${t.pair || "–"} ${t.side === "short" ? "Short" : "Long"}${t.result === "open" ? " (noch offen)" : ""}`;

/** The dated lines of `e`, oldest first. */
export function signalHistory(e: SignalEvent, events: readonly SignalEvent[], trades: readonly EnrichedTrade[], outcome: SignalOutcome | undefined, windowMs: number = MISSED_WINDOW_MS): HistoryLine[] {
  const out: HistoryLine[] = [{ at: e.at, kind: "raised", text: `Ausgelöst: ${e.label}`, derived: false, sibling: false }];

  const key = lifecycleKey(e);
  if (key) {
    for (const o of events) {
      if (o.id === e.id || lifecycleKey(o) !== key) continue;
      out.push({ at: o.at, kind: "stage", text: `${signalKindLabel(o)}: ${o.label}`, derived: false, sibling: true });
    }
  }

  for (const l of e.log) {
    const text =
      l.what === "seen"
        ? "Angesehen"
        : l.what === "skip"
          ? `Bewusst ausgelassen${l.note ? ` – ${SKIP_LABEL[l.note as SkipReason] ?? l.note}` : ""}`
          : l.what === "unskip"
            ? "Vermerk „ausgelassen“ zurückgenommen"
            : l.what === "watch"
              ? "„Beobachten“ eingeschaltet"
              : l.what === "unwatch"
                ? "„Beobachten“ ausgeschaltet"
                : l.what === "link"
                  ? "Trade von dir verknüpft"
                  : "Verknüpfung gelöst";
    out.push({ at: l.at, kind: l.what, text, derived: false, sibling: false });
  }

  if (e.entry && e.side) {
    for (const t of trades.filter((x) => tradeMatchesSignal(e, x))) {
      const at = +tradeTime(t);
      if (Number.isFinite(at)) out.push({ at, kind: "trade", text: tradeText(t), derived: true, sibling: false });
    }
    out.push({ at: e.at + windowMs, kind: "window", text: "Beobachtungsfenster endet – ohne Trade und ohne Vermerk gilt das Signal danach als abgelaufen", derived: true, sibling: false });
    if (outcome && (outcome.kind === "target" || outcome.kind === "stop") && outcome.hitAt != null) {
      out.push({ at: outcome.hitAt, kind: "outcome", text: `Ausgang laut Kerzen: ${outcomeText(outcome)}`, derived: true, sibling: false });
    }
  }

  return out.sort((a, b) => a.at - b.at);
}
