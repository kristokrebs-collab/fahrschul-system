/**
 * PERSONAL edition data (web + "für mich"): the strategy texts, levels and copy that must never reach the
 * "zum Teilen" file. PURE LITERALS ONLY (no function calls at module level) so the share build tree-shakes this
 * module away; `npm run build:single` greps the share file for markers from here and fails if one leaks.
 */
import type { BacktestReference, MarketLevels, Rule, Setup } from "../types";

export const RULES: readonly Rule[] = [
  { id: "trigger", text: "Trigger ausgelöst, nicht geraten" },
  { id: "topdown", text: "Top-down geprüft (W → 3D → D → 4H → 1H)" },
  { id: "spx", text: "S&P-500-Kontext geprüft" },
  { id: "stop", text: "Stop deutlich vor der Liquidation" },
  { id: "lev", text: "Hebel im Rahmen (Scalp 4x, Makro höchstens 5x)" },
];

export const SETUPS: readonly Setup[] = [
  {
    id: "s_p1",
    name: "Früher Makro-Trendbruch",
    account: "makro",
    color: "#6f9dc9",
    desc: "Philosophie 1: Diagonale Downtrend-Linie und RSI-Trendlinie brechen. Höchstes Risiko, bester Preis.",
    checklist: [{ id: "c1", text: "Diagonale Downtrend-Linie gebrochen" }, { id: "c2", text: "RSI-Trendlinie gebrochen" }, { id: "c3", text: "Top-down geprüft (W → 3D → D → 4H → 1H)" }],
  },
  {
    id: "s_p2",
    name: "Lower-High-Bruch 82.829",
    account: "makro",
    color: "#46a6a0",
    desc: "Philosophie 2: Weekly Close über 82.829 UND Weekly RSI über 62,09. Beides nötig.",
    checklist: [{ id: "c1", text: "Weekly Close über 82.829" }, { id: "c2", text: "Weekly RSI über 62,09" }],
  },
  {
    id: "s_p3",
    name: "4-Jahres-Zyklus-Bestätigung",
    account: "makro",
    color: "#8c83cf",
    desc: "Philosophie 3: Kein Zyklus-Bottom bis 21. Nov. Spätester Einstieg, höchste Bestätigung, schlechtester Preis.",
    checklist: [{ id: "c1", text: "Kein neues Tief bis 21. Nov" }, { id: "c2", text: "Wochenschlüsse durchgehend über 82.829" }],
  },
  {
    id: "s_ml",
    name: "Makro-Long Support-Zone",
    account: "makro",
    color: "#5fb0d6",
    desc: "Preis bei 81.500–82.200 plus Falling-Knife-Filter. Long-% allein ist kein Kaufsignal.",
    checklist: [{ id: "c1", text: "Preis in Support-/Liquiditätszone (BSL/EQL)" }, { id: "c2", text: "Erster Higher Low oder BOS auf 1H/4H" }, { id: "c3", text: "Whale-vs-Retail-Delta positiv, 2–3 Kerzen in Folge" }, { id: "c4", text: "RSI: bullische Divergenz oder Trendlinienbruch" }],
  },
  {
    id: "s_ladder",
    name: "Leg-Up-Ladder",
    account: "makro",
    color: "#a0b56b",
    desc: "Bestätigtes Measured-Move-Ziel mit Struktur nach oben durchbrochen: 15–25 % des verbleibenden Makro-Cash zukaufen.",
    checklist: [{ id: "c1", text: "Ziel mit Struktur bestätigt, nicht nur Wick" }, { id: "c2", text: "Add höchstens 25 % des verbleibenden Makro-Cash" }],
  },
  {
    id: "s_bo",
    name: "4H-Breakout über 85.900",
    account: "scalp",
    color: "#6f9dc9",
    desc: "4H-Schluss über 85.900: Ziel 87.200, dann 89.000–90.000. Invalidierung zurück unter 85.300.",
    checklist: [{ id: "c1", text: "4H-Schluss über 85.900" }, { id: "c2", text: "Stop unter 85.300" }, { id: "c3", text: "S&P nicht in Ablehnung an 7.834–7.840" }],
  },
  {
    id: "s_short",
    name: "4H-Neckline-Short unter 84.500",
    account: "scalp",
    color: "#c7768f",
    desc: "4H-Schluss unter 84.500: Ziel 82.000–81.500, Stop über 85.300.",
    checklist: [{ id: "c1", text: "4H-Schluss unter 84.500" }, { id: "c2", text: "Stop über 85.300" }],
  },
  {
    id: "s_rej",
    name: "Breakout-Ablehnung 85.700–85.900",
    account: "scalp",
    color: "#c9975b",
    desc: "Preis scheitert an der Ausbruchszone: Rückfall-Risiko bis zum BOS-Test bei 82.000.",
    checklist: [{ id: "c1", text: "Ablehnung an 85.700–85.900 bestätigt" }, { id: "c2", text: "Stop über der Zone" }],
  },
  {
    id: "s_sweep",
    name: "BSL/EQL Liquidity Sweep",
    account: "both",
    color: "#46a6a0",
    desc: "Preis fegt eine Liquiditätszone ab, bevor der eigentliche Move kommt.",
    checklist: [{ id: "c1", text: "Liquidität klar abgeholt" }, { id: "c2", text: "Reclaim, Struktur dreht" }],
  },
  {
    id: "s_rsi",
    name: "RSI-Trendlinienbruch",
    account: "both",
    color: "#8c83cf",
    desc: "Diagonale RSI-Trendlinie bricht: Momentum-Signal. Keine horizontalen RSI-Level.",
    checklist: [{ id: "c1", text: "Diagonale RSI-Trendlinie gebrochen" }, { id: "c2", text: "Struktur bestätigt (BOS/CHoCH)" }],
  },
  {
    id: "s_bt",
    name: "Backtest-Signal (214er)",
    account: "scalp",
    color: "#5fb0d6",
    desc: "Eigene Strategie: 62,15 % Winrate im Backtest. 4x Hebel, 250 USDT Margin isoliert, etwa 2 Trades pro Monat.",
    checklist: [{ id: "c1", text: "4x Hebel, isoliert" }, { id: "c2", text: "Margin rund 250 USDT" }, { id: "c3", text: "Trailing-Stop ab +8–10 % geplant" }],
  },
];

