/**
 * Box-zu-Box trade snapshot (pure part of the Wave-0 contract; `@/market/boxes/snapshot` re-exports it and adds the
 * live / retro resolver). `BoxSnapshot` is what `Trade.boxSnap` holds (opaque in the domain model, versioned here):
 * `toBoxSnapshot` builds it from an analysis, `parseBoxSnapshot` reads a stored one defensively, `boxGradeOf` is the
 * reader for analytics (P03 "Box-Note", P04 review, P07 classify). `boxKey` fingerprints an analysis (what the UI shows)
 * so the live store publishes only on a visible change.
 */
import type { Side, Trade } from "../types";
import type { BoxTf } from "./config";
import type { BoxGrade, BoxPhase } from "./engine";
import type { BoxAnalysis, BoxSetup, Grade, SetupKind } from "./setups";

export type { BoxTf } from "./config";

export interface BoxSnapshot {
  v: 1;
  /** Venue symbol, e.g. "BTCUSDT". */
  symbol: string;
  tf: BoxTf;
  /** Open time (epoch ms) of the last CLOSED bar the analysis used. */
  at: number;
  /** "live" = from the running box store, "retro" = recomputed from historic klines for a past entry. */
  source: "live" | "retro";
  phase: BoxPhase;
  dir: 0 | 1 | -1;
  /** Position in the box, 0 = support … 1 = resistance (outside < 0 / > 1). */
  pos: number | null;
  zone: "top" | "mid" | "bottom" | null;
  box: { top: number; bottom: number; grade: BoxGrade; quality: number } | null;
  /** Best setup on the TRADE's side, null when there was none. */
  setup: { kind: SetupKind; grade: Grade; score: number; side: Side; entry: number; stop: number; rr: number | null; targets: number[] } | null;
  /** Higher-timeframe context (1D for 4h, 1W for 1D). */
  htf: { tf: BoxTf; phase: BoxPhase; dir: 0 | 1 | -1 } | null;
  /** RSI at the bar and freshly broken diagonal RSI lines. */
  rsi: { last: number; breakUp: boolean; breakDown: boolean } | null;
}

const TFS: readonly BoxTf[] = ["4h", "1d", "1w"];
const GRADES: readonly Grade[] = ["A+", "A", "B", "C"];
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/** Rounds a price to 6 significant digits (snapshot size; prices of every coin keep their meaning). */
export function r6(x: number): number {
  if (!Number.isFinite(x) || x === 0) return x;
  const p = 6 - Math.ceil(Math.log10(Math.abs(x)));
  const f = 10 ** Math.max(-2, Math.min(10, p));
  return Math.round(x * f) / f;
}
const r3 = (x: number | null): number | null => (x == null || !Number.isFinite(x) ? null : Math.round(x * 1000) / 1000);

/**
 * Reads a stored `boxSnap` defensively: the version, symbol, timeframe, time and phase must be valid, otherwise
 * `null`. Returns the object as stored (no deep coercion of the nested parts).
 */
export function parseBoxSnapshot(raw: unknown): BoxSnapshot | null {
  if (!isObj(raw) || raw.v !== 1) return null;
  if (typeof raw.symbol !== "string" || !TFS.includes(raw.tf as BoxTf)) return null;
  if (typeof raw.at !== "number" || !Number.isFinite(raw.at) || typeof raw.phase !== "string") return null;
  return raw as unknown as BoxSnapshot;
}

/** Grade of the box setup on the trade's side at entry ("A+" … "C"), `null` when unknown – reader for P03/P07. */
export function boxGradeOf(trade: Pick<Trade, "boxSnap">): Grade | null {
  const g = parseBoxSnapshot(trade.boxSnap)?.setup?.grade;
  return GRADES.includes(g as Grade) ? (g as Grade) : null;
}

/** The best setup of an analysis on `side` (setups are sorted best first). */
export function bestSetupFor(a: Pick<BoxAnalysis, "setups">, side: Side): BoxSetup | null {
  return a.setups.find((s) => s.side === side) ?? null;
}

export interface ToSnapshotOptions {
  symbol: string;
  tf: BoxTf;
  side: Side;
  source: "live" | "retro";
}

/** A `BoxSnapshot` of `a` for a trade on `side` (rounded: prices to 6 significant digits, positions to 0.001). */
export function toBoxSnapshot(a: BoxAnalysis, o: ToSnapshotOptions): BoxSnapshot {
  const b = a.box;
  const s = bestSetupFor(a, o.side);
  const htf = a.htf && TFS.includes(a.htf.tf as BoxTf) ? { tf: a.htf.tf as BoxTf, phase: a.htf.phase, dir: a.htf.dir } : null;
  return {
    v: 1,
    symbol: o.symbol,
    tf: o.tf,
    at: a.at * 1000,
    source: o.source,
    phase: b.phase,
    dir: b.dir,
    pos: r3(b.pos),
    zone: b.zone,
    box: b.box ? { top: r6(b.box.top), bottom: r6(b.box.bottom), grade: b.box.grade, quality: b.box.quality } : null,
    setup: s
      ? { kind: s.kind, grade: s.grade, score: s.score, side: s.side, entry: r6(s.entry), stop: r6(s.stop), rr: s.rr == null ? null : Math.round(s.rr * 100) / 100, targets: s.targets.map((t) => r6(t.price)) }
      : null,
    htf,
    rsi: a.rsi && Number.isFinite(a.rsi.last) ? { last: Math.round(a.rsi.last * 10) / 10, breakUp: !!a.rsi.breakUp, breakDown: !!a.rsi.breakDown } : null,
  };
}

/**
 * Stable id of a box (survives recomputes and the live price): timeframe, start bar time and the edges at 6 significant
 * digits. Alerts deduplicate per box id and phase.
 */
export function boxIdOf(tf: string, b: { t0: number; top: number; bottom: number } | null | undefined): string | null {
  return b ? `${tf}:${b.t0}:${r6(b.top)}:${r6(b.bottom)}` : null;
}

/**
 * Fingerprint of everything an analysis shows: phase, direction, pending close, zone, the box edges and grade, the
 * targets, RSI breaks (and the RSI at 0.5), the setups (side, kind, grade, score) and the htf phase. The live price only
 * enters through these (a tick inside the box that moves nothing shown keeps the key).
 */
export function boxKey(a: BoxAnalysis | null | undefined): string {
  if (!a) return "∅";
  const b = a.box;
  const bx = b.box ? `${b.box.t0}:${r6(b.box.top)}-${r6(b.box.bottom)}:${b.box.grade}:${b.box.brk}` : "-";
  const tg = b.targets.map((t) => r6(t.price)).join(",");
  const rl = a.rsi ? `${Math.round(a.rsi.last * 2) / 2}:${a.rsi.breakUp?.a.i ?? "-"}/${a.rsi.breakDown?.a.i ?? "-"}:${a.rsi.res?.a.i ?? "-"}/${a.rsi.sup?.a.i ?? "-"}` : "-";
  const st = a.setups.map((s) => `${s.side[0]}${s.kind}${s.grade}${s.score}${s.rr == null ? "" : Math.round(s.rr * 10)}`).join(",");
  const h = a.htf ? `${a.htf.tf}${a.htf.phase}${a.htf.dir}` : "-";
  const pos = b.pos == null ? "-" : Math.round(b.pos * 20);
  return `${a.tf}|${a.at}|${b.phase}${b.dir}${b.pending}|${b.zone ?? "-"}${pos}|${bx}|${tg}|${b.barsSince ?? "-"}|${rl}|${st}|${h}`;
}
