/**
 * Lage-Ampel (decision 23; …/scratchpad/merge/knife-lab/REPORT.md § RECOMMENDATION) — fixed logic, validated on
 * BTC history, no dial:
 *
 * - k = last CLOSED daily bar. `unter1 = close[k] < EMA21_1D[k]`, `unter2 = close[k−1] < EMA21_1D[k−1]`,
 *   `abwaerts = unter1 && unter2` (red after 2 daily closes below, green again after the first close above).
 * - Reversal signs (decide only while `abwaerts`): U1 live price > EMA21_1D[k] · U2 last closed 4H close > 4H-EMA 21 ·
 *   U3 4H-EMA 21 > 4H-EMA 50 · U4 4H internal structure trend up (`marketStructure`, last 500 closed 4H bars).
 * - red = abwaerts, no sign · amber = abwaerts, ≥ 1 sign · green = not abwaerts ("Umkehr bestätigt" for
 *   `LAGE_CONFIRM_DAYS` after a red phase, else "Aufwärtstrend intakt"; "Trend wackelt" after one close below).
 *
 * Only closed bars feed EMAs and structure; the live price is used for U1 and the distances only. Deterministic.
 * Two stages so the market layer can cache the closed-bar part: `lageBase` (bars → EMAs, structure, phase) and
 * `lageAt` (+ live price → Lage); `computeLage` = both.
 */
import { n0, pct } from "@/lib/format";
import { ema, type Bar } from "@/domain/signals/indicators";
import { marketStructure, type Level, type Structure, type StructureCfg } from "@/domain/signals/structure";
import { aboveText, belowText, ema200Text, LAGE_HEADLINE, SIGN_LABEL, TREND_TEXT, wobbleText } from "./copy";
import type { Lage, LageChip, LageDaily, LageEma, LageH4, LageLevel, LageOptions, LageSign, LageSignId, LageState } from "./types";

export const DAY_MS = 86_400_000;
export const H4_MS = 14_400_000;
export const H1_MS = 3_600_000;
/** Closed daily bars needed for the gate (EMA 21 settled at k − 1). */
export const LAGE_MIN_DAILY = 60;
/** Closed 4H bars needed for the signs U2 … U4. */
export const LAGE_MIN_H4 = 120;
/** Bars the structure reads (the engine's `SIGNAL_BARS` window). */
export const LAGE_STRUCTURE_BARS = 500;
/** "Umkehr bestätigt" this long after a red phase ended. */
export const LAGE_CONFIRM_DAYS = 3;
/** "neues 20-Kerzen-Tief (1H)": one of the last 3 closed lows at or below the 20 lows before them. */
export const NEW_LOW_BARS = 20;
/** First daily index whose EMA counts for the phase walk (seeded EMA warm-up). */
const PHASE_WARMUP = 30;
/** Levels per side and timeframe. */
const LEVELS_PER_TF = 2;

export const LAGE_STRUCTURE: Readonly<StructureCfg> = Object.freeze({ swing: 50, internal: 5, eqLen: 3, eqThreshold: 0.1, range: null });

/** Next 00:00 UTC strictly after `nowMs`. */
export const nextDailyClose = (nowMs: number): number => (Math.floor(nowMs / DAY_MS) + 1) * DAY_MS;

/** Prefix of `bars` (ascending open times, SECONDS) whose bar has closed at `nowMs`. */
export function closedBars(bars: readonly Bar[] | null | undefined, sec: number, nowMs: number): readonly Bar[] {
  if (!bars?.length) return [];
  let n = bars.length;
  while (n > 0 && (bars[n - 1]!.t + sec) * 1000 > nowMs) n--;
  return n === bars.length ? bars : bars.slice(0, n);
}

const tail = <T>(xs: readonly T[], n: number): readonly T[] => (xs.length > n ? xs.slice(xs.length - n) : xs);
const fin = (x: number | null | undefined): x is number => typeof x === "number" && Number.isFinite(x);

/** Closed-bar part of the Lage (cache it per closed bar set). */
export interface LageBase {
  /** changes when a closed input bar changes */
  key: string;
  ok: boolean;
  dailyN: number;
  h4N: number;
  h1N: number;
  daily: LageDaily | null;
  /** close of the bar before k and its EMA 21 */
  prev: { close: number; ema21: number } | null;
  unter1: boolean;
  unter2: boolean;
  abwaerts: boolean;
  /** start of the current phase (close time of its first daily bar), `null` = before the data */
  since: number | null;
  h4: LageH4 | null;
  s4: Structure | null;
  sD: Structure | null;
  newLow1h: boolean | null;
  /** newest close of any input incl. a forming bar (stands in for a missing live price) */
  lastClose: number | null;
}

