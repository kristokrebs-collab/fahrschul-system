/**
 * zod schemas for persisted data (migration + backup import). All `passthrough()` so unknown keys survive.
 */
import { z } from "zod";

/** Legacy records store numbers as numbers, form strings ("100", "1,5") or null; `normalizeTrade` parses them. */
const numOrNull = z.union([z.number(), z.string(), z.null()]).optional();
/** Legacy text fields may be `null` (old forms wrote `null` for empty inputs). */
const textOrNull = z.string().nullable().optional();

export const ChecklistItemSchema = z.object({ id: z.string(), text: z.string() }).passthrough();
export const RuleSchema = z.object({ id: z.string(), text: z.string() }).passthrough();

export const SetupSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    account: z.enum(["makro", "scalp", "both"]).optional(),
    color: z.string().optional(),
    desc: z.string().optional(),
    checklist: z.array(ChecklistItemSchema).optional(),
  })
  .passthrough();

export const BacktestReferenceSchema = z
  .object({
    winRate: z.number(),
    avgWin: z.number(),
    avgLoss: z.number(),
    expectancy: z.number(),
    label: z.string(),
  })
  .passthrough();

export const MarketLevelsSchema = z
  .object({
    symbol: z.string(),
    longTrigger: z.number(),
    longStop: z.number(),
    shortTrigger: z.number(),
    lowerHigh: z.number(),
    rsiWeekly: z.number(),
    invalidation: z.number(),
    zoneLow: z.number(),
    zoneHigh: z.number(),
  })
  .passthrough();

export const HyblockConfigSchema = z
  .object({
    longEndpoint: z.string(),
    longField: z.string(),
    deltaEndpoint: z.string(),
    deltaField: z.string(),
    coin: z.string(),
    exchange: z.string(),
    timeframe: z.string(),
  })
  .passthrough();

/** Raw (pre-normalise) settings: every field optional, numbers may be strings (legacy form values). */
export const RawSettingsSchema = z
  .object({
    currency: z.string().optional(),
    pair: z.string().optional(),
    startDate: z.string().optional(),
    capital: z
      .object({ makro: z.union([z.number(), z.string()]).optional(), scalp: z.union([z.number(), z.string()]).optional() })
      .passthrough()
      .optional(),
    setups: z.array(SetupSchema).optional(),
    rules: z.array(RuleSchema).optional(),
    backtest: BacktestReferenceSchema.partial().optional(),
    market: MarketLevelsSchema.partial().optional(),
    hyblock: HyblockConfigSchema.partial().optional(),
    /** Other version / NEW: mistake tags and the entry-check config (both passthrough, defaulted on read). */
    mistakes: z.array(z.unknown()).optional(),
    signals: z.unknown().optional(),
  })
  .passthrough();

/** Fully normalised settings. */
export const SettingsSchema = z
  .object({
    currency: z.string(),
    pair: z.string(),
    startDate: z.string(),
    capital: z.object({ makro: z.number(), scalp: z.number() }).passthrough(),
    setups: z.array(SetupSchema),
    rules: z.array(RuleSchema),
    backtest: BacktestReferenceSchema,
    market: MarketLevelsSchema,
    hyblock: HyblockConfigSchema,
    mistakes: z.array(z.string()),
    signals: z.unknown().optional(),
  })
  .passthrough();

/**
 * Trade record as persisted. Deliberately no stricter than `normalizeTrade`: validate AFTER normalising
 * (`TradeSchema.safeParse(normalizeTrade(raw))`, see `validateTrades`) so only truly broken records (no id,
 * not an object) are quarantined. Enumerations are `string` because the normaliser coerces them.
 */
export const TradeSchema = z
  .object({
    id: z.string().min(1),
    account: z.string().nullable().optional(),
    side: z.string().nullable().optional(),
    status: z.string().nullable().optional(),
    date: textOrNull,
    pair: textOrNull,
    timeframe: textOrNull,
    entry: numOrNull,
    stop: numOrNull,
    target: numOrNull,
    exit: numOrNull,
    size: numOrNull,
    leverage: numOrNull,
    fees: numOrNull,
    pnlManual: numOrNull,
    setups: z.array(z.unknown()).nullable().optional(),
    checks: z.record(z.unknown()).nullable().optional(),
    conviction: numOrNull,
    followedPlan: z.boolean().nullable().optional(),
    emotion: textOrNull,
    reason: textOrNull,
    notes: textOrNull,
    chart: textOrNull,
    pnl: numOrNull,
    r: numOrNull,
    createdAt: textOrNull,
    updatedAt: textOrNull,
    /** Other version / NEW: mistake tags (strings kept by `normalizeTrade`) and the opaque entry-check snapshot. */
    mistakes: z.array(z.unknown()).nullable().optional(),
    signal: z.unknown().optional(),
  })
  .passthrough();

/** Hyblock reading as persisted; like `TradeSchema` validated after `normalizeReading` (only `id`/`at` are required). */
export const HyblockReadingSchema = z
  .object({
    id: z.string().min(1),
    at: z.string().min(1),
    longPct: numOrNull,
    delta: numOrNull,
    deltaCandles: numOrNull,
    structure: z.unknown().optional(),
    rsi: z.unknown().optional(),
    note: textOrNull,
  })
  .passthrough();

/**
 * Backup envelope – tolerant, so every backup the two journal versions ever wrote imports:
 * ours `{ exportedAt, settings, trades, hyblock, schemaVersion, days? }`, the other version's
 * `{ exportedAt, settings, trades }` and `{ trades }` (a bare `[...]` array is wrapped by `parseBackup`).
 * Each part is optional, but present parts must have the right type (`settings` an object, `trades` an array), and
 * `parseBackup` rejects an envelope with neither `trades` nor `settings`. Records are validated one by one
 * (`validateTrades` / `validateReadings` in `@/store/backup`) so a single broken record does not reject the file.
 */
export const JsonBackupSchema = z
  .object({
    exportedAt: z.string().optional(),
    settings: RawSettingsSchema.optional(),
    trades: z.array(z.unknown()).optional(),
    hyblock: z.array(z.unknown()).optional(),
    schemaVersion: z.number().optional(),
    days: z.record(z.unknown()).optional(),
  })
  .passthrough();

export type TradeInput = z.infer<typeof TradeSchema>;
export type HyblockReadingInput = z.infer<typeof HyblockReadingSchema>;
export type JsonBackupInput = z.infer<typeof JsonBackupSchema>;
export type RawSettingsInput = z.infer<typeof RawSettingsSchema>;
