/**
 * Live "Einstiegs-Check": the pure engine (`@/domain/signals`) fed from the market provider.
 *
 * - Inputs: `kline_15m` (→ 30m, 45m), `kline_1h` (→ 1h, 2h, 3h), `kline_4h`, plus a lazily polled REST `1d` series
 *   when a ladder uses `1D`. The running candle of every rung is completed with the live price (`priceMv`, like the
 *   other journal's `withLivePrice`).
 * - Cadence (120 Hz rule): never in render, never per WS frame. A data change only sets a dirty flag; one timer
 *   evaluates at most once per second (every 5 s in a hidden tab) and sleeps while nothing changes.
 * - Top-Trader-Kombi: the provider's 5-min ratio twins (`traders.ts`), graded inside the same evaluation.
 * - Output: a `SignalCheckState` that changes identity only when the rounded result changes (score, strength,
 *   labels, events, candle-close states, parts, knife filter, wt1/RSI to 0.1, zone position to 0.01, status) —
 *   React subscribers re-render only then. Countdowns are NOT part of it: render them from `closesAt` on a clock.
 */
import {
  DEFAULT_SIGNAL_CFG,
  computeSignals,
  divCfgOf,
  eventState,
  isForming,
  isLongKind,
  luxZone,
  marketStructure,
  rsi,
  sanitizeSignalCfg,
  signalCfgKey,
  srCfgOf,
  strongClosesOf,
  tfDivergences,
  waveTrend,
  withLivePrice,
  tfSeconds,
  mcbSeries,
  toSignalSnapshot,
  type Bar,
  type DivKind,
  type DivOsc,
  type Level,
  type RungConf,
  type Side,
  type SignalCfg,
  type SignalSnapshot,
  type SignalState,
  type Signals,
  type Structure,
  type SwingLabel,
  type TfCheck,
  type Verdict,
  type WtKind,
} from "@/domain/signals";
import { LIVE_RATIO_FEEDS } from "../feeds";
import type { MarketProvider } from "../provider";
import type { Candle, FeedId, KlineFeed, ProviderHealth, Source, Stamped } from "../types";
import { priceMv, priceReceivedAtMv, tradeTimeMv } from "../motionValues";
import { BarConverter, neededTfs, rungBars, tfSource } from "./bars";
import { noteSignals, resetSignalNotifier, signalNotifyMinStrength } from "./notify";
import { liveTraders, tradersInputKey } from "./traders";

export type SignalCheckStatus = "loading" | "ok" | "stale" | "offline";

/** One live evaluation: the engine's `Signals` (both sides, every rung) plus where the data came from. */
export interface LiveSignals extends Signals {
  /** data symbol, e.g. `BTCUSDT` */
  symbol: string;
  /** source of the kline feeds (`binance`, `bybit` in the fallback, `cache` before the first fetch) */
  source: Source;
  /** the (sanitised) config the evaluation used */
  cfg: SignalCfg;
  /** live price used to complete the running candles, `null` when none was fresh */
  price: number | null;
}

export interface SignalCheckState {
  /** `loading` before the first evaluation or while the feeds connect (a cached `snapshot` may already exist) */
  state: SignalCheckStatus;
  snapshot: LiveSignals | null;
  /** ms of the evaluation that produced `snapshot` (changes only with the snapshot) */
  updatedAt: number | null;
  /** German status text for empty or degraded states, `null` when `ok` */
  message: string | null;
}

export const SIGNAL_MIN_INTERVAL_MS = 1000;
export const SIGNAL_HIDDEN_INTERVAL_MS = 5000;
/** The live price completes the running candles only while it is younger than this (other journal: 5 min). */
export const LIVE_PRICE_MAX_AGE_MS = 5 * 60_000;
/** REST cadence of the lazily polled `1d` series. */
export const DAILY_POLL_MS = 5 * 60_000;
const DAILY_BARS = 499;

