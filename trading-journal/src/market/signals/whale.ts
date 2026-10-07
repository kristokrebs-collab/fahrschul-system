/**
 * Market side of "Top-Trader kaufen · Retail rot" (`@/domain/signals` `whale.ts`): the Binance futures-data series
 * `topLongShortPositionRatio` (top traders, positions) and `globalLongShortAccountRatio` (all accounts = retail) per
 * configured period.
 *
 * - Live: a period equal to the provider's ratio period (`settings.hyblock.timeframe`, default 1h) reads the
 *   provider's own `topPositionRatio` / `globalAccountRatio` feeds (no extra request, same data as the Top-Trader
 *   card). Every other period is polled here: two requests (limit 30) right after each period boundary (+ 70–90 s,
 *   when Binance has published the snapshot), i.e. 4 requests/h for 30m, 2/h for 1h; failures back off 1 → 10 min.
 *   Data changes only bump a version (`whaleInputKey`) and call the engine's `schedule` — the evaluation stays ≤ 1/s.
 * - Retro (`whaleAt`): the series ending at T, one page per period and kind (memoised). Binance keeps these series
 *   for ~30 days: older times → `null` (the snapshot stores `whale: null` = "keine Daten", never a fail).
 * - Only Binance (direct or through the proxy) has top traders: a Bybit / OKX fallback yields no reading.
 */
import { applyWhale, tfSeconds, whaleCfgOf, whalePeriod, whaleReading, type RatioSample, type SignalCfg, type Signals, type WhaleCfg, type WhaleReading, type WhaleSeries } from "@/domain/signals";
import { isFileProtocol } from "@/edition";
import { FUTURES_DATA_RETENTION_MS } from "../feeds";
import type { Period } from "../period";
import type { MarketProvider } from "../provider";
import { binanceRest } from "../sources/binance";
import { proxyRest } from "../sources/proxy";
import type { RatioPoint, Source, Stamped } from "../types";

type Kind = "topPositionRatio" | "globalAccountRatio";

/** What the condition needs from a REST client (a `binanceRest` / `proxyRest` instance fits). */
export interface WhaleClient {
  ratio(kind: Kind, symbol: string, period: Period, p?: { limit?: number; startTime?: number; endTime?: number }): Promise<Stamped<RatioPoint[]>>;
}

const BINANCE_SOURCES: readonly Source[] = ["binance", "proxy"];
export const WHALE_POLL_LIMIT = 30;
export const WHALE_POLL_LAG_MS = 70_000;
const JITTER_MS = 20_000;
const RETRY_MIN_MS = 60_000;
const RETRY_MAX_MS = 10 * 60_000;

// ------------------------------------------------------------------ client

let clientOverride: ((p: MarketProvider) => WhaleClient | null) | undefined;
let direct: WhaleClient | null = null;
let viaProxy: WhaleClient | null = null;

