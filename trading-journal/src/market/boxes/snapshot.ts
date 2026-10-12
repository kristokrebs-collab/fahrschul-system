/**
 * Box-zu-Box trade snapshot contract (Wave 0 – owner P02; writer P14 TradeEditor save path → `trade.boxSnap`;
 * readers P03 "Box-Note" dimension, P04 trade review, P07 classify).
 *
 * `BoxSnapshot` is what `Trade.boxSnap` holds (opaque in the domain model, versioned here). `parseBoxSnapshot` and
 * `boxGradeOf` are real (pure); `resolveTradeBoxes` is a STUB (resolves `null`) until P02 wires the live store
 * (live) and `provider.fetchKlines` with `endTime` (retro). P02 may move the pure part to
 * `src/domain/boxes/snapshot.ts` and re-export it here – this import path stays.
 */
import type { BoxGrade, BoxPhase, Grade, SetupKind } from "@/domain/boxes";
import type { Side, Trade } from "@/domain/types";

export type BoxTf = "4h" | "1d" | "1w";

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

export interface ResolveBoxesOptions {
  /** Default: the journal's market symbol. */
  symbol?: string;
  /** Default "4h". */
  tf?: BoxTf;
  signal?: AbortSignal;
}

/**
 * Box context for a trade entered at `date` (local wall clock, `Trade.date`) on `side`. Live when `date` is within the
 * current bar, retro otherwise. Resolves `null` when no data is available (offline, file build without klines).
 * STUB: always `null` until P02.
 */
export async function resolveTradeBoxes(date: string, side: Side, opts: ResolveBoxesOptions = {}): Promise<BoxSnapshot | null> {
  void date;
  void side;
  void opts;
  return null;
}

const TFS: readonly BoxTf[] = ["4h", "1d", "1w"];
const GRADES: readonly Grade[] = ["A+", "A", "B", "C"];
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

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
