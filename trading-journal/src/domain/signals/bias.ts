/**
 * Long/Short-Tendenz ("Bias") of the Einstiegs-Check (ours, additive; user request 2026-10-07: "alle Bedingungen
 * abgleichen und an einem waagerechten Balken zeigen, ob eher Short oder eher Long").
 *
 * Every condition of the check votes in BOTH directions on −1 (fully short) … +1 (fully long):
 * - MCB per ladder rung (30m → 45m → 1h → 4h): the strongest event of each direction inside the lookback window
 *   (Bottom/Top 1, Kauf/Verkauf ⅔, the small zero-line crosses ⅓ — `WT_RANK / 3`), each decayed by its age in bars
 *   (half-life = `signalLookback` bars), long minus short, plus a mild wave vote (`BIAS_WAVE_SHARE` of: wt1 position
 *   — oversold → long, overbought → short — and wt1 − wt2 slope — curling up → long).
 * - RSI 14 per rung: ≤ `rsiOs + rsiNear` (near oversold) +1, ≥ `rsiOb − rsiNear` (near overbought) −1, linear in
 *   between (0 at the middle, 50 with the defaults); one row, the rungs weighted like the MCB rungs.
 * - Premium/Discount (LuxAlgo, `zoneTf`): by the position in the range — bottom +1, equilibrium band 0, top −1.
 * - "Top-Trader kaufen · Retail rot": per period, top-trader long % up AND all-accounts long % down → +1 when the
 *   run holds (≥ `minRun`), ±0.75 when both point the same way over the window without a full run, ±0.5 when only one
 *   side does; short mirrored; the periods averaged.
 *
 * Weights reuse the check's grading: the score's points (ladder 55 + Bottom/Top 10 = MCB 65, RSI 20, zone 15) and the
 * whale condition's own `settings.signals.whale.weight` (default 10; 0 = shown, never counted). The MCB points are
 * split over the rungs by 1 : 2 : 3 : 4 … (the strength grading adds one level per further rung: higher rungs weigh
 * more). Override: `settings.signals.bias = { mcb, rsi, zone, whale }` (optional; `sanitizeSignalCfg` keeps the
 * unknown key, `sanitizeBiasCfg` reads it; no settings UI yet).
 *
 * Missing data (a rung with too few bars, no zone, whale off / no Binance data) is EXCLUDED from the weighted mean —
 * never counted as a neutral vote. Nothing left → `null` ("Keine Daten").
 *
 * Labels: |score| < 0.15 Neutral, < 0.5 Eher Long/Short, else Stark Long/Short (symmetric). `biasLevel(score, prev)`
 * adds a ±0.05 hysteresis around the boundaries so the label does not flicker while the score hovers there.
 * Pure: no React, no I/O.
 */
import { whaleCfgOf, type Side, type SignalCfg, type WhaleCfg } from "./config";
import { ageText, kindText, roleText, ZONE_TEXT } from "./copy";
import { WT_RANK, type WtEvent } from "./mcb";
import type { Signals, TfCheck } from "./verdict";
import { WHALE_TITLE, type WhalePeriod, type WhaleReading } from "./whale";
import type { ZoneInfo } from "./zones";

/** −2 Stark Short · −1 Eher Short · 0 Neutral · 1 Eher Long · 2 Stark Long */
export type BiasLevel = -2 | -1 | 0 | 1 | 2;

export const BIAS_TITLE = "Long/Short-Tendenz";
export const BIAS_NO_DATA = "Keine Daten";
export const BIAS_LABEL: Readonly<Record<BiasLevel, string>> = { [-2]: "Stark Short", [-1]: "Eher Short", 0: "Neutral", 1: "Eher Long", 2: "Stark Long" };

/** |score| below this = Neutral (the neutral zone of the bar: ±0.15 = the middle 15 % of its width). */
export const BIAS_LEAN = 0.15;
/** |score| from this = Stark Long / Stark Short. */
export const BIAS_STRONG = 0.5;
/** A label changes only once the score is this far past the boundary of the current level. */
export const BIAS_HYSTERESIS = 0.05;
/** Share of the wave vote (wt1 position + slope) in a rung's MCB vote: mild next to an event. */
export const BIAS_WAVE_SHARE = 0.3;
/** wt1 − wt2 (= half the last wt1 step, wt2 is SMA 2) at which the slope vote is full. */
export const BIAS_SLOPE_FULL = 6;
/** Equilibrium band of the zone vote (0 inside), the same 47.5 … 52.5 % as `zoneOf`. */
const EQ_LO = 0.475;
const EQ_HI = 0.525;