const underTest = (): boolean => !!(globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env?.VITEST;

/** REST client for the futures-data endpoints: Binance direct, the proxy while Binance is blocked, none on file://. */
function clientFor(p: MarketProvider): WhaleClient | null {
  if (clientOverride !== undefined) return clientOverride(p);
  if (underTest()) return null; // tests inject a client; never the network
  const info = (p as Partial<MarketProvider>).symbolInfo;
  if (info && !info.valid) return null;
  const blocked = p.getHealth().primary?.blocked === true;
  if (!blocked) return (direct ??= binanceRest());
  if (isFileProtocol()) return null;
  return (viaProxy ??= proxyRest());
}

/** Testing helper: the client factory (`undefined` restores the default, `() => null` = no data). */
export function __setWhaleClient(f: ((p: MarketProvider) => WhaleClient | null) | undefined): void {
  clientOverride = f;
}

const toSamples = (pts: readonly RatioPoint[]): RatioSample[] => pts.map((x) => ({ time: x.time, longPct: x.longPct }));

/** The provider's own ratio period (`settings.hyblock.timeframe`), `null` when unknown. */
function providerPeriod(p: MarketProvider): string | null {
  return (p as Partial<MarketProvider>).period?.period ?? null;
}

/** Both series from the provider's feeds, when they come from Binance. */
function providerSeries(p: MarketProvider): WhaleSeries | null {
  const top = p.get("topPositionRatio") as Stamped<RatioPoint[]> | undefined;
  const glob = p.get("globalAccountRatio") as Stamped<RatioPoint[]> | undefined;
  if (!top?.data.length || !glob?.data.length) return null;
  if (!BINANCE_SOURCES.includes(top.source) || !BINANCE_SOURCES.includes(glob.source)) return null;
  return { top: toSamples(top.data), retail: toSamples(glob.data) };
}

// ------------------------------------------------------------------ live

interface Polled {
  series: WhaleSeries | null;
  timer: ReturnType<typeof setTimeout> | null;
  failures: number;
  inflight: boolean;
}

interface Live {
  p: MarketProvider | null;
  cfg: WhaleCfg | null;
  key: string;
  polled: Map<string, Polled>;
  offs: Array<() => void>;
  version: number;
  onChange: (() => void) | null;
  /** feeds identity for the input key */
  ids: WeakMap<object, number>;
  nextId: number;
}

const live: Live = { p: null, cfg: null, key: "", polled: new Map(), offs: [], version: 0, onChange: null, ids: new WeakMap(), nextId: 1 };

const cfgKey = (w: WhaleCfg): string => `${w.on ? 1 : 0}|${w.periods.join(",")}|${w.minRun}|${w.weight}`;

function bump(): void {
  live.version++;
  live.onChange?.();
}

function nextPollAt(period: string, now: number): number {
  const step = tfSeconds(period) * 1000;
  return (Math.floor(now / step) + 1) * step + WHALE_POLL_LAG_MS + Math.random() * JITTER_MS;
}

function poll(period: string): void {
  const p = live.p;
  const st = live.polled.get(period);
  if (!p || !st || st.inflight) return;
  if (st.timer) clearTimeout(st.timer);
  st.timer = null;
  const client = clientFor(p);
  if (!client) return; // no Binance futures data on this source: no reading
  st.inflight = true;
  const per = period as Period;
  Promise.all([client.ratio("topPositionRatio", p.symbol, per, { limit: WHALE_POLL_LIMIT }), client.ratio("globalAccountRatio", p.symbol, per, { limit: WHALE_POLL_LIMIT })])
    .then(([top, glob]) => {
      if (live.p !== p || live.polled.get(period) !== st) return;
      st.failures = 0;
      st.series = { top: toSamples(top.data), retail: toSamples(glob.data) };
      bump();
    })
    .catch(() => {
      if (live.polled.get(period) === st) st.failures++;
    })
    .finally(() => {
      st.inflight = false;
      if (live.p !== p || live.polled.get(period) !== st) return;
      const now = Date.now();
      const wait = st.failures ? Math.min(RETRY_MAX_MS, RETRY_MIN_MS * 2 ** (st.failures - 1)) : Math.max(5_000, nextPollAt(period, now) - now);
      st.timer = setTimeout(() => poll(period), wait);
    });
}

/**
 * Starts (or re-targets) the live series for `cfg` on provider `p`; `onChange` runs on every data change (the engine
 * passes its dirty-flag `schedule`). Idempotent for the same provider and settings.
 */
export function startWhale(p: MarketProvider, cfg: Pick<SignalCfg, "whale">, onChange: () => void): void {
  const w = whaleCfgOf(cfg);
  const key = cfgKey(w);
  live.onChange = onChange;
  if (live.p === p && live.key === key) return;
  stopWhale();
  live.p = p;
  live.cfg = w;
  live.key = key;
  live.onChange = onChange;
  if (!w.on) return;
  const own = providerPeriod(p);
  if (own && w.periods.includes(own)) {
    live.offs.push(p.subscribe("topPositionRatio", bump));
    live.offs.push(p.subscribe("globalAccountRatio", bump));
  }
  for (const period of w.periods) {
    if (period === own) continue;
    live.polled.set(period, { series: null, timer: null, failures: 0, inflight: false });
    poll(period);
  }
}

/** Stops polling and forgets the live series (engine detach, settings change). */
export function stopWhale(): void {
  for (const off of live.offs) off();
  live.offs = [];
  for (const st of live.polled.values()) if (st.timer) clearTimeout(st.timer);
  live.polled.clear();
  live.p = null;
  live.cfg = null;
  live.key = "";
  live.version++;
}

function objectId(o: object | undefined): number {
  if (!o) return 0;
  let id = live.ids.get(o);
  if (id === undefined) live.ids.set(o, (id = live.nextId++));
  return id;
}

/** Changes whenever a live series changes (part of the engine's input key). */
export function whaleInputKey(): string {
  const p = live.p;
  if (!p || !live.cfg?.on) return "w-";
  const own = providerPeriod(p);
  const feeds = own && live.cfg.periods.includes(own) ? `${objectId(p.get("topPositionRatio"))},${objectId(p.get("globalAccountRatio"))}` : "";
  return `w${live.version}|${feeds}`;
}

/** The live series per configured period (`null` = none yet / not from Binance). */
export function liveWhaleSeries(): Record<string, WhaleSeries | null> {
  const out: Record<string, WhaleSeries | null> = {};
  const p = live.p;
  if (!p || !live.cfg?.on) return out;
  const own = providerPeriod(p);
  for (const period of live.cfg.periods) out[period] = period === own ? providerSeries(p) : (live.polled.get(period)?.series ?? null);
  return out;
}

/** The engine's evaluation graded with the live condition (unchanged without a reading). */
export function withLiveWhale<S extends Signals>(sig: S, cfg: SignalCfg, now: number): S {
  return applyWhale(sig, whaleReading(liveWhaleSeries(), cfg, now), cfg);
}

// ------------------------------------------------------------------ retro

const MEMO_MAX = 128;
const memo = new Map<string, Promise<WhaleSeries | null>>();

/** One page of both series ending at `t` (≥ `need` + 4 periods), `null` on any failure. */
function fetchEndingAt(p: MarketProvider, client: WhaleClient, period: string, t: number, need: number): Promise<WhaleSeries | null> {
  const step = tfSeconds(period) * 1000;
  const key = `${p.symbol}|${period}|${Math.floor(t / 60_000)}|${need}`;
  const hit = memo.get(key);
  if (hit) return hit;
  const span = need + 4;
  const q = { endTime: t, startTime: t - span * step, limit: span + 2 };
  const run = Promise.all([client.ratio("topPositionRatio", p.symbol, period as Period, q), client.ratio("globalAccountRatio", p.symbol, period as Period, q)])
    .then(([top, glob]): WhaleSeries => ({ top: toSamples(top.data), retail: toSamples(glob.data) }))
    .catch(() => {
      memo.delete(key); // retry next time
      return null;
    });
  memo.set(key, run);
  if (memo.size > MEMO_MAX) memo.delete(memo.keys().next().value!);
  return run;
}

/** The live series already covers `t`: more than `need` snapshots at or before it, the newest one fresh. */
function coversAt(s: WhaleSeries | null, period: string, t: number, need: number): boolean {
  return !!s && s.top.filter((x) => x.time <= t).length > need && whalePeriod(period, s, t, need) !== null;
}

/**
 * The condition's readings at time `t` (a back-dated trade). `null` when it is off, the time is outside Binance's
 * ~30-day futures-data window, the source has no top traders, or nothing could be loaded. Never rejects.
 */
export async function whaleAt(p: MarketProvider, cfg: SignalCfg, t: number, now: number = Date.now()): Promise<WhaleReading | null> {
  const w = whaleCfgOf(cfg);
  if (!w.on || !Number.isFinite(t)) return null;
  const series: Record<string, WhaleSeries | null> = {};
  const client = clientFor(p);
  const own = providerPeriod(p);
  await Promise.all(
    w.periods.map(async (period) => {
      const step = tfSeconds(period) * 1000;
      if (now - t > FUTURES_DATA_RETENTION_MS - (w.minRun + 2) * step) return; // beyond Binance's window
      if (period === own) {
        const ps = providerSeries(p);
        if (coversAt(ps, period, t, w.minRun)) {
          series[period] = ps;
          return;
        }
      }
      if (!client) return;
      series[period] = await fetchEndingAt(p, client, period, t, w.minRun);
    }),
  );
  return whaleReading(series, cfg, t);
}

/** Testing helper. */
export function __resetWhale(): void {
  stopWhale();
  memo.clear();
  live.onChange = null;
  clientOverride = undefined;
}
