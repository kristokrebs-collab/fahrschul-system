/**
 * MAE / MFE measurement (Journal v3, P06): loads the candles of a trade's time in the market through the provider's
 * budget (`provider.fetchKlines`, budget class `bulk` – never below the live reserve), memoises closed windows in
 * IndexedDB (`storageKey("klines")`), computes the excursion with the pure `@/domain/excursion` and stores
 * `mae / mfe / maeR / mfeR / atrPct` on the trade. An idle queue backfills closed trades in the background.
 *
 * Honest limits (each one is a `MeasureStatus` with a German hint, never a fake number):
 * - only trades on the provider's symbol (`settings.market.symbol`) can be measured – other pairs have no feed here;
 * - MAE / MFE need an exit time (`exitDate`); the ATR at entry needs only the entry;
 * - without a running market provider (file build without network, blocked venue) nothing is fetched.
 */
import { createStore, get, set, type UseStore } from "idb-keyval";
import { atrPctAt, excursion, excursionInterval, excursionStale, type Excursion } from "@/domain/excursion";
import { fillStats } from "@/domain/fills";
import type { Trade } from "@/domain/types";
import { readJson, storageKey, writeJson } from "@/store/storage";
import { getProvider } from "./marketStore";
import type { MarketProvider } from "./provider";
import { tvSymbolToBinance } from "./symbol";
import type { Candle } from "./types";
import { FETCH_INTERVAL_MS, type FetchInterval } from "./period";

export type MeasureStatus = "ok" | "noProvider" | "otherPair" | "noExit" | "noEntry" | "noData" | "failed";

export const MEASURE_HINTS: Record<Exclude<MeasureStatus, "ok">, string> = {
  noProvider: "Marktdaten sind gerade nicht verbunden.",
  otherPair: "MAE/MFE lassen sich nur für das Paar des Live-Markts messen.",
  noExit: "Für MAE/MFE fehlt die Ausstiegszeit.",
  noEntry: "Ohne Einstiegspreis gibt es kein MAE/MFE.",
  noData: "Für diesen Zeitraum liefert die Börse keine Kerzen.",
  failed: "Messen fehlgeschlagen – gleich nochmal versuchen.",
};

export interface MeasureResult {
  status: MeasureStatus;
  excursion?: Excursion | null;
  atrPct?: number | null;
  interval?: FetchInterval;
}

const PAGE = 1500;
const MAX_PAGES = 4;

/* ------------------------------------------------------------------ memo */

let memo: UseStore | null = null;
let memoBroken = false;
function memoStore(): UseStore | null {
  if (memoBroken || typeof indexedDB === "undefined") return null;
  try {
    memo ??= createStore(storageKey("klines"), "windows");
    return memo;
  } catch {
    memoBroken = true;
    return null;
  }
}

type Bar = Pick<Candle, "time" | "open" | "high" | "low" | "close" | "volume">;

