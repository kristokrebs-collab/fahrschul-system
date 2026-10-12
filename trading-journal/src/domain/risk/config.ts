/**
 * Risk settings (P05): `settings.risk` is a passthrough key (unknown keys of other versions survive), sanitised here.
 * The limits that already exist are NOT duplicated: the daily loss, the loss per trade and the trades per day stay in
 * `settings.discipline` (`disciplineLimits`, edited by the settings page's "Disziplin-Grenzen" and by the RiskSettings
 * card). `riskLimits(settings)` merges both into the one object every risk module reads.
 */
import { disciplineLimits, type DisciplineLimits } from "../insights/discipline";
import type { AccountId } from "../types";
import { ED } from "../edition";

/** One maintenance-margin tier: notional up to `upTo` (quote) uses `mmr` (fraction). The last tier has `upTo: Infinity`. */
export interface MaintTier {
  upTo: number;
  mmr: number;
}

/**
 * Default tier table: Binance USDⓈ-M BTCUSDT (as published in 2024/25) – an APPROXIMATION for every venue and symbol;
 * the user edits it in the RiskSettings card. The maintenance amount (`cum`) is derived from the floors, so a table
 * only needs `upTo` and `mmr`.
 */
export const DEFAULT_TIERS: readonly MaintTier[] = Object.freeze([
  { upTo: 50_000, mmr: 0.004 },
  { upTo: 500_000, mmr: 0.005 },
  { upTo: 8_000_000, mmr: 0.01 },
  { upTo: 50_000_000, mmr: 0.025 },
  { upTo: 80_000_000, mmr: 0.05 },
  { upTo: 100_000_000, mmr: 0.1 },
  { upTo: 200_000_000, mmr: 0.125 },
  { upTo: 300_000_000, mmr: 0.15 },
  { upTo: Infinity, mmr: 0.25 },
]);

export const TIERS_MAX = 12;

export interface RiskSettings {
  /** Default risk per trade of the calculator (fraction of the account capital). */
  riskPerTradePct: number;
  /** Max. realised loss per calendar week (Mon–Sun, local), fraction of the capital. */
  maxLossWeekPct: number;
  /** Max. drawdown from the equity peak (fraction). */
  maxDrawdownPct: number;
  /** Max. open risk (Σ distance to the stop × qty of open trades), fraction of the capital. */
  maxOpenRiskPct: number;
  /** Share of a limit from which it turns "warn" (0.5–0.95). */
  warnAt: number;
  /** Pause after `cooldownLosses` losses in a row (minutes); 0 = off. */
  cooldownMin: number;
  /** Losses in a row that start the pause (0 = off). */
  cooldownLosses: number;
  /** Taker fee per side (fraction of the notional) – calculator, R:R and breakeven. */
  feePct: number;
  /** Expected slippage on the stop fill (fraction of the price). */
  slippagePct: number;
  /** ATR multiple of the calculator's ATR stop. */
  atrMult: number;
  /** Toasts after a save + the pause (the journal is never blocked). */
  guard: boolean;
  /** Maintenance tiers for the liquidation approximation. */
  tiers: MaintTier[];
}

export const DEFAULT_RISK: Readonly<RiskSettings> = Object.freeze({
  riskPerTradePct: 0.01,
  maxLossWeekPct: 0.08,
  maxDrawdownPct: 0.15,
  maxOpenRiskPct: 0.03,
  warnAt: 0.75,
  cooldownMin: 30,
  cooldownLosses: 2,
  feePct: 0.0005,
  slippagePct: 0.0005,
  atrMult: 1.5,
  guard: true,
  tiers: DEFAULT_TIERS as MaintTier[],
});

