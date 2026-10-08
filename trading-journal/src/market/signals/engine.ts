/**
 * Live "Einstiegs-Check": the pure engine (`@/domain/signals`) fed from the market provider.
 *
 * - Inputs: `kline_15m` (→ 30m, 45m), `kline_1h` (→ 1h, 2h, 3h), `kline_4h`, plus a lazily polled REST `1d` series
 *   when a ladder uses `1D`. The running candle of every rung is completed with the live price (`priceMv`, like the
 *   other journal's `withLivePrice`).
 * - Cadence (120 Hz rule): never in render, never per WS frame. A data change only sets a dirty flag; one timer
 *   evaluates at most once per second (every 5 s in a hidden tab) and sleeps while nothing changes.
 * - Frames on 1m closes (tv-check 2026-10-08, proposal 3): the running candles are completed with the price taken at
 *   the last minute boundary (`SIGNAL_FRAME_MS` + `SIGNAL_FRAME_GRACE_MS`), and the check is recomputed only when a
 *   new frame starts or the CLOSED history, the Top-Trader series or the config change — a rung's vorläufig state can
 *   no longer flicker with every tick (30m "Kreuz" on at 13:30, off at 13:31 on a one-minute-old candle). The
 *   countdowns run on the clock, unaffected. Per frame the engine also remembers forming-candle events that came and
 *   went (`intrabar`, shown greyed, never counted) and the turn price of every forming rung (`turns`, `wtTurn`).
 * - Top-Trader-Kombi: the provider's 5-min ratio twins (`traders.ts`), graded inside the same evaluation.
 * - Output: a `SignalCheckState` that changes identity only when the rounded result changes (score, strength,
 *   labels, events, candle-close states, parts, knife filter, wt1/RSI to 0.1, zone position to 0.01, status) —
 *   React subscribers re-render only then. Countdowns are NOT part of it: render them from `closesAt` on a clock.
 */
import {
  DEFAULT_SIGNAL_CFG,
  computeSignals,
  divCfgOf,
  EMPTY_INTRABAR,
  eventState,
  isForming,
  isLongKind,
  luxZone,
  marketStructure,
  noteIntrabar,
  rsi,
  sanitizeSignalCfg,
  signalCfgKey,
  srCfgOf,
  strongClosesOf,
  tfDivergences,
  waveTrend,
  withLivePrice,
  wtTurn,
  tfSeconds,
  mcbSeries,
  toSignalSnapshot,
  type Bar,
  type DivKind,
  type DivOsc,
  type IntrabarMemo,
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
  type WtTurn,
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
  /** live price used to complete the running candles (the frame's price, taken at the last 1m close), `null` when none was fresh */
  price: number | null;
  /** ms of the 1m close the frame stands for (`null` on hand-built input): the provisional states are read there */
  frameAt?: number | null;
  /** MCB turn price per ladder timeframe while its last bar forms (`wtTurn`: the close at which wt1 crosses wt2), else `null` */
  turns?: Readonly<Record<string, WtTurn | null>>;
  /** forming-candle events seen earlier on the current candles and gone now (`noteIntrabar`; shown greyed, never counted) */
  intrabar?: IntrabarMemo;
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
/** The provisional states are read on 1m closes: one frame per minute (exchange clock). */
export const SIGNAL_FRAME_MS = 60_000;
/** A frame is taken this long after the minute boundary (the closing kline update arrives ~250 ms after it). */
export const SIGNAL_FRAME_GRACE_MS = 1000;
/** A frame that starts within this long after its boundary stands for the minute that just closed. */
const FRAME_BOUNDARY_SLACK_MS = 5000;
/** Bar length of the kline feeds (closed-history key). */
const FEED_MS: Readonly<Record<string, number>> = { kline_1m: 60_000, kline_15m: 900_000, kline_1h: 3_600_000, kline_4h: 14_400_000, kline_1w: 604_800_000 };
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
  /** the current frame: index (minute on the exchange clock, after the grace), its price, the minute it stands for */
  frame: Frame | null;
  frameTimer: ReturnType<typeof setTimeout> | null;
  intrabar: IntrabarMemo;
}

