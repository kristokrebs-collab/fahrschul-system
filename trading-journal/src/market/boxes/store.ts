/**
 * Live Box-zu-Box store: `useBoxes()` / `getBoxes()` / `subscribeBoxes()` / `retainBoxes()` (pattern of `../lage.ts`).
 *
 * Inputs (all from the market provider, nothing fetched here except one history page):
 * - 4h: the live `kline_4h` series (WS + REST bootstrap 499); once per provider `provider.history("kline_4h")` extends
 *   it to ~760 bars (the engine scans 700).
 * - 1D: the REST feed `kline_1d` (`DAILY_FEED`, 1000 days, hourly polls).
 * - 1W: the live `kline_1w` series (bootstrap 200).
 * Closed candles only (breakouts count on the CLOSE); the live price (`priceMv`, ≤ 1/s) only drives the `pending`
 * state, the zone and the setups' entry.
 * - Higher timeframe: 1D grades the 4h setups, 1W the 1D ones.
 * - Top-trader bias: the provider's Binance 5-min series (`getTraderSeries` → `traderReading` → `traderBiasOf`).
 * - Settings: `settings.boxes` (`boxesCfgOf`); `on: false` → nothing is computed.
 *
 * Cadence (120 Hz rule): `findBoxes` + `rsiLines` (≈ 1–6 ms per timeframe) run ONLY when a timeframe's closed-bar key
 * changes (or the engine cfg), one timeframe per idle callback; the live part (`boxState` with the cached boxes +
 * `boxSetups`, ≈ 1 ms per timeframe) at most once a second while the price moves, never while hidden. A snapshot is
 * published only when something shown changes (`boxKey` per timeframe, bias, status). The signal engine
 * (`signals/engine.ts`, `signalCfgKey`) is untouched (Option A: an independent card, not a check part).
 */
import { startTransition, useEffect, useState } from "react";
import {
  BOX_TFS,
  BOX_TF_MS,
  boxesCfgKey,
  boxesCfgOf,
  boxIdOf,
  boxKey,
  boxSetups,
  boxState,
  DEFAULT_BOXES_CFG,
  DEFAULT_RSI_LINE_CFG,
  findBoxes,
  gradePasses,
  HTF_OF,
  rsiLines,
  traderBiasOf,
  type Box,
  type BoxAnalysis,
  type BoxesCfg,
  type BoxSetup,
  type BoxState,
  type BoxTf,
  type RsiLineState,
  type TraderBias,
} from "@/domain/boxes";
import { traderReading } from "@/domain/signals/traders";
import type { Bar } from "@/domain/signals/indicators";
import { useJournal } from "@/store/journalStore";
import { DAILY_FEED } from "../feeds";
import { getFeed, getProvider, subscribeFeed, useProvider } from "../marketStore";
import { priceMv } from "../motionValues";
import type { MarketProvider } from "../provider";
import { getTraderSeries, subscribeTraderSeries } from "../traders";
import type { Candle, KlineFeed } from "../types";

/** Feed of each box timeframe. */
export const BOX_FEED: Readonly<Record<BoxTf, KlineFeed>> = { "4h": "kline_4h", "1d": DAILY_FEED, "1w": "kline_1w" };
/** Closed bars handed to the engine at most (the 1D feed holds 1000; the engine scans `lookback` 700 of them). */
export const BOX_MAX_BARS = 1000;
/** 4h bars the store asks the provider's history for once (700 scanned + ATR / RSI lead-in). */
export const BOX_HISTORY_4H = 760;
/** The setups need this many closed bars (`analyzeBoxes`). */
export const BOX_MIN_BARS = 60;
/** Live price → live part at most this often. */
export const BOX_LIVE_MS = 1000;

export type BoxesState = "off" | "idle" | "loading" | "ok" | "error";