/** Weights (points) per condition group. `whale: null` = the whale condition's own `weight`. */
export interface BiasCfg {
  mcb: number;
  rsi: number;
  zone: number;
  whale: number | null;
}

/** From the check's score: ladder 55 + Bottom/Top 10, RSI 20, zone 15; whale = `settings.signals.whale.weight`. */
export const DEFAULT_BIAS_CFG: Readonly<BiasCfg> = Object.freeze({ mcb: 65, rsi: 20, zone: 15, whale: null });
const WEIGHT_MAX = 100;

/** `settings.signals.bias` (raw, optional) → weights 0 … 100; missing / invalid → the defaults. */
export function sanitizeBiasCfg(raw: unknown): BiasCfg {
  const r = (raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {}) as Record<string, unknown>;
  const num = (v: unknown, d: number | null): number | null => {
    const n = typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v) : NaN;
    return Number.isFinite(n) ? Math.min(WEIGHT_MAX, Math.max(0, n)) : d;
  };
  return {
    mcb: num(r.mcb, DEFAULT_BIAS_CFG.mcb)!,
    rsi: num(r.rsi, DEFAULT_BIAS_CFG.rsi)!,
    zone: num(r.zone, DEFAULT_BIAS_CFG.zone)!,
    whale: num(r.whale, DEFAULT_BIAS_CFG.whale),
  };
}

const biasCfgOf = (cfg: SignalCfg): BiasCfg => sanitizeBiasCfg((cfg as SignalCfg & { bias?: unknown }).bias);

// ------------------------------------------------------------------ votes

const clamp1 = (x: number): number => (Number.isFinite(x) ? Math.max(-1, Math.min(1, x)) : 0);

/** Age decay of an MCB event: 1 on the running candle, halved every `lookback` bars. */
export function ageDecay(barsAgo: number, lookback: number): number {
  return Math.pow(0.5, Math.max(0, barsAgo) / Math.max(1, lookback));
}

/** Magnitude 0 … 1 of one event: `WT_RANK / 3` (Bottom/Top 1, Kauf/Verkauf ⅔, crosses ⅓) × age decay. */
export function mcbEventVote(ev: WtEvent, lookback: number): number {
  if (!ev) return 0;
  return (WT_RANK[ev.kind] / 3) * ageDecay(ev.barsAgo, lookback);
}

/**
 * Wave vote −1 … +1 from wt1 / wt2 alone: half the position (oversold → long, `±wtObStrong / wtOsStrong` = full), half
 * the slope (wt1 above wt2 = curling up → long, `BIAS_SLOPE_FULL` = full).
 */
export function waveVote(wt1: number, wt2: number, cfg: Pick<SignalCfg, "wtObStrong" | "wtOsStrong">): number {
  if (!Number.isFinite(wt1)) return 0;
  const pos = wt1 < 0 ? -wt1 / Math.max(1, Math.abs(cfg.wtOsStrong)) : -wt1 / Math.max(1, Math.abs(cfg.wtObStrong));
  const slope = Number.isFinite(wt2) ? (wt1 - wt2) / BIAS_SLOPE_FULL : 0;
  return clamp1(0.5 * clamp1(pos) + 0.5 * clamp1(slope));
}

/** MCB vote of one rung: long event − short event (both decayed) + `BIAS_WAVE_SHARE` × wave, clamped. */
export function mcbVote(c: Pick<TfCheck, "wt">, cfg: Pick<SignalCfg, "signalLookback" | "wtObStrong" | "wtOsStrong">): number {
  const ev = mcbEventVote(c.wt.long, cfg.signalLookback) - mcbEventVote(c.wt.short, cfg.signalLookback);
  return clamp1(ev + BIAS_WAVE_SHARE * waveVote(c.wt.wt1, c.wt.wt2, cfg));
}

/** RSI vote: ≤ near-oversold +1, ≥ near-overbought −1, linear in between (0 in the middle). */
export function rsiVote(rsi: number, cfg: Pick<SignalCfg, "rsiOs" | "rsiOb" | "rsiNear">): number {
  if (!Number.isFinite(rsi)) return 0;
  const lo = cfg.rsiOs + cfg.rsiNear;
  const hi = cfg.rsiOb - cfg.rsiNear;
  if (rsi <= lo) return 1;
  if (rsi >= hi) return -1;
  const mid = (lo + hi) / 2;
  return clamp1((mid - rsi) / ((hi - lo) / 2));
}

