/**
 * Domain types – 1:1 compatible with the existing localStorage data (`tj2-trades`, `tj2-settings`, `tj2-hyblock`).
 * Do not rename fields: the persisted JSON of existing users must keep loading.
 */
export type AccountId = "makro" | "scalp";
export type SetupAccount = AccountId | "both";
export type Side = "long" | "short";
export type TradeStatus = "closed" | "open";
export type TradeResult = "win" | "loss" | "be" | "open";
export type Conviction = 1 | 2 | 3 | 4 | 5;

/** Trade timeframes (30m/45m/2h added for the other journal version's data and the multi-TF ladder). */
export const TIMEFRAMES = ["1m", "5m", "15m", "30m", "45m", "1h", "2h", "4h", "1D", "3D", "1W"] as const;
export type Timeframe = (typeof TIMEFRAMES)[number];
export const EMOTIONS = ["Ruhig", "Fokussiert", "Unsicher", "FOMO", "Gierig", "Revenge"] as const;
export const SETUP_COLORS = [
  "#6f9dc9",
  "#46a6a0",
  "#8c83cf",
  "#c9975b",
  "#c7768f",
  "#5fb0d6",
  "#9aa9bb",
  "#a0b56b",
] as const;

export interface Trade {
  id: string;
  /** missing in old records → treated as "scalp" */
  account?: AccountId;
  side: Side;
  status: TradeStatus;
  /** local wall-clock "YYYY-MM-DDTHH:mm" */
  date: string;
  pair: string;
  timeframe: string;
  entry: number | null;
  stop: number | null;
  target: number | null;
  /** null while open */
  exit: number | null;
  size: number | null;
  leverage: number | null;
  fees: number | null;
  pnlManual: number | null;
  setups: string[];
  checks: Record<string, boolean>;
  conviction: Conviction | null;
  followedPlan: boolean | null;
  emotion: string;
  reason: string;
  notes: string;
  chart: string;
  pnl: number | null;
  r: number | null;
  createdAt: string;
  updatedAt: string;
  /** Mistake tags (`settings.mistakes` vocabulary); `normalizeTrade` always fills `[]`. Other version: same field. */
  mistakes?: string[];
  /**
   * Entry-check snapshot stored when the trade was entered (other version's `SignalSnap`). Opaque here: kept
   * verbatim through every read/write/backup path; the signal module parses it.
   */
  signal?: unknown;
}

export interface ChecklistEntry {
  id: string;
  text: string;
}

export interface EnrichedTrade extends Trade {
  risk: number | null;
  rr: number | null;
  move: number | null;
  result: TradeResult;
  items: ChecklistEntry[];
  checked: number;
  complete: boolean | null;
}

export interface ChecklistItem {
  id: string;
  text: string;
}

export interface Rule {
  id: string;
  text: string;
}

export interface Setup {
  id: string;
  name: string;
  account: SetupAccount;
  color: string;
  desc: string;
  checklist: ChecklistItem[];
}

export interface BacktestReference {
  winRate: number;
  avgWin: number;
  avgLoss: number;
  expectancy: number;
  label: string;
}

export interface MarketLevels {
  symbol: string;
  longTrigger: number;
  longStop: number;
  shortTrigger: number;
  lowerHigh: number;
  rsiWeekly: number;
  invalidation: number;
  zoneLow: number;
  zoneHigh: number;
}

export interface HyblockConfig {
  longEndpoint: string;
  longField: string;
  deltaEndpoint: string;
  deltaField: string;
  coin: string;
  exchange: string;
  timeframe: string;
}

export interface Settings {
  currency: string;
  pair: string;
  startDate: string;
  capital: { makro: number; scalp: number };
  setups: Setup[];
  rules: Rule[];
  backtest: BacktestReference;
  market: MarketLevels;
  hyblock: HyblockConfig;
  /** Mistake tags offered in the trade form; `normalizeSettings` fills `DEFAULT_MISTAKES` when missing. */
  mistakes: string[];
  /**
   * Entry-check configuration (other version's `SignalCfg`). Passthrough: kept verbatim (also unknown keys); the
   * signal module parses it with its own defaults. Absent until the user saves the signal settings.
   */
  signals?: unknown;
}

/** One trading day's journal entry (`tj2-days`, key `YYYY-MM-DD` local date). Unknown keys survive. */
export interface DayNote {
  /** Free text (Tagesnotiz). */
  note: string;
  /** Optional pre-market plan / post-session review (Tradezella day journal). */
  plan?: string;
  review?: string;
  /** 1 (schlecht) … 5 (sehr gut); `null`/absent = not rated. */
  mood?: DayMood | null;
  updatedAt: string;
}
export type DayMood = 1 | 2 | 3 | 4 | 5;
/** `tj2-days`: `{ "2026-10-07": DayNote, … }`. */
export type DayNotes = Record<string, DayNote>;
/** Input of `saveDay`: every field optional, `updatedAt` is set by the store. */
export type DayNoteInput = Partial<Omit<DayNote, "updatedAt">> & Record<string, unknown>;

export interface HyblockReading {
  id: string;
  at: string;
  longPct: number;
  delta: number;
  deltaCandles: number;
  structure: boolean;
  rsi: boolean;
  note: string;
}

export interface JsonBackup {
  exportedAt: string;
  settings: Settings;
  trades: Trade[];
  /** NEW */
  hyblock?: HyblockReading[];
  /** NEW */
  schemaVersion?: number;
  /** NEW: day journal (`tj2-days`). Absent in older backups and in the other version's backups. */
  days?: DayNotes;
}

export interface TradeFilter {
  q: string;
  setup: "all" | "__none" | string;
  /** "be" is NEW */
  result: "all" | "win" | "loss" | "open" | "be";
  side: "all" | Side;
  acc: "all" | AccountId;
}

export interface StoreApi {
  saveTrade(t: Omit<Trade, "id"> & { id?: string }): Promise<void>;
  deleteTrade(id: string): Promise<void>;
  saveSettings(s: Settings): Promise<void>;
  saveHyblock(r: Omit<HyblockReading, "id"> & { id?: string }): Promise<void>;
  deleteHyblock(id: string): Promise<void>;
  /** NEW: upserts the day journal entry of `date` (`YYYY-MM-DD`), merged over the stored one; empty → removed. */
  saveDay(date: string, input: DayNoteInput): Promise<void>;
  /** NEW: removes the day journal entry of `date`. */
  deleteDay(date: string): Promise<void>;
}

export type StoreMode = "connecting" | "local" | "cloud" | "error";

export interface Store {
  trades: Trade[];
  enriched: EnrichedTrade[];
  settings: Settings;
  hyblock: HyblockReading[];
  mode: StoreMode;
  loaded: boolean;
  api: { current: StoreApi | null };
}
