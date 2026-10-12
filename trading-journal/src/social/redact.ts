/**
 * Redaction (P12): what leaves the journal when a trader shares something. PURE (relative type imports only).
 *
 * Default = the minimum a review needs: pair, side, timeframe, entry DAY, result, R, move in %, planned CRV, rating,
 * "nach Plan", checklist count and the R excursion. Never: money (P&L, fees, size, margin), the account and its capital,
 * notes, reasons, screenshots, the exchange or any id. Details are opt-in per share (`RedactOptions`).
 * The server re-validates the result with the strict schemas of `contract.ts`.
 */
import type { EnrichedTrade, Setup } from "../domain/types";
import { strategyOf } from "../domain/strategy/types";
import { SharedSetupSchema, SharedStatsSchema, SharedTradeSchema, type SharedSetup, type SharedStats, type SharedTrade } from "./contract";
import type { SocialStats } from "./metrics";

export interface RedactOptions {
  /** Entry / exit / stop / target prices and the leverage. */
  prices?: boolean;
  /** The entry time (HH:mm), the holding time. */
  time?: boolean;
  /** Names of the Entscheidungsgrundlagen. */
  setups?: boolean;
  /** Tags, mistake tags, the emotion chip. */
  tags?: boolean;
}

export const REDACT_DEFAULTS: Readonly<Required<RedactOptions>> = Object.freeze({ prices: false, time: false, setups: false, tags: false });

const fin = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const round = (v: number, d: number) => Math.round(v * 10 ** d) / 10 ** d;
const clampN = (v: unknown, lo: number, hi: number, d: number): number | null => (fin(v) ? round(Math.max(lo, Math.min(hi, v)), d) : null);
const texts = (v: unknown, maxItems: number, maxLen: number): string[] => {
  if (!Array.isArray(v)) return [];
  const out: string[] = [];
  for (const x of v) {
    if (typeof x !== "string") continue;
    const s = x.trim().slice(0, maxLen);
    if (s && !out.includes(s)) out.push(s);
    if (out.length >= maxItems) break;
  }
  return out;
};

/** Minutes between two journal wall-clock stamps, null when unknown. */
function holdMinutes(date: string, exitDate: string | undefined): number | null {
  if (!exitDate) return null;
  const a = Date.parse(date);
  const b = Date.parse(exitDate);
  return Number.isFinite(a) && Number.isFinite(b) && b >= a ? Math.round((b - a) / 60_000) : null;
}

/** The redacted payload of one trade (always valid against `SharedTradeSchema`). */
export function redactTrade(t: EnrichedTrade, opts: RedactOptions = {}, setups: readonly Pick<Setup, "id" | "name">[] = []): SharedTrade {
  const o = { ...REDACT_DEFAULTS, ...opts };
  const pair = (t.pair ?? "").trim().toUpperCase().replace(/[^A-Z0-9:._/-]/g, "").slice(0, 24) || "-";
  const day = /^\d{4}-\d{2}-\d{2}/.test(t.date ?? "") ? t.date.slice(0, 10) : null;
  const total = Array.isArray(t.items) ? t.items.length : 0;
  const rating = fin(t.rating) && t.rating >= 1 && t.rating <= 5 ? Math.round(t.rating) : null;
  const out: SharedTrade = {
    v: 1,
    kind: "trade",
    pair,
    side: t.side === "short" ? "short" : "long",
    timeframe: (t.timeframe ?? "").trim().slice(0, 8) || null,
    day,
    result: t.result,
    r: clampN(t.r, -100, 100, 2),
    movePct: fin(t.move) ? clampN(t.move * 100, -1000, 1000, 1) : null,
    rr: clampN(t.rr, 0, 100, 2),
    rating,
    followedPlan: typeof t.followedPlan === "boolean" ? t.followedPlan : null,
    checklist: total > 0 ? { done: Math.max(0, Math.min(total, Math.min(99, t.checked ?? 0))), total: Math.min(99, total) } : null,
  };
  const maeR = clampN(t.maeR, 0, 100, 2);
  const mfeR = clampN(t.mfeR, 0, 100, 2);
  if (maeR != null) out.maeR = maeR;
  if (mfeR != null) out.mfeR = mfeR;
  if (o.time) {
    if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(t.date ?? "")) out.time = t.date.slice(11, 16);
    const hold = holdMinutes(t.date, t.exitDate);
    if (hold != null) out.holdMin = Math.min(525_600, hold);
  }
  if (o.prices) {
    out.entry = clampN(t.entry, 0, 1e9, 8);
    out.exit = clampN(t.exit, 0, 1e9, 8);
    out.stop = clampN(t.stop, 0, 1e9, 8);
    out.target = clampN(t.target, 0, 1e9, 8);
    out.leverage = clampN(t.leverage, 0, 1000, 2);
  }
  if (o.setups) {
    const names = (t.setups ?? []).map((id) => setups.find((s) => s.id === id)?.name ?? "").filter(Boolean);
    out.setups = texts(names, 5, 40);
  }
  if (o.tags) {
    out.tags = texts(t.tags, 8, 24);
    out.mistakes = texts(t.mistakes, 8, 40);
    const emotion = (t.emotion ?? "").trim().slice(0, 24);
    if (emotion) out.emotion = emotion;
  }
  // belt and braces: anything outside the schema throws here, on the device, before it could leave
  return SharedTradeSchema.parse(out);
}