export interface BoxTfView {
  tf: BoxTf;
  /** analysis of the closed bars + the live price; `null` while there are too few bars */
  analysis: BoxAnalysis | null;
  /** closed bars analysed */
  bars: number;
  /** open time (ms) of the newest closed bar */
  closedAt: number | null;
  /** close time (ms, exchange clock) of the forming bar: the candle-close countdown */
  closesAt: number | null;
  /** stable id of the newest box (`boxIdOf`) */
  boxId: string | null;
  key: string;
}

export interface BestSetup {
  /** `${tf}:${boxId}:${side}:${kind}` – stable while the setup lives */
  id: string;
  tf: BoxTf;
  setup: BoxSetup;
  analysis: BoxAnalysis;
}

export interface BoxesView {
  state: BoxesState;
  /** German status line while not ok (`Lade Kerzen …`, `Zu wenig 4h-Kerzen`, `Box-zu-Box ist aus`) */
  detail: string | null;
  symbol: string | null;
  cfg: BoxesCfg;
  bias: TraderBias;
  tfs: Readonly<Record<BoxTf, BoxTfView>>;
  /** setups passing `cfg.minGrade` (A+ / A, never a mere preparation) across the timeframes, best first */
  best: readonly BestSetup[];
}

export const BOXES_STRINGS = {
  off: "Box-zu-Box ist aus (Einstellungen auf dieser Seite).",
  noProvider: "Kein Marktdaten-Anbieter aktiv.",
  loading: "Lade Kerzen …",
  few: (tf: string) => `Zu wenig ${tf}-Kerzen für Boxen.`,
  offline: "Offline – keine Kerzen.",
} as const;

interface TfCtl {
  key: string;
  bars: Bar[];
  /** forming bar's close time (ms) */
  closesAt: number | null;
  /** last price of the forming bar (stands in without a live price) */
  forming: number | null;
  /** `${key}#${cfgKey}` the cached base belongs to; "" = stale */
  baseKey: string;
  boxes: Box[];
  rsi: RsiLineState | null;
  view: BoxTfView;
}

interface Ctl {
  refs: number;
  provider: MarketProvider | null;
  offs: Array<() => void>;
  offSettings: (() => void) | null;
  settingsRaw: unknown;
  cfg: BoxesCfg;
  cfgKey: string;
  bias: TraderBias;
  tf: Record<BoxTf, TfCtl>;
  /** provider the 4h history was requested for */
  historyFor: MarketProvider | null;
  /** the 4h history page (the provider's ring keeps only ~600 bars; its older part is kept here) */
  older4h: readonly Candle[];
  idle: (() => void) | null;
  liveTimer: ReturnType<typeof setTimeout> | null;
  lastLive: number;
  view: BoxesView;
  viewKey: string;
  /** base computations (tests: recompute only on a closed-key change) */
  baseRuns: number;
}

const emptyTfView = (tf: BoxTf): BoxTfView => ({ tf, analysis: null, bars: 0, closedAt: null, closesAt: null, boxId: null, key: "∅" });
const emptyTf = (tf: BoxTf): TfCtl => ({ key: "", bars: [], closesAt: null, forming: null, baseKey: "", boxes: [], rsi: null, view: emptyTfView(tf) });
const EMPTY_TFS = (): Record<BoxTf, BoxTfView> => ({ "4h": emptyTfView("4h"), "1d": emptyTfView("1d"), "1w": emptyTfView("1w") });
const IDLE_VIEW: BoxesView = { state: "idle", detail: null, symbol: null, cfg: DEFAULT_BOXES_CFG, bias: null, tfs: EMPTY_TFS(), best: [] };

const listeners = new Set<() => void>();
const fresh = (): Ctl => ({
  refs: 0,
  provider: null,
  offs: [],
  offSettings: null,
  settingsRaw: undefined,
  cfg: DEFAULT_BOXES_CFG,
  cfgKey: boxesCfgKey(DEFAULT_BOXES_CFG),
  bias: null,
  tf: { "4h": emptyTf("4h"), "1d": emptyTf("1d"), "1w": emptyTf("1w") },
  historyFor: null,
  older4h: [],
  idle: null,
  liveTimer: null,
  lastLive: 0,
  view: IDLE_VIEW,
  viewKey: "",
  baseRuns: 0,
});
const ctl: Ctl = fresh();