const MSG = {
  loading: "Kerzen werden geladen …",
  offline: "Keine Marktdaten (Binance).",
  badSymbol: "Kein Live-Kurs für dieses Symbol.",
  stale: "Marktdaten veraltet, der Check zeigt den letzten Stand.",
  tooFew: "Zu wenig Kerzen für den Check.",
} as const;

const INITIAL: SignalCheckState = { state: "loading", snapshot: null, updatedAt: null, message: MSG.loading };

interface Engine {
  provider: MarketProvider | null;
  offs: Array<() => void>;
  cfg: SignalCfg;
  cfgKey: string;
  current: SignalCheckState;
  /** `signalsKey` of `current.snapshot` */
  snapKey: string;
  publishKey: string;
  timer: ReturnType<typeof setTimeout> | null;
  dirty: boolean;
  lastRunAt: number;
  /** identity of the inputs of the last evaluation: source arrays + price */
  inputKey: string;
  converters: Map<string, BarConverter>;
  daily: { candles: Candle[]; fetchedAt: number; timer: ReturnType<typeof setTimeout> | null; inflight: boolean };
}

const eng: Engine = {
  provider: null,
  offs: [],
  cfg: DEFAULT_SIGNAL_CFG,
  cfgKey: signalCfgKey(DEFAULT_SIGNAL_CFG),
  current: INITIAL,
  snapKey: "∅",
  publishKey: "",
  timer: null,
  dirty: false,
  lastRunAt: 0,
  inputKey: "",
  converters: new Map(),
  daily: { candles: [], fetchedAt: 0, timer: null, inflight: false },
};
const listeners = new Set<() => void>();
/** Test / perf counters: evaluations run and full engine computations (inputs changed). */
const stats = { runs: 0, computes: 0 };

const hiddenDoc = (): boolean => typeof document !== "undefined" && document.hidden === true;

// ------------------------------------------------------------------ inputs

/** Live feeds the current config reads. */
function liveFeeds(cfg: SignalCfg): KlineFeed[] {
  const out = new Set<KlineFeed>();
  for (const tf of neededTfs(cfg)) {
    const s = tfSource(tf);
    if (s?.feed) out.add(s.feed);
  }
  return [...out];
}

const needsDaily = (cfg: SignalCfg): boolean => neededTfs(cfg).some((tf) => tfSource(tf)?.interval === "1d");

function converter(key: string): BarConverter {
  let c = eng.converters.get(key);
  if (!c) eng.converters.set(key, (c = new BarConverter()));
  return c;
}

function sourceCandles(p: MarketProvider, tf: string): readonly Candle[] {
  const s = tfSource(tf);
  if (!s) return [];
  if (!s.feed) return eng.daily.candles;
  return (p.get(s.feed) as Stamped<Candle[]> | undefined)?.data ?? [];
}

/** Fresh live price + its time, or null. */
function livePrice(now: number): { price: number; at: number } | null {
  const price = priceMv.get();
  const rec = priceReceivedAtMv.get();
  if (!(price > 0) || !rec || now - rec > LIVE_PRICE_MAX_AGE_MS) return null;
  const tt = tradeTimeMv.get();
  return { price, at: tt > 0 ? tt : rec };
}

/** Rung bars per timeframe for `cfg` from the provider, running candles completed with `price`. */
export function buildBars(p: MarketProvider, cfg: SignalCfg, price: { price: number; at: number } | null, bars?: number): Record<string, Bar[]> {
  const out: Record<string, Bar[]> = {};
  for (const tf of neededTfs(cfg)) {
    const s = tfSource(tf);
    if (!s) continue;
    const src = converter(s.interval).convert(sourceCandles(p, tf));
    let rung = rungBars(tf, src, bars);
    if (price && rung.length) rung = withLivePrice(rung, tfSeconds(tf), price.price, price.at) as Bar[];
    out[tf] = rung;
  }
  return out;
}

