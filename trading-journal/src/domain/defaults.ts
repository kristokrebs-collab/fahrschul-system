/**
 * Default settings and constants – verbatim from the bundle (`HM`, `jG`, `LG`, `Bf`, `GM`, `KM`, `YM`, `BG`, `Qa`, `_he`).
 * These strings are the grep source for the M0 definition of done; do not paraphrase.
 */
import type {
  AccountId,
  BacktestReference,
  ChecklistItem,
  Conviction,
  HyblockConfig,
  MarketLevels,
  Rule,
  Settings,
  Setup,
  TradeResult,
} from "./types";
import { EMOTIONS, SETUP_COLORS, TIMEFRAMES } from "./types";
import { MONTHS_SHORT, WEEKDAYS } from "@/lib/dates";

export { EMOTIONS, SETUP_COLORS, TIMEFRAMES };
export const WEEKDAY_NAMES = WEEKDAYS;
export const MONTH_NAMES = MONTHS_SHORT;

/** Bundle `Bf`: setup colour palette; a new setup takes the first unused colour, then cycles. */
export const SETUP_PALETTE: readonly string[] = SETUP_COLORS;

/** Bundle `qn`: checklist items with ids c1, c2, … in order. */
export const checklistItems = (...texts: string[]): ChecklistItem[] =>
  texts.map((text, i) => ({ id: "c" + (i + 1), text }));

/** Bundle `LG`: global rules (`settings.rules`), checklist ids `g:{id}`. */
export const DEFAULT_RULES: readonly Rule[] = [
  { id: "trigger", text: "Trigger ausgelöst, nicht geraten" },
  { id: "topdown", text: "Top-down geprüft (W → 3D → D → 4H → 1H)" },
  { id: "spx", text: "S&P-500-Kontext geprüft" },
  { id: "stop", text: "Stop deutlich vor der Liquidation" },
  { id: "lev", text: "Hebel im Rahmen (Scalp 4x, Makro höchstens 5x)" },
];

