/**
 * The snapshot stored on a trade (`trade.signal`). The base shape is the other journal's `SignalSnap`
 * (`signals.ts:292-306`) field for field, so trades move between both apps without loss; our extra fields are
 * optional and additive (the other app ignores them).
 */
import { STRENGTH_LABEL, whaleCfgOf, type Side, type SignalCfg } from "./config";
import type { DivKind, DivOsc } from "./divergence";
import type { KnifeId } from "./knife";
import type { WtKind } from "./mcb";
import type { GradedPart, PartId } from "./parts";
import { isSignalState, type SignalState } from "./state";
import type { Signals } from "./verdict";
import type { Zone } from "./zones";

/** The other journal's per-timeframe entry. */
export interface SignalSnapTf {
  tf: string;
  /** direction-matching strongest event, null = none */
  kind: WtKind | null;
  /** wt1 rounded to 0.1 */
  wt: number;
  /** RSI rounded to 0.1 */
  rsi: number;
}

/** The other journal's `SignalSnap` (exact shape). */
export interface SignalSnap {
  /** ISO time of the evaluation */
  at: string;
  side: Side;
  score: number;
  strength: number;
  tiers: number;
  label: string;
  valid: boolean;
  rsiOk: boolean;
  zoneOk: boolean;
  zone: Zone | null;
  deep?: boolean;
  tfs: SignalSnapTf[];
}

/** Our per-timeframe entry: the other journal's fields plus optional extras. */
export interface SignalSnapshotTf extends SignalSnapTf {
  /** bars since the event (0 = running candle) */
  barsAgo?: number | null;
  /** this rung confirmed the ladder (`index < tiers`) */
  ok?: boolean;
  /** RSI near oversold (long) / overbought (short) on this timeframe */
  rsiNear?: boolean;
  /** candle-close state of this side's signal on the rung at check time (decision 6) */
  state?: SignalState;
  /** closed candles since that signal, counting its own close (0 = forming) */
  closes?: number;
}

/** One item of a stored graded part (`PartItem` without the German strings). */
export interface SignalSnapshotPartItem {
  id: string;
  /** lit / unlit; `null` = keine Daten */
  met: boolean | null;
  /** the number behind it (long %, pp, grade, ATR distance, R multiple), `null` without */
  raw: number | null;
}

/** A graded part at check time (Top-Trader-Kombi, divergences, support / resistance), for the snapshot's side. */
export interface SignalSnapshotPart {
  id: PartId;
  /** 0 … 1, rounded to 0.01 */
  grade: number;
  /** score points added, rounded to 0.1 */
  points: number;
  weight: number;
  /** the part held fully (gave a valid entry +1 strength when weighted) */
  ok: boolean;
  /** inputs had data (false = "keine Daten", never a fail) */
  data: boolean;
  state: SignalState;
  items: SignalSnapshotPartItem[];
  /** traders: met parts of 4; the legacy retail comparison period */
  met?: number;
  period?: string;
  /** traders: Whale–Retail-Delta (top-trader accounts − all accounts, long %, pp) and its change over `deltaWindow`, rounded to 0.01; `null` = keine Daten */
  delta?: number | null;
  deltaChg?: number | null;
  deltaWindow?: string;
  /** div: the rung of the best hit and the active hits */
  tf?: string;
  hits?: Array<{ tf: string; osc: DivOsc; kind: DivKind; state: SignalState; barsAgo: number }>;
  /** div: active RSI trendline breaks (absent = none / recorded before 2026-10-08) */
  trends?: Array<{ tf: string; dir: 1 | -1; state: SignalState; barsAgo: number }>;
  /** sr: the level leaned on, the target, reward / risk (`null` = no stop level; `free` = no target level) */
  lean?: { label: string; price: number; distAtr: number } | null;
  target?: { label: string; price: number } | null;
  r?: number | null;
  free?: boolean;
}

