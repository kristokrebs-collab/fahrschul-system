/**
 * zod schemas for persisted data (migration + backup import). All `passthrough()` so unknown keys survive.
 */
import { z } from "zod";

const numOrNull = z.union([z.number(), z.null()]).optional().nullable();

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
  })
  .passthrough();

export const TradeSchema = z
  .object({
    id: z.string(),
    account: z.enum(["makro", "scalp"]).optional(),
    side: z.enum(["long", "short"]).optional(),
    status: z.string().optional(),
    date: z.string().optional(),
    pair: z.string().optional(),
    timeframe: z.string().optional(),
    entry: numOrNull,
    stop: numOrNull,
    target: numOrNull,
    exit: numOrNull,
    size: numOrNull,
    leverage: numOrNull,
    fees: numOrNull,
    pnlManual: numOrNull,
    setups: z.array(z.string()).optional(),
    checks: z.record(z.boolean()).optional(),
    conviction: numOrNull,
    followedPlan: z.boolean().nullable().optional(),
    emotion: z.string().optional(),
    reason: z.string().optional(),
    notes: z.string().optional(),
    chart: z.string().optional(),
    pnl: numOrNull,
    r: numOrNull,
    createdAt: z.string().optional(),
    updatedAt: z.string().optional(),
  })
  .passthrough();

export const HyblockReadingSchema = z
  .object({
    id: z.string(),
    at: z.string(),
    longPct: z.number(),
    delta: z.number(),
    deltaCandles: z.number(),
    structure: z.boolean(),
    rsi: z.boolean(),
    note: z.string().optional(),
  })
  .passthrough();

export const JsonBackupSchema = z
  .object({
    exportedAt: z.string(),
    settings: RawSettingsSchema,
    trades: z.array(TradeSchema),
    hyblock: z.array(HyblockReadingSchema).optional(),
    schemaVersion: z.number().optional(),
  })
  .passthrough();

export type TradeInput = z.infer<typeof TradeSchema>;
export type HyblockReadingInput = z.infer<typeof HyblockReadingSchema>;
export type JsonBackupInput = z.infer<typeof JsonBackupSchema>;
export type RawSettingsInput = z.infer<typeof RawSettingsSchema>;