/** `symbol` of a trade's pair in the provider's notation (`BTC/USDT` → `BTCUSDT`). */
export function tradeSymbol(pair: string): string {
  return tvSymbolToBinance(pair.replace(/\//g, ""));
}

/** True when the provider can serve candles for this trade's pair. */
export function measurablePair(pair: string, provider: Pick<MarketProvider, "symbol"> | null = getProvider()): boolean {
  return !!provider && !!pair && tradeSymbol(pair) === provider.symbol;
}

/**
 * Candles `[from, to]` of `interval` for the provider's symbol: paged (≤ 4 × 1500), memoised in IndexedDB once every bar
 * of the window is closed. Bars are open-time ascending, unique.
 */
export async function loadBars(provider: MarketProvider, interval: FetchInterval, from: number, to: number, now = Date.now()): Promise<Bar[]> {
  const step = FETCH_INTERVAL_MS[interval];
  const start = Math.floor(from / step) * step;
  const end = Math.floor(to / step) * step;
  const key = `${provider.symbol}|${interval}|${start}|${end}`;
  const closed = end + step <= now;
  const store = memoStore();
  if (closed && store) {
    try {
      const hit = await get<Bar[]>(key, store);
      if (Array.isArray(hit) && hit.length) return hit;
    } catch {
      /* fall through to the network */
    }
  }
  const out = new Map<number, Bar>();
  let cursor = start;
  for (let page = 0; page < MAX_PAGES && cursor <= end; page++) {
    const res = await provider.fetchKlines(interval, { startTime: cursor, endTime: end + step - 1, limit: PAGE });
    const data = res.data ?? [];
    for (const c of data) if (c.time >= start && c.time <= end) out.set(c.time, { time: c.time, open: c.open, high: c.high, low: c.low, close: c.close, volume: c.volume });
    const last = data[data.length - 1];
    if (!last || data.length < PAGE) break;
    cursor = last.time + step;
  }
  const bars = [...out.values()].sort((a, b) => a.time - b.time);
  if (closed && store && bars.length) void set(key, bars, store).catch(() => undefined);
  return bars;
}

/* --------------------------------------------------------------- measure */

/** Entry time (ms) of a trade's local wall-clock `date`. */
const ms = (local: string | undefined): number => (local ? new Date(local).getTime() : NaN);

/** The trade's (Ø) entry: the fills' average when it has fills. */
export function measuredEntry(t: Pick<Trade, "entry" | "fills" | "side">): number | null {
  const s = t.fills?.length ? fillStats(t.fills, t.side) : null;
  const e = s?.avgEntry ?? t.entry;
  return e != null && e > 0 ? e : null;
}

/** Measures one trade (does not store anything). */
export async function measureTrade(t: Trade, provider: MarketProvider | null = getProvider(), now = Date.now()): Promise<MeasureResult> {
  if (!provider) return { status: "noProvider" };
  if (!measurablePair(t.pair, provider)) return { status: "otherPair" };
  const entry = measuredEntry(t);
  if (entry == null) return { status: "noEntry" };
  const from = ms(t.date);
  if (!Number.isFinite(from)) return { status: "noEntry" };
  const atr = await loadBars(provider, "1h", from - 20 * 3_600_000, from, now).then(
    (h1) => atrPctAt(h1, from, 3_600_000, 14),
    () => null,
  );
  const to = t.status === "open" ? now : ms(t.exitDate);
  if (t.status !== "open" && !Number.isFinite(to)) return { status: "noExit", atrPct: atr };
  const interval = excursionInterval(to - from);
  try {
    const bars = await loadBars(provider, interval, from, to, now);
    const x = excursion(bars, { side: t.side, entry, stop: t.stop, from, to, intervalMs: FETCH_INTERVAL_MS[interval] });
    if (!x) return { status: "noData", atrPct: atr, interval };
    return { status: "ok", excursion: x, atrPct: atr, interval };
  } catch {
    return { status: "failed", atrPct: atr, interval };
  }
}

const round = (v: number, d: number) => Number(v.toFixed(d));

/** The keys a measurement writes on the trade. */
export function excursionPatch(r: MeasureResult): Partial<Trade> {
  const out: Partial<Trade> = {};
  if (r.excursion) {
    out.mae = round(r.excursion.mae, 8);
    out.mfe = round(r.excursion.mfe, 8);
    out.maeR = r.excursion.maeR == null ? null : round(r.excursion.maeR, 3);
    out.mfeR = r.excursion.mfeR == null ? null : round(r.excursion.mfeR, 3);
  }
  if (r.atrPct != null) out.atrPct = round(r.atrPct, 3);
  return out;
}

export interface StoreDeps {
  /** Latest version of the trade (the journal may have changed while the candles loaded). */
  latest: (id: string) => Trade | undefined;
  save: (t: Trade) => Promise<void>;
}

/**
 * Measures and stores (closed trades: MAE / MFE + ATR; open trades: the ATR only – a running excursion is never
 * stored). Nothing is written when the trade was edited meanwhile in a way that changes the measurement.
 */
export async function measureAndStore(t: Trade, deps: StoreDeps, provider: MarketProvider | null = getProvider()): Promise<MeasureResult> {
  const r = await measureTrade(t, provider);
  const patch = excursionPatch(t.status === "open" ? { status: r.status, atrPct: r.atrPct } : r);
  if (!Object.keys(patch).length) return r;
  const cur = deps.latest(t.id);
  if (!cur || excursionStale(t, cur)) return r;
  await deps.save({ ...cur, ...patch, updatedAt: new Date().toISOString() });
  return r;
}

/* -------------------------------------------------------------- backfill */

export const TRIED_KEY = storageKey("excursion-tried");
/** A failed / impossible measurement is retried after this long. */
export const RETRY_AFTER_MS = 24 * 3_600_000;
/** At most this many trades per session; one every `BACKFILL_GAP_MS`. */
export const BACKFILL_MAX = 40;
export const BACKFILL_GAP_MS = 1500;

/** Closed trades that still lack MAE / MFE and can be measured here, newest first. */
export function backfillCandidates(trades: readonly Trade[], provider: Pick<MarketProvider, "symbol"> | null, tried: Readonly<Record<string, number>>, now = Date.now()): Trade[] {
  if (!provider) return [];
  return trades
    .filter((t) => {
      const at = tried[t.id];
      return t.status === "closed" && !!t.exitDate && t.mae == null && measurablePair(t.pair, provider) && measuredEntry(t) != null && !(at != null && now - at < RETRY_AFTER_MS);
    })
    .sort((a, b) => (b.date || "").localeCompare(a.date || ""));
}

export interface Backfill {
  stop(): void;
}

/**
 * Idle background queue: waits for an idle moment, then measures the candidates one by one (`BACKFILL_GAP_MS` apart,
 * paused while the tab is hidden), at most `BACKFILL_MAX` per session. Every attempt is remembered (`TRIED_KEY`), so a
 * trade that cannot be measured is not fetched again for a day.
 */
export function startExcursionBackfill(deps: StoreDeps & { trades: () => readonly Trade[] }, opts: { provider?: () => MarketProvider | null; delayMs?: number } = {}): Backfill {
  let stopped = false;
  let done = 0;
  let timer: ReturnType<typeof setTimeout> | null = null;
  const providerOf = opts.provider ?? getProvider;
  const schedule = (wait: number) => {
    if (stopped) return;
    timer = setTimeout(() => {
      const ric = (globalThis as { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number }).requestIdleCallback;
      if (ric) ric(() => void tick(), { timeout: 4000 });
      else void tick();
    }, wait);
  };
  const tick = async () => {
    if (stopped) return;
    if (typeof document !== "undefined" && document.visibilityState === "hidden") return schedule(10_000);
    const provider = providerOf();
    const tried = readJson<Record<string, number>>(TRIED_KEY, {});
    const next = backfillCandidates(deps.trades(), provider, tried)[0];
    if (!next || !provider || done >= BACKFILL_MAX) return;
    done += 1;
    writeJson(TRIED_KEY, { ...pruneTried(tried), [next.id]: Date.now() });
    try {
      await measureAndStore(next, deps, provider);
    } catch {
      /* remembered as tried; the next one follows */
    }
    schedule(BACKFILL_GAP_MS);
  };
  schedule(opts.delayMs ?? 4000);
  return {
    stop: () => {
      stopped = true;
      if (timer) clearTimeout(timer);
    },
  };
}

/** Keeps the tried-registry small (only entries younger than the retry window). */
function pruneTried(tried: Record<string, number>, now = Date.now()): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(tried)) if (now - v < RETRY_AFTER_MS) out[k] = v;
  return out;
}

/** Tests: forget the memo handle. */
export function resetExcursionMemoForTests(): void {
  memo = null;
  memoBroken = false;
}
