/**
 * Box-zu-Box snapshot backfill (review F02): trades that came in WITHOUT the editor – Bitunix auto-sync, CSV import,
 * TradingView webhook, REST API – or on a pair other than the live market's never got a `boxSnap`, so the Analyse
 * dimension "Box-Note", the trade review and the strategy classifier saw them all as "Ohne Box". This idle queue
 * resolves the box context at entry from the pair's OWN historic klines (`resolveTradeBoxes` retro, closed bars only,
 * no look-ahead) and stores it on the trade.
 *
 * - Source: the scanner's budgeted fetch (`budgetedKlines`: ≤ 20 Binance weight per minute, its own bucket – the live
 *   feeds never wait for it; direct, then the same-origin proxy). The provider's own symbol goes through the provider.
 * - Pace: starts after a minute in the app, at an idle moment; one trade every `BOXSNAP_GAP_MS`, at most
 *   `BOXSNAP_MAX` per session, paused while the tab is hidden; with nothing to do it looks again every 5 minutes (new
 *   synced / imported trades during the session). Every attempt is remembered for a day (`BOXSNAP_TRIED_KEY`),
 *   so a pair without Binance data is not fetched again and again.
 * - Safety: nothing is written when the trade changed meanwhile (date, side or pair) or already has a snapshot of its
 *   pair; a snapshot of another pair (stored by an older editor, MM-6) counts as missing and is replaced.
 */
import { boxSnapOf } from "@/domain/boxes";
import { normalizeWatchSymbol } from "@/domain/boxes/config";
import type { Trade } from "@/domain/types";
import { readJson, storageKey, writeJson } from "@/store/storage";
import { budgetedKlines } from "./scanner";
import { resolveTradeBoxes, tradeDateMs, type BoxSnapshot, type SymbolKlines } from "./snapshot";

export const BOXSNAP_TRIED_KEY = storageKey("boxsnap-tried");
/** A trade whose context could not be resolved is tried again after this long. */
export const BOXSNAP_RETRY_MS = 24 * 3_600_000;
/** At most this many trades per session, one every `BOXSNAP_GAP_MS`. */
export const BOXSNAP_MAX = 30;
export const BOXSNAP_GAP_MS = 4000;
/** With nothing to do, the queue looks again after this long. */
export const BOXSNAP_IDLE_RECHECK_MS = 5 * 60_000;
/** First run after this long in the app (the first minute belongs to the user, not to background fetches). */
export const BOXSNAP_START_MS = 60_000;

/** Trades that still lack the box context of their own pair, newest first (only past entries with a readable pair). */
export function boxSnapCandidates(trades: readonly Trade[], tried: Readonly<Record<string, number>>, now = Date.now()): Trade[] {
  return trades
    .filter((t) => {
      if (boxSnapOf(t)) return false;
      if (!normalizeWatchSymbol(t.pair ?? "")) return false;
      if (t.side !== "long" && t.side !== "short") return false;
      const at = tradeDateMs(t.date);
      if (!Number.isFinite(at) || at > now) return false;
      const last = tried[t.id];
      return !(last != null && now - last < BOXSNAP_RETRY_MS);
    })
    .sort((a, b) => (b.date || "").localeCompare(a.date || ""));
}

export interface BoxSnapDeps {
  trades: () => readonly Trade[];
  /** Latest version of the trade (the journal may have changed while the klines loaded). */
  latest: (id: string) => Trade | undefined;
  save: (t: Trade) => Promise<void>;
}

/** Default resolver: the trade's pair, its own klines (the scanner's budget) unless it is the provider's symbol. */
export function resolveForTrade(t: Trade, klines: SymbolKlines = budgetedKlines): Promise<BoxSnapshot | null> {
  const symbol = normalizeWatchSymbol(t.pair ?? "");
  if (!symbol) return Promise.resolve(null);
  return resolveTradeBoxes(t.date, t.side, { symbol, klines });
}

/** Resolves and stores one trade's snapshot; `true` when one was written. */
export async function backfillBoxSnap(t: Trade, deps: Pick<BoxSnapDeps, "latest" | "save">, resolve: (t: Trade) => Promise<BoxSnapshot | null> = resolveForTrade): Promise<boolean> {
  const snap = await resolve(t);
  if (!snap) return false;
  const cur = deps.latest(t.id);
  if (!cur || cur.date !== t.date || cur.side !== t.side || cur.pair !== t.pair || boxSnapOf(cur)) return false;
  // the resolver may only hand back the trade's own pair – never store a foreign context
  if (!boxSnapOf({ pair: cur.pair, boxSnap: snap })) return false;
  await deps.save({ ...cur, boxSnap: snap, updatedAt: new Date().toISOString() });
  return true;
}

export interface BoxSnapBackfill {
  stop(): void;
}

/** Keeps the tried-registry small (only entries younger than the retry window). */
function pruneTried(tried: Record<string, number>, now = Date.now()): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(tried)) if (now - v < BOXSNAP_RETRY_MS) out[k] = v;
  return out;
}

/** Idle background queue (see the module comment). */
export function startBoxSnapBackfill(deps: BoxSnapDeps, opts: { resolve?: (t: Trade) => Promise<BoxSnapshot | null>; delayMs?: number; gapMs?: number } = {}): BoxSnapBackfill {
  let stopped = false;
  let done = 0;
  let timer: ReturnType<typeof setTimeout> | null = null;
  const gap = opts.gapMs ?? BOXSNAP_GAP_MS;
  const schedule = (wait: number) => {
    if (stopped) return;
    timer = setTimeout(() => {
      const ric = (globalThis as { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number }).requestIdleCallback;
      if (ric) ric(() => void tick(), { timeout: 5000 });
      else void tick();
    }, wait);
  };
  const tick = async () => {
    if (stopped) return;
    if (typeof document !== "undefined" && document.visibilityState === "hidden") return schedule(15_000);
    const tried = readJson<Record<string, number>>(BOXSNAP_TRIED_KEY, {});
    if (done >= BOXSNAP_MAX) return;
    const next = boxSnapCandidates(deps.trades(), tried)[0];
    // nothing to do now: look again later (an auto-sync or import may bring new trades during the session)
    if (!next) return schedule(BOXSNAP_IDLE_RECHECK_MS);
    done += 1;
    writeJson(BOXSNAP_TRIED_KEY, { ...pruneTried(tried), [next.id]: Date.now() });
    try {
      await backfillBoxSnap(next, deps, opts.resolve);
    } catch {
      /* remembered as tried; the next one follows */
    }
    schedule(gap);
  };
  schedule(opts.delayMs ?? BOXSNAP_START_MS);
  return {
    stop: () => {
      stopped = true;
      if (timer) clearTimeout(timer);
    },
  };
}
