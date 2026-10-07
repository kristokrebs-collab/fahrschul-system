/**
 * Long/Short-Tendenz ("Bias") of the Einstiegs-Check (ours, additive; user request 2026-10-07: "alle Bedingungen
 * abgleichen und an einem waagerechten Balken zeigen, ob eher Short oder eher Long").
 *
 * Every condition of the check votes in BOTH directions on −1 (fully short) … +1 (fully long), read the way the check
 * itself reads it (`verdict.ts`):
 * - MCB per ladder rung (30m → 45m → 1h → 4h): the strongest event of each direction inside the lookback window
 *   (Bottom/Top 1, Kauf/Verkauf ⅔, the small zero-line crosses ⅓ — `WT_RANK / 3`), each decayed by its age in bars
 *   (half-life = `signalLookback` bars), long minus short, plus a mild wave vote (`BIAS_WAVE_SHARE` of: wt1 position
 *   — oversold → long, overbought → short — and wt1 − wt2 slope — curling up → long). LADDER GATE: like the check
 *   ("Leiter muss von unten durchgehend bestätigen"), an event counts fully only when every rung below confirms the
 *   same direction; an unconfirmed higher-rung event counts `BIAS_UNCONFIRMED` (¼).
 * - RSI 14 on the HEAD rungs (the check's `head`: the base plus the rungs the ladder confirms, either direction): per
 *   rung ≤ `rsiOs + rsiNear` (near oversold) +1, ≥ `rsiOb − rsiNear` (near overbought) −1, linear in between; the row
 *   votes the strongest long reading minus the strongest short reading (the check: "some head rung near OS/OB").
 * - Premium/Discount (LuxAlgo): the check's reference — the `zoneTf` check, or the 30m base when that timeframe has too
 *   few bars — by the position in the range: bottom +1, equilibrium band 0, top −1.
 * - "Top-Trader kaufen · Retail rot": per period, top-trader long % up AND all-accounts long % down → +1 when the
 *   run holds (≥ `minRun`), ±0.75 when both point the same way over the window without a full run, ±0.5 when only one
 *   side does; short mirrored; the periods averaged.
 *
 * Weights = the check's score points: MCB 65 (ladder 55 + Bottom/Top 10) split EQUALLY over the rungs (the score's
 * 55 / n per confirmed rung), RSI 20, zone 15, and the whale condition's own `settings.signals.whale.weight` (default
 * 10; 0 = shown, never counted). Override: `settings.signals.bias = { mcb, rsi, zone, whale }` (optional;
 * `sanitizeSignalCfg` keeps the unknown key, `sanitizeBiasCfg` reads it; no settings UI yet).
 *
 * Missing data (a rung with too few bars, no zone, whale off / no Binance data) is EXCLUDED from the weighted mean —
 * never counted as a neutral vote. Nothing left → `null` ("Keine Daten").
 *
 * Consistency with the check's verdict (`sig.long` / `sig.short`, recomputed when absent):
 * - never against a valid entry: when only one side is a valid entry, a sum pointing the other way is shown as 0;
 * - "Stark" only with a valid entry on that side: otherwise the score stops at `BIAS_STRONG_CAP` (74 %) and the
 *   label at "Eher". `Bias.sum` keeps the unlimited weighted mean (= Σ `contributionImpact`), `Bias.limit` says why.
 *
 * Labels: |score| < 0.15 Neutral, < 0.5 Eher Long/Short, else Stark Long/Short (symmetric). `biasLevel(score, prev)`
 * adds a ±0.05 hysteresis around the boundaries so the label does not flicker while the score hovers there.
 * Pure: no React, no I/O.
 */
import { whaleCfgOf, type Side, type SignalCfg, type WhaleCfg } from "./config";
import { ageText, kindText, roleText, ZONE_TEXT } from "./copy";
import { WT_RANK, type WtEvent } from "./mcb";
import { verdict, type Signals, type TfCheck } from "./verdict";
import { WHALE_TITLE, type WhalePeriod, type WhaleReading } from "./whale";
import type { ZoneInfo } from "./zones";