function newLow(lows: readonly number[]): boolean | null {
  const j = lows.length - 1;
  if (j < NEW_LOW_BARS + 2) return null;
  const recent = Math.min(lows[j]!, lows[j - 1]!, lows[j - 2]!);
  let before = Infinity;
  for (let i = j - NEW_LOW_BARS - 2; i < j - 2; i++) before = Math.min(before, lows[i]!);
  return recent <= before;
}

const barKey = (b: readonly Bar[]): string => {
  const l = b[b.length - 1];
  return l ? `${b.length}:${l.t}:${l.c}` : "0";
};

/** Closed-bar evaluation: EMAs, phase, 4H signs' inputs, structures. */
export function lageBase(dailyIn: readonly Bar[], h4In: readonly Bar[], nowMs: number, opts: LageOptions = {}): LageBase {
  const daily = closedBars(dailyIn, 86_400, nowMs);
  const h4 = closedBars(h4In, 14_400, nowMs);
  const h1 = closedBars(opts.h1, 3_600, nowMs);
  const scfg: StructureCfg = { ...LAGE_STRUCTURE, ...opts.structure };
  const lastClose = h4In.at(-1)?.c ?? dailyIn.at(-1)?.c ?? null;
  const key = `${barKey(daily)}|${barKey(h4)}|${barKey(h1)}|${scfg.swing},${scfg.internal},${scfg.eqLen},${scfg.eqThreshold}`;
  const ok = daily.length >= LAGE_MIN_DAILY;

  let d: LageDaily | null = null;
  let prev: LageBase["prev"] = null;
  let unter1 = false;
  let unter2 = false;
  let since: number | null = null;
  let sD: Structure | null = null;
  if (ok) {
    const c = daily.map((b) => b.c);
    const e21 = ema(c, 21);
    const e50 = ema(c, 50);
    const e200 = ema(c, 200);
    const k = c.length - 1;
    const below = (i: number): boolean => c[i]! < e21[i]!;
    let run = 0;
    for (let i = k; i >= 0 && below(i); i--) run++;
    d = {
      at: daily[k]!.t * 1000,
      closeAt: (daily[k]!.t + 86_400) * 1000,
      close: c[k]!,
      ema21: e21[k]!,
      ema50: e50[k]!,
      ema200: c.length >= 200 ? e200[k]! : null,
      dist21: c[k]! / e21[k]! - 1,
      below: run,
    };
    prev = { close: c[k - 1]!, ema21: e21[k - 1]! };
    unter1 = below(k);
    unter2 = below(k - 1);
    const down = (i: number): boolean => below(i) && below(i - 1);
    const now = down(k);
    for (let j = k - 1; j >= PHASE_WARMUP; j--) {
      if (down(j) !== now) {
        since = (daily[j + 1]!.t + 86_400) * 1000;
        break;
      }
    }
    sD = marketStructure(tail(daily, LAGE_STRUCTURE_BARS), scfg);
  }

  let h: LageH4 | null = null;
  let s4: Structure | null = null;
  if (h4.length >= LAGE_MIN_H4) {
    const c = h4.map((b) => b.c);
    const e21 = ema(c, 21);
    const e50 = ema(c, 50);
    const e200 = ema(c, 200);
    const k = c.length - 1;
    s4 = marketStructure(tail(h4, LAGE_STRUCTURE_BARS), scfg);
    h = {
      at: h4[k]!.t * 1000,
      closeAt: (h4[k]!.t + 14_400) * 1000,
      close: c[k]!,
      ema21: e21[k]!,
      ema50: e50[k]!,
      ema200: c.length >= 200 ? e200[k]! : null,
      cross: e21[k]! > e50[k]!,
      trend: s4?.trend ?? 0,
      itrend: s4?.itrend ?? 0,
      atr: s4?.atr ?? NaN,
    };
  }

  return {
    key,
    ok,
    dailyN: daily.length,
    h4N: h4.length,
    h1N: h1.length,
    daily: d,
    prev,
    unter1,
    unter2,
    abwaerts: unter1 && unter2,
    since,
    h4: h,
    s4,
    sD,
    newLow1h: h1.length ? newLow(h1.map((b) => b.l)) : null,
    lastClose,
  };
}