/** Everything a risk module reads: `settings.risk` + the discipline limits + the edition's leverage rule. */
export interface RiskLimits extends RiskSettings, DisciplineLimits {
  leverageRule: Readonly<Record<AccountId, number>>;
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const num = (v: unknown, fb: number, lo: number, hi: number): number => (typeof v === "number" && Number.isFinite(v) && v >= lo && v <= hi ? v : fb);

/** Sanitised tier table: numbers only, ascending `upTo`, ascending `mmr`, last tier open-ended; invalid → defaults. */
export function sanitizeTiers(raw: unknown): MaintTier[] {
  if (!Array.isArray(raw) || raw.length === 0) return [...DEFAULT_TIERS];
  const out: MaintTier[] = [];
  for (const r of raw.slice(0, TIERS_MAX)) {
    if (!isObj(r)) return [...DEFAULT_TIERS];
    const upTo = r.upTo === null || r.upTo === undefined ? Infinity : r.upTo;
    const mmr = r.mmr;
    if (typeof upTo !== "number" || !(upTo > 0) || typeof mmr !== "number" || !(mmr > 0 && mmr <= 0.5)) return [...DEFAULT_TIERS];
    out.push({ upTo, mmr });
  }
  out.sort((a, b) => a.upTo - b.upTo);
  for (let i = 1; i < out.length; i++) {
    if (out[i]!.upTo === out[i - 1]!.upTo || out[i]!.mmr < out[i - 1]!.mmr) return [...DEFAULT_TIERS];
  }
  out[out.length - 1] = { ...out[out.length - 1]!, upTo: Infinity };
  return out;
}

/** `settings.risk` sanitised over the defaults (unknown / invalid values → default). */
export function riskSettingsOf(raw: unknown): RiskSettings {
  const r = isObj(raw) ? raw : {};
  const d = DEFAULT_RISK;
  return {
    riskPerTradePct: num(r.riskPerTradePct, d.riskPerTradePct, 0.0005, 0.2),
    maxLossWeekPct: num(r.maxLossWeekPct, d.maxLossWeekPct, 0.001, 1),
    maxDrawdownPct: num(r.maxDrawdownPct, d.maxDrawdownPct, 0.01, 1),
    maxOpenRiskPct: num(r.maxOpenRiskPct, d.maxOpenRiskPct, 0.001, 1),
    warnAt: num(r.warnAt, d.warnAt, 0.5, 0.95),
    cooldownMin: Math.round(num(r.cooldownMin, d.cooldownMin, 0, 24 * 60)),
    cooldownLosses: Math.round(num(r.cooldownLosses, d.cooldownLosses, 0, 10)),
    feePct: num(r.feePct, d.feePct, 0, 0.01),
    slippagePct: num(r.slippagePct, d.slippagePct, 0, 0.05),
    atrMult: num(r.atrMult, d.atrMult, 0.25, 10),
    guard: typeof r.guard === "boolean" ? r.guard : d.guard,
    tiers: sanitizeTiers(r.tiers),
  };
}

/** The merged limits (`settings.risk` + `settings.discipline` + `ED.LEVERAGE_RULE`). */
export function riskLimits(settings: { risk?: unknown; discipline?: unknown }): RiskLimits {
  return { ...riskSettingsOf(settings.risk), ...disciplineLimits(settings), leverageRule: ED.LEVERAGE_RULE };
}

/** JSON form of a tier table (`Infinity` → `null`). */
export const tiersToJson = (tiers: readonly MaintTier[]): Array<{ upTo: number | null; mmr: number }> => tiers.map((t) => ({ upTo: Number.isFinite(t.upTo) ? t.upTo : null, mmr: t.mmr }));

/**
 * The raw `settings.risk` object with `patch` applied (unknown keys kept). Returns `prev` itself when nothing changes
 * (callers skip the save then).
 */
export function withRiskSettings(prev: unknown, patch: Partial<RiskSettings>): unknown {
  const base = isObj(prev) ? prev : {};
  const cur = riskSettingsOf(prev);
  const next: Record<string, unknown> = { ...base };
  let changed = false;
  for (const [k, v] of Object.entries(patch) as Array<[keyof RiskSettings, unknown]>) {
    if (v === undefined) continue;
    if (k === "tiers") {
      const t = sanitizeTiers(tiersToJson(v as MaintTier[]).map((x) => ({ upTo: x.upTo ?? undefined, mmr: x.mmr })));
      if (JSON.stringify(tiersToJson(t)) !== JSON.stringify(tiersToJson(cur.tiers)) || !Array.isArray(base.tiers)) {
        next.tiers = tiersToJson(t);
        changed = true;
      }
      continue;
    }
    const merged = riskSettingsOf({ ...base, [k]: v })[k];
    if (merged !== v) continue; // invalid value: refused (the card validates first)
    if (base[k] !== v) {
      next[k] = v;
      changed = true;
    }
  }
  return changed ? next : prev;
}
