/**
 * The runner of the forward test (F23): loads the candles of an account (the lab's own loader: cache first, only the missing
 * tail from the exchange), prepares the strategy facts, lets the pure catch-up (`advanceAccount`) continue the engine and
 * saves the result – from the LATEST settings, and only when the user did not change the account (pause, end, delete)
 * meanwhile; then the run is repeated from the changed state. One run per account at a time.
 *
 * Also the comparison with the backtest of the same rules before the start (`runCompare`), on demand, memory only.
 */
import { customStrategy } from "@/domain/backtest/strategies/custom";
import { runStats } from "@/domain/backtest/metrics";
import type { Bar, BarsBy, HistInterval } from "@/domain/backtest/types";
import {
  accountView,
  advanceAccount,
  backtestWindow,
  compareForward,
  engineCfgOf,
  lookbackMs,
  planOf,
  strategyInOf,
  type ForwardAccount,
  type Lookback,
} from "@/domain/forward";
import { loadErrorKind, loadLabData } from "../historySource";
import { accountsNow, writeAccounts } from "./forwardActions";
import { useForwardRuntime } from "./forwardStore";
import { FORWARD } from "./strings";

export type CatchResult = { kind: "ok"; processed: number; rebuilt: boolean } | { kind: "idle" } | { kind: "gone" } | { kind: "error"; message: string };

const inflight = new Map<string, Promise<CatchResult>>();
let clock: () => number = () => Date.now();

/** Test hook: another clock. */
export function __setForwardClock(c: (() => number) | null): void {
  clock = c ?? (() => Date.now());
}

const yieldToMain = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

/** The strategy facts of an account's candles, in slices so no frame waits on them. */
async function prepareSliced(account: Pick<ForwardAccount, "config" | "signal">, data: BarsBy, startMs: number) {
  const stepper = customStrategy.prepare(data, strategyInOf(account), startMs);
  const now = (): number => (typeof performance !== "undefined" ? performance.now() : Date.now());
  while (!stepper.step(now() + 14)) await yieldToMain();
  return stepper.result();
}

/** Every series cut at the account's fixed anchor, so the indicators always start at the same candle. */
function fromAnchor(data: BarsBy, anchorMs: number): BarsBy {
  const out: BarsBy = {};
  for (const [iv, bars] of Object.entries(data) as [HistInterval, readonly Bar[] | undefined][]) out[iv] = (bars ?? []).filter((b) => b.t * 1000 >= anchorMs);
  return out;
}

const errorText = (e: unknown): string => {
  const kind = loadErrorKind(e);
  return kind === "blocked" ? FORWARD.errors.blocked : kind === "rate" ? FORWARD.errors.rate : kind === "symbol" ? FORWARD.errors.symbol : FORWARD.errors.failed;
};

const sameUserState = (a: ForwardAccount, b: ForwardAccount): boolean => a.status === b.status && a.endedAt === b.endedAt && JSON.stringify(a.pauses) === JSON.stringify(b.pauses) && a.cursor.sig === b.cursor.sig;