function inputKeyOf(p: MarketProvider, cfg: SignalCfg, price: { price: number } | null): string {
  const ids: string[] = [eng.cfgKey, String(price?.price ?? "")];
  for (const f of liveFeeds(cfg)) {
    const v = p.get(f) as Stamped<Candle[]> | undefined;
    ids.push(`${f}:${v ? objectId(v.data) : 0}`);
  }
  if (needsDaily(cfg)) ids.push(`d:${objectId(eng.daily.candles)}`);
  ids.push(tradersInputKey(p, cfg));
  return ids.join("|");
}

const ids = new WeakMap<object, number>();
let nextId = 1;
function objectId(o: object): number {
  let id = ids.get(o);
  if (id === undefined) ids.set(o, (id = nextId++));
  return id;
}

// ------------------------------------------------------------------ status

function feedsOf(h: ProviderHealth, feeds: readonly FeedId[]) {
  return feeds.map((f) => h.feeds[f]);
}

function statusOf(p: MarketProvider | null, cfg: SignalCfg, hasResult: boolean): { state: SignalCheckStatus; message: string | null } {
  if (!p) return { state: "loading", message: MSG.loading };
  const h = p.getHealth();
  const fs = feedsOf(h, liveFeeds(cfg));
  if (fs.some((f) => f.reason === "bad_symbol")) return { state: "offline", message: MSG.badSymbol };
  if (!h.online) return hasResult ? { state: "stale", message: MSG.stale } : { state: "offline", message: MSG.offline };
  if (!hasResult) {
    const dead = fs.some((f) => f.state === "offline" || (f.consecutiveFailures >= 3 && f.lastDataAt === undefined));
    if (dead) return { state: "offline", message: MSG.offline };
    // every feed delivered, still no rung with 150 bars (e.g. a short Bybit/OKX fallback history)
    const delivered = fs.length > 0 && fs.every((f) => f.lastDataAt !== undefined);
    return { state: "loading", message: delivered ? MSG.tooFew : MSG.loading };
  }
  if (fs.some((f) => f.state === "stale" || f.state === "offline")) return { state: "stale", message: MSG.stale };
  if (fs.some((f) => f.state === "connecting")) return { state: "loading", message: MSG.loading };
  return { state: "ok", message: null };
}

// ------------------------------------------------------------------ publish

const r1 = (x: number): string => (Number.isFinite(x) ? (Math.round(x * 10) / 10).toFixed(1) : "-");
const r2 = (x: number): string => (Number.isFinite(x) ? (Math.round(x * 100) / 100).toFixed(2) : "-");
const ev = (e: { kind: WtKind; barsAgo: number } | null): string => (e ? `${e.kind}${e.barsAgo}` : "-");
const confKey = (c: RungConf | undefined): string => (c ? `${c.state}${c.closes}${c.held ? "h" : ""}${ev(c.event)}` : "-");
const lvlKey = (l: Level | null): string => (l ? `${l.kind}${r1(l.price)}/${r1(l.distAtr)}` : "-");

function checkKey(c: TfCheck): string {
  const d = c.div;
  const divs = d ? [...d.long, ...d.short].map((x) => `${x.osc}${x.kind}${x.dir}@${x.at}${x.state}`).join("+") : "-";
  const st = c.structure;
  const brk = st?.breaks.at(-1);
  const structure = st ? `${st.trend}${st.itrend}|${lvlKey(st.support)}|${lvlKey(st.resistance)}|${brk ? `${brk.kind}${brk.dir}${brk.index}` : "-"}` : "-";
  return [c.forming ? 1 : 0, c.closesAt ?? "-", confKey(c.conf?.long), confKey(c.conf?.short), divs, structure].join(",");
}