const hidden = (): boolean => typeof document !== "undefined" && document.hidden === true;
const offline = (): boolean => typeof navigator !== "undefined" && navigator.onLine === false;
const serverNow = (): number => ctl.provider?.serverNow?.() ?? Date.now();
const toBar = (c: Candle): Bar => ({ t: c.time / 1000, o: c.open, h: c.high, l: c.low, c: c.close, v: c.volume });
const settingsBoxes = (s: unknown): unknown => (s && typeof s === "object" ? (s as { boxes?: unknown }).boxes : undefined);

/** Order of evaluation: the higher timeframe first (it grades the lower one). */
const EVAL_ORDER: readonly BoxTf[] = ["1w", "1d", "4h"];

// ------------------------------------------------------------------ scheduling (idle chunks)

type IdleWin = Window & { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number; cancelIdleCallback?: (id: number) => void };

/** One task in an idle period (≤ 1 s late), else a plain timer. Returns the cancel. */
function onIdle(cb: () => void): () => void {
  const w = typeof window !== "undefined" ? (window as IdleWin) : null;
  if (w?.requestIdleCallback && w.cancelIdleCallback) {
    const id = w.requestIdleCallback(cb, { timeout: 1000 });
    return () => w.cancelIdleCallback?.(id);
  }
  const t = setTimeout(cb, 16);
  return () => clearTimeout(t);
}

function schedule(): void {
  if (ctl.idle || ctl.refs === 0) return;
  ctl.idle = onIdle(() => {
    ctl.idle = null;
    step();
  });
}

/** One base per idle callback (the expensive part), then the live part of every timeframe and a publish. */
function step(): void {
  if (ctl.refs === 0) return;
  if (!ctl.cfg.on) return publish();
  const stale = EVAL_ORDER.find((tf) => {
    const t = ctl.tf[tf];
    return t.bars.length >= BOX_MIN_BARS && t.baseKey !== `${t.key}#${ctl.cfgKey}`;
  });
  if (stale) {
    runBase(stale);
    schedule();
    return;
  }
  runLive();
}

function runBase(tf: BoxTf): void {
  const t = ctl.tf[tf];
  ctl.baseRuns += 1;
  t.boxes = findBoxes(t.bars, ctl.cfg.box);
  t.rsi = rsiLines(t.bars, DEFAULT_RSI_LINE_CFG);
  t.baseKey = `${t.key}#${ctl.cfgKey}`;
}

// ------------------------------------------------------------------ live part + publish

function livePrice(tf: BoxTf): number | undefined {
  const p = priceMv.get();
  if (Number.isFinite(p) && p > 0) return p;
  const f = ctl.tf[tf].forming;
  return f != null && f > 0 ? f : undefined;
}

function readBias(): TraderBias {
  const s = getTraderSeries();
  if (!s) return null;
  return traderBiasOf(traderReading(s, {}, s.now));
}