function signsOf(b: LageBase, price: number | null): LageSign[] {
  const d = b.daily;
  const h = b.h4;
  const u1 = d && price != null ? price > d.ema21 : null;
  return [
    { id: "U1", label: SIGN_LABEL.U1, met: u1, detail: d && price != null ? `${n0(price)} · EMA ${n0(d.ema21)} (${pct(price / d.ema21 - 1)})` : "–" },
    { id: "U2", label: SIGN_LABEL.U2, met: h ? h.close > h.ema21 : null, detail: h ? `4H-Schluss ${n0(h.close)} · EMA 21 ${n0(h.ema21)}` : "keine 4H-Daten" },
    { id: "U3", label: SIGN_LABEL.U3, met: h ? h.cross : null, detail: h ? `EMA 21 ${n0(h.ema21)} · EMA 50 ${n0(h.ema50)}` : "keine 4H-Daten" },
    { id: "U4", label: SIGN_LABEL.U4, met: h ? h.itrend === 1 : null, detail: h ? `interner 4H-Trend ${TREND_TEXT[h.itrend]}` : "keine 4H-Daten" },
  ];
}

function emaLadder(b: LageBase, price: number | null): LageEma[] {
  const out: LageEma[] = [];
  const add = (tf: "1D" | "4H", len: 21 | 50 | 200, v: number | null | undefined): void => {
    if (!fin(v)) return;
    out.push({ id: `${tf}-${len}`, tf, len, label: `${tf}-EMA ${len}`, value: v, dist: price != null ? price / v - 1 : NaN });
  };
  if (b.daily) {
    add("1D", 21, b.daily.ema21);
    add("1D", 50, b.daily.ema50);
    add("1D", 200, b.daily.ema200);
  }
  if (b.h4) {
    add("4H", 21, b.h4.ema21);
    add("4H", 50, b.h4.ema50);
    add("4H", 200, b.h4.ema200);
  }
  return out.sort((x, y) => y.value - x.value || (x.tf === y.tf ? x.len - y.len : x.tf === "1D" ? -1 : 1));
}

function levelsOf(b: LageBase, price: number | null): Lage["levels"] {
  const ref = price ?? b.lastClose;
  const atr = fin(b.h4?.atr) ? b.h4!.atr : fin(b.sD?.atr) ? b.sD!.atr : NaN;
  const pick = (s: Structure | null, tf: "4H" | "1D", side: "support" | "resistance"): LageLevel[] =>
    (s ? (side === "support" ? s.supports : s.resistances) : []).slice(0, LEVELS_PER_TF).map((l: Level) => ({
      id: `${tf}:${l.kind}:${Math.round(l.price)}`,
      tf,
      side,
      kind: l.kind,
      label: `${tf} ${l.label}`,
      price: l.price,
      top: l.top,
      btm: l.btm,
      dist: ref != null ? l.price / ref - 1 : NaN,
      distAtr: ref != null && atr > 0 ? Math.abs(l.price - ref) / atr : NaN,
    }));
  const own = [...pick(b.s4, "4H", "resistance"), ...pick(b.s4, "4H", "support")];
  // a 1D level next to a 4H one adds nothing: keep it only ≥ max(0.25 %, 0.1 ATR) away from every 4H level
  const gap = (x: LageLevel): number => Math.max(x.price * 0.0025, fin(atr) ? 0.1 * atr : 0);
  const daily = [...pick(b.sD, "1D", "resistance"), ...pick(b.sD, "1D", "support")].filter((x) => own.every((o) => Math.abs(o.price - x.price) >= gap(x)));
  const all = [...own, ...daily];
  // the side as the live price sees it: a support the price fell through is now above it (and reads as resistance)
  const above = (x: LageLevel): boolean => (ref != null ? x.price > ref : x.side === "resistance");
  const res = all.filter(above).map((x) => ({ ...x, side: "resistance" as const }));
  const sup = all.filter((x) => !above(x)).map((x) => ({ ...x, side: "support" as const }));
  return { resistances: res.sort((x, y) => x.price - y.price), supports: sup.sort((x, y) => y.price - x.price) };
}

function reasonsOf(b: LageBase, state: LageState, signs: readonly LageSign[], price: number | null): LageChip[] {
  const d = b.daily;
  if (!d) return [];
  const h = b.h4;
  const neg = state === "green" ? "warn" : "neg";
  const out: LageChip[] = [];
  const dist = price != null ? price / d.ema21 - 1 : null;
  if (b.unter1) {
    if (b.unter2) out.push({ id: "daily", text: belowText(d.below, d.ema21, dist), tone: "neg" });
  } else out.push({ id: "daily", text: aboveText(d.ema21, dist), tone: "pos" });
  // the lit signs first (amber), then what still speaks against an entry
  if (state === "amber") for (const s of signs) if (s.met) out.push({ id: `sign-${s.id}`, text: s.label, tone: "pos" });
  if (h) {
    const u21 = h.close < h.ema21;
    const u50 = h.close < h.ema50;
    if (u21 && u50) out.push({ id: "h4-below", text: "4H unter EMA 21/50", tone: neg });
    else if (u21) out.push({ id: "h4-below", text: "4H unter EMA 21", tone: neg });
    else if (u50) out.push({ id: "h4-below", text: "4H unter EMA 50", tone: neg });
    if (!h.cross) out.push({ id: "h4-cross", text: "4H-EMA 21 unter EMA 50", tone: neg });
    if (h.itrend === -1) out.push({ id: "h4-trend", text: "4H-Trend abwärts", tone: neg });
  }
  if (b.newLow1h) out.push({ id: "h1-low", text: "neues 20-Kerzen-Tief (1H)", tone: neg });
  if (d.ema200 != null && price != null) {
    const above = price >= d.ema200;
    out.push({ id: "ema200", text: ema200Text(above, d.ema200, price / d.ema200 - 1), tone: above ? "info" : "neg" });
  }
  return out;
}