/** Bundle `jG`: 11 default setups. `s_bt` is hard-referenced by the Backtest comparison. */
export const DEFAULT_SETUPS: readonly Setup[] = [
  {
    id: "s_p1",
    name: "Früher Makro-Trendbruch",
    account: "makro",
    color: "#6f9dc9",
    desc: "Philosophie 1: Diagonale Downtrend-Linie und RSI-Trendlinie brechen. Höchstes Risiko, bester Preis.",
    checklist: checklistItems(
      "Diagonale Downtrend-Linie gebrochen",
      "RSI-Trendlinie gebrochen",
      "Top-down geprüft (W → 3D → D → 4H → 1H)",
    ),
  },
  {
    id: "s_p2",
    name: "Lower-High-Bruch 82.829",
    account: "makro",
    color: "#46a6a0",
    desc: "Philosophie 2: Weekly Close über 82.829 UND Weekly RSI über 62,09. Beides nötig.",
    checklist: checklistItems("Weekly Close über 82.829", "Weekly RSI über 62,09"),
  },
  {
    id: "s_p3",
    name: "4-Jahres-Zyklus-Bestätigung",
    account: "makro",
    color: "#8c83cf",
    desc: "Philosophie 3: Kein Zyklus-Bottom bis 21. Nov. Spätester Einstieg, höchste Bestätigung, schlechtester Preis.",
    checklist: checklistItems("Kein neues Tief bis 21. Nov", "Wochenschlüsse durchgehend über 82.829"),
  },
  {
    id: "s_ml",
    name: "Makro-Long Support-Zone",
    account: "makro",
    color: "#5fb0d6",
    desc: "Preis bei 81.500–82.200 plus Falling-Knife-Filter. Long-% allein ist kein Kaufsignal.",
    checklist: checklistItems(
      "Preis in Support-/Liquiditätszone (BSL/EQL)",
      "Erster Higher Low oder BOS auf 1H/4H",
      "Whale-vs-Retail-Delta positiv, 2–3 Kerzen in Folge",
      "RSI: bullische Divergenz oder Trendlinienbruch",
    ),
  },
  {
    id: "s_ladder",
    name: "Leg-Up-Ladder",
    account: "makro",
    color: "#a0b56b",
    desc: "Bestätigtes Measured-Move-Ziel mit Struktur nach oben durchbrochen: 15–25 % des verbleibenden Makro-Cash zukaufen.",
    checklist: checklistItems(
      "Ziel mit Struktur bestätigt, nicht nur Wick",
      "Add höchstens 25 % des verbleibenden Makro-Cash",
    ),
  },
  {
    id: "s_bo",
    name: "4H-Breakout über 85.900",
    account: "scalp",
    color: "#6f9dc9",
    desc: "4H-Schluss über 85.900: Ziel 87.200, dann 89.000–90.000. Invalidierung zurück unter 85.300.",
    checklist: checklistItems(
      "4H-Schluss über 85.900",
      "Stop unter 85.300",
      "S&P nicht in Ablehnung an 7.834–7.840",
    ),
  },
  {
    id: "s_short",
    name: "4H-Neckline-Short unter 84.500",
    account: "scalp",
    color: "#c7768f",
    desc: "4H-Schluss unter 84.500: Ziel 82.000–81.500, Stop über 85.300.",
    checklist: checklistItems("4H-Schluss unter 84.500", "Stop über 85.300"),
  },
  {
    id: "s_rej",
    name: "Breakout-Ablehnung 85.700–85.900",
    account: "scalp",
    color: "#c9975b",
    desc: "Preis scheitert an der Ausbruchszone: Rückfall-Risiko bis zum BOS-Test bei 82.000.",
    checklist: checklistItems("Ablehnung an 85.700–85.900 bestätigt", "Stop über der Zone"),
  },
  {
    id: "s_sweep",
    name: "BSL/EQL Liquidity Sweep",
    account: "both",
    color: "#46a6a0",
    desc: "Preis fegt eine Liquiditätszone ab, bevor der eigentliche Move kommt.",
    checklist: checklistItems("Liquidität klar abgeholt", "Reclaim, Struktur dreht"),
  },
  {
    id: "s_rsi",
    name: "RSI-Trendlinienbruch",
    account: "both",
    color: "#8c83cf",
    desc: "Diagonale RSI-Trendlinie bricht: Momentum-Signal. Keine horizontalen RSI-Level.",
    checklist: checklistItems("Diagonale RSI-Trendlinie gebrochen", "Struktur bestätigt (BOS/CHoCH)"),
  },
  {
    id: "s_bt",
    name: "Backtest-Signal (214er)",
    account: "scalp",
    color: "#5fb0d6",
    desc: "Eigene Strategie: 62,15 % Winrate im Backtest. 4x Hebel, 250 USDT Margin isoliert, etwa 2 Trades pro Monat.",
    checklist: checklistItems("4x Hebel, isoliert", "Margin rund 250 USDT", "Trailing-Stop ab +8–10 % geplant"),
  },
];

/** Hard-referenced setup id of the "Nur Backtest-Signal" toggle. */
export const BACKTEST_SETUP_ID = "s_bt";

export const DEFAULT_BACKTEST: BacktestReference = {
  winRate: 0.6215,
  avgWin: 0.1664,
  avgLoss: -0.0931,
  expectancy: 0.0682,
  label: "214 Signale",
};

