/**
 * Conformity and exit fidelity per strategy (P07, pure): how closely the trades of an Entscheidungsgrundlage followed
 * its OWN plan. Only what is measurable counts – a part without data (no checklist, no risk model, no exit reason)
 * is left out instead of scored as a miss.
 *
 * Per trade (0–100, weights renormalised over the measurable parts):
 *   Checkliste 30   share of THIS setup's checklist items ticked
 *   Plan 15         `followedPlan` (yes / no)
 *   Risiko 20       risk % of the account ≤ model + 10 %, leverage ≤ model, planned R:R ≥ model
 *   Stop 10         a stop was set
 *   Exit 15         the exit followed the plan (see `exitFollowed`)
 *   Markt/TF 10     pair and timeframe are among the strategy's markets / timeframes
 *
 * Exit fidelity ("Exit-Treue"): a closed trade left at the target, at the stop (± 0,25 R), by a plan exit reason
 * (Ziel, Stop, Trailing-Stop, Zeitstop, Signal dreht, or one of the strategy's own exit criteria) counts as faithful;
 * a named exit away from both levels (e.g. "Manuell"), a liquidation, a loss beyond −1,2 R (stop not respected) or a
 * stop moved away from the entry counts as a break; an unnamed exit away from both levels is not measurable.
 */
import { aggregate } from "../agg";
import { manualMistakes } from "../insights/mistakes";
import type { EnrichedTrade, Settings } from "../types";
import { marketKey, type SetupX } from "./types";

export const CONFORMITY_WEIGHTS = { checklist: 30, plan: 15, risk: 20, stop: 10, exit: 15, market: 10 } as const;
export type ConformityPart = keyof typeof CONFORMITY_WEIGHTS;
export const CONFORMITY_LABEL: Readonly<Record<ConformityPart, string>> = { checklist: "Checkliste", plan: "Plan befolgt", risk: "Risiko-Modell", stop: "Stop gesetzt", exit: "Exit-Treue", market: "Markt & Timeframe" };

/** Exit reasons that follow a plan (P06 `EXIT_REASONS` minus "Manuell" / "Liquidation"). */
export const PLAN_EXITS: readonly string[] = ["Ziel erreicht", "Stop", "Trailing-Stop", "Zeitstop", "Signal dreht"];
/** Tolerance around stop / target in R. */
export const EXIT_TOL_R = 0.25;
/** A loss below this R means the stop was not respected. */
export const STOP_BREACH_R = -1.2;
/** Score a trade needs to count as "regelkonform". */
export const CONFORM_MIN = 80;

export type ExitVerdict = "plan" | "break" | "unknown";

const fin = (v: number | null | undefined): v is number => typeof v === "number" && Number.isFinite(v);

/** Did the exit of a closed trade follow the plan? */
export function exitFollowed(t: EnrichedTrade, x?: Pick<SetupX, "exitCriteria"> | null): ExitVerdict {
  if (t.status !== "closed" || !fin(t.exit)) return "unknown";
  const reason = (t.psych?.exitReason ?? "").trim();
  if (reason === "Liquidation") return "break";
  const entry = t.entry;
  const risk = fin(entry) && fin(t.stop) ? Math.abs(entry - t.stop) : null;
  // stop moved away from the entry (risk widened) = a break of the plan
  const hist = t.stopHistory ?? [];
  if (hist.length && fin(entry) && fin(hist[0]?.price)) {
    const dist0 = Math.abs(entry - hist[0]!.price);
    if (hist.some((h) => fin(h.price) && Math.abs(entry - h.price) > dist0 * 1.001 && (t.side === "long" ? h.price < hist[0]!.price : h.price > hist[0]!.price))) return "break";
  }
  if (fin(t.r) && t.r < STOP_BREACH_R) return "break";
  if (reason && PLAN_EXITS.includes(reason)) return "plan";
  const own = (x?.exitCriteria ?? []).map((c) => c.text.trim().toLowerCase()).filter(Boolean);
  if (reason && own.some((c) => c === reason.toLowerCase() || reason.toLowerCase().includes(c) || c.includes(reason.toLowerCase()))) return "plan";
  if (risk && risk > 0) {
    if (Math.abs(t.exit - t.stop!) <= EXIT_TOL_R * risk) return "plan";
    if (fin(t.target) && Math.abs(t.exit - t.target) <= EXIT_TOL_R * risk) return "plan";
  }
  // a named exit away from both levels left the plan; an unnamed one (maybe a trailing stop) is not measurable
  return reason ? "break" : "unknown";
}

export interface TradeConformity {
  id: string;
  /** 0–100, null when nothing was measurable */
  score: number | null;
  parts: Partial<Record<ConformityPart, number>>;
  exit: ExitVerdict;
}

