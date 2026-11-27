/**
 * Watchlist scanner ("trade the best"): the Box-zu-Box analysis for every symbol of `settings.boxes.watchlist`
 * (Binance USDT perpetuals, default ~10), listing ONLY the setups that pass the minimum grade (A+ / A), best score
 * first. `useScan()` / `getScan()` / `subscribeScan()` / `retainScanner()` / `scanNow()`.
 *
 * - Data: per symbol one 4h page (499 bars, weight 2) and one 1D page (300 bars, weight 2) from `binanceRest().klines`,
 *   plus one 1W page (200 bars, weight 2) once per closed week (reused from the cache until a new week closed). The
 *   owner's rule is support / resistance on 4h / 1D / 1W: the 1D boxes grade the 4h setups, the 1W boxes grade the 1D
 *   setups (exactly like the Markt page – Review MM-8: a 1D setup the weekly box speaks against is no "Scanner: A+"),
 *   and 1W setups are listed too (Review F16). Without a weekly page yet (an old cache) the 1D series aggregated to
 *   Monday weeks stands in as the 1D's higher timeframe. Closed bars only. No top-trader read for other symbols (the
 *   reason stays open – never invented).
 * - Cadence: once on start (from the cache when it is current), then after every 4h close (UTC) plus a 20–80 s jitter;
 *   `scanNow()` on demand. Nothing runs while no one retains it or the tab is hidden (an overdue scan runs on return).
 * - Budget: its OWN token bucket, ≤ 20 weight per minute, separate from the provider's buckets (the live feeds never
 *   wait for the scanner); a full default scan takes ~2 minutes.
 * - Route: direct Binance; a 451 / CORS / network failure switches the rest of the session to the same-origin proxy
 *   (`/api/binance`), except in the file build (no proxy) – then the honest error.
 * - Cache: the bars per symbol in IndexedDB (`tj-market`, key `${storageKey("box-scan")}:${symbol}:${tf}`), so a reload
 *   shows the last results at once.
 */
import { startTransition, useEffect, useState } from "react";
import { analyzeBoxes, boxesCfgKey, boxesCfgOf, boxState, BOX_TF_MS, DEFAULT_BOXES_CFG, gradePasses, type BoxesCfg, type BoxPhase, type BoxSetup } from "@/domain/boxes";
import { toWeekly, weekOpenS } from "@/domain/backtest/bars";
import type { Bar } from "@/domain/signals/indicators";
import { isFileProtocol, IS_FILE_BUILD } from "@/edition";
import { useJournal } from "@/store/journalStore";
import { storageKey } from "@/store/storage";
import { klineWeight, TokenBucket } from "../budget";
import { idbKV, type KVStore } from "../cache";
import { binanceRest, type BinanceRest } from "../sources/binance";
import { toRestError } from "../sources/http";
import { proxyRest } from "../sources/proxy";
import type { FetchInterval } from "../period";
import type { Candle } from "../types";

export type ScanTf = "4h" | "1d" | "1w";
export const SCAN_LIMIT: Readonly<Record<ScanTf, number>> = { "4h": 499, "1d": 300, "1w": 200 };
/** Bars a scan reads per symbol: 4h and 1D always, 1W when fetched (once per closed week). */
export type ScanBars = Record<"4h" | "1d", readonly Bar[]> & { "1w"?: readonly Bar[] };
/** The scanner's own budget: ≤ 20 Binance weight per minute. */
export const SCAN_BUDGET = { capacity: 20, windowMs: 60_000 } as const;
/** Jitter after a 4h close before the scan starts (the exchange needs a moment; many clients hit :00 exactly). */
export const SCAN_JITTER_MS: readonly [number, number] = [20_000, 80_000];
export const SCAN_CACHE_PREFIX = storageKey("box-scan");

export type ScanState = "off" | "idle" | "scanning" | "ok" | "error";