interface Frame {
  index: number;
  price: { price: number; at: number } | null;
  /** ms of the 1m close the frame stands for (labels of the intrabar memory) */
  at: number;
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
  frame: null,
  frameTimer: null,
  intrabar: EMPTY_INTRABAR,
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

/**
 * Offset (ms) of the exchange clock from the device clock (`serverNow() − Date.now()`; 0 without an estimate). Candle
 * open / close times are Binance times, so whether a candle is still forming is decided on that clock: a tablet whose
 * clock runs minutes ahead would otherwise treat the running candle as closed (and confirm its signals early).
 */
function skewOf(p: MarketProvider): number {
  if (typeof p.serverNow !== "function") return 0;
  const d = p.serverNow() - Date.now();
  return Number.isFinite(d) ? d : 0;
}

/**
 * Offset to add to the device clock for countdowns to the engine's `closesAt` times (`closesAt − (now + offset)`),
 * the live provider's applied clock skew (`health.clockSkewMs`); 0 without a provider.
 */
export function signalClockOffset(): number {
  return eng.provider ? skewOf(eng.provider) : 0;
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

/**
 * Key of the CLOSED history of a kline series at `ex` (exchange ms): length, first time and the identities of the two
 * newest closed candles (the feeds keep the prefix objects and replace a corrected one). The forming candle — the one
 * whose bucket holds `ex` — is left out: its ticks never trigger a recompute; the frame does.
 */
function closedKeyOf(cs: readonly Candle[], ex: number, ms: number): string {
  const n = cs.length;
  if (!n) return "0";
  const end = cs[n - 1]!.time + ms > ex ? n - 1 : n;
  const a = cs[end - 1];
  const b = cs[end - 2];
  return `${n}:${cs[0]!.time}:${a ? objectId(a) : 0}:${b ? objectId(b) : 0}`;
}

/** Inputs of an evaluation: config, frame (index + price), closed history per feed, daily series, Top-Trader series. */
function inputKeyOf(p: MarketProvider, cfg: SignalCfg, frame: Frame, ex: number): string {
  const ids: string[] = [eng.cfgKey, `f${frame.index}:${frame.price?.price ?? ""}`];
  for (const f of liveFeeds(cfg)) {
    const v = p.get(f) as Stamped<Candle[]> | undefined;
    ids.push(`${f}:${v ? closedKeyOf(v.data, ex, FEED_MS[f] ?? 60_000) : 0}`);
  }
  if (needsDaily(cfg)) ids.push(`d:${objectId(eng.daily.candles)}`);
  ids.push(tradersInputKey(p, cfg));
  return ids.join("|");
}

/**
 * The frame at `now` (device ms): a new one per minute on the exchange clock (after the grace), with the live price
 * of that moment; a frame without a price takes one as soon as it is fresh.
 */
function frameAt(now: number, skew: number): Frame {
  const ex = now + skew;
  const index = Math.floor((ex - SIGNAL_FRAME_GRACE_MS) / SIGNAL_FRAME_MS);
  const cur = eng.frame;
  if (cur && cur.index === index && cur.price) return cur;
  const price = livePrice(now);
  if (cur && cur.index === index && !price) return cur;
  // taken right after its boundary → it stands for the minute that just closed (its close ≈ this price)
  const sinceBoundary = ex - (index * SIGNAL_FRAME_MS + SIGNAL_FRAME_GRACE_MS);
  const at = cur && cur.index === index ? cur.at : sinceBoundary < FRAME_BOUNDARY_SLACK_MS ? index * SIGNAL_FRAME_MS - 1 : ex;
  return (eng.frame = { index, price, at });
}

/** Turn price of every ladder rung whose last bar forms (`null` for a closed or missing rung). */
function turnsOf(bars: Readonly<Record<string, readonly Bar[]>>, s: Signals, cfg: SignalCfg): Record<string, WtTurn | null> {
  const out: Record<string, WtTurn | null> = {};
  for (const c of s.checks) if (c) out[c.tf] = c.forming && bars[c.tf] ? wtTurn(bars[c.tf]!, cfg) : null;
  return out;
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
  // live extras: turn prices (to the dollar) and the intrabar memory
  const live = s as Partial<LiveSignals>;
  if (live.turns) parts.push(`tp:${Object.entries(live.turns).map(([tf, t]) => (t ? `${tf}${Math.round(t.price)}${t.above ? "a" : "b"}${t.up ? "u" : ""}${t.down ? "d" : ""}${r1(t.level)}` : `${tf}-`)).join(",")}`);
  if (live.intrabar) {
    const ib: string[] = [];
    for (const [tf, m] of Object.entries(live.intrabar)) for (const [side, x] of Object.entries(m)) if (x) ib.push(`${tf}${side}${x.kind}${x.bar}:${x.first}-${x.last}`);
    parts.push(`ib:${ib.join(",")}`);
  }
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
  const skew = skewOf(p);
  const frame = frameAt(now, skew);
  const price = frame.price;
  const key = inputKeyOf(p, cfg, frame, now + skew);
  let snap = eng.current.snapshot;
  let updatedAt = eng.current.updatedAt;
  if (key !== eng.inputKey || !snap) {
    eng.inputKey = key;
    stats.computes++;
    const bars = buildBars(p, cfg, price);
    // candle-close states on the exchange clock (Binance candle times); the Top-Trader-Kombi from the provider's
    // 5-min series (Binance clock)
    const s = computeSignals(bars, cfg, now + skew, { traders: liveTraders(p, cfg) });
    if (s) {
      eng.intrabar = noteIntrabar(eng.intrabar, s.checks, frame.at, price?.price ?? null);
      const live: LiveSignals = {
        ...s,
        symbol: p.symbol,
        source: p.getHealth().feeds[liveFeeds(cfg)[0] ?? "kline_1h"].source,
        cfg,
        price: price?.price ?? null,
        frameAt: frame.at,
        turns: turnsOf(bars, s, cfg),
        intrabar: eng.intrabar,
      };
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

/** Wakes the engine at the next frame (1m close on the exchange clock + grace) while a provider is attached. */
function armFrame(): void {
  if (eng.frameTimer) clearTimeout(eng.frameTimer);
  eng.frameTimer = null;
  const p = eng.provider;
  if (!p) return;
  const ex = Date.now() + skewOf(p);
  const next = (Math.floor((ex - SIGNAL_FRAME_GRACE_MS) / SIGNAL_FRAME_MS) + 1) * SIGNAL_FRAME_MS + SIGNAL_FRAME_GRACE_MS;
  eng.frameTimer = setTimeout(
    () => {
      eng.frameTimer = null;
      schedule();
      armFrame();
    },
    Math.max(0, next - ex),
  );
}

/** A price tick matters only while the current frame has no price (between frames the price is the frame's). */
function onPrice(): void {
  if (!eng.frame?.price) schedule();
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
  eng.offs.push(priceMv.on("change", onPrice));
}

/** Binds the engine to a (started) provider; called by `startMarket`. */
export function attachSignalEngine(p: MarketProvider): void {
  if (eng.provider === p) return;
  detachSignalEngine();
  eng.provider = p;
  subscribeInputs(p);
  if (needsDaily(eng.cfg)) pollDaily();
  schedule();
  armFrame();
}

/** Releases the provider (symbol change, `stopMarket`); the last state is replaced by `loading`. */
export function detachSignalEngine(): void {
  for (const off of eng.offs) off();
  eng.offs = [];
  if (eng.timer) clearTimeout(eng.timer);
  eng.timer = null;
  if (eng.frameTimer) clearTimeout(eng.frameTimer);
  eng.frameTimer = null;
  eng.frame = null;
  eng.intrabar = EMPTY_INTRABAR;
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
  const device = Date.now();
  // the check's frame price (the last 1m close), so the chart's forming-candle markers equal the check's states
  const f = eng.frame;
  const index = Math.floor((device + skewOf(p) - SIGNAL_FRAME_GRACE_MS) / SIGNAL_FRAME_MS);
  const price = f?.price && index - f.index <= LIVE_PRICE_MAX_AGE_MS / SIGNAL_FRAME_MS ? f.price : livePrice(device);
  const bars = buildBars(p, { ...cfg, ladder: [interval], zoneTf: interval }, price, n)[interval] ?? [];
  // `now` decides the forming candle: exchange clock, like the check
  return bars.length ? { bars, cfg, now: device + skewOf(p) } : null;
}

/**
 * Per-bar MCB events of one timeframe for chart markers (`30m`, `45m`, `1h`, `2h`, `3h`, `4h`, `1D`), computed from
 * the same bars and window as the check (running candle completed with the live price). `minor` adds the small
 * `bull`/`bear` crosses; `bars` widens the window (as far as the loaded history reaches). Empty without data.
 */
export function getMcbSeries(interval: string, opts: { minor?: boolean; bars?: number } = {}): McbMarker[] {
  const d = chartBars(interval, opts.bars);
  return d ? mcbOf(d, interval, opts.minor) : [];
}

type ChartBars = NonNullable<ReturnType<typeof chartBars>>;

function mcbOf(d: ChartBars, interval: string, minor?: boolean): McbMarker[] {
  const { bars, cfg, now } = d;
  const forming = isForming(bars, interval, now);
  const strong = strongClosesOf(cfg);
  const lastT = bars[bars.length - 1]!.t;
  const index = new Map<number, number>();
  bars.forEach((b, i) => index.set(b.t, i));
  return mcbSeries(bars, cfg, { minor }).map((m) => ({
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
  return d ? divergencesOf(d, interval, opts.recent) : [];
}

function divergencesOf(d: ChartBars, interval: string, recent?: number): ChartDivergence[] {
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
    .filter((x) => recent === undefined || x.barsAgo <= recent)
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
  return d ? structureOf(d) : null;
}

function structureOf(d: ChartBars): ChartStructure | null {
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

/** The chart's check overlay of one timeframe: the layers asked for, all from ONE build of the bars. */
export interface ChartOverlayData {
  mcb: McbMarker[];
  div: ChartDivergence[];
  structure: ChartStructure | null;
}

/**
 * `getMcbSeries` + `getDivergences` + `getStructure` of one timeframe from a single build of its bars (one resample
 * instead of three); a layer that is not asked for stays empty / `null`.
 */
export function getChartOverlay(interval: string, opts: { bars?: number; mcb?: boolean; div?: boolean; structure?: boolean } = {}): ChartOverlayData {
  const none: ChartOverlayData = { mcb: [], div: [], structure: null };
  if (!opts.mcb && !opts.div && !opts.structure) return none;
  const d = chartBars(interval, opts.bars);
  if (!d) return none;
  return { mcb: opts.mcb ? mcbOf(d, interval) : [], div: opts.div ? divergencesOf(d, interval) : [], structure: opts.structure ? structureOf(d) : null };
}

/**
 * Candles of a signal timeframe (e.g. `30m` / `45m` built from 15m) for a chart: `time` in ms, `closed` when the
 * bucket has ended. `bars` limits the count (default `SIGNAL_BARS`).
 */
export function getSignalCandles(interval: string, opts: { bars?: number } = {}): Candle[] {
  const p = eng.provider;
  if (!p || !tfSource(interval)) return [];
  const now = Date.now() + skewOf(p); // exchange clock: the `closed` flag of the running candle
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