/** R-based playbook figures of a setup (optional on a setup share). */
export interface SetupFigures {
  trades: number;
  winRate: number | null;
  expectancyR: number | null;
}

/** An Entscheidungsgrundlage without personal data (no example trades, no money; risk only in % / R). */
export function redactSetup(setup: Setup, figures: SetupFigures | null = null): SharedSetup {
  const x = strategyOf(setup);
  const rm = x.riskModel;
  const risk = rm.riskPct != null || rm.maxLeverage != null || rm.minRR != null || rm.stop != null ? { riskPct: rm.riskPct, maxLeverage: rm.maxLeverage, minRR: rm.minRR, stop: rm.stop } : null;
  const out: SharedSetup = {
    v: 1,
    kind: "setup",
    name: (setup.name ?? "").trim().slice(0, 40) || "Grundlage",
    desc: (setup.desc ?? "").trim().slice(0, 500),
    account: setup.account === "makro" || setup.account === "scalp" ? setup.account : "both",
    color: /^#[0-9a-fA-F]{6}$/.test(setup.color ?? "") ? setup.color : "#9b9b9b",
    checklist: texts((setup.checklist ?? []).map((c) => c.text), 30, 120),
    entryCriteria: texts(x.entryCriteria.map((c) => c.text), 30, 160),
    exitCriteria: texts(x.exitCriteria.map((c) => c.text), 30, 160),
    risk,
    tags: texts(x.tags, 20, 40),
    markets: x.markets.filter((m) => /^[A-Z0-9]{2,20}$/.test(m)).slice(0, 20),
    tf: texts(x.tf, 12, 8),
    stats: figures
      ? {
          trades: Math.max(0, Math.min(100_000, Math.round(figures.trades))),
          winRate: clampN(figures.winRate, 0, 100, 1),
          expectancyR: clampN(figures.expectancyR, -100, 100, 2),
        }
      : null,
  };
  return SharedSetupSchema.parse(out);
}

/** A trader's window figures as a share card. */
export function redactStats(s: SocialStats): SharedStats {
  return SharedStatsSchema.parse({
    v: 1,
    kind: "stats",
    windowDays: s.windowDays,
    trades: s.trades,
    expectancyR: s.expectancyR,
    winRate: s.winRate,
    discipline: s.discipline,
    consistency: s.consistency,
  });
}

/** Which details of a payload are switched on (the share sheet's preview lists them). */
export function sharedDetails(p: SharedTrade): (keyof RedactOptions)[] {
  const out: (keyof RedactOptions)[] = [];
  if (p.entry !== undefined || p.exit !== undefined) out.push("prices");
  if (p.time !== undefined || p.holdMin !== undefined) out.push("time");
  if (p.setups !== undefined) out.push("setups");
  if (p.tags !== undefined || p.mistakes !== undefined) out.push("tags");
  return out;
}