/** The falling-knife filter at check time (the snapshot's side). */
export interface SignalSnapshotKnife {
  /** points met of 3 */
  n: number;
  items: Array<{ id: KnifeId; met: boolean | null }>;
}

/** One period of the stored "Top-Trader kaufen · Retail rot" reading. */
export interface SignalSnapshotWhalePeriod {
  period: string;
  /** top-trader position long % / all-accounts long % at the check, rounded to 0.01 */
  top: number;
  retail: number;
  /** change over the last `need` periods, pp, rounded to 0.01 */
  topChg: number;
  retailChg: number;
  /** trailing closed periods that fit the snapshot's side */
  run: number;
}

/** The stored condition (`WhaleVerdict` + the per-period readings), for the snapshot's side. */
export interface SignalSnapshotWhale {
  ok: boolean;
  run: number;
  need: number;
  period: string;
  topChg: number;
  retailChg: number;
  /** score points it added (0 = did not hold or weight 0) */
  points: number;
  periods: SignalSnapshotWhalePeriod[];
}

/** Stored on `trade.signal`. A superset of `SignalSnap`; every extra field is optional. */
export interface SignalSnapshot extends SignalSnap {
  tfs: SignalSnapshotTf[];
  /** format marker of our snapshots */
  v?: 2;
  /** `live` = taken from the running check, `retro` = recomputed from history at the trade time */
  mode?: "live" | "retro";
  /** the full ladder at check time (rungs without data are missing from `tfs`) */
  ladder?: string[];
  required?: number;
  zoneTf?: string;
  /** position in the premium/discount range, 0..1 rounded to 0.01 */
  zonePos?: number;
  /** data symbol, e.g. `BTCUSDT` */
  symbol?: string;
  /** data source, e.g. `binance` */
  source?: string;
  /**
   * "Top-Trader kaufen · Retail rot" at check time. `null` = the condition was on but no Binance top-trader data
   * existed for that time (older than ~30 days, other source) — never a fail; absent = snapshot from before the
   * condition, or switched off.
   */
  whale?: SignalSnapshotWhale | null;
  /**
   * Candle-close state of the entry at check time (decision 6): `provisional` = the base candle was still forming
   * (stored `valid` false / `strength` 0, `provStrength` = the strength on the close), `confirmed`, `strong`, `none`.
   * Absent = a snapshot from before the rule (state unknown).
   */
  state?: SignalState;
  /** consecutive confirmed rungs from the base */
  confTiers?: number;
  /** strength the entry had once confirmed (= `strength` for confirmed entries) */
  provStrength?: number;
  /** graded parts at check time (absent = before the parts existed) */
  parts?: SignalSnapshotPart[];
  /** score points of the parts */
  partPoints?: number;
  /** falling-knife filter at check time */
  knife?: SignalSnapshotKnife;
}

const r1 = (x: number): number => Math.round(x * 10) / 10;
const r2 = (x: number): number => Math.round(x * 100) / 100;
const fin = (x: number | null | undefined): number | null => (x == null || !Number.isFinite(x) ? null : r2(x));