function runLive(): void {
  ctl.lastLive = Date.now();
  ctl.bias = readBias();
  const states: Partial<Record<BoxTf, BoxState>> = {};
  for (const tf of EVAL_ORDER) {
    const t = ctl.tf[tf];
    if (t.bars.length < BOX_MIN_BARS || t.baseKey === "") {
      t.view = { ...emptyTfView(tf), bars: t.bars.length, closedAt: t.bars.length ? t.bars[t.bars.length - 1]!.t * 1000 : null, closesAt: t.closesAt };
      continue;
    }
    const box = boxState(t.bars, ctl.cfg.box, livePrice(tf), t.boxes);
    states[tf] = box;
    const h = HTF_OF[tf];
    const hs = h ? (states[h] ?? null) : null;
    const setups = boxSetups(box, t.rsi, ctl.bias, hs);
    const analysis: BoxAnalysis = {
      tf,
      at: t.bars[t.bars.length - 1]!.t,
      box,
      rsi: t.rsi,
      setups,
      best: setups[0] ?? null,
      htf: h && hs ? { tf: h, phase: hs.phase, dir: hs.dir, pos: hs.pos } : null,
    };
    const key = boxKey(analysis);
    // keep the old object while nothing shown changed: consumers compare identities
    if (key !== t.view.key || t.view.closesAt !== t.closesAt) {
      t.view = { tf, analysis, bars: t.bars.length, closedAt: analysis.at * 1000, closesAt: t.closesAt, boxId: boxIdOf(tf, box.box), key };
    }
  }
  publish();
}

function bestOf(): BestSetup[] {
  const out: BestSetup[] = [];
  for (const tf of BOX_TFS) {
    const v = ctl.tf[tf].view;
    const a = v.analysis;
    if (!a) continue;
    for (const s of a.setups) if (s.best && gradePasses(s.grade, ctl.cfg.minGrade)) out.push({ id: `${tf}:${v.boxId ?? "-"}:${s.side}:${s.kind}`, tf, setup: s, analysis: a });
  }
  return out.sort((x, y) => y.setup.score - x.setup.score || (y.setup.rr ?? 0) - (x.setup.rr ?? 0));
}

function statusOf(): { state: BoxesState; detail: string | null } {
  if (!ctl.cfg.on) return { state: "off", detail: BOXES_STRINGS.off };
  const p = ctl.provider;
  if (!p) return { state: "idle", detail: BOXES_STRINGS.noProvider };
  if (BOX_TFS.some((tf) => ctl.tf[tf].view.analysis)) return { state: "ok", detail: null };
  if (offline()) return { state: "error", detail: BOXES_STRINGS.offline };
  const h = p.getHealth?.().feeds?.[BOX_FEED["4h"]];
  const n4 = ctl.tf["4h"].bars.length;
  if (h && (h.state === "offline" || h.consecutiveFailures >= 3) && n4 === 0) return { state: "error", detail: BOXES_STRINGS.offline };
  if (n4 > 0 && n4 < BOX_MIN_BARS && ctl.historyFor === p) return { state: "loading", detail: BOXES_STRINGS.few("4h") };
  return { state: "loading", detail: BOXES_STRINGS.loading };
}

function publish(): void {
  const st = statusOf();
  const tfs = { "4h": ctl.tf["4h"].view, "1d": ctl.tf["1d"].view, "1w": ctl.tf["1w"].view };
  const symbol = ctl.provider?.symbol ?? null;
  const key = `${st.state}|${st.detail}|${symbol}|${ctl.cfgKey}|${ctl.bias}|${BOX_TFS.map((tf) => `${tfs[tf].key}@${tfs[tf].closesAt}`).join("#")}`;
  if (key === ctl.viewKey) return;
  ctl.viewKey = key;
  ctl.view = { ...st, symbol, cfg: ctl.cfg, bias: ctl.bias, tfs, best: ctl.cfg.on ? bestOf() : [] };
  for (const l of [...listeners]) l();
}

// ------------------------------------------------------------------ series

/** Identity of the CLOSED part of a series (the forming candle is left out), computed without copying. */
export function closedKeyOf(data: readonly Candle[]): { n: number; key: string } {
  const n = data.length > 0 && !data[data.length - 1]!.closed ? data.length - 1 : data.length;
  const lc = data[n - 1];
  return { n, key: lc ? `${n}:${lc.time}:${lc.close}:${lc.high}:${lc.low}:${data[0]!.time}` : "0" };
}