/** Zone vote from the position in the range (0 = bottom … 1 = top): discount → long, premium → short, EQ band 0. */
export function zoneVote(pos: number): number {
  if (!Number.isFinite(pos)) return 0;
  const p = Math.max(0, Math.min(1, pos));
  if (p < EQ_LO) return (EQ_LO - p) / EQ_LO;
  if (p > EQ_HI) return -(p - EQ_HI) / (1 - EQ_HI);
  return 0;
}

/** A change smaller than this (pp) points nowhere. */
const WHALE_FLAT_PP = 0.05;
const sgn = (x: number): number => (x > WHALE_FLAT_PP ? 1 : x < -WHALE_FLAT_PP ? -1 : 0);

/**
 * Vote of one period: the run holds (≥ `minRun`) → ±1; both readings point the same way over the window without a full
 * run → ±0.75; only one of them (top traders buy / sell OR retail red / green) → ±0.5; opposite → 0.
 */
export function whalePeriodVote(p: Pick<WhalePeriod, "runLong" | "runShort" | "topChg" | "retailChg">, minRun: number): number {
  if (p.runLong >= minRun && p.runLong > p.runShort) return 1;
  if (p.runShort >= minRun && p.runShort > p.runLong) return -1;
  const top = sgn(p.topChg);
  const retail = -sgn(p.retailChg); // retail red (falling long %) is a long vote
  if (top !== 0 && top === retail) return 0.75 * top;
  return 0.5 * (top + retail);
}

/** Whale vote: the mean of the period votes; `null` without a reading. */
export function whaleVote(reading: WhaleReading | null | undefined, w: Pick<WhaleCfg, "minRun">): number | null {
  if (!reading || !reading.periods.length) return null;
  let s = 0;
  for (const p of reading.periods) s += whalePeriodVote(p, w.minRun);
  return clamp1(s / reading.periods.length);
}

// ------------------------------------------------------------------ levels / text

/** Level without hysteresis (symmetric: `rawLevel(−s) = −rawLevel(s)`). */
export function rawBiasLevel(score: number): BiasLevel {
  const a = Math.abs(score);
  const m = a >= BIAS_STRONG ? 2 : a >= BIAS_LEAN ? 1 : 0;
  return (score < 0 && m ? -m : m) as BiasLevel;
}

/** Score interval of a level: [lo, hi). */
function levelRange(l: BiasLevel): [number, number] {
  switch (l) {
    case -2:
      return [-Infinity, -BIAS_STRONG];
    case -1:
      return [-BIAS_STRONG, -BIAS_LEAN];
    case 0:
      return [-BIAS_LEAN, BIAS_LEAN];
    case 1:
      return [BIAS_LEAN, BIAS_STRONG];
    default:
      return [BIAS_STRONG, Infinity];
  }
}

/**
 * Level with hysteresis: the previous level holds while the score stays within `h` of its interval; only a score
 * clearly past a boundary changes it (no label flicker at 0.149 ↔ 0.151). Without `prev` = `rawBiasLevel`.
 */
export function biasLevel(score: number, prev?: BiasLevel | null, h: number = BIAS_HYSTERESIS): BiasLevel {
  const raw = rawBiasLevel(score);
  if (prev == null || raw === prev || !Number.isFinite(score)) return raw;
  const [lo, hi] = levelRange(prev);
  return score >= lo - h && score <= hi + h ? prev : raw;
}

/** Share of the leading side, 50 … 100 (the bar's 0 … 100 % Long mapped onto the stronger side). */
export const biasPct = (score: number): number => Math.round(50 + 50 * Math.min(1, Math.abs(Number.isFinite(score) ? score : 0)));

/** Leading side (`null` at exactly 50 %). */
export const biasSide = (score: number): Side | null => (biasPct(score) === 50 ? null : score > 0 ? "long" : "short");

/** `64 % Long` / `70 % Short` / `50 %`. */
export function biasPercentText(score: number): string {
  const side = biasSide(score);
  return side ? `${biasPct(score)} % ${side === "long" ? "Long" : "Short"}` : "50 %";
}

/** Text alternative of the meter: `Eher Long, 64 %` · `Neutral, 53 % Long` · `Neutral, 50 %`. */
export function biasValueText(score: number, level: BiasLevel): string {
  if (level !== 0) return `${BIAS_LABEL[level]}, ${biasPct(score)} %`;
  return `${BIAS_LABEL[0]}, ${biasPercentText(score)}`;
}