/** A graded part → its stored form. */
export function snapshotPart(p: GradedPart): SignalSnapshotPart {
  const out: SignalSnapshotPart = {
    id: p.id,
    grade: r2(p.grade),
    points: r1(p.points),
    weight: p.weight,
    ok: p.ok,
    data: p.data,
    state: p.state,
    items: p.items.map((i) => ({ id: i.id, met: i.met, raw: fin(i.raw) })),
  };
  if (p.id === "traders") {
    out.met = p.met ?? 0;
    if (p.reading) {
      out.period = p.reading.period;
      const delta = p.items.find((i) => i.id === "retail")?.raw ?? null;
      out.delta = delta == null || !Number.isFinite(delta) ? null : r2(delta);
      out.deltaChg = p.reading.deltaChg == null || !Number.isFinite(p.reading.deltaChg) ? null : r2(p.reading.deltaChg);
      if (p.reading.deltaWindow) out.deltaWindow = p.reading.deltaWindow;
    }
  }
  if (p.id === "div") {
    if (p.tf) out.tf = p.tf;
    out.hits = (p.hits ?? []).map((h) => ({ tf: h.tf, osc: h.osc, kind: h.kind, state: h.state, barsAgo: h.barsAgo }));
    if (p.trends?.length) out.trends = p.trends.map((t) => ({ tf: t.tf, dir: t.dir, state: t.state, barsAgo: t.barsAgo }));
  }
  if (p.id === "sr" && p.levels) {
    const { lean, target, r } = p.levels;
    out.lean = lean ? { label: lean.label, price: r2(lean.price), distAtr: r2(lean.distAtr) } : null;
    out.target = target ? { label: target.label, price: r2(target.price) } : null;
    out.r = r == null || !Number.isFinite(r) ? null : r2(r);
    if (r === Infinity) out.free = true;
  }
  return out;
}

/** Candle-close state of a stored snapshot (`null` = recorded before the rule existed). */
export const snapshotState = (s: Pick<SignalSnapshot, "state">): SignalState | null => s.state ?? null;

/** The other journal's `snapshot(sig, side)`, exact. */
export function snapshot(sig: Signals, side: Side): SignalSnap {
  const v = side === "long" ? sig.long : sig.short;
  return {
    at: new Date(sig.at).toISOString(),
    side,
    score: v.score,
    strength: v.strength,
    tiers: v.tiers,
    label: v.label,
    valid: v.valid,
    rsiOk: v.rsiOk,
    zoneOk: v.zoneOk,
    zone: sig.zone?.zone.zone ?? null,
    deep: !!sig.zone?.zone.deep,
    tfs: sig.checks.filter((c): c is NonNullable<typeof c> => !!c).map((c) => ({ tf: c.tf, kind: (side === "long" ? c.wt.long : c.wt.short)?.kind ?? null, wt: r1(c.wt.wt1), rsi: r1(c.rsi) })),
  };
}

export interface SnapshotMeta {
  mode?: "live" | "retro";
  symbol?: string;
  source?: string;
}

/** Snapshot to store on a trade: `snapshot()` plus our additive fields. */
export function toSignalSnapshot(sig: Signals, side: Side, cfg: Pick<SignalCfg, "ladder" | "required" | "zoneTf" | "whale">, meta: SnapshotMeta = {}): SignalSnapshot {
  const base = snapshot(sig, side);
  const v = side === "long" ? sig.long : sig.short;
  const present = sig.checks.map((c, i) => ({ c, i })).filter((x): x is { c: NonNullable<typeof x.c>; i: number } => !!x.c);
  const tfs: SignalSnapshotTf[] = base.tfs.map((t, j) => {
    const { c, i } = present[j]!;
    const e = side === "long" ? c.wt.long : c.wt.short;
    const row: SignalSnapshotTf = { ...t, barsAgo: e?.barsAgo ?? null, ok: i < v.tiers && (side === "long" ? c.longSignal : c.shortSignal), rsiNear: side === "long" ? c.rsiLong : c.rsiShort };
    const conf = c.conf?.[side];
    if (conf) {
      row.state = conf.state;
      row.closes = conf.closes;
    }
    return row;
  });
  const out: SignalSnapshot = { ...base, tfs, v: 2, ladder: [...cfg.ladder], required: cfg.required, zoneTf: cfg.zoneTf };
  if (sig.zone) out.zonePos = Math.round(sig.zone.zone.pos * 100) / 100;
  if (meta.mode) out.mode = meta.mode;
  if (meta.symbol) out.symbol = meta.symbol;
  if (meta.source) out.source = meta.source;
  if (v.state) out.state = v.state;
  if (v.confTiers !== undefined) out.confTiers = v.confTiers;
  if (v.provStrength !== undefined) out.provStrength = v.provStrength;
  if (v.parts) {
    out.parts = v.parts.map(snapshotPart);
    out.partPoints = v.partPoints ?? 0;
  }
  const k = sig.knife?.[side];
  if (k) out.knife = { n: k.n, items: k.items.map((i) => ({ id: i.id, met: i.met })) };
  const w = v.whale;
  if (w && sig.whale) {
    out.whale = {
      ok: w.ok,
      run: w.run,
      need: w.need,
      period: w.period,
      topChg: r2(w.topChg),
      retailChg: r2(w.retailChg),
      points: w.points,
      periods: sig.whale.periods.map((p) => ({ period: p.period, top: r2(p.top), retail: r2(p.retail), topChg: r2(p.topChg), retailChg: r2(p.retailChg), run: side === "long" ? p.runLong : p.runShort })),
    };
  } else if (whaleCfgOf(cfg).on && !v.parts) out.whale = null; // legacy grading without a reading ("keine Daten")
  return out;
}