function verdictKey(v: Verdict): string {
  const parts = (v.parts ?? []).map((p) => `${p.id}:${r2(p.grade)}:${r1(p.points)}:${p.ok ? 1 : 0}${p.data ? 1 : 0}:${p.state}:${p.items.map((i) => `${i.met === null ? "n" : i.met ? 1 : 0}${i.value}`).join("~")}`);
  return [v.state ?? "-", v.confTiers ?? "-", v.provStrength ?? "-", v.closesAt ?? "-", (v.rungStates ?? []).join("/"), parts.join("^")].join(",");
}

/** Rounded fingerprint of an evaluation: equal fingerprints never re-render a subscriber. */
export function signalsKey(s: Signals | null): string {
  if (!s) return "∅";
  const parts: string[] = [];
  for (const c of s.checks) {
    if (!c) {
      parts.push("null");
      continue;
    }
    parts.push(
      [c.tf, c.closeAt, r1(c.rsi), r1(c.rsiMa), r1(c.wt.wt1), r1(c.wt.wt2), c.wt.kind ?? "-", c.wt.barsAgo ?? "-", ev(c.wt.long), ev(c.wt.short), c.zone.zone, c.zone.deep ? 1 : 0, r2(c.zone.pos), r1(c.zone.hi), r1(c.zone.lo), c.zone.brk ? `${c.zone.brk.kind}${c.zone.brk.dir}` : "-", c.zone.lux ? 1 : 0, checkKey(c)].join(","),
    );
  }
  const z = s.zone;
  parts.push(z ? `z:${z.tf},${z.zone.zone},${r2(z.zone.pos)},${r1(z.zone.hi)},${r1(z.zone.lo)},${z.zone.deep ? 1 : 0},${z.zone.brk ? `${z.zone.brk.kind}${z.zone.brk.dir}` : "-"},${z.zone.lux ? 1 : 0},${checkKey(z)}` : "z:-");
  for (const v of [s.long, s.short]) parts.push([v.score, v.strength, v.tiers, v.valid ? 1 : 0, v.rsiOk ? 1 : 0, v.zoneOk ? 1 : 0, v.label, v.reasons.map((r) => (r.ok ? 1 : 0)).join(""), verdictKey(v)].join(","));
  // top-trader readings (rounded like the rest: a re-render only when a shown digit changes)
  const t = s.traders;
  parts.push(t ? `t:${t.at},${r1(t.position ?? NaN)},${r1(t.account ?? NaN)},${r1(t.retail ?? NaN)},${r1(t.retailChg ?? NaN)},${t.period}` : `t:${t === null ? "0" : "-"}`);
  if (s.knife) for (const k of [s.knife.long, s.knife.short]) parts.push(`k:${k.n}:${k.items.map((i) => `${i.met === null ? "n" : i.met ? 1 : 0}${i.detail}`).join("~")}`);
  // legacy run-rule readings (`applyWhale`; not set by the live engine)
  if (s.whale) {
    for (const w of s.whale.periods) parts.push(`w:${w.period},${w.at},${r1(w.top)},${r1(w.retail)},${r1(w.topChg)},${r1(w.retailChg)},${w.runLong},${w.runShort}`);
    parts.push(`wm:${s.whale.missing.join(",")}`);
  }
  for (const v of [s.long, s.short]) if (v.whale) parts.push(`wv:${v.whale.ok ? 1 : 0},${v.whale.run},${v.whale.period},${v.whale.points}`);
  return parts.join(";");
}

function publish(next: SignalCheckState, key: string): void {
  if (key === eng.publishKey) return;
  eng.publishKey = key;
  eng.current = next;
  for (const l of [...listeners]) l();
}

// ------------------------------------------------------------------ evaluation