async function runOnce(id: string): Promise<CatchResult> {
  const rt = useForwardRuntime.getState();
  for (let attempt = 0; attempt < 3; attempt++) {
    const a0 = accountsNow().find((a) => a.id === id);
    if (!a0) return { kind: "gone" };
    if (a0.cursor.done) return { kind: "idle" };
    const now = clock();
    const plan = planOf(a0);
    rt.patchRuntime(id, { phase: "loading", error: null, load: { done: 0, total: 0 } });
    try {
      const loaded = await loadLabData({
        symbol: a0.symbol,
        intervals: plan.intervals,
        from: plan.anchorMs,
        to: now,
        funding: a0.funding === "history",
        onProgress: (done, total) => useForwardRuntime.getState().patchRuntime(id, { load: { done, total } }),
      });
      const data = fromAnchor(loaded.data, plan.anchorMs);
      if (!(data[a0.interval]?.length)) {
        useForwardRuntime.getState().patchRuntime(id, { phase: "idle", error: FORWARD.errors.noData });
        return { kind: "error", message: FORWARD.errors.noData };
      }
      useForwardRuntime.getState().patchRuntime(id, { phase: "calc" });
      const prep = await prepareSliced(a0, data, a0.startMs);
      const adv = advanceAccount(a0, prep, engineCfgOf(a0, loaded.funding), now);
      if (adv.account === a0) {
        useForwardRuntime.getState().patchRuntime(id, { phase: "idle", checkedAt: now, rebuilt: false });
        return { kind: "ok", processed: 0, rebuilt: false };
      }
      let stale = false;
      const saved = await writeAccounts((list) => {
        const latest = list.find((a) => a.id === id);
        if (!latest) return null;
        if (!sameUserState(a0, latest)) {
          stale = true;
          return null;
        }
        const n = adv.account;
        return list.map((a) => (a.id === id ? { ...latest, status: n.status, endedAt: n.endedAt, endReason: n.endReason, trades: n.trades, cursor: n.cursor } : a));
      });
      if (stale) continue;
      if (!saved) {
        useForwardRuntime.getState().patchRuntime(id, { phase: "idle", error: FORWARD.failed });
        return { kind: "error", message: FORWARD.failed };
      }
      useForwardRuntime.getState().patchRuntime(id, { phase: "idle", checkedAt: now, rebuilt: adv.rebuilt });
      return { kind: "ok", processed: adv.processed, rebuilt: adv.rebuilt };
    } catch (e) {
      console.error("Forward-Test: Nachrechnen fehlgeschlagen", e);
      const message = e instanceof Error && e.message.includes("carry") ? FORWARD.errors.failed : errorText(e);
      useForwardRuntime.getState().patchRuntime(id, { phase: "idle", error: message });
      return { kind: "error", message };
    }
  }
  useForwardRuntime.getState().patchRuntime(id, { phase: "idle" });
  return { kind: "idle" };
}

/** Brings one account up to date. A run that is already going on is joined, not doubled. */
export function catchUp(id: string): Promise<CatchResult> {
  const running = inflight.get(id);
  if (running) return running;
  const p = runOnce(id).finally(() => inflight.delete(id));
  inflight.set(id, p);
  return p;
}

/** Brings every account that still needs it up to date (one after the other: the loader has its own request budget). */
export async function catchUpAll(): Promise<void> {
  for (const a of accountsNow()) if (!a.cursor.done) await catchUp(a.id);
}

/** Open time of the next candle close of the soonest running interval (ms), null when nothing is running. */
export function nextCloseMs(accounts: readonly ForwardAccount[], now: number): number | null {
  const ivMs: Record<string, number> = { "15m": 900_000, "30m": 1_800_000, "1h": 3_600_000, "2h": 7_200_000, "4h": 14_400_000, "1d": 86_400_000 };
  let best: number | null = null;
  for (const a of accounts) {
    if (a.status === "ended" || a.cursor.done) continue;
    const iv = ivMs[a.interval]!;
    const next = (Math.floor(now / iv) + 1) * iv;
    if (best == null || next < best) best = next;
  }
  return best;
}

// ── the comparison with the backtest ─────────────────────────────────────────────────────────────────────────────────

/** Backtest of the account's rules over `lookback` days before its start, compared with what the account did since. */
export async function runCompare(id: string, lookback: Lookback): Promise<void> {
  const rt = useForwardRuntime.getState();
  const a = accountsNow().find((x) => x.id === id);
  if (!a) return;
  rt.patchCompare(id, { status: "loading", lookback, result: null, error: null });
  try {
    const startMs = a.startMs - lookbackMs(lookback);
    const base = planOf({ ...a, startMs });
    const loaded = await loadLabData({ symbol: a.symbol, intervals: base.intervals, from: base.anchorMs, to: a.startMs - 1, funding: a.funding === "history" });
    const data = fromAnchor(loaded.data, base.anchorMs);
    if (!(data[a.interval]?.length)) throw Object.assign(new Error("no data"), { code: "noWindow" });
    useForwardRuntime.getState().patchCompare(id, { status: "calc" });
    const prep = await prepareSliced(a, data, startMs);
    const engine = engineCfgOf(a, loaded.funding);
    const bt = backtestWindow(a, prep, engine);
    if (!bt) throw Object.assign(new Error("window"), { code: "noWindow" });
    const result = compareForward(accountView(a).stats, runStats(bt));
    useForwardRuntime.getState().patchCompare(id, { status: "done", result });
  } catch (e) {
    const code = (e as { code?: string }).code;
    useForwardRuntime.getState().patchCompare(id, { status: "error", error: code === "noWindow" ? FORWARD.errors.noWindow : errorText(e) });
  }
}