export interface ScanRow {
  /** `${symbol}:${tf}:${side}:${kind}:${box start}` */
  id: string;
  symbol: string;
  tf: ScanTf;
  setup: BoxSetup;
  phase: BoxPhase;
  /** last close (the scanner has no live price) */
  price: number;
  box: { top: number; bottom: number; grade: string } | null;
  /** open time (ms) of the newest closed bar */
  at: number;
}

export interface ScanView {
  state: ScanState;
  rows: readonly ScanRow[];
  progress: { done: number; total: number };
  lastScanAt: number | null;
  nextScanAt: number | null;
  detail: string | null;
  /** symbols whose data could not be read in the last run */
  failed: readonly string[];
  watchlist: readonly string[];
  viaProxy: boolean;
}

export const SCAN_STRINGS = {
  off: "Scanner ist aus.",
  waiting: "Wartet auf den ersten Scan …",
  scanning: (done: number, total: number) => `Scanne ${done}/${total} …`,
  blocked: "Binance nicht erreichbar (Region/CORS) – kein Proxy in der Datei-Version.",
  failedSome: (n: number) => `${n} Symbol${n === 1 ? "" : "e"} nicht lesbar.`,
  empty: "Kein Symbol der Watchlist.",
} as const;

export interface ScannerDeps {
  rest: () => BinanceRest;
  proxy: () => BinanceRest | null;
  kv: () => KVStore | null;
  now: () => number;
  random: () => number;
}

const defaultDeps = (): ScannerDeps => ({
  rest: () => binanceRest(),
  proxy: () => (IS_FILE_BUILD || isFileProtocol() ? null : proxyRest()),
  kv: () => idbKV(),
  now: () => Date.now(),
  random: () => Math.random(),
});

interface SymData {
  bars: Record<"4h" | "1d", Bar[]> & { "1w"?: Bar[] };
  fetchedAt: number;
}

interface ScanCtl {
  refs: number;
  deps: ScannerDeps;
  cfg: BoxesCfg;
  cfgKey: string;
  settingsRaw: unknown;
  offSettings: (() => void) | null;
  offVis: (() => void) | null;
  bucket: TokenBucket | null;
  viaProxy: boolean;
  data: Map<string, SymData>;
  running: Promise<void> | null;
  timer: ReturnType<typeof setTimeout> | null;
  view: ScanView;
  viewKey: string;
  hydrated: boolean;
  /** symbols that failed in the last run */
  failed: string[];
}

const IDLE: ScanView = { state: "idle", rows: [], progress: { done: 0, total: 0 }, lastScanAt: null, nextScanAt: null, detail: null, failed: [], watchlist: [], viaProxy: false };
const listeners = new Set<() => void>();
const freshCtl = (deps: ScannerDeps = defaultDeps()): ScanCtl => ({
  refs: 0,
  deps,
  cfg: DEFAULT_BOXES_CFG,
  cfgKey: boxesCfgKey(DEFAULT_BOXES_CFG),
  settingsRaw: undefined,
  offSettings: null,
  offVis: null,
  bucket: null,
  viaProxy: false,
  data: new Map(),
  running: null,
  timer: null,
  view: IDLE,
  viewKey: "",
  hydrated: false,
  failed: [],
});
const ctl: ScanCtl = freshCtl();

const hidden = (): boolean => typeof document !== "undefined" && document.hidden === true;
const toBar = (c: Candle): Bar => ({ t: c.time / 1000, o: c.open, h: c.high, l: c.low, c: c.close, v: c.volume });
const settingsBoxes = (s: unknown): unknown => (s && typeof s === "object" ? (s as { boxes?: unknown }).boxes : undefined);
const cacheKeyOf = (symbol: string, tf: ScanTf): string => `${SCAN_CACHE_PREFIX}:${symbol}:${tf}`;

/** Open time of the newest bar of `tf` that has closed at `now` (weeks open Monday 00:00 UTC, like Binance's). */
export function lastClosedOpen(now: number, tf: ScanTf = "4h"): number {
  const iv = BOX_TF_MS[tf];
  if (tf === "1w") return weekOpenS(Math.floor(now / 1000)) * 1000 - iv;
  return Math.floor(now / iv) * iv - iv;
}