/** −2 Stark Short · −1 Eher Short · 0 Neutral · 1 Eher Long · 2 Stark Long */
export type BiasLevel = -2 | -1 | 0 | 1 | 2;

export const BIAS_TITLE = "Long/Short-Tendenz";
export const BIAS_NO_DATA = "Keine Daten";
export const BIAS_LABEL: Readonly<Record<BiasLevel, string>> = { [-2]: "Stark Short", [-1]: "Eher Short", 0: "Neutral", 1: "Eher Long", 2: "Stark Long" };
/** Row title of the whale condition while it points nowhere (vote 0) or has no data. */
export const WHALE_NEUTRAL_TITLE = "Top-Trader vs. Retail";

/** |score| below this = Neutral (the neutral zone of the bar: ±0.15 = the middle 15 % of its width). */
export const BIAS_LEAN = 0.15;
/** |score| from this = Stark Long / Stark Short (only with a valid entry on that side). */
export const BIAS_STRONG = 0.5;
/** Without a valid entry on its side the score stops here (74 %), just short of "Stark". */
export const BIAS_STRONG_CAP = BIAS_STRONG - 0.02;
/** A label changes only once the score is this far past the boundary of the current level. */
export const BIAS_HYSTERESIS = 0.05;
/** Share of the wave vote (wt1 position + slope) in a rung's MCB vote: mild next to an event. */
export const BIAS_WAVE_SHARE = 0.3;
/** wt1 − wt2 (= half the last wt1 step, wt2 is SMA 2) at which the slope vote is full. */
export const BIAS_SLOPE_FULL = 6;
/** Factor of an MCB event on a rung the ladder below does not confirm (the check ignores it; we keep a trace). */
export const BIAS_UNCONFIRMED = 0.25;
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

/** Per direction: does the ladder below this rung confirm it (every lower rung has a signal of that direction)? */
export interface RungGate {
  long: boolean;
  short: boolean;
}
const OPEN_GATE: Readonly<RungGate> = Object.freeze({ long: true, short: true });

/**
 * MCB vote of one rung: long event − short event (both decayed; an event the ladder below does not confirm counts
 * `BIAS_UNCONFIRMED`) + `BIAS_WAVE_SHARE` × wave, clamped.
 */
export function mcbVote(c: Pick<TfCheck, "wt">, cfg: Pick<SignalCfg, "signalLookback" | "wtObStrong" | "wtOsStrong">, gate: RungGate = OPEN_GATE): number {
  const long = mcbEventVote(c.wt.long, cfg.signalLookback) * (gate.long ? 1 : BIAS_UNCONFIRMED);
  const short = mcbEventVote(c.wt.short, cfg.signalLookback) * (gate.short ? 1 : BIAS_UNCONFIRMED);
  return clamp1(long - short + BIAS_WAVE_SHARE * waveVote(c.wt.wt1, c.wt.wt2, cfg));
}

