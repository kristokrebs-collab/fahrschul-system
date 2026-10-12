/**
 * Box-zu-Box trade snapshot contract (owner P02; writer P14 TradeEditor save path → `trade.boxSnap`; readers P03
 * "Box-Note" dimension, P04 trade review, P07 classify).
 *
 * The pure part (`BoxSnapshot`, `parseBoxSnapshot`, `boxGradeOf`, `toBoxSnapshot`) lives in `@/domain/boxes/snapshot`
 * and is re-exported here – this import path stays. `resolveTradeBoxes` resolves the box context of a trade:
 * - live: the entry lies in the timeframe's forming bar (or the one just closed) of the journal's symbol → the running
 *   box store's analysis (no request);
 * - retro: `provider.fetchKlines(tf, { endTime })` for the closed bars before the entry plus the higher timeframe
 *   (1D for 4h, 1W for 1D) → the same pure analysis (closed bars only, no look-ahead), memoised per bar.
 * Resolves `null` when no data is available (offline, no provider, file build without klines, timeout).
 */
import { analyzeBoxes, boxState, DEFAULT_BOX_CFG, HTF_OF, BOX_TF_MS, toBoxSnapshot, type BoxAnalysis, type BoxSnapshot, type BoxTf } from "@/domain/boxes";
import type { Bar } from "@/domain/signals/indicators";
import type { Side } from "@/domain/types";
import { getProvider } from "../marketStore";
import type { Candle } from "../types";
import { getBoxes } from "./store";

export { boxGradeOf, parseBoxSnapshot, toBoxSnapshot, type BoxSnapshot, type BoxTf } from "@/domain/boxes";

export interface ResolveBoxesOptions {
  /** Default: the journal's market symbol (the running provider's symbol). */
  symbol?: string;
  /** Default "4h". */
  tf?: BoxTf;
  signal?: AbortSignal;
}

/** Bars of a retro analysis per timeframe (the engine scans 700, the setups need ≥ 60). */
const RETRO_LIMIT: Readonly<Record<BoxTf, number>> = { "4h": 760, "1d": 500, "1w": 200 };
/** A retro resolve gives up after this long (the trade editor never waits for it). */
export const RESOLVE_TIMEOUT_MS = 6000;

/** `Trade.date` ("YYYY-MM-DDTHH:mm", local wall clock, seconds optional) → epoch ms; NaN when unreadable. */
export function tradeDateMs(date: string): number {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?/.exec(date ?? "");
  if (!m) return Number.NaN;
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4]), Number(m[5]), Number(m[6] ?? 0)).getTime();
}

/** Open time of the bar of `tf` that contains `ms` (weekly bars open Monday 00:00 UTC). */
export function barOpenOf(ms: number, tf: BoxTf): number {
  const iv = BOX_TF_MS[tf];
  const off = tf === "1w" ? 4 * 86_400_000 : 0;
  return Math.floor((ms - off) / iv) * iv + off;
}

const toBar = (c: Candle): Bar => ({ t: c.time / 1000, o: c.open, h: c.high, l: c.low, c: c.close, v: c.volume });
/** Bars that had CLOSED at `atMs` (close time = open + interval). */
export const closedBefore = (cs: readonly Candle[], tf: BoxTf, atMs: number): Bar[] => cs.filter((c) => c.time + BOX_TF_MS[tf] <= atMs).map(toBar);

const memo = new Map<string, Promise<BoxAnalysis | null>>();
const MEMO_MAX = 40;

async function fetchClosed(tf: BoxTf, atMs: number, signal?: AbortSignal): Promise<Bar[]> {
  const p = getProvider();
  if (!p) return [];
  const res = await p.fetchKlines(tf, { endTime: atMs, limit: RETRO_LIMIT[tf], maxWaitMs: 3000 });
  if (signal?.aborted) return [];
  return closedBefore(res.data, tf, atMs);
}

/** The analysis of `tf` as of `atMs` from historic klines (memoised per symbol, timeframe and bar). */
async function retroAnalysis(symbol: string, tf: BoxTf, atMs: number, signal?: AbortSignal): Promise<BoxAnalysis | null> {
  const bar = barOpenOf(atMs, tf);
  const key = `${symbol}:${tf}:${bar}:${Math.floor(atMs / 60_000)}`;
  const hit = memo.get(key);
  if (hit) return hit;
  const run = (async () => {
    const bars = await fetchClosed(tf, atMs, signal);
    if (bars.length < 60) return null;
    const htfTf = HTF_OF[tf];
    let htf: { tf: string; state: ReturnType<typeof boxState> } | null = null;
    if (htfTf) {
      const hb = await fetchClosed(htfTf, atMs, signal).catch(() => [] as Bar[]);
      if (hb.length >= 60) htf = { tf: htfTf, state: boxState(hb, DEFAULT_BOX_CFG) };
    }
    // the top-trader read is not known retro (Binance keeps ~30 days, not at every bar): the bias reason stays open
    return analyzeBoxes({ tf, bars, bias: null, htf });
  })().catch(() => null);
  memo.set(key, run);
  if (memo.size > MEMO_MAX) memo.delete(memo.keys().next().value as string);
  void run.then((a) => {
    if (!a) memo.delete(key); // a failure is retried on the next call
  });
  return run;
}

function withTimeout<T>(p: Promise<T>, ms: number, signal?: AbortSignal): Promise<T | null> {
  return new Promise((resolve) => {
    const t = setTimeout(() => resolve(null), ms);
    const done = (v: T | null) => {
      clearTimeout(t);
      resolve(v);
    };
    signal?.addEventListener("abort", () => done(null), { once: true });
    p.then(done, () => done(null));
  });
}

/**
 * Box context for a trade entered at `date` (local wall clock, `Trade.date`) on `side`. Live when `date` is within the
 * timeframe's current bar (or the bar just closed) of the running symbol, retro otherwise. Resolves `null` when no data
 * is available (offline, file build without klines, timeout).
 */
export async function resolveTradeBoxes(date: string, side: Side, opts: ResolveBoxesOptions = {}): Promise<BoxSnapshot | null> {
  const atMs = tradeDateMs(date);
  if (!Number.isFinite(atMs)) return null;
  const tf = opts.tf ?? "4h";
  const p = getProvider();
  const symbol = (opts.symbol ?? p?.symbol ?? "").toUpperCase();
  if (!symbol) return null;
  const now = p?.serverNow?.() ?? Date.now();
  if (atMs > now + 60_000) return null; // a planned trade in the future has no box context yet
  // live: the running store, same symbol, the entry inside the forming bar or the one just closed
  const view = getBoxes();
  const live = view.symbol === symbol ? view.tfs[tf]?.analysis : null;
  if (live && barOpenOf(atMs, tf) >= barOpenOf(now, tf) - BOX_TF_MS[tf]) return toBoxSnapshot(live, { symbol, tf, side, source: "live" });
  if (!p || p.symbol.toUpperCase() !== symbol) return null; // retro needs the provider of that symbol
  const a = await withTimeout(retroAnalysis(symbol, tf, atMs, opts.signal), RESOLVE_TIMEOUT_MS, opts.signal);
  return a ? toBoxSnapshot(a, { symbol, tf, side, source: "retro" }) : null;
}

/** Tests: forget the retro memo. */
export function __resetBoxSnapshotMemo(): void {
  memo.clear();
}