/** de-DE, one decimal, U+2212 minus. */
const n1 = (x: number): string => {
  const r = Math.round(x * 10) / 10;
  return `${r < 0 ? "−" : ""}${Math.abs(r).toFixed(1).replace(".", ",")}`;
};
const pp = (x: number): string => {
  const r = Math.round(x * 10) / 10;
  return `${r > 0 ? "+" : r < 0 ? "−" : "±"}${Math.abs(r).toFixed(1).replace(".", ",")} pp`;
};

// ------------------------------------------------------------------ the bias

export type BiasGroup = "mcb" | "rsi" | "zone" | "whale";

export interface BiasContribution {
  /** `mcb-30m` … `rsi`, `zone`, `whale` */
  id: string;
  group: BiasGroup;
  /** German row name, as on the card (`MCB 30m · Basis`, `RSI 14`, `Premium/Discount · 1h`, `Top-Trader kaufen · Retail rot`) */
  label: string;
  /** −1 (Short) … +1 (Long); `null` = no data (excluded from the mean) */
  vote: number | null;
  /** configured points of this condition */
  weight: number;
  /** weight / Σ weights of the conditions with data (0 when excluded or weight 0) */
  share: number;
  /** German detail line (`Bottom · vor 1 · WT −61,2 ↑`, `keine Daten`, …) */
  detail: string;
}

export interface Bias {
  /** −1 = fully short … +1 = fully long (weighted mean of the votes) */
  score: number;
  level: BiasLevel;
  /** `Stark Short` · `Eher Short` · `Neutral` · `Eher Long` · `Stark Long` */
  label: string;
  side: Side | null;
  /** share of the leading side, 50 … 100 */
  pct: number;
  /** `64 % Long` */
  percent: string;
  /** `Eher Long, 64 %` (meter text alternative) */
  valueText: string;
  contributions: BiasContribution[];
  /** conditions that voted / all conditions */
  used: number;
  total: number;
}

/** MCB rung weights: the group's points split 1 : 2 : 3 : 4 … over the ladder (higher timeframe = more). */
export function rungWeights(n: number, total: number): number[] {
  const sum = (n * (n + 1)) / 2;
  return Array.from({ length: n }, (_, i) => (sum > 0 ? (total * (i + 1)) / sum : 0));
}

function mcbDetail(c: TfCheck): string {
  const long = c.wt.long;
  const short = c.wt.short;
  const ev = long && short ? (long.barsAgo <= short.barsAgo ? long : short) : (long ?? short);
  const head = ev ? `${kindText(ev.kind)} · ${ageText(ev.barsAgo)}` : kindText(null);
  const both = long && short ? ` (+ ${kindText(ev === long ? short.kind : long.kind)})` : "";
  return `${head}${both} · WT ${n1(c.wt.wt1)} ${c.wt.wt1 >= c.wt.wt2 ? "↑" : "↓"}`;
}

function zoneDetail(z: ZoneInfo): string {
  return `${ZONE_TEXT[z.zone]}${z.deep ? "-Zone" : ""} · ${Math.round(z.pos * 100)} % der Range`;
}

function whaleDetail(reading: WhaleReading, w: WhaleCfg, vote: number): string {
  const side: Side = vote < 0 ? "short" : "long";
  const best = reading.periods.reduce((a, b) => {
    const ra = side === "long" ? a.runLong : a.runShort;
    const rb = side === "long" ? b.runLong : b.runShort;
    return rb > ra ? b : a;
  });
  const run = side === "long" ? best.runLong : best.runShort;
  const missing = reading.missing.length ? ` · ${reading.missing.join(", ")}: keine Daten` : "";
  return `Top-Trader ${pp(best.topChg)} · Retail ${pp(best.retailChg)} · ${run}× in Folge (${best.period}, mind. ${w.minRun})${missing}`;
}

/**
 * The bias of an evaluation (both directions, every condition). `prevLevel` applies the label hysteresis
 * (`biasLevel`). `null` when no condition has data ("Keine Daten").
 */
