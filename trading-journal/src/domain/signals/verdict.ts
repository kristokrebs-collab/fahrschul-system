/**
 * Per-timeframe check, ladder verdict and score, ported 1:1 from the other journal (`signals.ts:208-290`), plus our
 * additive layers (decisions 5, 6, 9, 10, 11 — 2026-10-08):
 *
 * - `checkTf(tf, bars, cfg, now)` adds the candle-close state per direction (`conf`, `state.ts`), the forming flag and
 *   close time of the last bar, divergences (`div`, `divergence.ts`) and market structure / S-R (`structure`,
 *   `structure.ts`). The reference fields are computed exactly as before.
 * - `verdict()` / `bestVerdict()` stay the 1:1 port ("raw": every event counts as if its candle had closed).
 * - `confirmVerdict()` applies the candle-close rule: an entry counts (`valid`) only once the base candle and every
 *   required rung have CLOSED with the signal and the RSI condition holds on a closed candle; before that it is
 *   `provisional` (strength 0, `provStrength` = the strength it gets on the close, provisional rungs count ½ in the
 *   score).
 * - `gradeSignals()` adds the graded parts (`parts.ts`: Top-Trader-Kombi, divergences, support/resistance) and the
 *   falling-knife filter (`knife.ts`). `computeSignals()` = checks → raw verdicts → confirm → parts.
 *
 * Deliberate difference (bug fix, §0.4 of the port spec): `signalsAt` for a past time returns `null` instead of a
 * "strength 0" result when any ladder rung or the zone timeframe lacks history or coverage at that time.
 */
import { MIN_SIGNAL_BARS, divCfgOf, srCfgOf, strongClosesOf, tfSeconds, type Side, type SignalCfg } from "./config";
import { tfDivergences, type TfDivergences } from "./divergence";
import { rsi, sma, waveTrend, type Bar } from "./indicators";
import { KNIFE_TFS, knifeFilter, type KnifeFilter } from "./knife";
import { applyLageGate, type LageInput, type VerdictLage } from "./lageGate";
import { wtSignal, type WtSignal } from "./mcb";
import { divPart, partReasonText, srPart, tradersPart, type GradedPart } from "./parts";
import { PROVISIONAL_FACTOR, isConfirmedState, isForming, lastCloseAt, rungConf, type RungConf, type SignalState } from "./state";
import { marketStructure, type Structure } from "./structure";
import type { TraderReading } from "./traders";
import type { WhaleReading, WhaleVerdict } from "./whale";
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
  // ---- ours (additive; always set by `checkTf`, optional so hand-built checks stay valid — absent = closed / none)
  /** the last bar is the running (forming) candle at the evaluation time */
  forming?: boolean;
  /** close time of the last bar, ms UTC (the countdown target of a provisional signal) */
  closesAt?: number;
  /** ms until that close at the evaluation (0 when closed). Render countdowns from `closesAt` on a shared clock */
  msToClose?: number;
  /** candle-close state per direction (`state.ts`) */
  conf?: Readonly<Record<Side, RungConf>>;
  /**
   * RSI near oversold / overbought on the last CLOSED bar (the one before a forming candle; = `rsiLong` / `rsiShort`
   * when the last bar is closed). The candle-close rule reads these: a live RSI dip on a forming candle can still
   * repaint. Absent (hand-built checks, old snapshots) = the live flags.
   */
  rsiLongClosed?: boolean;
  rsiShortClosed?: boolean;
  /** divergences of RSI / wt1 vs price (when `settings.signals.div.on`) */
  div?: TfDivergences;
  /** market structure + support / resistance (when `settings.signals.sr.on`; `null` below 3 bars) */
  structure?: Structure | null;
  /**
   * The same structure on CLOSED bars only (the forming candle left out), for the falling-knife filter's structure
   * point on 1h / 4h — a break on the running candle can still repaint. Set only while the last bar forms.
   */
  structureClosed?: Structure | null;
}

/** Candle-close state of a rung for a side (hand-built checks without `conf`: a signal counts as confirmed). */
export function rungState(c: TfCheck | null | undefined, side: Side): SignalState {
  if (!c) return "none";
  const st = c.conf?.[side]?.state;
  if (st) return st;
  return (side === "long" ? c.longSignal : c.shortSignal) ? "confirmed" : "none";
}

/**
 * One timeframe. `now` (ms) decides whether the last bar is still forming (its signals are then `provisional`);
 * without `now` every bar counts as closed (the other journal's behaviour, back-dated checks).
 */