// ------------------------------------------------------------------ parsing

const KINDS: readonly WtKind[] = ["bottom", "buy", "bull", "top", "sell", "bear"];
const ZONES: readonly Zone[] = ["premium", "equilibrium", "discount"];
const isRec = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const toNum = (v: unknown): number => (typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v) : NaN);
const clamp = (x: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, x));

function parseTf(raw: unknown): SignalSnapshotTf | null {
  if (!isRec(raw) || typeof raw.tf !== "string" || !raw.tf) return null;
  const kind = typeof raw.kind === "string" && (KINDS as readonly string[]).includes(raw.kind) ? (raw.kind as WtKind) : null;
  const wt = toNum(raw.wt);
  const rsi = toNum(raw.rsi);
  const out: SignalSnapshotTf = { ...raw, tf: raw.tf, kind, wt: Number.isFinite(wt) ? wt : NaN, rsi: Number.isFinite(rsi) ? rsi : NaN };
  if (raw.barsAgo !== undefined) {
    const b = toNum(raw.barsAgo);
    out.barsAgo = raw.barsAgo === null || !Number.isFinite(b) ? null : b;
  }
  if (raw.ok !== undefined) out.ok = raw.ok === true;
  if (raw.rsiNear !== undefined) out.rsiNear = raw.rsiNear === true;
  if (raw.state !== undefined) {
    if (isSignalState(raw.state)) out.state = raw.state;
    else delete out.state;
  }
  if (raw.closes !== undefined) {
    const c = toNum(raw.closes);
    if (Number.isFinite(c)) out.closes = Math.max(0, Math.round(c));
    else delete out.closes;
  }
  return out;
}

/**
 * Reads a stored `trade.signal`: the other journal's `SignalSnap` or ours. Returns a normalised copy (unknown
 * keys kept) or `null` when the value is not a snapshot. Lenient: numbers may be strings, a missing label is
 * derived from the strength, invalid per-timeframe entries are dropped. Never mutates the input.
 */
