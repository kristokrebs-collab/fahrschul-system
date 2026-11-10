/**
 * Risk per strategy and per asset (P05), pure: how much of the account each closed trade risked (distance to the
 * stop × qty ÷ the account's start capital) – mean, standard deviation, maximum and consistency (1 − coefficient of
 * variation, 0…1) – and how many trades went above the per-trade limit (`settings.discipline.maxLossTradePct`).
 * "Trade the best": the rows are sorted by sample size, the most consistent strategy is flagged.
 */
import type { AccountId, EnrichedTrade, Settings } from "../types";
import { assetOf } from "./exposure";

export interface RiskSpreadRow {
  key: string;
  label: string;
  color: string | null;
  /** trades with a known risk */
  n: number;
  mean: number;
  sd: number;
  max: number;
  /** 1 − sd ÷ mean clamped to 0…1 (1 = always the same risk) */
  consistency: number;
  /** trades whose risk was above the per-trade limit */
  over: number;
}

export interface RiskSpread {
  rows: RiskSpreadRow[];
  /** all trades with a risk */
  overall: RiskSpreadRow | null;
  /** key of the most consistent row with n ≥ `RISK_SPREAD_MIN_N` */
  steadiest: string | null;
  /** closed trades without a risk (no stop or no size) */
  missing: number;
}

export const RISK_SPREAD_MIN_N = 5;

const accountOf = (t: { account?: AccountId }): AccountId => t.account ?? "scalp";

/** Risk of a trade as a fraction of its account's start capital (null without risk / capital). */
export function riskPctOf(t: Pick<EnrichedTrade, "risk"> & { account?: AccountId }, capital: Readonly<Record<AccountId, number>>): number | null {
  const c = capital[accountOf(t)] ?? 0;
  return t.risk != null && Number.isFinite(t.risk) && t.risk > 0 && c > 0 ? t.risk / c : null;
}

function row(key: string, label: string, color: string | null, xs: readonly number[], limit: number): RiskSpreadRow {
  const n = xs.length;
  const mean = n ? xs.reduce((s, x) => s + x, 0) / n : 0;
  const sd = n > 1 ? Math.sqrt(xs.reduce((s, x) => s + (x - mean) ** 2, 0) / (n - 1)) : 0;
  return {
    key,
    label,
    color,
    n,
    mean,
    sd,
    max: n ? Math.max(...xs) : 0,
    consistency: mean > 0 ? Math.max(0, Math.min(1, 1 - sd / mean)) : 0,
    over: xs.filter((x) => x > limit + 1e-12).length,
  };
}

/** Risk spread per strategy (setup; a trade with two setups counts for both) or per asset. */
export function riskSpread(closed: readonly EnrichedTrade[], settings: Pick<Settings, "capital" | "setups">, by: "setup" | "asset", limit: number): RiskSpread {
  const groups = new Map<string, number[]>();
  const all: number[] = [];
  let missing = 0;
  const known = new Map(settings.setups.map((s) => [s.id, s]));
  for (const t of closed) {
    if (t.result === "open") continue;
    const r = riskPctOf(t, settings.capital);
    if (r == null) {
      missing++;
      continue;
    }
    all.push(r);
    const keys = by === "asset" ? [assetOf(t.pair)] : (t.setups ?? []).filter((id) => known.has(id));
    for (const k of keys.length ? keys : ["__none"]) groups.set(k, [...(groups.get(k) ?? []), r]);
  }
  const rows = [...groups.entries()]
    .map(([k, xs]) => {
      const s = known.get(k);
      const label = by === "asset" ? k : k === "__none" ? "Ohne Grundlage" : (s?.name ?? k);
      return row(k, label, by === "setup" ? (s?.color ?? null) : null, xs, limit);
    })
    .sort((a, b) => b.n - a.n || a.label.localeCompare(b.label, "de"));
  const eligible = rows.filter((r) => r.n >= RISK_SPREAD_MIN_N && r.key !== "__none");
  const steadiest = eligible.length ? eligible.reduce((b, r) => (r.consistency > b.consistency ? r : b)).key : null;
  return { rows, overall: all.length ? row("__all", "Alle", null, all, limit) : null, steadiest, missing };
}
