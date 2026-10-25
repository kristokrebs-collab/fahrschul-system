/**
 * The browser and the e-mail alarm decide the same (F21 / F22): the same candles, the same levels, the same clock →
 * the same stages fire at the same ticks. The browser side is the real alert runtime (`evaluateEntries` +
 * `processKeyLevelView`, read back from the Zustellprotokoll); the server side is the real `runAlertWatch` against the
 * fakes of `alerts.watch.fixtures.ts` (the fires it queued are in `serverAlerts.recent`). A seeded price path
 * crosses the levels again and again, so every rule (touch, running, close, closes, buffer, retest), both directions,
 * one-shot and recurring levels, invalidation prices and the silent first look are exercised.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_ALERT_SETTINGS, KEY_TF_MS, serverAlertsOf, type KeyLevel } from "@/domain/keylevels";
import { __resetDeliveryLog, getDeliveryLog } from "@/market/keylevels/deliveryLog";
import { __resetKeyLevelAlerts, processKeyLevelView } from "@/market/keylevels/alerts";
import { evaluateEntries, type KeyLevelsView } from "@/market/keylevels/store";
import { mapKline } from "@/market/sources/binance";
import type { Candle } from "@/market/types";
import { useUi } from "@/store/uiStore";
import * as fx from "./alerts.watch.fixtures";

vi.mock("../../netlify/functions/_lib/supabase", async () => {
  const f = await import("./alerts.watch.fixtures");
  return { supabaseAdmin: () => f.fakeSupabase };
});
vi.mock("../../netlify/functions/_lib/plan", () => ({
  paymentsConfigured: () => false,
  effectivePlan: (r: { plan: unknown; plan_status: unknown }) => ({ plan: r.plan, status: r.plan_status, trialEnd: null }),
}));

const { runAlertWatch } = await import("../../netlify/functions/_lib/alertWatch/run");

const { H, MIN } = fx;
const MS4H = KEY_TF_MS["4h"];
const START = Date.UTC(2026, 9, 1); // aligned to every 4 h bucket
const SAMPLE = 5 * MIN;
const TICK = 30 * MIN;
const DAYS = 4;
const SYMBOL = "BTCUSDT";

/** Seeded LCG: the same path on every run. */
function lcg(seed: number): () => number {
  let s = seed;
  return () => ((s = (s * 1664525 + 1013904223) % 4294967296) / 4294967296);
}

/** A 5-minute price path that mean-reverts around 100 and crosses 99 … 101 many times. */
function pricePath(n: number, seed: number): number[] {
  const rnd = lcg(seed);
  const out: number[] = [];
  let p = 99.2;
  for (let i = 0; i < n; i++) {
    p += (100 - p) * 0.012 + (rnd() - 0.5) * 0.55;
    out.push(Math.round(p * 100) / 100);
  }
  return out;
}

/** The 4 h candles known at `now`: raw Binance rows (for the server's fake) and the same as browser candles. */
function candlesAt(path: readonly number[], now: number): { rows: fx.Row[]; candles: Candle[] } {
  const samples = Math.floor((now - START) / SAMPLE) + 1;
  const rows: fx.Row[] = [];
  for (let b = Math.floor(START / MS4H) * MS4H; b <= now; b += MS4H) {
    const from = Math.max(0, Math.floor((b - START) / SAMPLE));
    const to = Math.min(samples - 1, Math.floor((b + MS4H - 1 - START) / SAMPLE));
    const vals = path.slice(from, to + 1);
    if (!vals.length) continue;
    rows.push(fx.kline(b, MS4H, vals[0]!, Math.max(...vals), Math.min(...vals), vals[vals.length - 1]!));
  }
  const candles = rows.map((r) => mapKline([r[0], Number(r[1]), Number(r[2]), Number(r[3]), Number(r[4]), Number(r[5]), r[6], Number(r[7]), r[8], Number(r[9]), Number(r[10]), r[11]], now));
  return { rows, candles };
}