export const BACKTEST: BacktestReference = {
  winRate: 0.6215,
  avgWin: 0.1664,
  avgLoss: -0.0931,
  expectancy: 0.0682,
  label: "214 Signale",
};

export const MARKET: MarketLevels = {
  symbol: "BINANCE:BTCUSDT",
  longTrigger: 85900,
  longStop: 85300,
  shortTrigger: 84500,
  lowerHigh: 82829,
  rsiWeekly: 62.09,
  invalidation: 75500,
  zoneLow: 81500,
  zoneHigh: 82200,
};

export const CAPITAL = { makro: 20000, scalp: 5000 } as const;
export const LEVERAGE_RULE = { scalp: 4, makro: 5 } as const;

export const COPY = {
  setupsLead: "Deine Setups aus der MegaWhale-Methodik und deinen eigenen Regeln. Jede Karte zeigt, wie oft die Grundlage funktioniert hat.",
  reasonPlaceholder: "z. B. 4H-Schluss unter 84.500, Delta rot, S&P lehnt ab",
  setupNamePlaceholder: "z. B. 4H-Breakout über 85.900",
  leverageHelp: { scalp: "Regel: 4x", makro: "Regel: 2–5x" },
  leverageWarning: { scalp: "Über deiner Regel (4x)", makro: "Über deiner Regel (max. 5x)" },
  backtestDeleted: "Grundlage „Backtest-Signal (214er)“ wurde gelöscht – Vergleich nur über alle Trades.",
  scenarioTargets: { bear: " Ziel 66.000–70.000.", long: " Ziel 87.200, dann 89.000–90.000.", short: " Ziel 82.000–81.500," },
  /** Title of the weekly confirmation block in the market panel (`MarketPanel.WEEKLY_TITLE`). */
  weeklyTitle: "Bärenmarkt-Ende bestätigt?",
  leverageRuleSentence: "Regel: Scalp 4x, Makro höchstens 5x",
} as const;
