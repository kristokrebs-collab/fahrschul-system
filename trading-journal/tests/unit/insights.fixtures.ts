import type { EnrichedTrade, Settings, Trade } from "@/domain/types";
import { defaultSettings } from "@/domain/defaults";
import { enrichTrades } from "@/domain/enrich";
import { nowLocalInput } from "@/lib/dates";
import { mkTrade } from "./domain.fixtures";

export interface QuickTrade extends Partial<Trade> {
  /** realised P&L (stored as `pnlManual`) */
  p?: number;
  /** risk in money → `r = p / risk` (entry 100, stop 99, size 100·risk) */
  risk?: number;
}

let seq = 0;

/** A closed trade with a manual P&L; `risk` gives it an R value. */
export function qt(date: string, { p = 0, risk, ...rest }: QuickTrade = {}): Trade {
  seq++;
  const withRisk = risk != null ? { entry: 100, stop: 99, size: 100 * risk } : {};
  return mkTrade({ id: rest.id ?? `t${seq}`, date, pnlManual: p, setups: ["s_bo"], stop: risk != null ? 99 : 1, ...withRisk, ...rest });
}

/** Local wall-clock input string of a UTC instant (timezone-independent tests). */
export const utc = (y: number, m: number, d: number, h = 12, min = 0): string => nowLocalInput(new Date(Date.UTC(y, m - 1, d, h, min)));

export function settingsWith(patch: Partial<Settings> = {}): Settings {
  return { ...defaultSettings(), ...patch };
}

export function enrich(list: Trade[], s: Settings = settingsWith()): EnrichedTrade[] {
  return enrichTrades(list, s);
}

export const closedOf = (list: EnrichedTrade[]): EnrichedTrade[] => list.filter((t) => t.result !== "open");

/** The other journal's stored snapshot shape (`SignalSnap`). */
export function theirSnap(side: "long" | "short", strength: number, extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    at: "2026-03-02T10:00:00.000Z",
    side,
    score: strength * 20,
    strength,
    tiers: strength,
    label: "x",
    valid: strength > 0,
    rsiOk: false,
    zoneOk: false,
    zone: null,
    deep: false,
    tfs: [{ tf: "30m", kind: "bottom", wt: -50.1, rsi: 38.2 }],
    ...extra,
  };
}
