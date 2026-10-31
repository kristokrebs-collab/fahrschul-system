import type { EnrichedTrade, Settings, Trade } from "@/domain/types";
import { defaultSettings } from "@/domain/defaults";
import { enrichTrades } from "@/domain/enrich";

export const NBSP = " ";

export function mkTrade(p: Partial<Trade> & { id: string; date: string }): Trade {
  return {
    account: "scalp",
    side: "long",
    status: "closed",
    pair: "BTC/USDT",
    timeframe: "4h",
    entry: null,
    stop: null,
    target: null,
    exit: null,
    size: null,
    leverage: null,
    fees: null,
    pnlManual: null,
    setups: [],
    checks: {},
    conviction: null,
    followedPlan: null,
    emotion: "",
    reason: "",
    notes: "",
    chart: "",
    pnl: null,
    r: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...p,
  };
}

/** Hand-computed sample (see domain.agg.test.ts for the expected numbers). */
export const A = mkTrade({
  id: "A",
  date: "2026-01-05T10:00",
  entry: 80000,
  exit: 84000,
  size: 8000,
  fees: 4,
  stop: 79000,
  target: 86000,
  setups: ["s_bo"],
  checks: { "g:trigger": true, "s_bo:c1": true },
  conviction: 4,
  followedPlan: true,
  emotion: "Ruhig",
  reason: 'Breakout; "sauber"',
  chart: "https://www.tradingview.com/x/abc",
});
export const B = mkTrade({
  id: "B",
  date: "2026-01-12T11:00",
  side: "short",
  entry: 85000,
  exit: 86000,
  size: 8500,
  fees: 0,
  stop: 86500,
  setups: ["s_short"],
  followedPlan: false,
  emotion: "FOMO",
  conviction: 3,
});
export const C = mkTrade({ id: "C", date: "2026-02-03T09:30", entry: 82000, pnlManual: 50, account: undefined });
export const D = mkTrade({ id: "D", date: "2026-02-10T08:00", status: "open", account: "makro", entry: 83000, stop: 82000, size: 4150, setups: ["s_ml"] });
export const E = mkTrade({ id: "E", date: "2026-02-20T14:15", entry: 80000, exit: 80000, size: 8000, fees: 0, followedPlan: true, conviction: 2 });
export const F = mkTrade({
  id: "F",
  date: "2026-03-01T16:45",
  entry: 80000,
  exit: 79000,
  size: 8000,
  fees: 0,
  stop: 79500,
  setups: ["s_bt"],
  followedPlan: false,
  emotion: "Gierig",
  conviction: 5,
});

export const SAMPLE: Trade[] = [A, B, C, D, E, F];

export function settings(): Settings {
  return defaultSettings();
}
export function enriched(list: Trade[] = SAMPLE, s: Settings = settings()): EnrichedTrade[] {
  return enrichTrades(list, s);
}
