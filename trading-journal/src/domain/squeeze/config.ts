/**
 * `settings.squeeze` – the versioned passthrough key of the squeeze observation (F07): the thresholds and the switch of its
 * alert. Reading is lenient (anything unknown falls back to the default, numbers are clamped), writing keeps every unknown
 * key of the root object (a newer version's data survives a round trip) and returns the SAME object when nothing changed.
 * Absent until the user changes something. The alert is OFF until the user switches it on; the thresholds are starting
 * values that were not tuned on data – the card says so.
 */

export const SQUEEZE_VERSION = 1 as const;

export interface SqueezeCfg {
  /** funding rate that counts as extreme, in percent per settlement (|rate| ≥ this) */
  fundingPct: number;
  /** open-interest rise that counts as strong, in percent over `oiHours` */
  oiRisePct: number;
  oiHours: 1 | 4 | 24;
  /** accounts: the long share (percent) from which the market counts as one-sided long – or, mirrored, short at 100 − this */
  longPct: number;
  /** how many of the three readings must hold (1 … 3) */
  minMet: 1 | 2 | 3;
  /** the explicit switch of the alert (toast, delivery log, browser notification like the box alerts); default OFF */
  alerts: boolean;
}

export const DEFAULT_SQUEEZE_CFG: SqueezeCfg = { fundingPct: 0.05, oiRisePct: 5, oiHours: 4, longPct: 65, minMet: 2, alerts: false };
export const OI_HOURS_CHOICES = [1, 4, 24] as const;
export const MIN_MET_CHOICES = [1, 2, 3] as const;
/** Allowed ranges of the numeric thresholds (the card's inputs clamp to them). */
export const SQUEEZE_LIMITS = { fundingPct: [0.01, 0.5], oiRisePct: [1, 50], longPct: [55, 90] } as const;

type Raw = Record<string, unknown>;
const isObj = (v: unknown): v is Raw => typeof v === "object" && v !== null && !Array.isArray(v);

const clamp = (v: unknown, [lo, hi]: readonly [number, number], d: number): number => {
  const n = typeof v === "number" && Number.isFinite(v) ? v : d;
  return Math.min(hi, Math.max(lo, Math.round(n * 1000) / 1000));
};

export function squeezeCfgOf(raw: unknown): SqueezeCfg {
  const r = isObj(raw) ? raw : {};
  const d = DEFAULT_SQUEEZE_CFG;
  return {
    fundingPct: clamp(r.fundingPct, SQUEEZE_LIMITS.fundingPct, d.fundingPct),
    oiRisePct: clamp(r.oiRisePct, SQUEEZE_LIMITS.oiRisePct, d.oiRisePct),
    oiHours: (OI_HOURS_CHOICES as readonly unknown[]).includes(r.oiHours) ? (r.oiHours as SqueezeCfg["oiHours"]) : d.oiHours,
    longPct: clamp(r.longPct, SQUEEZE_LIMITS.longPct, d.longPct),
    minMet: (MIN_MET_CHOICES as readonly unknown[]).includes(r.minMet) ? (r.minMet as SqueezeCfg["minMet"]) : d.minMet,
    alerts: r.alerts === true,
  };
}

export const squeezeOfSettings = (s: { squeeze?: unknown } | null | undefined): SqueezeCfg => squeezeCfgOf(s?.squeeze);

const canon = (v: unknown): string => JSON.stringify(v, (_k, x: unknown) => (isObj(x) ? Object.fromEntries(Object.keys(x).sort().map((k) => [k, x[k]])) : x));

/** The stored object with `patch` applied (unknown keys kept); the same object when nothing changed. */
export function withSqueeze(raw: unknown, patch: Partial<SqueezeCfg>): Record<string, unknown> {
  const prev = isObj(raw) ? raw : {};
  const cur = squeezeCfgOf(raw);
  const next: Record<string, unknown> = { ...prev, v: SQUEEZE_VERSION, ...squeezeCfgOf({ ...cur, ...patch }) };
  return isObj(raw) && canon(prev) === canon(next) ? (raw as Record<string, unknown>) : next;
}