/** When the next scan is due: the next 4h close plus the jitter. */
export function nextScanAt(now: number, random: () => number): number {
  const iv = BOX_TF_MS["4h"];
  const [lo, hi] = SCAN_JITTER_MS;
  return Math.floor(now / iv) * iv + iv + lo + Math.round(random() * (hi - lo));
}

/** Weekly bars the 1W analysis needs at least (findBoxes needs ~30; fewer → no weekly context). */
const MIN_WEEKS = 30;

/**
 * Setups of one symbol that pass the grade (pure: closed 4h + 1D bars, 1W when given). Each timeframe is graded with the
 * next higher one, as on the Markt page: 4h with 1D, 1D with 1W (the given weekly page, else 1D aggregated to weeks);
 * 1W setups are listed only from a real weekly page.
 */
export function scanSymbol(symbol: string, bars: ScanBars, cfg: BoxesCfg): ScanRow[] {
  const out: ScanRow[] = [];
  const d1 = bars["1d"];
  const w1Page = bars["1w"]?.length ? bars["1w"] : null;
  const w1 = w1Page ?? toWeekly(d1);
  const d1State = d1.length >= 60 ? boxState(d1, cfg.box) : null;
  const w1State = w1.length >= MIN_WEEKS ? boxState(w1, cfg.box) : null;
  const runs: Array<[ScanTf, readonly Bar[], ReturnType<typeof analyzeBoxes>]> = [
    ["4h", bars["4h"], analyzeBoxes({ tf: "4h", bars: bars["4h"], htf: d1State ? { tf: "1d", state: d1State } : null, boxCfg: cfg.box })],
    ["1d", d1, analyzeBoxes({ tf: "1d", bars: d1, htf: w1State ? { tf: "1w", state: w1State } : null, boxCfg: cfg.box })],
  ];
  if (w1Page && w1Page.length >= MIN_WEEKS) runs.push(["1w", w1Page, analyzeBoxes({ tf: "1w", bars: w1Page, boxCfg: cfg.box })]);
  for (const [tf, series, a] of runs) {
    if (!a) continue;
    const last = series[series.length - 1]!;
    for (const s of a.setups) {
      if (!s.best || !gradePasses(s.grade, cfg.minGrade)) continue;
      const b = a.box.box;
      out.push({ id: `${symbol}:${tf}:${s.side}:${s.kind}:${b?.t0 ?? 0}`, symbol, tf, setup: s, phase: a.box.phase, price: last.c, box: b ? { top: b.top, bottom: b.bottom, grade: b.grade } : null, at: last.t * 1000 });
    }
  }
  return out;
}

// ------------------------------------------------------------------ publish

/** Rows per fetched series (a new fetch = a new object): every symbol is analysed once per fetch and engine setting. */
const rowMemo = new WeakMap<SymData, { key: string; rows: ScanRow[] }>();

/** The symbol's rows (analysed at most once per fetch / setting – a few ms, in the task that brought the bars). */
function rowsFor(symbol: string, d: SymData): ScanRow[] {
  const key = JSON.stringify([ctl.cfg.minGrade, ctl.cfg.box]);
  let m = rowMemo.get(d);
  if (!m || m.key !== key) {
    m = { key, rows: scanSymbol(symbol, d.bars, ctl.cfg) };
    rowMemo.set(d, m);
  }
  return m.rows;
}

function rowsOf(): ScanRow[] {
  const out: ScanRow[] = [];
  for (const symbol of ctl.cfg.watchlist) {
    const d = ctl.data.get(symbol);
    if (d) out.push(...rowsFor(symbol, d));
  }
  return out.sort((a, b) => b.setup.score - a.setup.score || (b.setup.rr ?? 0) - (a.setup.rr ?? 0));
}

