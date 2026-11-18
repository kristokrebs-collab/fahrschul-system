/**
 * Squeeze observation (F07), the reading: three public numbers from the archive – the last settled funding rate, the open-
 * interest change over a window, the long share of all accounts – each against a threshold the user can change, and what
 * they say together. Pure; the same function reads „now“ and every earlier sample (`history.ts`), so the card and the
 * sample statement can never disagree. No look-ahead: a reading at time t sees only points up to t.
 *
 * What it says: a market where funding, new positions and the account split all lean to ONE side is crowded on that side;
 * if the price then moves against the crowd, its positions are closed under pressure (a squeeze). That is an observation
 * about positioning, with the numbers and thresholds shown – no prediction, no signal.
 *
 * Rules (hand-checked in `tests/unit/squeeze.domain.test.ts`):
 *  - funding: |rate| ≥ threshold → crowded long (rate > 0, longs pay) or short (rate < 0)
 *  - open interest: rise ≥ threshold over the window → positions are being added (no side of its own)
 *  - accounts: long share ≥ L → long, ≤ 100 − L → short
 *  - funding and accounts must not point to opposite sides (then: „gegensätzlich“, no observation)
 *  - the observation holds when (directional readings that agree + OI rise) ≥ the user's minimum – and at least one
 *    directional reading agrees; open interest alone never makes one
 *  - a reading without data is „keine Daten“ – never estimated, never counted as met
 */
import type { SqueezeCfg } from "./config";
import type { LsPt, OiPt, PremiumPt, Signal, SqueezeData, SqueezeReading, SqueezeSide } from "./types";

const MIN = 60_000;
const HOUR = 60 * MIN;
/** The 5-minute account split is published a little after its time. */
export const LS_FRESH_MS = 20 * MIN;
/** Open interest is read in the same tick as the funding rate. */
export const OI_FRESH_MS = 15 * MIN;
const EPS = 1e-9;

const de = (v: number, digits: number): string => v.toLocaleString("de-DE", { minimumFractionDigits: digits, maximumFractionDigits: digits }).replace("-", "−");
const signed = (v: number, digits: number): string => (v < 0 ? de(v, digits) : `+${de(v, digits)}`);

/** Index of the last element with `t <= x` (ascending), −1 when none. */
export function lastAtOrBefore<T extends { t: number }>(arr: readonly T[], x: number): number {
  let lo = 0;
  let hi = arr.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (arr[mid]!.t <= x) lo = mid + 1;
    else hi = mid;
  }
  return lo - 1;
}

/** The element nearest to `x` within `tol` (ascending), else `null`. */
export function nearestWithin<T extends { t: number }>(arr: readonly T[], x: number, tol: number): T | null {
  const i = lastAtOrBefore(arr, x);
  const a = i >= 0 ? arr[i]! : null;
  const b = i + 1 < arr.length ? arr[i + 1]! : null;
  const best = a && b ? (x - a.t <= b.t - x ? a : b) : (a ?? b);
  return best && Math.abs(best.t - x) <= tol ? best : null;
}

const noData = (key: Signal["key"], label: string, threshold: string, note: string): Signal => ({ key, label, value: null, text: "keine Daten", threshold, met: null, side: null, at: null, note });

export function fundingSignal(p: PremiumPt | null, cfg: SqueezeCfg): Signal {
  const threshold = `≥ ${de(cfg.fundingPct, 3)} % oder ≤ −${de(cfg.fundingPct, 3)} % je Abrechnung`;
  if (!p || p.rate === null) return noData("funding", "Funding-Rate", threshold, "Im Archiv fehlt ein Funding-Wert.");
  const pct = p.rate * 100;
  const met = Math.abs(pct) >= cfg.fundingPct - EPS;
  return { key: "funding", label: "Funding-Rate", value: p.rate, text: `${signed(pct, 3)} % je Abrechnung`, threshold, met, side: met ? (pct > 0 ? "long" : "short") : null, at: p.t, note: null };
}