/** Live part: the Lage at `nowMs` with the live price (null → the newest close stands in). */
export function lageAt(b: LageBase, livePrice: number | null | undefined, nowMs: number, opts: Pick<LageOptions, "timeZone"> = {}): Lage {
  const live = fin(livePrice) && livePrice > 0;
  const price = live ? (livePrice as number) : b.lastClose;
  const dailyCloseAt = nextDailyClose(nowMs);
  const signs = signsOf(b, price);
  const signsMet = signs.reduce((n, s) => n + (s.met ? 1 : 0), 0);
  let state: LageState;
  if (!b.ok) state = "none";
  else if (!b.abwaerts) state = "green";
  else state = signsMet > 0 ? "amber" : "red";
  const confirmed = state === "green" && b.since != null && nowMs - b.since < LAGE_CONFIRM_DAYS * DAY_MS;
  const title =
    state === "red" ? LAGE_HEADLINE.red : state === "amber" ? LAGE_HEADLINE.amber(signsMet) : state === "green" ? (confirmed ? LAGE_HEADLINE.confirmed : LAGE_HEADLINE.intact) : LAGE_HEADLINE.none;
  const wobble: LageChip | null = state === "green" && b.unter1 && !b.unter2 ? { id: "wobble", text: wobbleText(dailyCloseAt, opts.timeZone), tone: "warn" } : null;
  const d = b.daily;
  return {
    state,
    title,
    since: b.ok ? b.since : null,
    confirmed,
    abwaerts: b.abwaerts,
    unter1: b.unter1,
    unter2: b.unter2,
    signs,
    signsMet,
    reasons: b.ok ? reasonsOf(b, state, signs, price) : [],
    wobble,
    emaLadder: emaLadder(b, price),
    levels: levelsOf(b, price),
    daily: d,
    h4: b.h4,
    newLow1h: b.newLow1h,
    price,
    ema21_1d: d ? d.ema21 : null,
    dist: d && price != null ? price / d.ema21 - 1 : null,
    dailyCloseAt,
    at: nowMs,
    data: { daily: b.dailyN, h4: b.h4N, h1: b.h1N, ok: b.ok, ema200: b.dailyN >= 200, live },
  };
}

/**
 * The Lage-Ampel at `nowMs`. `daily` / `h4` may include the forming bar (ignored for EMAs and structure; its close
 * stands in for a missing live price). `opts.h1` adds the 1H new-low chip.
 */
export function computeLage(daily: readonly Bar[], h4: readonly Bar[], livePrice: number | null | undefined, nowMs: number, opts: LageOptions = {}): Lage {
  return lageAt(lageBase(daily, h4, nowMs, opts), livePrice, nowMs, opts);
}

/** Ids of the met signs. */
export const metSigns = (l: Pick<Lage, "signs">): LageSignId[] => l.signs.filter((s) => s.met).map((s) => s.id);

/**
 * Identity key of what the panel shows: state, signs, chips, rounded distances (0.1 %), levels. The market layer
 * publishes a new Lage only when it changes, so the live price moves the panel at most when a shown value moves.
 */
export function lageKey(l: Lage): string {
  const r = (x: number | null | undefined): string => (fin(x) ? (Math.round(x * 1000) / 10).toFixed(1) : "–");
  return [
    l.state,
    l.title,
    l.since ?? "",
    l.signs.map((s) => `${s.id}${s.met == null ? "?" : s.met ? 1 : 0}`).join(""),
    l.reasons.map((c) => `${c.id}:${c.text}`).join("|"),
    l.wobble?.text ?? "",
    l.emaLadder.map((e) => `${e.id}${Math.round(e.value)}${r(e.dist)}`).join(","),
    [...l.levels.resistances, ...l.levels.supports].map((x) => `${x.id}${r(x.dist)}`).join(","),
    l.dailyCloseAt,
    `${l.data.daily}/${l.data.h4}/${l.data.h1}/${l.data.live ? 1 : 0}`,
  ].join("#");
}