function publish(patch: Partial<ScanView> = {}): void {
  const base: ScanView = { ...ctl.view, watchlist: ctl.cfg.watchlist, viaProxy: ctl.viaProxy, failed: ctl.failed, ...patch };
  if (!ctl.cfg.scanner) Object.assign(base, { state: "off", detail: SCAN_STRINGS.off, rows: [] });
  const key = JSON.stringify([base.state, base.progress, base.lastScanAt, base.nextScanAt, base.detail, base.failed, base.watchlist, base.viaProxy, base.rows.map((r) => `${r.id}${r.setup.grade}${r.setup.score}${r.at}`)]);
  if (key === ctl.viewKey) return;
  ctl.viewKey = key;
  ctl.view = base;
  for (const l of [...listeners]) l();
}

// ------------------------------------------------------------------ fetching

async function take(units: number): Promise<void> {
  const b = (ctl.bucket ??= new TokenBucket(SCAN_BUDGET, ctl.deps.now()));
  for (;;) {
    const now = ctl.deps.now();
    if (b.take(units, now, "price")) return;
    await new Promise<void>((r) => setTimeout(r, Math.max(250, b.waitFor(units, now, "price"))));
  }
}

/** One kline page through the scanner's budget and route (direct, then the same-origin proxy for the session). */
async function fetchPage(symbol: string, tf: FetchInterval, p: { limit: number; endTime?: number }): Promise<Candle[]> {
  await take(klineWeight(p.limit));
  const client = ctl.viaProxy ? ctl.deps.proxy() : ctl.deps.rest();
  if (!client) throw new Error("no client");
  try {
    return (await client.klines(symbol, tf, p.endTime != null ? { limit: p.limit, endTime: p.endTime } : { limit: p.limit })).data;
  } catch (err) {
    const e = toRestError(err);
    if (e.kind === "rate_limited") ctl.bucket?.backoff(60_000, ctl.deps.now());
    // geo-block / CORS / network on the direct route: the rest of the session goes through the same-origin proxy
    if (!ctl.viaProxy && (e.kind === "blocked_451" || e.kind === "network" || e.kind === "cors") && ctl.deps.proxy()) {
      ctl.viaProxy = true;
      return fetchPage(symbol, tf, p);
    }
    throw e;
  }
}

async function klines(symbol: string, tf: ScanTf): Promise<Bar[]> {
  const asOf = ctl.deps.now();
  const data = await fetchPage(symbol, tf, { limit: SCAN_LIMIT[tf] });
  return data.filter((c) => c.time + BOX_TF_MS[tf] <= asOf).map(toBar);
}

/**
 * Historic klines of ANY symbol (the newest `limit` bars up to `endTime`) through the scanner's own budget (≤ 20
 * weight / min, never the live feeds' buckets) and route – for background jobs such as the box-snapshot backfill of
 * imported trades (`./backfill.ts`). Works while the scanner itself is off.
 */
export function budgetedKlines(symbol: string, tf: FetchInterval, p: { endTime: number; limit: number }): Promise<Candle[]> {
  return fetchPage(symbol, tf, { limit: Math.max(1, Math.min(1500, Math.round(p.limit))), endTime: p.endTime });
}

async function persist(symbol: string, d: SymData): Promise<void> {
  const kv = ctl.deps.kv();
  if (!kv) return;
  try {
    for (const tf of ["4h", "1d", "1w"] as const) {
      const series = d.bars[tf];
      if (series) await kv.set(cacheKeyOf(symbol, tf), { fetchedAt: d.fetchedAt, bars: series.map((b) => [b.t, b.o, b.h, b.l, b.c]) });
    }
  } catch {
    /* private mode / quota: the scan still works, only the reload cache is missing */
  }
}