/** One evaluation now (normally driven by the timer; exported for tests and `refreshSignalCheck`). */
export function runSignalCheck(now: number = Date.now()): SignalCheckState {
  eng.dirty = false;
  eng.lastRunAt = now;
  stats.runs++;
  const p = eng.provider;
  const cfg = eng.cfg;
  if (!p) {
    publish(INITIAL, "init");
    return eng.current;
  }
  const price = livePrice(now);
  const key = inputKeyOf(p, cfg, price);
  let snap = eng.current.snapshot;
  let updatedAt = eng.current.updatedAt;
  if (key !== eng.inputKey || !snap) {
    eng.inputKey = key;
    stats.computes++;
    const bars = buildBars(p, cfg, price);
    // candle-close states from `now`; the Top-Trader-Kombi from the provider's 5-min series (Binance clock)
    const s = computeSignals(bars, cfg, now, { traders: liveTraders(p, cfg) });
    if (s) {
      const live: LiveSignals = { ...s, symbol: p.symbol, source: p.getHealth().feeds[liveFeeds(cfg)[0] ?? "kline_1h"].source, cfg, price: price?.price ?? null };
      const k = signalsKey(live);
      if (k !== eng.snapKey) {
        eng.snapKey = k;
        snap = live;
        updatedAt = now;
      }
      noteSignals(live, now);
    } else {
      eng.snapKey = "∅";
      snap = null;
      updatedAt = null;
    }
  }
  const st = statusOf(p, cfg, !!snap);
  publish({ state: st.state, snapshot: snap, updatedAt, message: st.message }, `${st.state}|${st.message}|${updatedAt}|${snap ? objectId(snap) : 0}`);
  return eng.current;
}

function schedule(): void {
  eng.dirty = true;
  if (eng.timer || !eng.provider) return;
  const gap = hiddenDoc() ? SIGNAL_HIDDEN_INTERVAL_MS : SIGNAL_MIN_INTERVAL_MS;
  const wait = Math.max(0, eng.lastRunAt + gap - Date.now());
  eng.timer = setTimeout(() => {
    eng.timer = null;
    if (eng.dirty) runSignalCheck();
  }, wait);
}

// ------------------------------------------------------------------ 1d REST series (only for a `1D` rung)

function pollDaily(): void {
  const p = eng.provider;
  const d = eng.daily;
  if (d.timer) clearTimeout(d.timer);
  d.timer = null;
  if (!p || !needsDaily(eng.cfg)) return;
  if (d.inflight) return;
  d.inflight = true;
  // 499 daily bars: Binance weight 2 (500+ would cost 5), same window as the native 1h / 4h rungs
  p.fetchKlines("1d", { limit: DAILY_BARS })
    .then((v) => {
      if (eng.provider !== p) return;
      d.candles = v.data;
      d.fetchedAt = Date.now();
      schedule();
    })
    .catch(() => undefined)
    .finally(() => {
      d.inflight = false;
      if (eng.provider === p && needsDaily(eng.cfg)) d.timer = setTimeout(pollDaily, d.candles.length ? DAILY_POLL_MS : 60_000);
    });
}

// ------------------------------------------------------------------ lifecycle

function subscribeInputs(p: MarketProvider): void {
  for (const off of eng.offs) off();
  eng.offs = [];
  for (const f of liveFeeds(eng.cfg)) eng.offs.push(p.subscribe(f, schedule));
  // the Top-Trader-Kombi's 5-min series (a new point every 5 min; the evaluation stays ≤ 1/s)
  for (const f of LIVE_RATIO_FEEDS) eng.offs.push(p.subscribe(f, schedule));
  eng.offs.push(p.onHealth(schedule));
  eng.offs.push(priceMv.on("change", schedule));
}

/** Binds the engine to a (started) provider; called by `startMarket`. */
export function attachSignalEngine(p: MarketProvider): void {
  if (eng.provider === p) return;
  detachSignalEngine();
  eng.provider = p;
  subscribeInputs(p);
  if (needsDaily(eng.cfg)) pollDaily();
  schedule();
}

