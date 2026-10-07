/**
 * Per-timeframe check, ladder verdict and score, ported 1:1 from the other journal (`signals.ts:208-290`).
 *
 * Deliberate difference (bug fix, §0.4 of the port spec): `signalsAt` for a past time returns `null` instead of a
 * "strength 0" result when any ladder rung or the zone timeframe lacks history or coverage at that time.
 */
import { MIN_SIGNAL_BARS, tfSeconds, type Side, type SignalCfg } from "./config";
import { rsi, sma, waveTrend, type Bar } from "./indicators";
import { wtSignal, type WtSignal } from "./mcb";
import { luxZone, pdZone, PD_FALLBACK_BARS, type ZoneInfo } from "./zones";

export interface TfCheck {
  tf: string;
  ok: boolean;
  /** open time (unix SECONDS) of the last evaluated bar */
  closeAt: number;
  rsi: number;
  rsiMa: number;
  wt: WtSignal;
  zone: ZoneInfo;
  /** MCB signal matching the direction */
  longSignal: boolean;
  shortSignal: boolean;
  /** RSI near oversold / overbought */
  rsiLong: boolean;
  rsiShort: boolean;
}

export function checkTf(tf: string, bars: readonly Bar[], cfg: SignalCfg): TfCheck | null {
  if (!bars || bars.length < MIN_SIGNAL_BARS) return null; // RSI braucht ~150 Kerzen Vorlauf, um auf 0,1 genau zu sein
  const close = bars.map((b) => b.c);
  const r = rsi(close, cfg.rsiLen);
  const rMa = sma(r, cfg.rsiMaLen);
  const { wt1, wt2 } = waveTrend(bars, cfg);
  const wt = wtSignal(wt1, wt2, cfg, close);
  const z = luxZone(bars, cfg.swingLookback) ?? pdZone(bars, PD_FALLBACK_BARS);
  const rv = r[r.length - 1]!;
  const rm = rMa[rMa.length - 1]!;
  return {
    tf,
    ok: true,
    closeAt: bars[bars.length - 1]!.t,
    rsi: rv,
    rsiMa: rm,
    wt,
    zone: z,
    longSignal: !!wt.long,
    shortSignal: !!wt.short,
    rsiLong: rv <= cfg.rsiOs + cfg.rsiNear,
    rsiShort: rv >= cfg.rsiOb - cfg.rsiNear,
  };
}

export type Strength = 0 | 1 | 2 | 3 | 4;
export interface VerdictReason {
  text: string;
  ok: boolean;
}
export interface Verdict {
  side: Side;
  tiers: number;
  strength: Strength;
  label: string;
  valid: boolean;
  rsiOk: boolean;
  zoneOk: boolean;
  strongSignal: boolean;
  /** 0..100 */
  score: number;
  reasons: VerdictReason[];
}

/** Rates one direction: signal ladder + RSI + zone. */
export function verdict(side: Side, checks: readonly (TfCheck | null)[], cfg: SignalCfg, zoneCheck?: TfCheck | null): Verdict {
  const sig = (c: TfCheck | null | undefined): boolean => !!c && (side === "long" ? c.longSignal : c.shortSignal);
  let tiers = 0;
  for (const c of checks) {
    if (sig(c)) tiers++;
    else break; // Leiter muss von unten durchgehend bestätigen
  }
  const base = checks[0] ?? null;
  const head = checks.slice(0, Math.max(1, tiers));
  const rsiOk = head.some((c) => !!c && (side === "long" ? c.rsiLong : c.rsiShort));
  const zoneRef = (zoneCheck !== undefined ? zoneCheck : checks.find((c) => c?.tf === cfg.zoneTf)) || base;
  const zoneOk = !!zoneRef && (side === "long" ? zoneRef.zone.zone === "discount" : zoneRef.zone.zone === "premium");
  const strongSignal = head.some((c) => {
    const e = side === "long" ? c?.wt.long : c?.wt.short;
    return !!e && e.kind !== "bull" && e.kind !== "bear";
  });
  const valid = tiers >= cfg.required && rsiOk;
  const strength = (valid ? Math.min(4, 1 + Math.min(2, tiers - cfg.required) + (zoneOk ? 1 : 0)) : 0) as Strength;
  const score = Math.round(Math.min(100, (tiers / Math.max(1, checks.length)) * 55 + (rsiOk ? 20 : 0) + (zoneOk ? 15 : 0) + (strongSignal ? 10 : 0)));
  const sideWord = side === "long" ? "Long" : "Short";
  const label = valid
    ? strength >= 3
      ? `Sehr starker ${sideWord}-Einstieg`
      : strength === 2
        ? `Starker ${sideWord}-Einstieg`
        : `${sideWord}-Einstieg`
    : tiers >= cfg.required
      ? `${sideWord}-Signal, RSI noch nicht ${side === "long" ? "überverkauft" : "überkauft"}`
      : tiers === 1
        ? `${sideWord}: nur ${checks[0]?.tf} bestätigt`
        : `Kein ${sideWord}-Signal`;
  const sigWord = side === "long" ? "Bottom/Einstieg" : "Top/Verkauf";
  const reasons: VerdictReason[] = [
    ...checks.map((c, i) => ({
      text: `${c?.tf ?? cfg.ladder[i]}: MCB ${sigWord}${i === 0 ? " (Basis)" : i < cfg.required ? " (Bestätigung)" : " (stärker)"}`,
      ok: sig(c) && i < tiers,
    })),
    { text: side === "long" ? `RSI nahe überverkauft (≤ ${cfg.rsiOs + cfg.rsiNear})` : `RSI nahe überkauft (≥ ${cfg.rsiOb - cfg.rsiNear})`, ok: rsiOk },
    { text: `${side === "long" ? "Preis im Discount" : "Preis im Premium"}${zoneRef ? ` (${zoneRef.tf})` : ""}`, ok: zoneOk },
  ];
  return { side, tiers, strength, label, valid, rsiOk, zoneOk, strongSignal, score, reasons };
}