export function checkTf(tf: string, bars: readonly Bar[], cfg: SignalCfg, now?: number): TfCheck | null {
  if (!bars || bars.length < MIN_SIGNAL_BARS) return null; // RSI braucht ~150 Kerzen Vorlauf, um auf 0,1 genau zu sein
  const close = bars.map((b) => b.c);
  const r = rsi(close, cfg.rsiLen);
  const rMa = sma(r, cfg.rsiMaLen);
  const { wt1, wt2 } = waveTrend(bars, cfg);
  const wt = wtSignal(wt1, wt2, cfg, close);
  const z = luxZone(bars, cfg.swingLookback) ?? pdZone(bars, PD_FALLBACK_BARS);
  const rv = r[r.length - 1]!;
  const rm = rMa[rMa.length - 1]!;
  const forming = isForming(bars, tf, now);
  const closesAt = lastCloseAt(bars, tf);
  const strong = strongClosesOf(cfg);
  const rc = forming && r.length >= 2 ? r[r.length - 2]! : rv;
  const out: TfCheck = {
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
    rsiLongClosed: rc <= cfg.rsiOs + cfg.rsiNear,
    rsiShortClosed: rc >= cfg.rsiOb - cfg.rsiNear,
    forming,
    closesAt,
    msToClose: forming && now !== undefined ? Math.max(0, closesAt - now) : 0,
    conf: rungConf(bars, wt1, wt2, cfg, forming, strong),
  };
  const d = divCfgOf(cfg);
  if (d.on) out.div = tfDivergences(bars, r, wt1, d, forming, strong);
  const sc = srCfgOf(cfg);
  if (sc.on) {
    const opts = { swing: cfg.swingLookback, internal: sc.internal, eqLen: sc.eqLen, eqThreshold: sc.eqThreshold, range: z.lux ? { hi: z.hi, lo: z.lo } : null };
    out.structure = marketStructure(bars, opts);
    if (forming && KNIFE_TFS.includes(tf)) out.structureClosed = marketStructure(bars.slice(0, -1), opts);
  }
  return out;
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
  /** legacy run rule "Top-Trader kaufen · Retail rot" (`applyWhale`); the live engine grades with `parts` instead */
  whale?: WhaleVerdict;
  // ---- ours (additive; set by `confirmVerdict` / `gradeSignals`, i.e. by `computeSignals` and `signalsAt`)
  /**
   * Candle-close state of the entry: `none` (the entry rule does not hold), `provisional` (it holds, but the base
   * signal sits on the forming candle — shown, not counted), `confirmed` (the base candle closed with the signal),
   * `strong` (the base signal held for `strongCloses` closes).
   */
  state?: SignalState;
  /** consecutive rungs from the base whose signal is confirmed (closed candle) */
  confTiers?: number;
  /** per ladder rung: the candle-close state of this side's signal (`none` without one / without data) */
  rungStates?: SignalState[];
  /** the strength the entry has (`provisional`) or gets once confirmed; = `strength` for a confirmed entry */
  provStrength?: Strength;
  /** close time (ms) of the base candle while the entry is `provisional` (countdown target), else `null` */
  closesAt?: number | null;
  /** graded parts (Top-Trader-Kombi, divergences, support / resistance) that are switched on */
  parts?: GradedPart[];
  /** score points the parts added (before the cap at 100) */
  partPoints?: number;
  /**
   * Lage-Ampel gate (decision 23, `lageGate.ts`, long only): set while the Lage has something to say (red / amber with
   * the switch on). `blocked` = the entry is held back (`valid` false, strength 0, label `Kaufsignal · Lage rot – zählt
   * nicht (fällt noch)`); `nur Warnung`: counts, `label` is the warning.
   */
  lage?: VerdictLage;
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

const SIDE_WORD: Readonly<Record<Side, string>> = { long: "Long", short: "Short" };

function entryLabel(side: Side, strength: number): string {
  const w = SIDE_WORD[side];
  return strength >= 3 ? `Sehr starker ${w}-Einstieg` : strength === 2 ? `Starker ${w}-Einstieg` : `${w}-Einstieg`;
}

/** Label prefix of a provisional entry (`Vorläufig: Starker Long-Einstieg`). */
export const PROVISIONAL_PREFIX = "Vorläufig: ";

/**
 * Candle-close rule on top of a raw `verdict()` (decision 6): an entry counts only when it rests on CLOSED candles —
 * the base rung's signal, the signals of every required rung (`cfg.required`; a higher rung counts as confirmed at its
 * own close, provisional before) and the RSI condition (read on the last closed bar of the head rungs, never on a
 * forming candle that can still repaint). Higher rungs keep their own state (`rungStates`; a provisional rung counts
 * ½ in the score, and extra rungs beyond `required` add strength only once their candle closed).
 * Provisional entry: `valid` false, `strength` 0, `provStrength` = the raw strength, label `Vorläufig: …`, `closesAt` =
 * the close that decides it (the last close among the provisional required rungs; with the RSI only live, not before
 * the first forming head rung that shows it closes). Without any forming signal the reference fields stay exactly as
 * `verdict()` gave them.
 */
export function confirmVerdict(v: Verdict, checks: readonly (TfCheck | null)[], cfg: Pick<SignalCfg, "ladder" | "required">): Verdict {
  const n = Math.max(checks.length, cfg.ladder.length);
  const required = Math.max(1, Math.min(n, cfg.required ?? 1));
  const rungStates: SignalState[] = [];
  for (let i = 0; i < n; i++) rungStates.push(rungState(checks[i], v.side));
  let confTiers = 0;
  while (confTiers < n && isConfirmedState(rungStates[confTiers])) confTiers++;
  let prov = 0;
  for (let i = 0; i < v.tiers; i++) if (rungStates[i] === "provisional") prov++;
  const baseState = rungStates[0] ?? "none";
  // RSI condition on closed candles: the live flag of a forming head rung is only a preview
  const long = v.side === "long";
  const head = checks.slice(0, Math.max(1, v.tiers));
  const rsiClosed = head.some((c) => !!c && (long ? (c.rsiLongClosed ?? c.rsiLong) : (c.rsiShortClosed ?? c.rsiShort)));
  const waiting = baseState === "provisional" || confTiers < required || !rsiClosed;
  const state: SignalState = !v.valid ? "none" : waiting ? "provisional" : baseState === "strong" ? "strong" : "confirmed";
  const score = prov
    ? Math.round(Math.min(100, ((v.tiers - PROVISIONAL_FACTOR * prov) / Math.max(1, checks.length)) * 55 + (v.rsiOk ? 20 : 0) + (v.zoneOk ? 15 : 0) + (v.strongSignal ? 10 : 0)))
    : v.score;
  const base = { ...v, score, state, confTiers, rungStates, provStrength: v.strength, closesAt: null };
  if (state === "provisional") {
    // countdown to the close that can confirm it: every provisional required rung (the base included) must close, and
    // one forming head rung whose live RSI meets the condition must close with it
    const at = (c: TfCheck | null | undefined): number => (c?.closesAt != null && Number.isFinite(c.closesAt) ? c.closesAt : NaN);
    let need = -Infinity;
    for (let i = 0; i < required; i++) if (rungStates[i] === "provisional" && Number.isFinite(at(checks[i]))) need = Math.max(need, at(checks[i]));
    let rsiAt = Infinity;
    if (!rsiClosed) for (const c of head) if (c?.forming && (long ? c.rsiLong : c.rsiShort) && Number.isFinite(at(c))) rsiAt = Math.min(rsiAt, at(c));
    let closesAt = Number.isFinite(rsiAt) ? Math.max(need, rsiAt) : need;
    if (!Number.isFinite(closesAt)) closesAt = at(checks[0]);
    return { ...base, valid: false, strength: 0, label: `${PROVISIONAL_PREFIX}${v.label}`, closesAt: Number.isFinite(closesAt) ? closesAt : null };
  }
  if (state === "none" || confTiers >= v.tiers) return base;
  // confirmed, but extra rungs above `required` still on forming candles: they add strength at their own close
  const strength = Math.min(4, 1 + Math.min(2, Math.min(confTiers, v.tiers) - required) + (v.zoneOk ? 1 : 0)) as Strength;
  return strength === v.strength ? base : { ...base, strength, provStrength: strength, label: entryLabel(v.side, strength) };
}

/** The verdict graded with its parts: score + Σ points (max 100), +1 strength per part that holds (max 4). */
function withParts(v: Verdict, parts: GradedPart[]): Verdict {
  if (!parts.length) return { ...v, parts, partPoints: 0 };
  const points = parts.reduce((a, p) => a + (p.data ? p.points : 0), 0);
  const bonus = parts.filter((p) => p.bonus).length;
  const prov = (v.provStrength ?? v.strength) > 0 ? (Math.min(4, (v.provStrength ?? v.strength) + bonus) as Strength) : 0;
  const strength = (v.valid ? Math.min(4, v.strength + bonus) : 0) as Strength;
  let label = v.label;
  if (v.valid && strength !== v.strength) label = entryLabel(v.side, strength);
  else if (v.state === "provisional" && prov !== v.provStrength) label = `${PROVISIONAL_PREFIX}${entryLabel(v.side, prov)}`;
  return {
    ...v,
    score: Math.round(Math.min(100, v.score + points)),
    strength,
    provStrength: prov,
    label,
    reasons: [...v.reasons, ...parts.map((p) => ({ text: partReasonText(p), ok: p.ok }))],
    parts,
    partPoints: Math.round(points * 10) / 10,
  };
}

/**
 * Candle-close rule + graded parts + falling-knife filter on top of the raw 1:1 evaluation (`bestVerdict`).
 * `traders` = the Top-Trader reading (`traderReading`), `null` = none (the part shows "keine Daten").
 */
export type Graded<S extends Signals> = S & { traders: TraderReading | null; knife: Readonly<Record<Side, KnifeFilter>> };

export function gradeSignals<S extends Signals>(sig: S, cfg: SignalCfg, traders: TraderReading | null = null, lage?: LageInput | null): Graded<S> {
  const zoneRef = sig.zone ?? sig.checks[0] ?? null;
  const grade = (v: Verdict): Verdict => {
    const c = confirmVerdict(v, sig.checks, cfg);
    const parts = [tradersPart(v.side, traders, zoneRef, cfg), divPart(v.side, sig.checks, cfg), srPart(v.side, zoneRef, cfg)].filter((p): p is GradedPart => p !== null);
    // the Lage-Ampel gate comes last: it holds a long entry back on red / amber (decision 23)
    return applyLageGate(withParts(c, parts), lage);
  };
  const long = grade(sig.long);
  const short = grade(sig.short);
  const out = { ...sig, long, short, best: long.score >= short.score ? long : short, traders, ...(lage !== undefined ? { lage: lage ?? null } : {}) };
  return { ...out, knife: { long: knifeFilter(out, cfg, "long"), short: knifeFilter(out, cfg, "short") } };
}

/**
 * An evaluation graded again with another Top-Trader reading (retro checks: the candles are memoised, the reading
 * arrives later): the raw verdicts from its checks, then `gradeSignals`.
 */
export function regradeSignals<S extends Signals>(sig: S, cfg: SignalCfg, traders: TraderReading | null, lage: LageInput | null | undefined = sig.lage): Graded<S> {
  return gradeSignals({ ...sig, ...bestVerdict(sig.checks, cfg, sig.zone) }, cfg, traders, lage);
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
  /** legacy run-rule readings (`applyWhale`); the live engine no longer sets it */
  whale?: WhaleReading;
  /** ours: the Top-Trader reading the parts were graded with (`null` = condition on, no data; absent = off / raw) */
  traders?: TraderReading | null;
  /** ours: the falling-knife filter per side (`knife.ts`), from the same checks and parts */
  knife?: Readonly<Record<Side, KnifeFilter>>;
  /** ours: the Lage-Ampel input the long was gated with (`null` = gate given, no Lage data; absent = no gate input) */
  lage?: LageInput | null;
}

/** Extra live inputs of an evaluation. */
export interface SignalInputs {
  /** Top-Trader reading at the evaluation time (`traderReading`); absent / `null` = no data */
  traders?: TraderReading | null;
  /** Lage-Ampel at the evaluation time + setting (decision 23); absent = no gate (hand-built / older callers) */
  lage?: LageInput | null;
}

export type BarsByTf = Readonly<Record<string, readonly Bar[] | undefined>>;

/**
 * All checks from the bars per timeframe, graded (candle-close rule, parts, knife filter). `now` decides which last
 * bars are still forming. `null` while no rung has enough bars.
 */
export function computeSignals(bars: BarsByTf | undefined, cfg: SignalCfg, now: number = Date.now(), inputs: SignalInputs = {}): Signals | null {
  if (!bars) return null;
  const checks = cfg.ladder.map((tf) => checkTf(tf, bars[tf] || [], cfg, now));
  if (!checks.some(Boolean)) return null;
  const zone = checks.find((c) => c?.tf === cfg.zoneTf) ?? checkTf(cfg.zoneTf, bars[cfg.zoneTf] || [], cfg, now);
  return gradeSignals({ checks, zone, at: now, ...bestVerdict(checks, cfg, zone) }, cfg, inputs.traders ?? null, inputs.lage);
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
export function signalsAt(bars: BarsByTf | undefined, cfg: SignalCfg, atMs: number, now: number = Date.now(), inputs: SignalInputs = {}): Signals | null {
  if (!bars || !isFinite(atMs)) return null;
  if (atMs >= now - LIVE_WINDOW_MS) return computeSignals(bars, cfg, now, inputs);
  const cut: Record<string, Bar[]> = {};
  for (const [tf, b] of Object.entries(bars)) if (b) cut[tf] = closedAt(b, tf, atMs);
  const need = [...new Set([...cfg.ladder, cfg.zoneTf])];
  for (const tf of need) {
    const b = cut[tf];
    if (!b || b.length < MIN_SIGNAL_BARS || !covers(b, tf, atMs)) return null; // Zeitpunkt nicht abgedeckt
  }
  const s = computeSignals(cut, cfg, atMs, inputs);
  if (!s || !s.checks[0] || !s.zone || s.checks.some((c) => !c)) return null;
  return s;
}