async function hydrate(): Promise<void> {
  if (ctl.hydrated) return;
  ctl.hydrated = true;
  const kv = ctl.deps.kv();
  if (!kv) return;
  for (const symbol of ctl.cfg.watchlist) {
    if (ctl.data.has(symbol)) continue;
    try {
      const raw = await Promise.all((["4h", "1d", "1w"] as const).map((tf) => kv.get(cacheKeyOf(symbol, tf)) as Promise<{ fetchedAt?: number; bars?: number[][] } | undefined>));
      if (!raw[0]?.bars || !raw[1]?.bars) continue;
      const bars = (x: number[][]): Bar[] => x.map(([t, o, h, l, c]) => ({ t: t!, o: o!, h: h!, l: l!, c: c! }));
      const d: SymData = { bars: { "4h": bars(raw[0].bars), "1d": bars(raw[1].bars), ...(raw[2]?.bars ? { "1w": bars(raw[2].bars) } : null) }, fetchedAt: raw[0].fetchedAt ?? 0 };
      ctl.data.set(symbol, d);
      rowsFor(symbol, d); // analysed here, one symbol per task (between the cache reads), not all at once below
    } catch {
      /* cache unreadable: scanned fresh */
    }
  }
  const lastScan = Math.max(0, ...[...ctl.data.values()].map((d) => d.fetchedAt));
  if (ctl.data.size) publish({ state: "ok", rows: rowsOf(), lastScanAt: lastScan || null, detail: null });
}

/** Is the symbol's cached 4h series current (holds the newest closed bar)? */
const isCurrent = (d: SymData | undefined, now: number): boolean => !!d && (d.bars["4h"].at(-1)?.t ?? 0) * 1000 >= lastClosedOpen(now);
/** Does the cached weekly series hold the newest closed week? (one weekly page per symbol and week) */
const weekCurrent = (w: readonly Bar[] | undefined, now: number): boolean => !!w?.length && w[w.length - 1]!.t * 1000 >= lastClosedOpen(now, "1w");

async function runScan(symbols: readonly string[], force: boolean): Promise<void> {
  const now0 = ctl.deps.now();
  const todo = symbols.filter((s) => force || !isCurrent(ctl.data.get(s), now0));
  if (!todo.length) {
    publish({ state: ctl.data.size ? "ok" : "idle", rows: rowsOf(), detail: ctl.cfg.watchlist.length ? null : SCAN_STRINGS.empty });
    return;
  }
  const failed: string[] = [];
  let done = 0;
  publish({ state: "scanning", progress: { done, total: todo.length }, detail: SCAN_STRINGS.scanning(done, todo.length) });
  for (const symbol of todo) {
    if (ctl.refs === 0 || !ctl.cfg.scanner) break;
    try {
      const h4 = await klines(symbol, "4h");
      const d1 = await klines(symbol, "1d");
      const held = ctl.data.get(symbol)?.bars["1w"];
      const w1 = weekCurrent(held, ctl.deps.now()) ? held! : await klines(symbol, "1w").catch(() => held);
      const d: SymData = { bars: { "4h": h4, "1d": d1, ...(w1?.length ? { "1w": w1 } : null) }, fetchedAt: ctl.deps.now() };
      ctl.data.set(symbol, d);
      void persist(symbol, d);
    } catch {
      failed.push(symbol);
    }
    done += 1;
    publish({ state: "scanning", progress: { done, total: todo.length }, rows: rowsOf(), detail: SCAN_STRINGS.scanning(done, todo.length) });
  }
  ctl.failed = failed;
  const allFailed = failed.length > 0 && failed.length === todo.length && ctl.data.size === 0;
  publish({
    state: allFailed ? "error" : "ok",
    progress: { done, total: todo.length },
    rows: rowsOf(),
    lastScanAt: ctl.deps.now(),
    failed,
    detail: allFailed ? (ctl.deps.proxy() ? `${SCAN_STRINGS.failedSome(failed.length)}` : SCAN_STRINGS.blocked) : failed.length ? SCAN_STRINGS.failedSome(failed.length) : null,
  });
}

function scan(symbols: readonly string[], force = false): Promise<void> {
  if (ctl.running) return ctl.running;
  ctl.running = (async () => {
    try {
      await hydrate();
      await runScan(symbols, force);
    } finally {
      ctl.running = null;
      arm();
    }
  })();
  return ctl.running;
}