export function parseSignalSnapshot(raw: unknown): SignalSnapshot | null {
  if (!isRec(raw)) return null;
  const side = raw.side === "long" || raw.side === "short" ? raw.side : null;
  if (!side) return null;
  const score = toNum(raw.score);
  const strength = toNum(raw.strength);
  if (!Number.isFinite(score) || !Number.isFinite(strength)) return null;
  const atRaw = typeof raw.at === "string" ? raw.at : typeof raw.at === "number" ? new Date(raw.at).toISOString() : "";
  const atMs = atRaw ? Date.parse(atRaw) : NaN;
  if (!Number.isFinite(atMs)) return null;
  const st = clamp(Math.round(strength), 0, 4);
  const tiersN = toNum(raw.tiers);
  const tfs = Array.isArray(raw.tfs) ? raw.tfs.map(parseTf).filter((t): t is SignalSnapshotTf => t !== null) : [];
  const valid = typeof raw.valid === "boolean" ? raw.valid : st > 0;
  const out: SignalSnapshot = {
    ...raw,
    at: atRaw,
    side,
    score: clamp(Math.round(score), 0, 100),
    strength: st,
    tiers: Number.isFinite(tiersN) ? clamp(Math.round(tiersN), 0, 12) : 0,
    label: typeof raw.label === "string" && raw.label ? raw.label : (STRENGTH_LABEL[st] ?? STRENGTH_LABEL[0]!),
    valid,
    rsiOk: raw.rsiOk === true,
    zoneOk: raw.zoneOk === true,
    zone: typeof raw.zone === "string" && (ZONES as readonly string[]).includes(raw.zone) ? (raw.zone as Zone) : null,
    tfs,
  };
  if (raw.deep !== undefined) out.deep = raw.deep === true;
  if (raw.v !== undefined) {
    if (raw.v === 2) out.v = 2;
    else delete out.v;
  }
  if (raw.mode !== undefined) {
    if (raw.mode === "live" || raw.mode === "retro") out.mode = raw.mode;
    else delete out.mode;
  }
  if (raw.ladder !== undefined) {
    if (Array.isArray(raw.ladder)) out.ladder = raw.ladder.filter((x): x is string => typeof x === "string");
    else delete out.ladder;
  }
  for (const k of ["required", "zonePos"] as const) {
    if (raw[k] === undefined) continue;
    const n = toNum(raw[k]);
    if (Number.isFinite(n)) out[k] = n;
    else delete out[k];
  }
  for (const k of ["zoneTf", "symbol", "source"] as const) {
    if (raw[k] === undefined) continue;
    if (typeof raw[k] === "string") out[k] = raw[k] as string;
    else delete out[k];
  }
  if (raw.whale !== undefined) {
    const w = raw.whale === null ? null : parseWhale(raw.whale);
    if (raw.whale === null || w) out.whale = w;
    else delete out.whale;
  }
  if (raw.state !== undefined) {
    if (isSignalState(raw.state)) out.state = raw.state;
    else delete out.state;
  }
  for (const k of ["confTiers", "provStrength", "partPoints"] as const) {
    if (raw[k] === undefined) continue;
    const n = toNum(raw[k]);
    if (Number.isFinite(n)) out[k] = k === "partPoints" ? Math.max(0, n) : clamp(Math.round(n), 0, k === "provStrength" ? 4 : 12);
    else delete out[k];
  }
  if (raw.parts !== undefined) {
    if (Array.isArray(raw.parts)) out.parts = raw.parts.map(parsePart).filter((p): p is SignalSnapshotPart => p !== null);
    else delete out.parts;
  }
  if (raw.knife !== undefined) {
    const k = parseKnife(raw.knife);
    if (k) out.knife = k;
    else delete out.knife;
  }
  return out;
}

const PART_IDS: readonly PartId[] = ["traders", "div", "sr"];
const KNIFE_IDS: readonly KnifeId[] = ["structure", "divergence", "whale"];
const metOf = (v: unknown): boolean | null => (v === true ? true : v === false ? false : null);
const numOrNull = (v: unknown): number | null => {
  if (v === null || v === undefined) return null;
  const n = toNum(v);
  return Number.isFinite(n) ? n : null;
};