/** Releases the provider (symbol change, `stopMarket`); the last state is replaced by `loading`. */
export function detachSignalEngine(): void {
  for (const off of eng.offs) off();
  eng.offs = [];
  if (eng.timer) clearTimeout(eng.timer);
  eng.timer = null;
  if (eng.daily.timer) clearTimeout(eng.daily.timer);
  eng.daily = { candles: [], fetchedAt: 0, timer: null, inflight: false };
  eng.converters.clear();
  eng.provider = null;
  eng.inputKey = "";
  eng.snapKey = "∅";
  eng.dirty = false;
  resetSignalNotifier();
  publish(INITIAL, "init");
}

/** Applies `settings.signals` (raw value; sanitised here). Re-evaluates when the effective config changed. */
export function setSignalConfig(raw: unknown): SignalCfg {
  const cfg = sanitizeSignalCfg(raw);
  const key = signalCfgKey(cfg);
  // notification-only settings (switch, minimum strength) do not change the evaluation, but the notifier reads them
  const notifyChanged = cfg.notify !== eng.cfg.notify || signalNotifyMinStrength(cfg) !== signalNotifyMinStrength(eng.cfg);
  if (key === eng.cfgKey) {
    if (notifyChanged) eng.cfg = cfg;
    return eng.cfg;
  }
  eng.cfg = cfg;
  eng.cfgKey = key;
  eng.inputKey = "";
  resetSignalNotifier();
  if (eng.provider) {
    subscribeInputs(eng.provider);
    if (needsDaily(cfg)) pollDaily();
    schedule();
  }
  return cfg;
}

export function getSignalConfig(): SignalCfg {
  return eng.cfg;
}

/** Forces an evaluation on the next tick (ignores the input memo, still ≤ 1/s). */
export function refreshSignalCheck(): void {
  eng.inputKey = "";
  schedule();
}

// ------------------------------------------------------------------ read API

/** Current state (non-hook). Same object until the rounded result or the status changes. */
export function getSignalSnapshot(): SignalCheckState {
  return eng.current;
}

/** Listener on state changes (≤ 1/s, only on a real change). */
export function subscribeSignalCheck(cb: () => void): () => void {
  listeners.add(cb);
  return () => void listeners.delete(cb);
}

/** The snapshot to store on a trade (`trade.signal`) from a live evaluation (`mode: "live"`). */
export function toTradeSnapshot(live: LiveSignals, side: Side): SignalSnapshot {
  return toSignalSnapshot(live, side, live.cfg, { mode: "live", symbol: live.symbol, source: live.source });
}

/** The provider the engine reads (retro checks share its budget). */
export function signalProvider(): MarketProvider | null {
  return eng.provider;
}

export interface McbMarker {
  /** open time of the bar, ms UTC (same unit as `Candle.time`) */
  time: number;
  kind: WtKind;
  /** the event sits on the running (repainting) bar */
  live: boolean;
  /** candle-close state: `provisional` on the running bar, `confirmed` after its close, `strong` after `strongCloses` closes held */
  state: SignalState;
}

/** Rung bars of one timeframe as the check builds them (running candle completed with the live price). */
function chartBars(interval: string, n?: number): { bars: Bar[]; cfg: SignalCfg; now: number } | null {
  const p = eng.provider;
  if (!p || !tfSource(interval)) return null;
  const cfg = eng.cfg;
  const now = Date.now();
  const bars = buildBars(p, { ...cfg, ladder: [interval], zoneTf: interval }, livePrice(now), n)[interval] ?? [];
  return bars.length ? { bars, cfg, now } : null;
}

/**
 * Per-bar MCB events of one timeframe for chart markers (`30m`, `45m`, `1h`, `2h`, `3h`, `4h`, `1D`), computed from
 * the same bars and window as the check (running candle completed with the live price). `minor` adds the small
 * `bull`/`bear` crosses; `bars` widens the window (as far as the loaded history reaches). Empty without data.
 */