/** Rungs the ladder confirms for `side`, counted from the base and stopping at the first gap (= `verdict().tiers`). */
export function ladderTiers(checks: readonly (Pick<TfCheck, "longSignal" | "shortSignal"> | null)[], side: Side): number {
  let t = 0;
  for (const c of checks) {
    if (c && (side === "long" ? c.longSignal : c.shortSignal)) t++;
    else break;
  }
  return t;
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
/** `57,5 %` — the share of one side at |score| `a`. */
const sidePct = (a: number): string => `${String(Math.round((50 + 50 * Math.abs(a)) * 10) / 10).replace(".", ",")} %`;

/**
 * Why the label holds although the score sits past its boundary (hysteresis), e.g. `gehalten: wechselt erst unter
 * 55 %`; `""` when the label is the plain level of the score.
 */
export function biasHoldText(score: number, level: BiasLevel): string {
  if (!Number.isFinite(score) || rawBiasLevel(score) === level) return "";
  const [lo, hi] = levelRange(level);
  // the boundary the score has crossed, seen from the leading side (|score|)
  const inner = level === 0 ? null : level > 0 ? lo : hi;
  const a = Math.abs(score);
  if (inner != null && a < Math.abs(inner)) return `gehalten: wechselt erst unter ${sidePct(Math.abs(inner) - BIAS_HYSTERESIS)}`;
  const outer = level === 0 ? BIAS_LEAN : level > 0 ? hi : lo;
  return `gehalten: wechselt erst ab ${sidePct(Math.abs(outer) + BIAS_HYSTERESIS)}`;
}

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

/** Why the shown score differs from the weighted sum. */
export interface BiasLimit {
  /** `entry`: the sum pointed against the only valid entry → 0; `strong`: no valid entry on its side → `BIAS_STRONG_CAP` */
  kind: "entry" | "strong";
  /** the side of the valid entry (`entry`) or of the capped lean (`strong`) */
  side: Side;
  /** German note (explainer) */
  text: string;
}

export interface Bias {
  /** −1 = fully short … +1 = fully long (the weighted mean, limited by the check's verdict — see `limit`) */
  score: number;
  /** the weighted mean of the votes before the limits (= Σ `contributionImpact`) */
  sum: number;
  /** set when `score` ≠ `sum` */
  limit: BiasLimit | null;
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
  /** hysteresis note (`gehalten: wechselt erst unter 55 %`), `""` when the label is the plain level */
  hold: string;
  /** valid entry per side, from the check's verdict */
  valid: Readonly<Record<Side, boolean>>;
  contributions: BiasContribution[];
  /** conditions that voted / all conditions */
  used: number;
  total: number;
}

/** What the bias reads: the checks, the zone and the whale reading; the verdicts when at hand (else recomputed). */
export type BiasInput = Pick<Signals, "checks" | "zone" | "whale"> & Partial<Pick<Signals, "long" | "short">>;

/** MCB rung weights: the group's points split equally over the ladder (the check's score: 55 / n per rung). */
export function rungWeights(n: number, total: number): number[] {
  return Array.from({ length: n }, () => (n > 0 ? total / n : 0));
}

function mcbDetail(c: TfCheck, gate: RungGate): string {
  const long = c.wt.long;
  const short = c.wt.short;
  const ev = long && short ? (long.barsAgo <= short.barsAgo ? long : short) : (long ?? short);
  const tag = (e: NonNullable<WtEvent>): string => `${kindText(e.kind)}${(e === long ? gate.long : gate.short) ? "" : " (unbestätigt)"}`;
  const head = ev ? `${tag(ev)} · ${ageText(ev.barsAgo)}` : kindText(null);
  const both = long && short ? ` (+ ${tag(ev === long ? short : long)})` : "";
  return `${head}${both} · WT ${n1(c.wt.wt1)} ${c.wt.wt1 >= c.wt.wt2 ? "↑" : "↓"}`;
}

function zoneDetail(z: ZoneInfo): string {
  return `${ZONE_TEXT[z.zone]}${z.deep ? "-Zone" : ""} · ${Math.round(z.pos * 100)} % der Range`;
}

function whaleDetail(reading: WhaleReading, w: WhaleCfg, vote: number): string {
  const missing = reading.missing.length ? ` · ${reading.missing.join(", ")}: keine Daten` : "";
  const runOf = (p: WhalePeriod): number => (vote > 0 ? p.runLong : vote < 0 ? p.runShort : Math.max(p.runLong, p.runShort));
  const best = reading.periods.reduce((a, b) => (runOf(b) > runOf(a) ? b : a));
  const runs = vote === 0 ? `Long ${best.runLong}× · Short ${best.runShort}×` : `${runOf(best)}×`;
  return `Top-Trader ${pp(best.topChg)} · Retail ${pp(best.retailChg)} · ${runs} in Folge (${best.period}, mind. ${w.minRun})${missing}`;
}

const SIDE_WORD: Readonly<Record<Side, string>> = { long: "Long", short: "Short" };
const OTHER: Readonly<Record<Side, Side>> = { long: "short", short: "long" };

/**
 * The bias of an evaluation (both directions, every condition). `prevLevel` applies the label hysteresis
 * (`biasLevel`). `null` when no condition has data ("Keine Daten").
 */
export function computeBias(sig: BiasInput | null | undefined, cfg: SignalCfg, prevLevel?: BiasLevel | null): Bias | null {
  if (!sig) return null;
  const bc = biasCfgOf(cfg);
  const w = whaleCfgOf(cfg);
  const out: Omit<BiasContribution, "share">[] = [];
  const checks = sig.checks;
  const n = Math.max(checks.length, cfg.ladder.length);
  const rw = rungWeights(n, bc.mcb);
  const tiers: Record<Side, number> = { long: ladderTiers(checks, "long"), short: ladderTiers(checks, "short") };

  for (let i = 0; i < n; i++) {
    const c = checks[i] ?? null;
    const tf = c?.tf ?? cfg.ladder[i] ?? `#${i + 1}`;
    // an event counts fully only when every rung below confirms its direction (the check's ladder)
    const gate: RungGate = { long: i <= tiers.long, short: i <= tiers.short };
    out.push({
      id: `mcb-${tf}`,
      group: "mcb",
      label: `MCB ${tf} · ${roleText(i, cfg.required)}`,
      vote: c ? mcbVote(c, cfg, gate) : null,
      weight: rw[i]!,
      detail: c ? mcbDetail(c, gate) : "Zu wenig Kerzen",
    });
  }

  // RSI on the check's head rungs (the base + the rungs the ladder confirms): strongest long − strongest short reading
  const headN = Math.max(1, tiers.long, tiers.short);
  let rLong = 0;
  let rShort = 0;
  let rAny = false;
  const rsiParts: string[] = [];
  for (let i = 0; i < headN; i++) {
    const c = checks[i];
    if (!c || !Number.isFinite(c.rsi)) continue;
    const v = rsiVote(c.rsi, cfg);
    rLong = Math.max(rLong, v);
    rShort = Math.max(rShort, -v);
    rAny = true;
    rsiParts.push(`${c.tf} ${n1(c.rsi)}`);
  }
  out.push({
    id: "rsi",
    group: "rsi",
    label: `RSI ${cfg.rsiLen}`,
    vote: rAny ? clamp1(rLong - rShort) : null,
    weight: bc.rsi,
    detail: rAny ? `${rsiParts.join(" · ")} (≤ ${cfg.rsiOs + cfg.rsiNear} Long, ≥ ${cfg.rsiOb - cfg.rsiNear} Short)` : "Zu wenig Kerzen",
  });

  // the check's zone reference: the zoneTf check, or the base when that timeframe has too few bars
  const zc = sig.zone ?? checks.find((c) => c?.tf === cfg.zoneTf) ?? checks[0] ?? null;
  const z = zc?.zone ?? null;
  out.push({
    id: "zone",
    group: "zone",
    label: `Premium/Discount · ${zc?.tf ?? cfg.zoneTf}`,
    vote: z && Number.isFinite(z.pos) ? zoneVote(z.pos) : null,
    weight: bc.zone,
    detail: z ? zoneDetail(z) : "Zu wenig Kerzen",
  });

  if (w.on) {
    const v = whaleVote(sig.whale, w);
    out.push({
      id: "whale",
      group: "whale",
      label: v == null || v === 0 ? WHALE_NEUTRAL_TITLE : WHALE_TITLE[v < 0 ? "short" : "long"],
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
  const sum = clamp1(s / sw);

  // the check's verdict per side (the live snapshot carries it; hand-built inputs get it recomputed)
  const valid: Record<Side, boolean> = {
    long: (sig.long ?? verdict("long", checks, cfg, sig.zone)).valid,
    short: (sig.short ?? verdict("short", checks, cfg, sig.zone)).valid,
  };
  let score = sum;
  let limit: BiasLimit | null = null;
  const only: Side | null = valid.long !== valid.short ? (valid.long ? "long" : "short") : null;
  if (only && (only === "long" ? score < 0 : score > 0)) {
    score = 0;
    limit = { kind: "entry", side: only, text: `gültiger ${SIDE_WORD[only]}-Einstieg im Check: zeigt nicht ${SIDE_WORD[OTHER[only]]}` };
  }
  const lean: Side | null = score > 0 ? "long" : score < 0 ? "short" : null;
  if (lean && Math.abs(score) > BIAS_STRONG_CAP && !valid[lean]) {
    score = Math.sign(score) * BIAS_STRONG_CAP;
    limit = { kind: "strong", side: lean, text: `„Stark“ nur mit gültigem ${SIDE_WORD[lean]}-Einstieg` };
  }
  let level = biasLevel(score, prevLevel);
  if (Math.abs(level) === 2 && !valid[level > 0 ? "long" : "short"]) level = (level > 0 ? 1 : -1) as BiasLevel;

  const contributions: BiasContribution[] = out.map((c) => ({ ...c, share: c.vote != null && c.weight > 0 ? c.weight / sw : 0 }));
  return {
    score,
    sum,
    limit,
    level,
    label: BIAS_LABEL[level],
    side: biasSide(score),
    pct: biasPct(score),
    percent: biasPercentText(score),
    valueText: biasValueText(score, level),
    hold: biasHoldText(score, level),
    valid,
    contributions,
    used: contributions.filter((c) => c.vote != null).length,
    total: contributions.length,
  };
}

/** Weighted vote of one row in score units (−1 … +1 of the whole bar): `share × vote`. Σ over the rows = `Bias.sum`. */
export const contributionImpact = (c: Pick<BiasContribution, "share" | "vote">): number => (c.vote == null ? 0 : c.share * c.vote);

/**
 * Largest-remainder rounding: `xs` rounded to integers that add up to `Math.round(Σ xs)` (shares in % → exactly 100,
 * impacts in hundredths → exactly the rounded sum). Signed values work too.
 */
export function roundToSum(xs: readonly number[]): number[] {
  const fl = xs.map((x) => (Number.isFinite(x) ? Math.floor(x) : 0));
  const total = Math.round(xs.reduce((a, x) => a + (Number.isFinite(x) ? x : 0), 0));
  let k = total - fl.reduce((a, x) => a + x, 0);
  const order = xs.map((x, i) => ({ i, f: Number.isFinite(x) ? x - fl[i]! : 0 })).sort((a, b) => b.f - a.f || a.i - b.i);
  for (const o of order) {
    if (k <= 0) break;
    if (o.f <= 0) break;
    fl[o.i]!++;
    k--;
  }
  return fl;
}

/** German one-paragraph method note (explainer). */
export function biasMethodText(cfg: SignalCfg): string {
  const bc = biasCfgOf(cfg);
  const w = whaleCfgOf(cfg);
  const whale = w.on ? `, Top-Trader · Retail ${bc.whale ?? w.weight}` : "";
  return (
    `Jede Bedingung stimmt zwischen −1 (Short) und +1 (Long) ab; Stimme × Gewicht = Beitrag, die Beiträge ergeben die Summe. ` +
    `Gewichte wie die Score-Punkte des Checks: MCB ${bc.mcb} (zu gleichen Teilen auf ${cfg.ladder.join(" · ")}), RSI ${bc.rsi}, Zone ${bc.zone}${whale}. ` +
    `Ein MCB-Signal einer höheren Stufe zählt nur voll, wenn alle Stufen darunter dieselbe Richtung bestätigen (sonst ¼); RSI zählt ` +
    `auf der Basis und den bestätigten Stufen. Fehlende Daten zählen nicht. Neutral bis ${sidePct(BIAS_LEAN)} einer Seite, „Eher“ darüber, ` +
    `„Stark“ ab ${sidePct(BIAS_STRONG)} und nur mit gültigem Einstieg; nie gegen einen gültigen Einstieg. ` +
    `Die Stufe wechselt erst ${String(BIAS_HYSTERESIS * 50).replace(".", ",")} % hinter der Grenze.`
  );
}