function parsePart(raw: unknown): SignalSnapshotPart | null {
  if (!isRec(raw) || typeof raw.id !== "string" || !(PART_IDS as readonly string[]).includes(raw.id)) return null;
  const g = toNum(raw.grade);
  const pts = toNum(raw.points);
  const w = toNum(raw.weight);
  const items = Array.isArray(raw.items)
    ? raw.items.filter((i): i is Record<string, unknown> => isRec(i) && typeof i.id === "string").map((i) => ({ ...i, id: i.id as string, met: metOf(i.met), raw: numOrNull(i.raw) }))
    : [];
  const out = {
    ...raw,
    id: raw.id as PartId,
    grade: Number.isFinite(g) ? clamp(g, 0, 1) : 0,
    points: Number.isFinite(pts) ? Math.max(0, pts) : 0,
    weight: Number.isFinite(w) ? Math.max(0, w) : 0,
    ok: raw.ok === true,
    data: raw.data !== false,
    state: isSignalState(raw.state) ? raw.state : "none",
    items,
  } as SignalSnapshotPart;
  if (raw.id === "traders") {
    // additive Whale–Retail-Delta fields: a malformed number reads as "keine Daten", an absent one stays absent (older
    // snapshots), a malformed window is dropped
    if ("delta" in raw) out.delta = numOrNull(raw.delta);
    if ("deltaChg" in raw) out.deltaChg = numOrNull(raw.deltaChg);
    if ("deltaWindow" in raw && typeof raw.deltaWindow !== "string") delete out.deltaWindow;
  }
  return out;
}

function parseKnife(raw: unknown): SignalSnapshotKnife | null {
  if (!isRec(raw) || !Array.isArray(raw.items)) return null;
  const items = raw.items
    .filter((i): i is Record<string, unknown> => isRec(i) && typeof i.id === "string" && (KNIFE_IDS as readonly string[]).includes(i.id))
    .map((i) => ({ ...i, id: i.id as KnifeId, met: metOf(i.met) }));
  const n = toNum(raw.n);
  return { ...raw, n: Number.isFinite(n) ? clamp(Math.round(n), 0, 3) : items.filter((i) => i.met === true).length, items };
}

function parseWhale(raw: unknown): SignalSnapshotWhale | null {
  if (!isRec(raw) || typeof raw.ok !== "boolean") return null;
  const n = (v: unknown): number => {
    const x = toNum(v);
    return Number.isFinite(x) ? x : 0;
  };
  const periods = Array.isArray(raw.periods)
    ? raw.periods
        .filter((p): p is Record<string, unknown> => isRec(p) && typeof p.period === "string")
        .map((p) => ({ ...p, period: p.period as string, top: n(p.top), retail: n(p.retail), topChg: n(p.topChg), retailChg: n(p.retailChg), run: Math.max(0, Math.round(n(p.run))) }))
    : [];
  return {
    ...raw,
    ok: raw.ok,
    run: Math.max(0, Math.round(n(raw.run))),
    need: Math.max(1, Math.round(n(raw.need) || 1)),
    period: typeof raw.period === "string" ? raw.period : (periods[0]?.period ?? ""),
    topChg: n(raw.topChg),
    retailChg: n(raw.retailChg),
    points: Math.max(0, n(raw.points)),
    periods,
  };
}

/** Checklist item ids of the multi-timeframe setup `s_mtf` (other journal `MTF_SETUP`). */
export type MtfItem = "mtf_base" | "mtf_next" | "mtf_third" | "mtf_rsi" | "mtf_zone";

/**
 * Auto-ticks of the `s_mtf` checklist from a snapshot (other journal `forms.tsx:157-163`): base rung → `tiers ≥ 1`,
 * next → `≥ 2`, third → `≥ 3`, RSI near the extreme → `rsiOk`, Discount (short: Premium) → `zoneOk`.
 * Check ids in a trade are `s_mtf:<item>`.
 */
export function mtfAutoChecks(s: Pick<SignalSnap, "tiers" | "rsiOk" | "zoneOk">): Record<MtfItem, boolean> {
  return { mtf_base: s.tiers >= 1, mtf_next: s.tiers >= 2, mtf_third: s.tiers >= 3, mtf_rsi: s.rsiOk, mtf_zone: s.zoneOk };
}

/** Ladder length to show in "x von n Timeframes" for a stored snapshot (ours carries it, theirs had 4 rungs). */
export function snapshotLadderLength(s: Pick<SignalSnapshot, "ladder" | "tfs">): number {
  return s.ladder?.length ?? Math.max(4, s.tfs.length);
}
