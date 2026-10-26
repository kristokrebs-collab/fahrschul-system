/**
 * SHARE edition data ("zum Teilen"): neutral defaults, same shape as `./personal`. PURE LITERALS ONLY.
 * Setups: the multi-timeframe signal setup first (shared literal `./mtf`), plus a neutral backtest setup (`s_bt` is
 * hard-referenced by the backtest comparison). Levels 0 = "nicht gesetzt" (`levelsConfigured()` in `../defaults`).
 */
import type { BacktestReference, MarketLevels, Rule, Setup } from "../types";
import { MTF_SETUP } from "./mtf";

export const RULES: readonly Rule[] = [
  { id: "trigger", text: "Trigger ausgelöst, nicht geraten" },
  { id: "topdown", text: "Top-down geprüft (höhere Timeframes zuerst)" },
  { id: "stop", text: "Stop deutlich vor der Liquidation" },
  { id: "lev", text: "Hebel im Rahmen meiner Regel" },
];

export const SETUPS: readonly Setup[] = [
  MTF_SETUP,
  {
    id: "s_bt",
    name: "Backtest-Signal",
    account: "scalp",
    color: "#5fb0d6",
    desc: "Eigene, getestete Strategie. Die Backtest-Werte trägst du unter Einstellungen ein.",
    checklist: [
      { id: "c1", text: "Signal laut Regelwerk" },
      { id: "c2", text: "Risiko pro Trade im Rahmen" },
    ],
  },
];

export const BACKTEST: BacktestReference = { winRate: 0.5, avgWin: 0.1, avgLoss: -0.05, expectancy: 0.025, label: "Beispielwerte" };

/** 0 = "nicht gesetzt" (the market panel must hide trigger/zone/weekly rows until the user enters levels). */
export const MARKET: MarketLevels = {
  symbol: "BINANCE:BTCUSDT",
  longTrigger: 0,
  longStop: 0,
  shortTrigger: 0,
  lowerHigh: 0,
  rsiWeekly: 60,
  invalidation: 0,
  zoneLow: 0,
  zoneHigh: 0,
};

export const CAPITAL = { makro: 10000, scalp: 1000 } as const;
export const LEVERAGE_RULE = { scalp: 5, makro: 5 } as const;

export const COPY = {
  setupsLead: "Deine Setups und Regeln. Jede Karte zeigt, wie oft die Grundlage funktioniert hat.",
  reasonPlaceholder: "z. B. Bottom-Signal auf 30m und 1h, RSI überverkauft, Preis im Discount",
  setupNamePlaceholder: "z. B. Multi-TF-Bottom",
  leverageHelp: { scalp: "Regel: höchstens 5x", makro: "Regel: höchstens 5x" },
  leverageWarning: { scalp: "Über deiner Regel (5x)", makro: "Über deiner Regel (5x)" },
  backtestDeleted: "Grundlage „Backtest-Signal“ wurde gelöscht – Vergleich nur über alle Trades.",
  scenarioTargets: { bear: "", long: "", short: "" },
  /** Title of the weekly confirmation block in the market panel (`MarketPanel.WEEKLY_TITLE`). */
  weeklyTitle: "Wochen-Bestätigung",
  leverageRuleSentence: "Regel: höchstens 5x",
} as const;
