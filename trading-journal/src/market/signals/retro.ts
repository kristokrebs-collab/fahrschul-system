/**
 * Retro check: the "Einstiegs-Check" for a trade at time T (back-dated trades, back-filling old trades).
 *
 * - Within 5 min of now the live evaluation is used (like the other journal's `signalsAt`).
 * - Otherwise every ladder / zone timeframe is rebuilt from exchange history that ENDS at T (only bars closed at
 *   T count): the live series when it already holds enough contiguous bars before T (no network), else one
 *   `endTime` page per source interval through the provider's budget (`fetchKlines`, nothing enters the live
 *   cache). Binance futures history reaches back to 2019, so every journal date can be checked.
 * - Not enough history at T → `null` / status `no-history`. Never a fake "strength 0" (the other journal's bug).
 */
import { SIGNAL_BARS, sanitizeSignalCfg, signalCfgKey, signalsAt, toSignalSnapshot, LIVE_WINDOW_MS, type Bar, type Side, type SignalCfg, type SignalSnapshot, type Signals } from "@/domain/signals";
import { FETCH_INTERVAL_MS, type FetchInterval } from "../period";
import type { MarketProvider } from "../provider";
import type { Candle, KlineFeed, Source, Stamped } from "../types";
import { candleToBar, neededTfs, rungBars, tfSource } from "./bars";
import { getSignalConfig, getSignalSnapshot, signalProvider, toTradeSnapshot, type LiveSignals } from "./engine";

export type RetroStatus = "ok" | "live" | "no-history" | "error" | "unavailable";

export interface RetroResult {
  status: RetroStatus;
  /** both sides, every rung; `null` unless status is `ok` / `live` */
  signals: Signals | null;
  /** data symbol / source of the bars */
  symbol: string | null;
  source: Source | null;
  /** German text for the non-ok states */
  message: string | null;
}

const MSG = {
  noHistory: "Keine Kerzen für diesen Zeitpunkt.",
  error: "Kerzen für diesen Zeitpunkt konnten nicht geladen werden.",
  unavailable: "Keine Marktdaten (Binance).",
  liveLoading: "Kerzen werden geladen …",
} as const;

/** Source bars fetched per interval for a retro check (one Binance page: 1500 × 15m = 500 × 45m). */
export const RETRO_PAGE_MAX = 1500;
/** Native rungs (1h, 4h, 1D) use the live bootstrap window (499 bars, Binance weight 2 instead of 5). */
export const RETRO_NATIVE_BARS = 499;
const MEMO_MAX = 64;
const memo = new Map<string, Promise<RetroResult>>();

function toMs(date: Date | string | number): number {
  if (date instanceof Date) return date.getTime();
  if (typeof date === "number") return date;
  return new Date(date).getTime();
}

/** Source bars needed per exchange interval for `cfg` (capped at one page). */
function needPerInterval(cfg: SignalCfg): Map<FetchInterval, number> {
  const out = new Map<FetchInterval, number>();
  for (const tf of neededTfs(cfg)) {
    const s = tfSource(tf);
    if (!s) continue;
    const n = s.factor === 1 ? RETRO_NATIVE_BARS : Math.min(RETRO_PAGE_MAX, SIGNAL_BARS * s.factor);
    out.set(s.interval, Math.max(out.get(s.interval) ?? 0, n));
  }
  return out;
}

const FEED_OF: Partial<Record<FetchInterval, KlineFeed>> = { "15m": "kline_15m", "1h": "kline_1h", "4h": "kline_4h" };