export interface BestVerdict {
  long: Verdict;
  short: Verdict;
  best: Verdict;
}

export function bestVerdict(checks: readonly (TfCheck | null)[], cfg: SignalCfg, zoneCheck?: TfCheck | null): BestVerdict {
  const l = verdict("long", checks, cfg, zoneCheck);
  const s = verdict("short", checks, cfg, zoneCheck);
  return { long: l, short: s, best: l.score >= s.score ? l : s };
}

export interface Signals extends BestVerdict {
  checks: (TfCheck | null)[];
  /** check of `cfg.zoneTf` (null = too few bars) */
  zone: TfCheck | null;
  /** evaluation time, ms */
  at: number;
}

export type BarsByTf = Readonly<Record<string, readonly Bar[] | undefined>>;

/** All checks from the bars per timeframe. `null` while no rung has enough bars. */
export function computeSignals(bars: BarsByTf | undefined, cfg: SignalCfg, now: number = Date.now()): Signals | null {
  if (!bars) return null;
  const checks = cfg.ladder.map((tf) => checkTf(tf, bars[tf] || [], cfg));
  if (!checks.some(Boolean)) return null;
  const zone = checks.find((c) => c?.tf === cfg.zoneTf) ?? checkTf(cfg.zoneTf, bars[cfg.zoneTf] || [], cfg);
  return { checks, zone, at: now, ...bestVerdict(checks, cfg, zone) };
}

/** Times within this window of `now` are evaluated live (running candle included). */
export const LIVE_WINDOW_MS = 5 * 60_000;

/** Bars of `tf` that were already CLOSED at `atMs` (`(t + sec)·1000 ≤ atMs`). */
export function closedAt(bars: readonly Bar[], tf: string, atMs: number): Bar[] {
  const sec = tfSeconds(tf);
  let end = bars.length;
  while (end > 0 && (bars[end - 1]!.t + sec) * 1000 > atMs) end--;
  return bars.slice(0, end);
}

/** true when the last bar of `bars` closed no more than one bar length before `atMs`. */
export function covers(bars: readonly Bar[], tf: string, atMs: number): boolean {
  const sec = tfSeconds(tf);
  const last = bars[bars.length - 1];
  return !!last && sec > 0 && atMs - (last.t + sec) * 1000 <= sec * 1000;
}

/**
 * Check at an earlier time (back-dated trade): only bars that were closed at `atMs`.
 * Returns `null` when the time is not covered: the base rung has no bars, any ladder rung or the zone timeframe
 * has fewer than `MIN_SIGNAL_BARS` bars or ends more than one bar before `atMs` (the other journal returned a fake
 * "strength 0" here). Within `LIVE_WINDOW_MS` of `now` it evaluates the bars as they are (live).
 */
export function signalsAt(bars: BarsByTf | undefined, cfg: SignalCfg, atMs: number, now: number = Date.now()): Signals | null {
  if (!bars || !isFinite(atMs)) return null;
  if (atMs >= now - LIVE_WINDOW_MS) return computeSignals(bars, cfg, now);
  const cut: Record<string, Bar[]> = {};
  for (const [tf, b] of Object.entries(bars)) if (b) cut[tf] = closedAt(b, tf, atMs);
  const need = [...new Set([...cfg.ladder, cfg.zoneTf])];
  for (const tf of need) {
    const b = cut[tf];
    if (!b || b.length < MIN_SIGNAL_BARS || !covers(b, tf, atMs)) return null; // Zeitpunkt nicht abgedeckt
  }
  const s = computeSignals(cut, cfg, atMs);
  if (!s || !s.checks[0] || !s.zone || s.checks.some((c) => !c)) return null;
  return s;
}