const ALL = { on: true, prepare: true, confirm: true, retest: true, invalid: true };
const levels = (): KeyLevel[] => {
  const mk = (id: string, over: Partial<KeyLevel>) => fx.level({ id, since: START, alerts: { ...ALL, recurring: false }, ...over }, START);
  return [
    mk("touch-up", { kind: "touch", price: 101 }),
    mk("running-up", { kind: "running", price: 100.6, alerts: { ...ALL, recurring: true } }),
    mk("close-up", { kind: "close", price: 100.4, invalidation: 98.5, alerts: { ...ALL, recurring: true } }),
    mk("close-down", { kind: "close", price: 99.4, direction: "below", alerts: { ...ALL, recurring: true } }),
    mk("closes2-up", { kind: "closes", closes: 2, price: 100.2, alerts: { ...ALL, recurring: true } }),
    mk("buffer-up", { kind: "buffer", price: 99.8, distance: { mode: "pct", value: 0.3 }, alerts: { ...ALL, recurring: true } }),
    mk("retest-up", { kind: "retest", price: 100, distance: { mode: "pct", value: 0.4 }, alerts: { ...ALL, recurring: true } }),
    mk("atr-down", { kind: "buffer", price: 100.8, direction: "below", distance: { mode: "atr", value: 0.5 }, alerts: { ...ALL, recurring: true } }),
    mk("off", { kind: "close", price: 100, alerts: { ...ALL, on: false } }),
  ];
};

let logs: string[];
beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(START);
  localStorage.clear();
  __resetKeyLevelAlerts();
  __resetDeliveryLog();
  useUi.setState({ toasts: [] });
  fx.resetDb();
  process.env.RESEND_API_KEY = "re_test_key";
  process.env.ALERT_FROM = "alerts@example.test";
  logs = [];
  vi.spyOn(console, "log").mockImplementation((...a) => void logs.push(a.join(" ")));
  vi.spyOn(console, "error").mockImplementation((...a) => void logs.push(a.join(" ")));
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  delete process.env.RESEND_API_KEY;
  delete process.env.ALERT_FROM;
});

describe("browser and e-mail alarm decide the same", () => {
  it("every stage fires at the same tick on both sides over a path with hundreds of crossings", { timeout: 120_000 }, async () => {
    const lv = levels();
    const path = pricePath((DAYS * 24 * H) / SAMPLE + 1, 20261001);
    const alerts = { ...DEFAULT_ALERT_SETTINGS, cooldownMin: 0 };
    const b = fx.binanceFake(START);
    const r = fx.resendFake();
    fx.putUser("u1", {
      data: fx.settingsData(lv, { armedAt: START + 30 * 24 * H, alerts, maxPerDay: 24 }), // armed long after `since`: the first look is silent, like the browser's
    });
    // the first tick after a 2 h warm-up, so ATR and the closes exist
    const clientFires: string[][] = [];
    const serverFires: string[][] = [];
    let serverSeen = 0;
    const ticks: number[] = [];
    for (let t = START + 3 * MS4H; t <= START + DAYS * 24 * H; t += TICK) ticks.push(t);
    for (const now of ticks) {
      vi.setSystemTime(now);
      const { rows, candles } = candlesAt(path, now);
      // browser
      const before = getDeliveryLog().length;
      const entries = evaluateEntries(lv, SYMBOL, () => candles, now, alerts);
      processKeyLevelView({ state: "ok", symbol: SYMBOL, entries, alerts } as unknown as KeyLevelsView, now);
      clientFires.push(
        getDeliveryLog()
          .slice(0, getDeliveryLog().length - before)
          .map((x) => `${x.levelId}|${x.stage}`)
          .sort(),
      );
      // server
      b.now = now;
      b.raw.set(`${SYMBOL}|4h`, rows);
      b.prices.set(SYMBOL, path[Math.floor((now - START) / SAMPLE)]!);
      await runAlertWatch({ now, fetch: b.fetch, sendFetch: r.fetch });
      const recent = serverAlertsOf(fx.db.rows.get("u1")!.data.serverAlerts).recent;
      const fresh = recent.filter((x) => x.at === now);
      serverSeen += fresh.length;
      serverFires.push(fresh.map((x) => `${x.levelId}|${x.stage}`).sort());
    }
    const total = clientFires.reduce((n, f) => n + f.length, 0);
    // the path really exercises the alerts (a vacuous comparison would pass trivially)
    expect(total).toBeGreaterThan(25);
    const kinds = new Set(clientFires.flat().map((x) => x.split("|")[0]));
    for (const id of ["touch-up", "running-up", "close-up", "close-down", "closes2-up", "buffer-up", "retest-up"]) expect(kinds, id).toContain(id);
    expect(kinds).not.toContain("off");
    const stages = new Set(clientFires.flat().map((x) => x.split("|")[1]));
    expect(stages.size).toBeGreaterThanOrEqual(3);
    expect(serverFires).toEqual(clientFires);
    expect(serverSeen).toBe(total);
  });
});