/** Conformity of one trade with strategy `x`. `capital` = the trade's account capital (risk %). */
export function tradeConformity(t: EnrichedTrade, x: SetupX, capital: number | null, leverageRule?: number | null): TradeConformity {
  const parts: Partial<Record<ConformityPart, number>> = {};
  const ids = x.checklist.map((c) => `${x.id}:${c.id}`);
  if (ids.length) parts.checklist = ids.filter((id) => t.checks?.[id] === true).length / ids.length;
  if (t.followedPlan != null) parts.plan = t.followedPlan ? 1 : 0;
  const rm = x.riskModel;
  const checks: number[] = [];
  if (rm.riskPct != null && fin(t.risk) && capital && capital > 0) checks.push((Math.abs(t.risk) / capital) * 100 <= rm.riskPct * 1.1 ? 1 : 0);
  const maxLev = rm.maxLeverage ?? leverageRule ?? null;
  if (maxLev != null && fin(t.leverage)) checks.push(t.leverage <= maxLev + 1e-9 ? 1 : 0);
  if (rm.minRR != null && fin(t.rr)) checks.push(t.rr >= rm.minRR - 1e-9 ? 1 : 0);
  if (checks.length) parts.risk = checks.reduce((a, b) => a + b, 0) / checks.length;
  parts.stop = fin(t.stop) ? 1 : 0;
  const exit = exitFollowed(t, x);
  if (exit !== "unknown") parts.exit = exit === "plan" ? 1 : 0;
  const mk: number[] = [];
  if (x.markets.length && t.pair) mk.push(x.markets.includes(marketKey(t.pair)) ? 1 : 0);
  if (x.tf.length && t.timeframe) mk.push(x.tf.includes(t.timeframe) ? 1 : 0);
  if (mk.length) parts.market = mk.reduce((a, b) => a + b, 0) / mk.length;
  let w = 0;
  let s = 0;
  for (const [k, v] of Object.entries(parts) as [ConformityPart, number][]) {
    w += CONFORMITY_WEIGHTS[k];
    s += CONFORMITY_WEIGHTS[k] * v;
  }
  // "a stop was set" alone says nothing about THIS plan: a score needs at least one plan-specific part
  const planParts = Object.keys(parts).filter((k) => k !== "stop").length;
  return { id: t.id, score: w && planParts ? Math.round((s / w) * 100) : null, parts, exit };
}

export interface StrategyConformity {
  /** trades of the strategy with a measurable score */
  n: number;
  /** mean score 0–100 (null without measurable trades) */
  score: number | null;
  /** mean per part (0–1) over the trades that measured it */
  parts: Partial<Record<ConformityPart, { rate: number; n: number }>>;
  /** exit fidelity over the closed trades whose exit was measurable */
  exit: { rate: number | null; plan: number; breaks: number; n: number };
  /** win rate of conform (≥ 80) vs. other trades, when both sides have trades */
  conformWinRate: number | null;
  otherWinRate: number | null;
  /** weakest measurable part */
  weakest: ConformityPart | null;
  perTrade: TradeConformity[];
}

/** Conformity of a strategy over its closed trades. */
export function strategyConformity(x: SetupX, closed: readonly EnrichedTrade[], settings: Pick<Settings, "capital">, leverageRule?: Partial<Record<"makro" | "scalp", number>>): StrategyConformity {
  const list = closed.filter((t) => (t.setups || []).includes(x.id));
  const perTrade = list.map((t) => tradeConformity(t, x, settings.capital?.[t.account ?? "scalp"] ?? null, leverageRule?.[t.account ?? "scalp"] ?? null));
  const scored = perTrade.filter((c) => c.score != null);
  const parts: StrategyConformity["parts"] = {};
  for (const k of Object.keys(CONFORMITY_WEIGHTS) as ConformityPart[]) {
    const vals = perTrade.map((c) => c.parts[k]).filter((v): v is number => v != null);
    if (vals.length) parts[k] = { rate: vals.reduce((a, b) => a + b, 0) / vals.length, n: vals.length };
  }
  const plan = perTrade.filter((c) => c.exit === "plan").length;
  const breaks = perTrade.filter((c) => c.exit === "break").length;
  const byId = new Map(list.map((t) => [t.id, t]));
  const conform = scored.filter((c) => c.score! >= CONFORM_MIN).map((c) => byId.get(c.id)!);
  const other = scored.filter((c) => c.score! < CONFORM_MIN).map((c) => byId.get(c.id)!);
  let weakest: ConformityPart | null = null;
  for (const [k, v] of Object.entries(parts) as [ConformityPart, { rate: number }][]) if (!weakest || v.rate < parts[weakest]!.rate) weakest = k;
  return {
    n: scored.length,
    score: scored.length ? Math.round(scored.reduce((s, c) => s + c.score!, 0) / scored.length) : null,
    parts,
    exit: { rate: plan + breaks ? plan / (plan + breaks) : null, plan, breaks, n: plan + breaks },
    conformWinRate: conform.length && other.length ? aggregate(conform).winRate : null,
    otherWinRate: conform.length && other.length ? aggregate(other).winRate : null,
    weakest,
    perTrade,
  };
}

/** The most frequent manual mistake tags of the non-conform trades (what breaks the plan most). */
export function planBreakers(closed: readonly EnrichedTrade[], c: StrategyConformity, limit = 3): { tag: string; n: number }[] {
  const low = new Set(c.perTrade.filter((p) => p.score != null && p.score < CONFORM_MIN).map((p) => p.id));
  const counts = new Map<string, number>();
  for (const t of closed) if (low.has(t.id)) for (const m of manualMistakes(t)) counts.set(m, (counts.get(m) ?? 0) + 1);
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([tag, n]) => ({ tag, n }));
}