export function getMcbSeries(interval: string, opts: { minor?: boolean; bars?: number } = {}): McbMarker[] {
  const d = chartBars(interval, opts.bars);
  if (!d) return [];
  const { bars, cfg, now } = d;
  const forming = isForming(bars, interval, now);
  const strong = strongClosesOf(cfg);
  const lastT = bars[bars.length - 1]!.t;
  const index = new Map<number, number>();
  bars.forEach((b, i) => index.set(b.t, i));
  return mcbSeries(bars, cfg, { minor: opts.minor }).map((m) => ({
    time: m.t * 1000,
    kind: m.kind,
    live: forming && m.t === lastT,
    state: eventState(bars, index.get(m.t)!, isLongKind(m.kind), forming, strong),
  }));
}

/** A divergence pivot on the chart: bar open time (ms), price (bar low / high) and the oscillator value. */
export interface ChartPivot {
  time: number;
  price: number;
  osc: number;
}

export interface ChartDivergence {
  /** `rsi` = RSI 14, `wt` = WaveTrend wt1 */
  osc: DivOsc;
  kind: DivKind;
  /** 1 bullish, −1 bearish */
  dir: 1 | -1;
  /** line from → to (price pane: `price`, oscillator pane: `osc`) */
  from: ChartPivot;
  to: ChartPivot;
  /** open time (ms) of the bar that confirmed it (`to` + right lookback) */
  confirmedAt: number;
  barsAgo: number;
  state: SignalState;
  /** counts in the check (held, at most `maxAge` bars old) */
  active: boolean;
}

/**
 * Divergences (RSI 14 and wt1 vs price pivots, regular + hidden) of one timeframe, oldest first — the same computation
 * as the check's `TfCheck.div`. `recent` keeps those confirmed within the last `recent` bars; `bars` widens the window.
 * Empty without data or while `settings.signals.div.on` is off.
 */
export function getDivergences(interval: string, opts: { bars?: number; recent?: number } = {}): ChartDivergence[] {
  const d = chartBars(interval, opts.bars);
  if (!d) return [];
  const { bars, cfg, now } = d;
  const dc = divCfgOf(cfg);
  if (!dc.on) return [];
  const r = rsi(
    bars.map((b) => b.c),
    cfg.rsiLen,
  );
  const { wt1 } = waveTrend(bars, cfg);
  const all = tfDivergences(bars, r, wt1, dc, isForming(bars, interval, now), strongClosesOf(cfg)).all;
  const pt = (x: { t: number; price: number; osc: number }): ChartPivot => ({ time: x.t * 1000, price: x.price, osc: x.osc });
  return all
    .filter((x) => opts.recent === undefined || x.barsAgo <= opts.recent)
    .map((x) => ({ osc: x.osc, kind: x.kind, dir: x.dir, from: pt(x.from), to: pt(x.to), confirmedAt: bars[x.at]!.t * 1000, barsAgo: x.barsAgo, state: x.state, active: x.active }));
}

/** A support / resistance level on the chart (`time` = origin bar, ms; `null` for the premium/discount range). */
export interface ChartLevel extends Omit<Level, "t" | "index"> {
  time: number | null;
}

/** Market structure of one timeframe with chart times (ms). */
export interface ChartStructure {
  swings: Array<{ time: number; price: number; high: boolean; internal: boolean; label: SwingLabel; broken: boolean }>;
  breaks: Array<{ time: number; level: number; pivotTime: number; kind: "BOS" | "CHoCH"; dir: 1 | -1; internal: boolean }>;
  /** unmitigated order blocks: candle time, box, the break that made it */
  obs: Array<{ time: number; top: number; btm: number; dir: 1 | -1; internal: boolean; breakTime: number }>;
  eqs: Array<{ kind: "EQH" | "EQL"; price: number; from: { time: number; price: number }; to: { time: number; price: number }; broken: boolean }>;
  /** nearest first (≤ 4 each) */
  supports: ChartLevel[];
  resistances: ChartLevel[];
  support: ChartLevel | null;
  resistance: ChartLevel | null;
  trend: Structure["trend"];
  itrend: Structure["itrend"];
  atr: number;
  close: number;
}