export function computeBias(sig: Pick<Signals, "checks" | "zone" | "whale"> | null | undefined, cfg: SignalCfg, prevLevel?: BiasLevel | null): Bias | null {
  if (!sig) return null;
  const bc = biasCfgOf(cfg);
  const w = whaleCfgOf(cfg);
  const out: Omit<BiasContribution, "share">[] = [];
  const n = Math.max(sig.checks.length, cfg.ladder.length);
  const rw = rungWeights(n, bc.mcb);

  for (let i = 0; i < n; i++) {
    const c = sig.checks[i] ?? null;
    const tf = c?.tf ?? cfg.ladder[i] ?? `#${i + 1}`;
    out.push({
      id: `mcb-${tf}`,
      group: "mcb",
      label: `MCB ${tf} · ${roleText(i, cfg.required)}`,
      vote: c ? mcbVote(c, cfg) : null,
      weight: rw[i]!,
      detail: c ? mcbDetail(c) : "Zu wenig Kerzen",
    });
  }

  // RSI: one row, the rungs weighted like the MCB rungs (1 : 2 : 3 : 4)
  let rs = 0;
  let rwSum = 0;
  const rsiParts: string[] = [];
  for (let i = 0; i < n; i++) {
    const c = sig.checks[i];
    if (!c || !Number.isFinite(c.rsi)) continue;
    rs += (i + 1) * rsiVote(c.rsi, cfg);
    rwSum += i + 1;
    rsiParts.push(`${c.tf} ${n1(c.rsi)}`);
  }
  out.push({
    id: "rsi",
    group: "rsi",
    label: `RSI ${cfg.rsiLen}`,
    vote: rwSum > 0 ? clamp1(rs / rwSum) : null,
    weight: bc.rsi,
    detail: rwSum > 0 ? `${rsiParts.join(" · ")} (≤ ${cfg.rsiOs + cfg.rsiNear} Long, ≥ ${cfg.rsiOb - cfg.rsiNear} Short)` : "Zu wenig Kerzen",
  });

  const z = sig.zone?.zone ?? null;
  out.push({
    id: "zone",
    group: "zone",
    label: `Premium/Discount · ${sig.zone?.tf ?? cfg.zoneTf}`,
    vote: z && Number.isFinite(z.pos) ? zoneVote(z.pos) : null,
    weight: bc.zone,
    detail: z ? zoneDetail(z) : "Zu wenig Kerzen",
  });

  if (w.on) {
    const v = whaleVote(sig.whale, w);
    out.push({
      id: "whale",
      group: "whale",
      label: WHALE_TITLE[v != null && v < 0 ? "short" : "long"],
      vote: v,
      weight: bc.whale ?? w.weight,
      detail: v == null || !sig.whale ? "keine Daten" : `${whaleDetail(sig.whale, w, v)}${(bc.whale ?? w.weight) > 0 ? "" : " · zählt nicht"}`,
    });
  }

  let sw = 0;
  let s = 0;
  for (const c of out) {
    if (c.vote == null || !(c.weight > 0)) continue;
    sw += c.weight;
    s += c.weight * c.vote;
  }
  if (!(sw > 0)) return null;
  const score = clamp1(s / sw);
  const level = biasLevel(score, prevLevel);
  const contributions: BiasContribution[] = out.map((c) => ({ ...c, share: c.vote != null && c.weight > 0 ? c.weight / sw : 0 }));
  return {
    score,
    level,
    label: BIAS_LABEL[level],
    side: biasSide(score),
    pct: biasPct(score),
    percent: biasPercentText(score),
    valueText: biasValueText(score, level),
    contributions,
    used: contributions.filter((c) => c.vote != null).length,
    total: contributions.length,
  };
}

/** Weighted vote of one row in score units (−1 … +1 of the whole bar): `share × vote`. */
export const contributionImpact = (c: Pick<BiasContribution, "share" | "vote">): number => (c.vote == null ? 0 : c.share * c.vote);

const pctText = (score: number): string => `${String(50 + 50 * score).replace(".", ",")} %`;

/** German one-paragraph method note (explainer). */
export function biasMethodText(cfg: SignalCfg): string {
  const bc = biasCfgOf(cfg);
  const w = whaleCfgOf(cfg);
  const whale = w.on ? `, Top-Trader · Retail ${bc.whale ?? w.weight}` : "";
  return (
    `Jede Bedingung des Checks stimmt zwischen −1 (Short) und +1 (Long) ab, in beide Richtungen. Gewichtet mit den Score-Punkten: ` +
    `MCB ${bc.mcb} (auf ${cfg.ladder.join(" · ")} im Verhältnis ${cfg.ladder.map((_, i) => i + 1).join(" : ")} verteilt), RSI ${bc.rsi}, Zone ${bc.zone}${whale}. ` +
    `Fehlende Daten zählen nicht mit. Neutral bis ${pctText(BIAS_LEAN)} einer Seite, „Eher“ darüber, „Stark“ ab ${pctText(BIAS_STRONG)}.`
  );
}
