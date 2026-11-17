/**
 * Retro check: the "Einstiegs-Check" for a trade at time T (back-dated trades, back-filling old trades).
 *
 * - Within 5 min of now the live evaluation is used (like the other journal's `signalsAt`).
 * - Otherwise every ladder / zone timeframe is rebuilt from exchange history that ENDS at T (only bars closed at
 *   T count): the live series when it already holds enough contiguous bars before T (no network), else one
 *   `endTime` page per source interval through the provider's budget (`fetchKlines`, nothing enters the live
 *   cache). Binance futures history reaches back to 2019, so every journal date can be checked.
 * - Not enough history at T → `null` / status `no-history`. Never a fake "strength 0" (the other journal's bug).
 * - Only closed bars at T count, so every signal of a back-dated check is `confirmed` / `strong` (never provisional).
 * - Top-Trader-Kombi at T from Binance's 5-min futures data (`tradersAt`); they reach ~30 days back, older trades get
 *   no reading (the part shows "keine Daten", never a fail) and the grade without it.
 * - Lage-Ampel at T (decision 23): `computeLage` from the daily bars ending at T (the cached `kline_1d` feed when it
 *   reaches T, else one `1d` page of 499 days, weight 2), the 4H / 1H bars and the last closed price at T; the long is
 *   gated with the CURRENT setting (`settings.signals.lage`). Daily data that cannot be loaded → no gate (never an
 *   error of the whole check) and the result is not memoised (`partial`: the next check asks again); the switch off →
 *   no Lage, no extra request.
 */
import { computeLage, type Lage } from "@/domain/lage";
import { SIGNAL_BARS, regradeSignals, sanitizeSignalCfg, signalCfgKey, signalsAt, toSignalSnapshot, LIVE_WINDOW_MS, type Bar, type Side, type SignalCfg, type SignalSnapshot, type Signals } from "@/domain/signals";
import { FETCH_INTERVAL_MS, type FetchInterval } from "../period";
import type { MarketProvider } from "../provider";
import type { Candle, KlineFeed, Source, Stamped } from "../types";
import { candleToBar, neededTfs, rungBars, tfSource } from "./bars";
import { getLageConfig, getSignalConfig, getSignalSnapshot, signalProvider, toTradeSnapshot, type LiveSignals } from "./engine";
import { tradersAt } from "./traders";

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
  /**
   * The Lage-Ampel's bars at T could not be loaded (network): the result holds no gate and is not memoised — the next
   * check of the same minute (`Neu prüfen`, the save) asks for them again. Absent = complete.
   */
  partial?: boolean;
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

const FEED_OF: Partial<Record<FetchInterval, KlineFeed>> = { "15m": "kline_15m", "1h": "kline_1h", "4h": "kline_4h", "1d": "kline_1d" };

/** Bars the Lage at T reads per interval (daily: 499 = weight 2; the EMA 21 / 50 settle, the EMA 200 nearly). */
const LAGE_NEED: ReadonlyArray<readonly [FetchInterval, number]> = [
  ["1d", RETRO_NATIVE_BARS],
  ["4h", RETRO_NATIVE_BARS],
  ["1h", 120],
];

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

/**
 * The Lage at T from the bars the check already has plus the missing ones; `lage: null` without daily bars. `failed`:
 * a page could not be loaded (the caller does not memoise such a result).
 */
async function lageAtT(p: MarketProvider, t: number, have: ReadonlyMap<FetchInterval, Bar[]>): Promise<{ lage: Lage | null; failed: boolean }> {
  const got = new Map(have);
  let failed = false;
  try {
    await Promise.all(
      LAGE_NEED.filter(([iv, n]) => (got.get(iv)?.length ?? 0) < Math.min(n, 120)).map(async ([iv, n]) => {
        const r = fromLive(p, iv, t, n) ?? (await fetchEndingAt(p, iv, t, n));
        got.set(iv, r.candles.map(candleToBar));
      }),
    );
  } catch {
    failed = true;
    if (!got.get("1d")?.length) return { lage: null, failed };
  }
  const daily = got.get("1d") ?? [];
  if (!daily.length) return { lage: null, failed };
  // the price at T: the last bar CLOSED at T (the running bar's close lies after T)
  const closeAt = (bars: readonly Bar[] | undefined, sec: number): number | null => {
    if (!bars) return null;
    for (let i = bars.length - 1; i >= 0; i--) if ((bars[i]!.t + sec) * 1000 <= t) return bars[i]!.c;
    return null;
  };
  const price = closeAt(got.get("15m"), 900) ?? closeAt(got.get("1h"), 3600) ?? closeAt(got.get("4h"), 14_400);
  return { lage: computeLage(daily, got.get("4h") ?? [], price, t, { h1: got.get("1h") ?? null }), failed };
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
  // the Lage at T (one more daily page unless the cached feed reaches T); the switch off → no gate, no request
  const lc = getLageConfig();
  const at = lc.on ? await lageAtT(p, t, sources) : null;
  const lage = at?.lage ?? null;
  const bars: Record<string, Bar[]> = {};
  for (const tf of neededTfs(cfg)) {
    const s = tfSource(tf);
    if (!s) continue;
    // + 1: the bar running at T is in the page and is cut by `signalsAt` (only closed bars count)
    bars[tf] = rungBars(tf, sources.get(s.interval) ?? [], SIGNAL_BARS + 1);
  }
  // `now` far in the future relative to T: always the closed-bars path (the live window is handled by the caller)
  const sig = signalsAt(bars, cfg, t, t + LIVE_WINDOW_MS + 1, lc.on ? { lage: { lage, cfg: lc } } : {});
  if (!sig) return { status: "no-history", signals: null, symbol: p.symbol, source, message: MSG.noHistory };
  return { status: "ok", signals: sig, symbol: p.symbol, source, message: null, ...(at?.failed ? { partial: true } : {}) };
}

/**
 * The Top-Trader reading at T on top of the (memoised) candle result: Binance keeps ~30 days, older / unavailable →
 * no reading (the part has no data). `tradersAt` memoises its pages and retries failed ones on the next call.
 */
async function withTradersAt(p: MarketProvider, cfg: SignalCfg, t: number, now: number, r: RetroResult): Promise<RetroResult> {
  if (r.status !== "ok" || !r.signals) return r;
  const reading = await tradersAt(p, cfg, t, now);
  return reading ? { ...r, signals: regradeSignals(r.signals, cfg, reading) } : r;
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
  const lc = getLageConfig();
  const key = `${p.symbol}|${signalCfgKey(cfg)}|lage:${lc.on ? 1 : 0}${lc.mode}|${Math.floor(t / 60_000)}`;
  const hit = memo.get(key);
  if (hit) return hit.then((r) => withTradersAt(p, cfg, t, now, r));
  const run = computeRetro(p, cfg, t).then((r) => {
    if (r.status === "error" || r.partial) memo.delete(key); // retry next time (a Lage page that failed included)
    return r;
  });
  memo.set(key, run);
  if (memo.size > MEMO_MAX) memo.delete(memo.keys().next().value!);
  return run.then((r) => withTradersAt(p, cfg, t, now, r));
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
