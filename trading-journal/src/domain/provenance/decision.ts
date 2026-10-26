/**
 * Herkunft der Entscheidung je Trade (F24): wer hat entschieden – du selbst, ein regelbasiertes Signal (Regelwerk) oder ein
 * KI-Vorschlag? Reine Funktionen, kein I/O.
 *
 * Quellen, in dieser Reihenfolge (die erste, die zutrifft, gilt – und die Karte zählt, woher jede Zuordnung kommt):
 *   1. `trade.decision`   die Marke am Trade: vom Händler im Editor oder in der Liste „Herkunft nachtragen“ gesetzt (`set`), oder
 *                         vom Handelsplan (`plan`, das Signal des Einstiegs-Timers) bzw. einem Box-Setup (`box`) beim Entwurf
 *   2. Posteingang        der Händler hat im Signal-Posteingang einen Trade von Hand mit einem Signal verknüpft (`inbox`)
 *   3. `trade.origin`     Bot oder TradingView-Webhook – eine Regel hat die Order ausgelöst (`source`); Börsen-Sync und CSV
 *                         sagen nichts darüber, wer entschieden hat
 * Alles andere ist UNBEKANNT (`null`): ein Trade, der nur zeitlich zu einem Signal passt, bekommt keine Herkunft – die Liste
 * „Herkunft nachtragen“ zeigt ihn mit dem Hinweis und der Händler entscheidet.
 */
import type { DecisionBy, Trade } from "../types";

export const DECISION_BY: readonly DecisionBy[] = ["own", "rules", "ai"];

export const DECISION_LABEL: Readonly<Record<DecisionBy, string>> = { own: "Eigene Entscheidung", rules: "Regelwerk-Signal", ai: "KI-Vorschlag" };
/** Kurzform für Schalter und enge Zeilen. */
export const DECISION_SHORT: Readonly<Record<DecisionBy, string>> = { own: "Ich", rules: "Regelwerk", ai: "KI" };

export type DecisionBasis = "set" | "plan" | "box" | "inbox" | "source";
export const BASIS_LABEL: Readonly<Record<DecisionBasis, string>> = {
  set: "von dir gesetzt",
  plan: "aus dem Handelsplan",
  box: "aus einem Box-Setup",
  inbox: "im Posteingang verknüpft",
  source: "über Bot oder Webhook",
};

export interface ResolvedDecision {
  by: DecisionBy;
  basis: DecisionBasis;
  ref?: string;
}

export const isDecisionBy = (v: unknown): v is DecisionBy => v === "own" || v === "rules" || v === "ai";

/** The decision of a trade, or `null` (unknown). `inboxLinks` = signal event id by trade id (a link the trader made by hand). */
export function decisionOf(t: Pick<Trade, "id" | "decision" | "origin">, inboxLinks?: ReadonlyMap<string, string>): ResolvedDecision | null {
  const d = t.decision;
  if (d && isDecisionBy(d.by)) return { by: d.by, basis: d.via === "plan" || d.via === "box" ? d.via : "set", ...(d.ref ? { ref: d.ref } : {}) };
  const ev = inboxLinks?.get(t.id);
  if (ev) return { by: "rules", basis: "inbox", ref: ev };
  const kind = t.origin?.kind;
  if (kind === "bot" || kind === "webhook") return { by: "rules", basis: "source" };
  return null;
}

/** Signal event id by trade id, from the archive's hand-made links (`event.tradeId`). */
export function inboxLinksOf(events: readonly { id: string; tradeId?: string | null }[]): Map<string, string> {
  const out = new Map<string, string>();
  for (const e of events) if (e.tradeId && !out.has(e.tradeId)) out.set(e.tradeId, e.id);
  return out;
}

/** The decision a trader sets by hand: replaces any earlier mark, keeps nothing of `via` / `ref` (the trader's word wins). `null` removes the mark. */
export function withDecision<T extends Trade>(t: T, by: DecisionBy | null): T {
  const { decision: _old, ...rest } = t;
  void _old;
  return (by ? { ...rest, decision: { by } } : rest) as T;
}