/**
 * Market structure + support / resistance of one timeframe (LuxAlgo SMC: swing `swingLookback`, internal
 * `settings.signals.sr.internal`, EQH/EQL, order blocks), the same computation as the check's `TfCheck.structure`,
 * with chart times (ms). `null` without data. Computed whether or not the S/R part is weighted (the chart legend
 * toggles it).
 */
export function getStructure(interval: string, opts: { bars?: number } = {}): ChartStructure | null {
  const d = chartBars(interval, opts.bars);
  if (!d) return null;
  const { bars, cfg } = d;
  const sc = srCfgOf(cfg);
  const z = luxZone(bars, cfg.swingLookback);
  const s = marketStructure(bars, { swing: cfg.swingLookback, internal: sc.internal, eqLen: sc.eqLen, eqThreshold: sc.eqThreshold, range: z ? { hi: z.hi, lo: z.lo } : null });
  if (!s) return null;
  const ms = (i: number): number => bars[i]!.t * 1000;
  const lvl = (l: Level): ChartLevel => {
    const { t, index, ...rest } = l;
    return { ...rest, time: index >= 0 ? t * 1000 : null };
  };
  return {
    swings: s.swings.map((p) => ({ time: p.t * 1000, price: p.price, high: p.high, internal: p.internal, label: p.label, broken: p.broken })),
    breaks: s.breaks.map((b) => ({ time: b.t * 1000, level: b.level, pivotTime: ms(b.pivot), kind: b.kind, dir: b.dir, internal: b.internal })),
    obs: s.obs.map((o) => ({ time: o.t * 1000, top: o.top, btm: o.btm, dir: o.dir, internal: o.internal, breakTime: ms(o.brk) })),
    eqs: s.eqs.map((q) => ({ kind: q.kind, price: q.price, from: { time: q.from.t * 1000, price: q.from.price }, to: { time: q.to.t * 1000, price: q.to.price }, broken: q.broken })),
    supports: s.supports.map(lvl),
    resistances: s.resistances.map(lvl),
    support: s.support ? lvl(s.support) : null,
    resistance: s.resistance ? lvl(s.resistance) : null,
    trend: s.trend,
    itrend: s.itrend,
    atr: s.atr,
    close: s.close,
  };
}

/**
 * Candles of a signal timeframe (e.g. `30m` / `45m` built from 15m) for a chart: `time` in ms, `closed` when the
 * bucket has ended. `bars` limits the count (default `SIGNAL_BARS`).
 */
export function getSignalCandles(interval: string, opts: { bars?: number } = {}): Candle[] {
  const p = eng.provider;
  if (!p || !tfSource(interval)) return [];
  const now = Date.now();
  const sec = tfSeconds(interval);
  const bars = buildBars(p, { ...eng.cfg, ladder: [interval], zoneTf: interval }, null, opts.bars)[interval] ?? [];
  return bars.map((b) => ({ time: b.t * 1000, open: b.o, high: b.h, low: b.l, close: b.c, volume: b.v ?? 0, closed: (b.t + sec) * 1000 <= now, closeTime: (b.t + sec) * 1000 - 1 }));
}

/** Testing helper: evaluation counters since the last `__resetSignalEngine`. */
export function __signalStats(): { runs: number; computes: number } {
  return { ...stats };
}

/** Testing helper: forget all state (does not touch a provider). */
export function __resetSignalEngine(): void {
  detachSignalEngine();
  eng.cfg = DEFAULT_SIGNAL_CFG;
  eng.cfgKey = signalCfgKey(DEFAULT_SIGNAL_CFG);
  eng.current = INITIAL;
  eng.publishKey = "";
  eng.lastRunAt = 0;
  listeners.clear();
  stats.runs = 0;
  stats.computes = 0;
  resetSignalNotifier();
}