/** Next scan at the next 4h close + jitter (while retained). */
function arm(): void {
  if (ctl.timer) clearTimeout(ctl.timer);
  ctl.timer = null;
  if (ctl.refs === 0 || !ctl.cfg.scanner) return;
  const now = ctl.deps.now();
  const at = nextScanAt(now, ctl.deps.random);
  publish({ nextScanAt: at });
  ctl.timer = setTimeout(
    () => {
      ctl.timer = null;
      if (hidden()) return; // caught up on the next visibility change
      void scan(ctl.cfg.watchlist);
    },
    Math.max(1000, at - now),
  );
}

/** Scans now (the "Jetzt scannen" button). Already running → that run. */
export function scanNow(): Promise<void> {
  if (!ctl.cfg.scanner || ctl.refs === 0) return Promise.resolve();
  return scan(ctl.cfg.watchlist, true);
}

// ------------------------------------------------------------------ lifecycle

function applySettings(raw: unknown): void {
  ctl.settingsRaw = raw;
  const cfg = boxesCfgOf(raw);
  const key = boxesCfgKey(cfg);
  if (key === ctl.cfgKey) return;
  const before = ctl.cfg;
  ctl.cfg = cfg;
  ctl.cfgKey = key;
  if (!cfg.scanner) {
    if (ctl.timer) clearTimeout(ctl.timer);
    ctl.timer = null;
    publish();
    return;
  }
  // new symbols are scanned at once; a grade / engine change re-reads the bars already held
  const added = cfg.watchlist.filter((s) => !ctl.data.has(s));
  publish({ rows: rowsOf(), state: ctl.view.state === "off" ? "idle" : ctl.view.state, detail: null });
  if (ctl.refs > 0 && (added.length || !before.scanner)) void scan(added.length ? added : cfg.watchlist);
}

function start(): void {
  applySettings(settingsBoxes(useJournal.getState().settings));
  ctl.offSettings = useJournal.subscribe((s) => {
    const raw = settingsBoxes(s.settings);
    if (raw !== ctl.settingsRaw) applySettings(raw);
  });
  if (typeof document !== "undefined") {
    const onVis = (): void => {
      if (hidden() || ctl.refs === 0 || !ctl.cfg.scanner || ctl.running) return;
      const now = ctl.deps.now();
      if (ctl.view.nextScanAt != null && now >= ctl.view.nextScanAt) void scan(ctl.cfg.watchlist);
    };
    document.addEventListener("visibilitychange", onVis);
    ctl.offVis = () => document.removeEventListener("visibilitychange", onVis);
  }
  if (ctl.cfg.scanner) void scan(ctl.cfg.watchlist);
  else publish();
}

function stop(): void {
  ctl.offSettings?.();
  ctl.offSettings = null;
  ctl.offVis?.();
  ctl.offVis = null;
  if (ctl.timer) clearTimeout(ctl.timer);
  ctl.timer = null;
}

/** Keeps the scanner running (ref-counted); returns an idempotent release. */
export function retainScanner(): () => void {
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

export function getScan(): ScanView {
  return ctl.view;
}

export function subscribeScan(cb: () => void): () => void {
  listeners.add(cb);
  return () => void listeners.delete(cb);
}

/** React: the scan results (a transition per publish; progress steps re-render, ticks never). */
export function useScan(): ScanView {
  const [view, setView] = useState(getScan);
  useEffect(() => {
    const release = retainScanner();
    const sync = () => startTransition(() => setView(getScan()));
    sync();
    const off = subscribeScan(sync);
    return () => {
      off();
      release();
    };
  }, []);
  return view;
}

/** Tests: inject the network / storage / clock, forget everything. */
export function __resetScanner(deps?: Partial<ScannerDeps>): void {
  stop();
  Object.assign(ctl, freshCtl({ ...defaultDeps(), ...deps }));
  listeners.clear();
}