export const DEFAULT_MARKET: MarketLevels = {
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

export const DEFAULT_HYBLOCK: HyblockConfig = {
  longEndpoint: "topTraderAccountsLongShort",
  longField: "",
  deltaEndpoint: "whaleRetailDelta",
  deltaField: "",
  coin: "BTC",
  exchange: "binance_perp_stable",
  timeframe: "1h",
};

/** Bundle `HM`. */
export const DEFAULT_SETTINGS: Settings = {
  currency: "USDT",
  pair: "BTC/USDT",
  startDate: "",
  capital: { makro: 20000, scalp: 5000 },
  setups: DEFAULT_SETUPS.map((s) => ({ ...s, checklist: s.checklist.map((c) => ({ ...c })) })),
  rules: DEFAULT_RULES.map((r) => ({ ...r })),
  backtest: { ...DEFAULT_BACKTEST },
  market: { ...DEFAULT_MARKET },
  hyblock: { ...DEFAULT_HYBLOCK },
};

/** Fresh deep copy of the defaults (the store must never mutate the module constant). */
export function defaultSettings(): Settings {
  return {
    ...DEFAULT_SETTINGS,
    capital: { ...DEFAULT_SETTINGS.capital },
    setups: DEFAULT_SETUPS.map((s) => ({ ...s, checklist: s.checklist.map((c) => ({ ...c })) })),
    rules: DEFAULT_RULES.map((r) => ({ ...r })),
    backtest: { ...DEFAULT_BACKTEST },
    market: { ...DEFAULT_MARKET },
    hyblock: { ...DEFAULT_HYBLOCK },
  };
}

/** Bundle `Qa`: account segment labels. */
export const ACCOUNT_LABELS: Record<"all" | AccountId, string> = { all: "Gesamt", makro: "Makro", scalp: "Scalp" };
/** Setup account badges. */
export const SETUP_ACCOUNT_LABELS: Record<"makro" | "scalp" | "both", string> = {
  makro: "Makro",
  scalp: "Scalp",
  both: "Beide",
};
/** Badge tone per setup account (steel / teal / mute). */
export const SETUP_ACCOUNT_TONES: Record<"makro" | "scalp" | "both", "steel" | "teal" | "mute"> = {
  makro: "steel",
  scalp: "teal",
  both: "mute",
};

/** Bundle `_he`: conviction levels. */
export const CONVICTION_LEVELS: readonly { v: Conviction; label: string; color: string }[] = [
  { v: 1, label: "Schwach", color: "#4a4a4a" },
  { v: 2, label: "Gering", color: "#767676" },
  { v: 3, label: "Mittel", color: "#a8a8a8" },
  { v: 4, label: "Hoch", color: "#dedede" },
  { v: 5, label: "Top", color: "#ffffff" },
];

/** Result badge labels and tones. */
export const RESULT_LABELS: Record<TradeResult, string> = {
  win: "Gewinn",
  loss: "Verlust",
  be: "Break-even",
  open: "Offen",
};
export const RESULT_TONES: Record<TradeResult, "win" | "loss" | "mute" | "warn"> = {
  win: "win",
  loss: "loss",
  be: "mute",
  open: "warn",
};

/** Leverage rule per account (scalp 4x, makro max 5x). */
export const LEVERAGE_RULE: Record<AccountId, number> = { scalp: 4, makro: 5 };
export const LEVERAGE_HELP: Record<AccountId, string> = { scalp: "Regel: 4x", makro: "Regel: 2–5x" };
export const LEVERAGE_WARNING: Record<AccountId, string> = {
  scalp: "Über deiner Regel (4x)",
  makro: "Über deiner Regel (max. 5x)",
};

export const HYBLOCK_LINK = "https://hyblockcapital.com/console?user=HBC&dashboard=default&shared=true";

/** Sample-size thresholds used across explainers/cards. */
export const MIN_TRADES_STABLE = 30;
export const MIN_TRADES_PROJECTION = 10;
export const MIN_DAYS_PROJECTION = 30;
export const MIN_TRADES_SETUP_FAIR = 5;

/** First palette colour not used by `setups`, cycling by count when all are taken. */
export function nextSetupColor(setups: readonly Pick<Setup, "color">[]): string {
  const used = new Set(setups.map((s) => s.color));
  const free = SETUP_PALETTE.find((c) => !used.has(c));
  return free ?? SETUP_PALETTE[setups.length % SETUP_PALETTE.length] ?? "#6f9dc9";
}

// Bundle aliases
export const HM = DEFAULT_SETTINGS;
export const jG = DEFAULT_SETUPS;
export const LG = DEFAULT_RULES;
export const Bf = SETUP_PALETTE;
export const GM = TIMEFRAMES;
export const KM = EMOTIONS;
export const Qa = ACCOUNT_LABELS;
