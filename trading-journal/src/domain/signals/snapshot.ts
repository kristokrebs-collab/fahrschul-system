/**
 * The snapshot stored on a trade (`trade.signal`). The base shape is the other journal's `SignalSnap`
 * (`signals.ts:292-306`) field for field, so trades move between both apps without loss; our extra fields are
 * optional and additive (the other app ignores them).
 */
import { STRENGTH_LABEL, type Side, type SignalCfg } from "./config";
import type { WtKind } from "./mcb";
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
}

const r1 = (x: number): number => Math.round(x * 10) / 10;

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
export function toSignalSnapshot(sig: Signals, side: Side, cfg: Pick<SignalCfg, "ladder" | "required" | "zoneTf">, meta: SnapshotMeta = {}): SignalSnapshot {
  const base = snapshot(sig, side);
  const v = side === "long" ? sig.long : sig.short;
  const present = sig.checks.map((c, i) => ({ c, i })).filter((x): x is { c: NonNullable<typeof x.c>; i: number } => !!x.c);
  const tfs: SignalSnapshotTf[] = base.tfs.map((t, j) => {
    const { c, i } = present[j]!;
    const e = side === "long" ? c.wt.long : c.wt.short;
    return { ...t, barsAgo: e?.barsAgo ?? null, ok: i < v.tiers && (side === "long" ? c.longSignal : c.shortSignal), rsiNear: side === "long" ? c.rsiLong : c.rsiShort };
  });
  const out: SignalSnapshot = { ...base, tfs, v: 2, ladder: [...cfg.ladder], required: cfg.required, zoneTf: cfg.zoneTf };
  if (sig.zone) out.zonePos = Math.round(sig.zone.zone.pos * 100) / 100;
  if (meta.mode) out.mode = meta.mode;
  if (meta.symbol) out.symbol = meta.symbol;
  if (meta.source) out.source = meta.source;
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
  return out;
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
