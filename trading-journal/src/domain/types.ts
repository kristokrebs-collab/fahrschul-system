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

  // ── Journal v3 (Wave-0 contract, owner P06). ALL optional and additive: a record without them loads, derives and
  // exports exactly as before (`normalizeTrade` only coerces a key that is present, never adds one). See README.

  /** Exit time, same local wall-clock format as `date` ("YYYY-MM-DDTHH:mm", seconds optional). Absent = unknown. */
  exitDate?: string;
  /** Instrument kind; absent = perpetual (the journal's historic default). */
  market?: MarketKind;
  /** Exchange / sync provenance: venue id ("bitunix", "binance", …), sub-account label, the venue's id of the position. */
  exchange?: string;
  exchangeAccount?: string;
  externalId?: string;
  /** What wrote the exchange fields ("bitunix-api", "csv:binance", …) and when (ISO). */
  syncSource?: string;
  syncedAt?: string;
  /** Position quantity in base units (contracts). `size` stays the notional in quote currency (= qty × entry). */
  qty?: number | null;
  /** Executions; when present (P06 `fills.ts`) Ø entry / Ø exit / partial P&L are derived from them. */
  fills?: Fill[];
  /** Funding in `settings.currency`; positive = paid (cost), negative = received. Only counted when set. */
  fundingFees?: number | null;
  /** Execution slippage in `settings.currency`, positive = cost (informational; already inside the fill prices). */
  slippage?: number | null;
  /** Planned entry price (limit) – slippage reference. */
  plannedEntry?: number | null;
  /** Initial margin in `settings.currency`, margin mode and the liquidation price at entry. */
  margin?: number | null;
  marginMode?: MarginMode;
  liqPrice?: number | null;
  /** Grouping: one position split over several records, a free group and the hedged trade's id. */
  positionId?: string;
  groupId?: string;
  hedgeOf?: string;
  /** Free tags (trimmed, unique) and a 1–5 rating of the execution. */
  tags?: string[];
  rating?: TradeRating | null;
  /** Screenshot references (blobs live in IDB / Supabase Storage, never inline). */
  screenshots?: ScreenshotRef[];
  /** Chart drawings in time/price coordinates. */
  annotations?: Annotation[];
  /**
   * Excursion: max adverse / favourable move from the (average) entry as a NON-NEGATIVE price distance, the same in R
   * (distance ÷ |entry − stop|), and ATR(14) at entry in % of price.
   */
  mae?: number | null;
  mfe?: number | null;
  maeR?: number | null;
  mfeR?: number | null;
  atrPct?: number | null;
  /** Stop moves (oldest first) and the take-profit ladder. */
  stopHistory?: StopChange[];
  targets?: TradeTarget[];
  /** Psychology of this trade. */
  psych?: TradePsych;
  /** Who created the record; absent = manual entry. */
  origin?: TradeOrigin;
  /** Box-zu-Box context at entry (P02 `BoxSnapshot`, `@/market/boxes/snapshot`). Opaque here, kept verbatim. */
  boxSnap?: unknown;
}

// ── Journal v3 value types (Wave-0 contract) ────────────────────────────────────────────────────────────────────
export type MarketKind = "perp" | "spot";
export type MarginMode = "isolated" | "cross";
export type TradeRating = 1 | 2 | 3 | 4 | 5;
export type FillSide = "open" | "close";
export type FillKind = "entry" | "add" | "partial" | "exit";

/** One execution. `at` uses the `date` format (local wall clock, seconds optional). `fee` in `settings.currency`. */
export interface Fill {
  id: string;
  at: string;
  side: FillSide;
  price: number;
  qty: number;
  fee?: number | null;
  kind: FillKind;
}

/**
 * Reference to a screenshot. `store`: "idb" = local blob under `storageKey("shots")` (`key` = blob key),
 * "cloud" = Supabase Storage bucket `screenshots` (`key` = object path `<uid>/<file>`), "url" = external http(s) link.
 */
export interface ScreenshotRef {
  id: string;
  store: "idb" | "cloud" | "url";
  key?: string;
  url?: string;
  mime?: string;
  w?: number;
  h?: number;
  caption?: string;
  /** ISO time the shot was added. */
  at?: string;
}

export type AnnotationKind = "hline" | "trend" | "box" | "text" | "arrow";
/** One chart drawing; `time` is a UTC timestamp in SECONDS (lightweight-charts `UTCTimestamp`), `price` in quote. */
export interface Annotation {
  id: string;
  kind: AnnotationKind;
  points: { time: number; price: number }[];
  text?: string;
  color?: string;
  /** Timeframe the drawing was made on. */
  tf?: string;
}

/** A stop move: `at` in the `date` format, `price` the new stop. */
export interface StopChange {
  at: string;
  price: number;
  source?: "manual" | "exchange";
  note?: string;
}

/** One rung of the take-profit ladder; `pct` = share of the position (0–100). */
export interface TradeTarget {
  price: number;
  pct?: number | null;
  qty?: number | null;
  hit?: boolean;
  label?: string;
}

/** Psychology of one trade; `stress` / `confidence` 1–5. `flags` are behaviour keys (P04 `BehaviorKey`) or free words. */
export interface TradePsych {
  stress?: number | null;
  confidence?: number | null;
  flags?: string[];
  exitReason?: string;
  preNote?: string;
  postNote?: string;
}

export type TradeOriginKind = "manual" | "api" | "csv" | "bot" | "webhook";
export interface TradeOrigin {
  kind: TradeOriginKind;
  botId?: string;
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
  /**
   * Schlüsselmarken (F09/F08/F22): the user's own key levels, the precedence, the alert settings. Versioned passthrough
   * (`{ v: 1, levels, precedence, alerts, planToast }`, see `@/domain/keylevels`); absent until the user adds a level.
   * The five fixed levels stay in `market` and are derived into the model on read.
   */
  keyLevels?: unknown;
  /**
   * Preis- und RSI-Struktur (F05): the timeframes read and the chart switch. Versioned passthrough (`{ v: 1, tfs, chart }`,
   * see `@/domain/trendlines`); absent until the user changes something.
   */
  trendlines?: unknown;
  /**
   * Forward test (F23): the virtual accounts. Versioned passthrough (`{ v: 1, accounts: [{ id, … }] }`, see `@/domain/forward`:
   * frozen rules, start, cursor of the engine, closed trades – the cursor is a cache the candles can rebuild); absent until the
   * user starts an account. An id list, so the cloud / two-tab merge works per account and per trade.
   */
  forward?: unknown;
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
