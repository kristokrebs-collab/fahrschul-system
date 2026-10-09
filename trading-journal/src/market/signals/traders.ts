/**
 * Market side of the Top-Trader-Kombi (`@/domain/signals` `traders.ts`, decision 5): the Binance 5-minute long-share
 * series of top traders by position, top traders by account and all accounts (retail).
 *
 * - Live: the provider's own 5-min twins (`topPositionRatio5m`, `topAccountRatio5m`, `globalAccountRatio5m`) through the
 *   data layer's `deriveTraderSeries` — the SAME points the Top-Trader card and the falling-knife filter read, no extra
 *   request. Freshness is judged on the Binance clock (`provider.serverNow()`). Only Binance data counts (direct or the
 *   EU proxy); a Bybit / OKX fallback yields no reading ("keine Daten", never a fail).
 * - Retro (`tradersAt`): the live ring when it reaches back to T (24 h) with every value of the reading (positions,
 *   accounts, the Whale–Retail-Delta and its change over `deltaWindow`), else one `fetchRatios` page per series ending
 *   at T and reaching `traderLookbackMs(cfg)` back (the delta window, the 12-point sparkline, the legacy retail period;
 *   budget-aware, Binance route only; memoised, failures retried on the next call). Binance keeps these series for
 *   ~30 days: older times → `null`.
 * Pure helpers + one memo; the engine calls `liveTraders` inside its ≤ 1/s evaluation and keys it with `tradersInputKey`.
 */
import { traderReading, whaleCfgOf, type SignalCfg, type TraderReading, type TraderSeries } from "@/domain/signals";
import { traderLookbackMs } from "@/domain/signals/traders";
import { FUTURES_DATA_RETENTION_MS, LIVE_RATIO_FEEDS, LIVE_RATIO_PERIOD } from "../feeds";
import type { FeedSnapshot } from "../mapping";
import type { MarketProvider } from "../provider";
import { deriveTraderSeries, traderSeriesKey, TRADER_SERIES_STEP_MS, type LiveTraderSeries } from "../traders";
import type { RatioPoint, Stamped } from "../types";

const serverNow = (p: MarketProvider): number => (typeof p.serverNow === "function" ? p.serverNow() : Date.now());

/** The live 5-min series of the engine's provider (with the data layer's honest status). */
export function liveTraderSeriesOf(p: MarketProvider): LiveTraderSeries {
  const feeds: FeedSnapshot = {};
  for (const f of LIVE_RATIO_FEEDS) (feeds as Record<string, unknown>)[f] = p.get(f);
  return deriveTraderSeries(feeds, p.getHealth(), serverNow(p));
}

/** The live reading (`null` when the condition is off or no series has a fresh Binance point). */
export function liveTraders(p: MarketProvider, cfg: Pick<SignalCfg, "whale">): TraderReading | null {
  if (!whaleCfgOf(cfg).on) return null;
  const s = liveTraderSeriesOf(p);
  return traderReading(s, cfg, s.now);
}

const ids = new WeakMap<object, number>();
let nextId = 1;
function objectId(o: unknown): number {
  if (!o || typeof o !== "object") return 0;
  let id = ids.get(o);
  if (id === undefined) ids.set(o, (id = nextId++));
  return id;
}

/**
 * Changes whenever one of the three series publishes (identity of the feed values), its route / status changes, or a
 * step of time passes (freshness changes with time alone) — part of the engine's input key.
 */
export function tradersInputKey(p: MarketProvider, cfg: Pick<SignalCfg, "whale">): string {
  if (!whaleCfgOf(cfg).on) return "t-";
  const s = liveTraderSeriesOf(p);
  const vals = LIVE_RATIO_FEEDS.map((f) => objectId(p.get(f))).join(",");
  return `${traderSeriesKey(s)}|${vals}|${Math.floor(s.now / TRADER_SERIES_STEP_MS)}`;
}

// ------------------------------------------------------------------ retro

const MEMO_MAX = 128;
const memo = new Map<string, Promise<TraderSeries | null>>();
type Kind = "topPositionRatio" | "topAccountRatio" | "globalAccountRatio";
const KINDS: readonly Kind[] = ["topPositionRatio", "topAccountRatio", "globalAccountRatio"];

/** Points of the three series ending at `t`, `back` ms deep (+ 3 steps), `null` when every request failed. */
function fetchSeriesAt(p: MarketProvider, t: number, back: number): Promise<TraderSeries | null> {
  const n = Math.ceil(back / TRADER_SERIES_STEP_MS) + 3;
  const key = `${p.symbol}|${Math.floor(t / 60_000)}|${n}`;
  const hit = memo.get(key);
  if (hit) return hit;
  const q = { endTime: t, startTime: t - n * TRADER_SERIES_STEP_MS, limit: n + 2 };
  const run = Promise.allSettled(KINDS.map((k) => p.fetchRatios(k, LIVE_RATIO_PERIOD, q))).then((rs): TraderSeries | null => {
    if (rs.every((r) => r.status === "rejected")) {
      memo.delete(key); // retry next time
      return null;
    }
    const pts = (i: number): readonly RatioPoint[] => {
      const r = rs[i]!;
      return r.status === "fulfilled" ? (r.value as Stamped<RatioPoint[]>).data : [];
    };
    return { position: pts(0), account: pts(1), retail: pts(2), step: TRADER_SERIES_STEP_MS };
  });
  memo.set(key, run);
  if (memo.size > MEMO_MAX) memo.delete(memo.keys().next().value!);
  return run;
}

/** A reading with every value present (positions, accounts, the Whale–Retail-Delta and its change over the window). */
const complete = (r: TraderReading | null): r is TraderReading => !!r && r.position != null && r.account != null && r.delta != null && r.deltaChg != null;

/**
 * The reading at time `t` (a back-dated trade). `null` when the condition is off, `t` lies outside Binance's ~30-day
 * window, the route has no top traders, or nothing could be loaded. Never rejects.
 */
export async function tradersAt(p: MarketProvider, cfg: Pick<SignalCfg, "whale">, t: number, now: number = Date.now()): Promise<TraderReading | null> {
  const w = whaleCfgOf(cfg);
  if (!w.on || !Number.isFinite(t)) return null;
  const back = traderLookbackMs(cfg, TRADER_SERIES_STEP_MS);
  if (now - t > FUTURES_DATA_RETENTION_MS - back - 2 * TRADER_SERIES_STEP_MS) return null; // beyond Binance's window
  const live = traderReading(liveTraderSeriesOf(p), cfg, t);
  if (complete(live)) return live;
  if (typeof p.fetchRatios !== "function") return live;
  try {
    const s = await fetchSeriesAt(p, t, back);
    const r = s ? traderReading(s, cfg, t) : null;
    return r ?? live;
  } catch {
    return live;
  }
}

/** Testing helper. */
export function __resetTraders(): void {
  memo.clear();
}
