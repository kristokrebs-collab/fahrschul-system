/**
 * Journal trade → Zeitmaschine plan (pure). „Was hätte die Zeitmaschine zu diesem Trade gesagt?“: the trade's side, (Ø) entry,
 * stop and target are the plan; only candles BEFORE the entry may be used (the answer the Zeitmaschine could have given at that
 * moment, not one that knows the outcome). A trade without a stop has no plan to play through; one without a target gets an
 * assumed target of n × R that the sheet says out loud. Nothing is guessed silently: every refusal has its German reason.
 */
import { feePreset } from "@/domain/backtest/fees";
import type { CostModel } from "@/domain/backtest/types";
import { DEFAULT_FUNDING_RATE } from "@/domain/backtest/fees";
import { DEFAULT_SLIPPAGE } from "@/domain/backtest/slippage";
import { fillStats } from "@/domain/fills";
import type { Trade } from "@/domain/types";
import { checkPlan, type TmPlan } from "@/domain/timemachine";
import { tvSymbolToBinance } from "@/market/symbol";

export interface TradePlan {
  plan: TmPlan;
  /** Binance notation ("BTC/USDT" → "BTCUSDT") */
  symbol: string;
  /** entry time, ms */
  entryMs: number;
  /** true = the trade had no target: the plan's target is `assumedR` × R and the sheet says so */
  targetAssumed: boolean;
  costs: CostModel;
}

export type TradePlanResult = { ok: true; value: TradePlan } | { ok: false; why: string };

export const ASSUMED_R = [1, 2, 3] as const;

const ms = (local: string | undefined): number => (local ? new Date(local).getTime() : NaN);

/** The symbol of a trade's pair in the exchange's notation. */
export const symbolOfPair = (pair: string): string => tvSymbolToBinance(pair.replace(/\//g, ""));

/** The trade's fees: its venue's base tier, 2 bp slippage, perpetuals pay funding (spot does not). */
export function costsOfTrade(t: Pick<Trade, "exchange" | "market">): CostModel {
  const fee = feePreset(t.exchange ?? "binance");
  return { fees: { exchange: fee.exchange, makerBps: fee.makerBps, takerBps: fee.takerBps }, slippage: DEFAULT_SLIPPAGE, funding: t.market === "spot" ? { kind: "none" } : { kind: "flat", ratePer8h: DEFAULT_FUNDING_RATE } };
}

export function tmPlanOfTrade(t: Trade, assumedR: number = ASSUMED_R[1]): TradePlanResult {
  if (!t.pair?.trim()) return { ok: false, why: "Dem Trade fehlt das Paar – ohne Markt gibt es keine Kerzen." };
  const avg = t.fills?.length ? fillStats(t.fills, t.side).avgEntry : null;
  const entry = avg ?? t.entry;
  if (entry == null || !(entry > 0)) return { ok: false, why: "Dem Trade fehlt der Einstiegspreis." };
  if (t.stop == null || !(t.stop > 0)) return { ok: false, why: "Dieser Trade hat keinen Stop – ohne Stop gibt es keinen Plan, den die Zeitmaschine durchspielen kann." };
  const entryMs = ms(t.date);
  if (!Number.isFinite(entryMs)) return { ok: false, why: "Dem Trade fehlt die Einstiegszeit – die Zeitmaschine braucht den Moment, vor dem sie nur Kerzen sehen darf." };
  const side = t.side === "short" ? "short" : "long";
  const risk = Math.abs(entry - t.stop);
  const targetAssumed = t.target == null || !(t.target > 0);
  const target = targetAssumed ? entry + (side === "long" ? 1 : -1) * assumedR * risk : t.target!;
  const plan: TmPlan = { side, entry, stop: t.stop, target };
  const bad = checkPlan(plan);
  if (bad) return { ok: false, why: `Der Plan dieses Trades ergibt keinen Sinn: ${bad.why}` };
  return { ok: true, value: { plan, symbol: symbolOfPair(t.pair), entryMs, targetAssumed, costs: costsOfTrade(t) } };
}

/** How much history before the entry each timeframe loads (days): a few hundred candles at least, the pool needs ≥ 200. */
export const HISTORY_DAYS = { "15m": 60, "1h": 120, "4h": 365, "1d": 730 } as const;
