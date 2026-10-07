/**
 * Default settings and constants – verbatim from the bundle (`HM`, `jG`, `LG`, `Bf`, `GM`, `KM`, `YM`, `BG`, `Qa`, `_he`).
 * The edition-specific values (setups, rules, backtest, levels, capital, leverage copy) live in `./edition/personal.ts`
 * (web root + "persönlich" file, verbatim bundle strings – do not paraphrase) and `./edition/share.ts` ("zum Teilen").
 * Additions shared by both editions: the multi-timeframe signal setup `s_mtf` (`MTF_SETUP`) and the mistake tags
 * (`DEFAULT_MISTAKES`), both 1:1 from the other journal version so its data round-trips.
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
import { ED } from "./edition";
import { MTF_SETUP } from "./edition/mtf";

export { EMOTIONS, SETUP_COLORS, TIMEFRAMES };
export const WEEKDAY_NAMES = WEEKDAYS;
export const MONTH_NAMES = MONTHS_SHORT;

/** Bundle `Bf`: setup colour palette; a new setup takes the first unused colour, then cycles. */
export const SETUP_PALETTE: readonly string[] = SETUP_COLORS;

/** Bundle `qn`: checklist items with ids c1, c2, … in order. */
export const checklistItems = (...texts: string[]): ChecklistItem[] =>
  texts.map((text, i) => ({ id: "c" + (i + 1), text }));

/** Bundle `LG`: global rules (`settings.rules`), checklist ids `g:{id}`. */
export const DEFAULT_RULES: readonly Rule[] = ED.RULES;

/** Id of the multi-timeframe signal setup (checklist ids `mtf_base|mtf_next|mtf_third|mtf_rsi|mtf_zone`). */
export const MTF_SETUP_ID = "s_mtf";
export { MTF_SETUP };

/**
 * Bundle `jG` (personal: the 11 bundle setups + `s_mtf` appended; share: `s_mtf` + a neutral `s_bt`).
 * `s_bt` is hard-referenced by the Backtest comparison.
 */
export const DEFAULT_SETUPS: readonly Setup[] = ED.SETUPS.some((s) => s.id === MTF_SETUP_ID) ? ED.SETUPS : [...ED.SETUPS, MTF_SETUP];

/** Mistake tags offered in the trade form (`settings.mistakes`), 1:1 from the other journal version. */
export const DEFAULT_MISTAKES: readonly string[] = [
  "Zu früh rein",
  "Kein Stop",
  "Stop verschoben",
  "Zu großer Hebel",
  "FOMO-Einstieg",
  "Gegen den Plan",
  "Zu früh raus",
  "Revenge-Trade",
];

/** Hard-referenced setup id of the "Nur Backtest-Signal" toggle. */
export const BACKTEST_SETUP_ID = "s_bt";

export const DEFAULT_BACKTEST: BacktestReference = ED.BACKTEST;

export const DEFAULT_MARKET: MarketLevels = ED.MARKET;

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
  capital: { ...ED.CAPITAL },
  setups: DEFAULT_SETUPS.map((s) => ({ ...s, checklist: s.checklist.map((c) => ({ ...c })) })),
  rules: DEFAULT_RULES.map((r) => ({ ...r })),
  backtest: { ...DEFAULT_BACKTEST },
  market: { ...DEFAULT_MARKET },
  hyblock: { ...DEFAULT_HYBLOCK },
  mistakes: [...DEFAULT_MISTAKES],
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
    mistakes: [...DEFAULT_MISTAKES],
  };
}

/**
 * True when the 4H trigger levels are set. The share edition starts with 0 = "nicht gesetzt": the market panel,
 * scenario texts and the scenario toast must stay hidden until the user enters levels (Einstellungen → Markt).
 */
export function levelsConfigured(settings: { market: Pick<MarketLevels, "longTrigger" | "shortTrigger"> }): boolean {
  const m = settings.market;
  return m.longTrigger > 0 && m.shortTrigger > 0;
}

/** True when the weekly confirmation level (`lowerHigh`) is set (0 = not set). */
export function weeklyConfigured(settings: { market: Pick<MarketLevels, "lowerHigh"> }): boolean {
  return settings.market.lowerHigh > 0;
}

/** True when the support zone is set (`zoneLow` and `zoneHigh` > 0, `zoneHigh ≥ zoneLow`). */
export function zoneConfigured(settings: { market: Pick<MarketLevels, "zoneLow" | "zoneHigh"> }): boolean {
  const m = settings.market;
  return m.zoneLow > 0 && m.zoneHigh > 0 && m.zoneHigh >= m.zoneLow;
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
export const LEVERAGE_RULE: Record<AccountId, number> = { ...ED.LEVERAGE_RULE };
export const LEVERAGE_HELP: Record<AccountId, string> = { ...ED.COPY.leverageHelp };
export const LEVERAGE_WARNING: Record<AccountId, string> = { ...ED.COPY.leverageWarning };

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