export function oiSignal(oi: readonly OiPt[], t: number, cfg: SqueezeCfg): Signal {
  const w = cfg.oiHours * HOUR;
  const threshold = `≥ ${signed(cfg.oiRisePct, 1)} % in ${cfg.oiHours} h`;
  const i = lastAtOrBefore(oi, t);
  const now = i >= 0 ? oi[i]! : null;
  if (!now || t - now.t > OI_FRESH_MS) return noData("oi", "Open-Interest-Anstieg", threshold, "Im Archiv fehlt ein aktueller Open-Interest-Wert.");
  const then = nearestWithin(oi, now.t - w, Math.max(15 * MIN, w * 0.1));
  if (!then || then.t >= now.t || !(then.oi > 0)) {
    const have = oi.length ? Math.max(0, Math.round(((now.t - oi[0]!.t) / HOUR) * 10) / 10) : 0;
    return noData("oi", "Open-Interest-Anstieg", threshold, `Das Archiv hat keinen Wert von vor ${cfg.oiHours} h (es reicht erst ${de(have, 1)} h zurück).`);
  }
  const change = now.oi / then.oi - 1;
  const met = change * 100 >= cfg.oiRisePct - EPS;
  return { key: "oi", label: "Open-Interest-Anstieg", value: change, text: `${signed(change * 100, 1)} % in ${cfg.oiHours} h`, threshold, met, side: null, at: now.t, note: null };
}

export function accountsSignal(ls: readonly LsPt[], t: number, cfg: SqueezeCfg): Signal {
  const threshold = `Long ≥ ${de(cfg.longPct, 0)} % oder ≤ ${de(100 - cfg.longPct, 0)} %`;
  const i = lastAtOrBefore(ls, t);
  const p = i >= 0 ? ls[i]! : null;
  if (!p || t - p.t > LS_FRESH_MS) return noData("accounts", "Positionierung der Konten", threshold, "Im Archiv fehlt ein aktuelles Long/Short-Verhältnis.");
  const met = p.long >= cfg.longPct - EPS || p.long <= 100 - cfg.longPct + EPS;
  return { key: "accounts", label: "Positionierung der Konten", value: p.long, text: `Long ${de(p.long, 1)} % · Short ${de(100 - p.long, 1)} %`, threshold, met, side: met ? (p.long >= 50 ? "long" : "short") : null, at: p.t, note: null };
}

/** What the three readings say together. */
export function combine(signals: readonly Signal[], cfg: SqueezeCfg): Pick<SqueezeReading, "state" | "side" | "met" | "known"> {
  const known = signals.filter((s) => s.met !== null).length;
  if (known === 0) return { state: "nodata", side: null, met: 0, known };
  const f = signals.find((s) => s.key === "funding");
  const a = signals.find((s) => s.key === "accounts");
  const o = signals.find((s) => s.key === "oi");
  const fs = f?.met ? f.side : null;
  const as = a?.met ? a.side : null;
  if (fs && as && fs !== as) return { state: "conflict", side: null, met: 0, known };
  const side: SqueezeSide | null = fs ?? as;
  if (!side) return { state: "calm", side: null, met: 0, known };
  const met = (fs ? 1 : 0) + (as ? 1 : 0) + (o?.met ? 1 : 0);
  return { state: met >= cfg.minMet ? "watch" : "calm", side, met, known };
}

/** The reading at the premium sample `p` (no look-ahead: only points up to its time). */
export function readingAt(data: SqueezeData, cfg: SqueezeCfg, p: PremiumPt): SqueezeReading {
  const signals = [fundingSignal(p, cfg), oiSignal(data.oi, p.t, cfg), accountsSignal(data.ls, p.t, cfg)];
  const c = combine(signals, cfg);
  const top = data.top ? lastAtOrBefore(data.top, p.t) : -1;
  const topPt = top >= 0 && p.t - data.top![top]!.t <= LS_FRESH_MS ? data.top![top]! : null;
  return { at: p.t, ...c, signals, mark: p.mark, topLong: topPt ? { pct: topPt.long, at: topPt.t } : null, stale: false };
}

/**
 * The reading „now“: the newest premium sample, but only if it is recent (`ivMin` × 2,5, at least 30 minutes) – an archive
 * that is not being written right now gives no reading, never an old one dressed as current.
 */
export function evaluateNow(data: SqueezeData, cfg: SqueezeCfg, now: number, ivMin: number): SqueezeReading {
  const last = data.premium.length ? data.premium[data.premium.length - 1]! : null;
  const maxAge = Math.max(30 * MIN, ivMin * 2.5 * MIN);
  if (!last || now - last.t > maxAge) {
    const signals = [fundingSignal(null, cfg), oiSignal([], now, cfg), accountsSignal([], now, cfg)];
    return { at: last?.t ?? null, state: "nodata", side: null, met: 0, known: 0, signals, mark: null, topLong: null, stale: !!last };
  }
  return readingAt(data, cfg, last);
}