/** The bars of `older` that lie before `first` (the history page's part the provider's ring no longer holds). */
function olderThan(older: readonly Candle[], first: number | undefined): readonly Candle[] {
  if (!older.length || first === undefined) return [];
  let n = 0;
  while (n < older.length && older[n]!.time < first) n++;
  return older.slice(0, n);
}

/** Re-reads the three series; true when a closed bar changed somewhere. */
function readSeries(): boolean {
  let changed = false;
  for (const tf of BOX_TFS) {
    const t = ctl.tf[tf];
    const data = (getFeed(BOX_FEED[tf])?.data ?? []) as Candle[];
    const last = data[data.length - 1];
    t.forming = last && !last.closed ? last.close : null;
    t.closesAt = last ? (last.closed ? last.time + 2 * BOX_TF_MS[tf] : last.time + BOX_TF_MS[tf]) : null;
    const k = closedKeyOf(data);
    // the provider's 4h ring keeps ~600 bars: the history page's older bars are kept here and put in front
    const older = tf === "4h" ? ctl.older4h : [];
    const key = older.length ? `${k.key}+${older.length}:${older[0]!.time}` : k.key;
    if (key === t.key) continue;
    t.key = key;
    const head = olderThan(older, data[0]?.time);
    const closed = head.length ? [...head, ...data.slice(0, k.n)] : data.slice(0, k.n);
    t.bars = closed.slice(Math.max(0, closed.length - BOX_MAX_BARS)).map(toBar);
    changed = true;
  }
  return changed;
}

/** A feed published (≤ 1 per frame while the socket streams): work only when a CLOSED bar changed. */
function onSeries(): void {
  syncProvider();
  if (readSeries()) schedule();
}

function onPrice(): void {
  if (ctl.liveTimer || hidden() || ctl.refs === 0 || !ctl.cfg.on) return;
  const wait = Math.max(0, ctl.lastLive + BOX_LIVE_MS - Date.now());
  ctl.liveTimer = setTimeout(() => {
    ctl.liveTimer = null;
    schedule();
  }, wait);
}

/** Once per provider: extend the 4h series to `BOX_HISTORY_4H` bars (failures retry on the next visibility / swap). */
function requestHistory(p: MarketProvider): void {
  if (ctl.historyFor === p || typeof p.history !== "function") return;
  const have = getFeed(BOX_FEED["4h"])?.data.length ?? 0;
  ctl.historyFor = p;
  if (have >= BOX_HISTORY_4H - 10) return;
  const now = serverNow();
  p.history(BOX_FEED["4h"], { from: now - BOX_HISTORY_4H * BOX_TF_MS["4h"], to: now })
    .then((res) => {
      if (ctl.provider !== p) return;
      ctl.older4h = res.data.filter((c) => c.closed !== false);
      if (readSeries()) schedule();
    })
    .catch(() => {
      if (ctl.historyFor === p) ctl.historyFor = null;
    });
}

// ------------------------------------------------------------------ lifecycle

function applySettings(raw: unknown): void {
  ctl.settingsRaw = raw;
  const cfg = boxesCfgOf(raw);
  const key = boxesCfgKey(cfg);
  if (key === ctl.cfgKey) return;
  ctl.cfg = cfg;
  ctl.cfgKey = key;
  if (cfg.on && ctl.provider && ctl.refs > 0) requestHistory(ctl.provider);
  schedule();
  if (!cfg.on) publish();
}

/** Follows the market provider (symbol switch: everything starts over). */
function syncProvider(): void {
  const p = getProvider();
  if (p === ctl.provider) return;
  ctl.provider = p;
  for (const tf of BOX_TFS) ctl.tf[tf] = emptyTf(tf);
  ctl.historyFor = null;
  ctl.older4h = [];
  if (p && ctl.refs > 0 && ctl.cfg.on) requestHistory(p);
  readSeries();
  schedule();
  publish();
}

function onVisible(): void {
  if (hidden() || ctl.refs === 0) return;
  syncProvider();
  if (ctl.provider && ctl.cfg.on) requestHistory(ctl.provider);
  readSeries();
  schedule();
}