/** Index of the first candle with `time > t` (ascending series). */
function upperBound(arr: readonly Candle[], t: number): number {
  let lo = 0;
  let hi = arr.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (arr[mid]!.time <= t) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/** `count` contiguous live candles that opened at or before `t`, when the live series reaches past `t`. */
function fromLive(p: MarketProvider, iv: FetchInterval, t: number, count: number): { candles: Candle[]; source: Source } | null {
  const feed = FEED_OF[iv];
  if (!feed) return null;
  const v = p.get(feed) as Stamped<Candle[]> | undefined;
  const data = v?.data;
  if (!v || !data?.length) return null;
  const step = FETCH_INTERVAL_MS[iv];
  const end = upperBound(data, t);
  if (end === data.length && data[data.length - 1]!.time + step <= t) return null; // the series stops before t
  if (end < count) return null;
  const first = data[end - count]!;
  const last = data[end - 1]!;
  if (last.time - first.time !== (count - 1) * step) return null; // holes: fetch a clean page instead
  return { candles: data.slice(end - count, end), source: v.source };
}

async function fetchEndingAt(p: MarketProvider, iv: FetchInterval, t: number, count: number): Promise<{ candles: Candle[]; source: Source }> {
  const page = await p.fetchKlines(iv, { endTime: t, limit: count });
  return { candles: page.data.filter((c) => c.time <= t), source: page.source };
}

async function computeRetro(p: MarketProvider, cfg: SignalCfg, t: number): Promise<RetroResult> {
  const sources = new Map<FetchInterval, Bar[]>();
  let source: Source | null = null;
  try {
    const jobs = [...needPerInterval(cfg)].map(async ([iv, count]) => {
      const got = fromLive(p, iv, t, count) ?? (await fetchEndingAt(p, iv, t, count));
      sources.set(iv, got.candles.map(candleToBar));
      if (!source || got.source !== "cache") source = got.source;
    });
    await Promise.all(jobs);
  } catch {
    return { status: "error", signals: null, symbol: p.symbol, source, message: MSG.error };
  }
  const bars: Record<string, Bar[]> = {};
  for (const tf of neededTfs(cfg)) {
    const s = tfSource(tf);
    if (!s) continue;
    // + 1: the bar running at T is in the page and is cut by `signalsAt` (only closed bars count)
    bars[tf] = rungBars(tf, sources.get(s.interval) ?? [], SIGNAL_BARS + 1);
  }
  // `now` far in the future relative to T: always the closed-bars path (the live window is handled by the caller)
  const sig = signalsAt(bars, cfg, t, t + LIVE_WINDOW_MS + 1);
  if (!sig) return { status: "no-history", signals: null, symbol: p.symbol, source, message: MSG.noHistory };
  return { status: "ok", signals: sig, symbol: p.symbol, source, message: null };
}

/**
 * Both sides of the check at time `date` with a status. Never rejects. `opts.cfg` overrides the settings
 * (raw `settings.signals` value or a `SignalCfg`; sanitised).
 */
export function retroCheck(date: Date | string | number, opts: { cfg?: unknown; now?: number } = {}): Promise<RetroResult> {
  const t = toMs(date);
  const p = signalProvider();
  if (!Number.isFinite(t)) return Promise.resolve({ status: "no-history", signals: null, symbol: p?.symbol ?? null, source: null, message: MSG.noHistory });
  if (!p) return Promise.resolve({ status: "unavailable", signals: null, symbol: null, source: null, message: MSG.unavailable });
  const cfg = opts.cfg === undefined ? getSignalConfig() : sanitizeSignalCfg(opts.cfg);
  const now = opts.now ?? Date.now();
  if (t >= now - LIVE_WINDOW_MS) {
    const live = getSignalSnapshot().snapshot;
    const ok = live && signalCfgKey(live.cfg) === signalCfgKey(cfg);
    return Promise.resolve(
      ok ? { status: "live", signals: live, symbol: live.symbol, source: live.source, message: null } : { status: "unavailable", signals: null, symbol: p.symbol, source: null, message: MSG.liveLoading },
    );
  }
  const key = `${p.symbol}|${signalCfgKey(cfg)}|${Math.floor(t / 60_000)}`;
  const hit = memo.get(key);
  if (hit) return hit;
  const run = computeRetro(p, cfg, t).then((r) => {
    if (r.status === "error") memo.delete(key); // retry next time
    return r;
  });
  memo.set(key, run);
  if (memo.size > MEMO_MAX) memo.delete(memo.keys().next().value!);
  return run;
}

/**
 * The snapshot to store on a trade entered for `date` / `side`: live within 5 min of now, otherwise recomputed
 * from history at that time. `null` when the time is not covered (too little history) or the data could not be
 * loaded — never a made-up "strength 0". Never rejects.
 */
export async function checkTradeAt(date: Date | string | number, side: Side, opts: { cfg?: unknown; now?: number } = {}): Promise<SignalSnapshot | null> {
  const r = await retroCheck(date, opts);
  if (!r.signals) return null;
  if (r.status === "live") return toTradeSnapshot(r.signals as LiveSignals, side);
  const cfg = opts.cfg === undefined ? getSignalConfig() : sanitizeSignalCfg(opts.cfg);
  return toSignalSnapshot(r.signals, side, cfg, { mode: "retro", symbol: r.symbol ?? undefined, source: r.source ?? undefined });
}

/** Testing helper. */
export function __clearRetroMemo(): void {
  memo.clear();
}