function start(): void {
  const onVis = (): void => onVisible();
  const onNet = (): void => publish();
  if (typeof document !== "undefined") document.addEventListener("visibilitychange", onVis);
  if (typeof window !== "undefined") {
    window.addEventListener("online", onNet);
    window.addEventListener("offline", onNet);
  }
  applySettings(settingsBoxes(useJournal.getState().settings));
  ctl.offSettings = useJournal.subscribe((s) => {
    const raw = settingsBoxes(s.settings);
    if (raw !== ctl.settingsRaw) applySettings(raw);
  });
  ctl.offs = [
    ...BOX_TFS.map((tf) => subscribeFeed(BOX_FEED[tf], onSeries)),
    subscribeTraderSeries(() => schedule()),
    priceMv.on("change", onPrice),
    () => {
      if (typeof document !== "undefined") document.removeEventListener("visibilitychange", onVis);
      if (typeof window !== "undefined") {
        window.removeEventListener("online", onNet);
        window.removeEventListener("offline", onNet);
      }
    },
  ];
  // the same provider as before a release (a keep-alive page shown again): keep the bars, boxes and the 4h history page –
  // no recompute, no second history request; a new provider starts over
  const prev = ctl.provider;
  syncProvider();
  if (ctl.provider === prev) {
    if (prev && ctl.cfg.on) requestHistory(prev);
    readSeries();
    schedule();
    publish();
  }
}

function stop(): void {
  for (const off of ctl.offs) off();
  ctl.offs = [];
  ctl.offSettings?.();
  ctl.offSettings = null;
  ctl.idle?.();
  ctl.idle = null;
  if (ctl.liveTimer) clearTimeout(ctl.liveTimer);
  ctl.liveTimer = null;
}

/** Keeps the boxes running (ref-counted); returns an idempotent release. */
export function retainBoxes(): () => void {
  ctl.refs += 1;
  if (ctl.refs === 1) start();
  let released = false;
  return () => {
    if (released) return;
    released = true;
    ctl.refs -= 1;
    if (ctl.refs === 0) stop();
  };
}

/** Current boxes (stable object until something shown changes). */
export function getBoxes(): BoxesView {
  return ctl.view;
}

/** Listener on published changes (bar closes, ≤ 1/s from the price, status). */
export function subscribeBoxes(cb: () => void): () => void {
  listeners.add(cb);
  return () => void listeners.delete(cb);
}

/**
 * React: the live boxes. A publish arrives as a transition (the card trees re-render in slices between frames, never
 * inside the store's own task); re-renders only when something shown changes. `enabled: false` (an off layer) neither
 * retains nor subscribes – nothing is computed for it.
 */
export function useBoxes(opts: { enabled?: boolean } = {}): BoxesView {
  const enabled = opts.enabled !== false;
  const provider = useProvider();
  const [view, setView] = useState(getBoxes);
  useEffect(() => {
    if (!enabled) return;
    const release = retainBoxes();
    const sync = () => startTransition(() => setView(getBoxes()));
    sync();
    const off = subscribeBoxes(sync);
    return () => {
      off();
      release();
    };
  }, [enabled]);
  // a symbol switch replaces the provider: follow it at once
  useEffect(() => {
    if (ctl.refs > 0) syncProvider();
  }, [provider]);
  return view;
}

/** Closed bars a timeframe analysed (chart / tests); empty while not running. */
export function getBoxBars(tf: BoxTf): readonly Bar[] {
  return ctl.tf[tf].bars;
}

/** Tests: counters of the expensive part. */
export function __boxStats(): { baseRuns: number; refs: number } {
  return { baseRuns: ctl.baseRuns, refs: ctl.refs };
}

/** Tests: forget everything (listeners registered by their owners stay cleared). */
export function __resetBoxes(): void {
  stop();
  Object.assign(ctl, fresh());
  listeners.clear();
}
