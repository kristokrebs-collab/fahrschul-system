/**
 * Squeeze alert (F07): nothing while the switch is off; the first check only remembers what is already true; an alert when
 * the observation BEGINS for a symbol and side, with the numbers and „Beobachtung, kein Signal“; not again while it holds,
 * not again within six hours; the text names the box context when the live symbol has one. The toast, the delivery log and
 * the archive are real (fake-indexeddb); the clock is passed in.
 */
import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ArchivePoint } from "@/domain/archive";
import { openArchiveDb } from "@/market/archive/db";
import { __resetArchiveStore, bumpArchiveRev } from "@/market/archive/store";
import { __resetDeliveryLog, getDeliveryLog } from "@/market/keylevels/deliveryLog";
import { ALERT_COOLDOWN_MS, SQUEEZE_ALERTS_KEY, alertText, createAlertRunner, startSqueezeAlerts } from "@/market/squeeze/alerts";
import { DEFAULT_SQUEEZE_CFG, evaluateNow } from "@/domain/squeeze";
import { useJournal } from "@/store/journalStore";
import { bootFixtureJournal } from "./views.overview.harness";

const toasts = vi.hoisted(() => ({ calls: [] as Array<{ kind: string; title: string; detail?: string }> }));
vi.mock("@/store/uiStore", async (orig) => ({ ...(await orig<typeof import("@/store/uiStore")>()), pushToast: (t: { kind: string; title: string; detail?: string }) => void toasts.calls.push(t) }));

const MIN = 60_000;
const H = 60 * MIN;
const T0 = Date.UTC(2026, 9, 26, 12, 0, 0);

let clock = T0;
const setAlerts = async (alerts: boolean) => {
  const settings = useJournal.getState().settings;
  await useJournal.getState().saveSettings({ ...settings, squeeze: { v: 1, ...DEFAULT_SQUEEZE_CFG, alerts } } as typeof settings);
};

/** Writes the samples of one symbol from `from` to `to` every 10 minutes; `hot` decides whether the numbers lean. */
async function write(symbol: string, from: number, to: number, hot: (t: number) => boolean): Promise<void> {
  const db = await openArchiveDb();
  const pts: ArchivePoint[] = [];
  for (let t = from; t <= to; t += 10 * MIN) {
    const h = hot(t);
    pts.push({ series: "premium", symbol, t, d: { mark: 100, index: 100, rate: h ? 0.0007 : 0.0001, next: t + 8 * H } });
    // open interest 1 000 until T0 − 1 h, then 1 100 where it is hot (the 4 h window then reads +10 %)
    pts.push({ series: "oi", symbol, t, d: { oi: h ? 1100 : 1000 } });
    pts.push({ series: "lsAcc", symbol, t, d: { long: h ? 70 : 50, short: h ? 30 : 50, ratio: 1 } });
  }
  await db.putPoints(pts);
  await db.putTick({ t: to, iv: 10, route: "direct", res: { [symbol]: "ok" }, states: false });
  db.close();
}

beforeEach(async () => {
  await bootFixtureJournal();
  localStorage.clear();
  __resetArchiveStore();
  __resetDeliveryLog();
  toasts.calls.length = 0;
  clock = T0;
  const db = await openArchiveDb();
  await db.deleteAll();
  db.close();
});

const make = () => createAlertRunner(undefined, () => clock);

describe("squeeze alerts", () => {
  it("says nothing while the switch is off – even when the observation holds", async () => {
    await write("BTCUSDT", T0 - 6 * H, T0, () => true);
    const r = make();
    expect(await r.check()).toBe(0);
    expect(await r.check()).toBe(0);
    expect(toasts.calls).toEqual([]);
    r.stop();
  });

  it("the first check only remembers what is already true; a beginning observation is announced once", async () => {
    await setAlerts(true);
    await write("BTCUSDT", T0 - 6 * H, T0 - 20 * MIN, () => false);
    const r = make();
    expect(await r.check()).toBe(0); // calm, seeded
    clock = T0 - 10 * MIN;
    await write("BTCUSDT", T0 - 10 * MIN, T0 - 10 * MIN, () => false);
    // hot from now on: funding +0,07 %, 70 % long, open interest 1 100 against 1 000 four hours earlier (+10 %)
    clock = T0;
    await write("BTCUSDT", T0, T0, () => true);
    expect(await r.check()).toBe(1);
    expect(toasts.calls).toHaveLength(1);
    expect(toasts.calls[0]).toMatchObject({ kind: "signal", title: "Squeeze-Beobachtung · BTCUSDT · Long-Seite überfüllt" });
    expect(toasts.calls[0]!.detail).toBe("+0,070 % je Abrechnung · +10,0 % in 4 h · Long 70,0 % · Short 30,0 % – Beobachtung, kein Signal.");
    // it goes to the delivery log like the box alerts
    expect(getDeliveryLog()[0]).toMatchObject({ source: "box", title: "Squeeze-Beobachtung · BTCUSDT · Long-Seite überfüllt", outcome: "sent" });
    // while it holds: no second alert
    clock = T0 + 10 * MIN;
    await write("BTCUSDT", clock, clock, () => true);
    expect(await r.check()).toBe(0);
    expect(toasts.calls).toHaveLength(1);
    r.stop();
  });

  it("what is already true when the watcher starts is not announced", async () => {
    await setAlerts(true);
    await write("BTCUSDT", T0 - 6 * H, T0, (t) => t > T0 - 3 * H);
    const r = make();
    expect(await r.check()).toBe(0);
    expect(await r.check()).toBe(0);
    expect(toasts.calls).toEqual([]);
    r.stop();
  });

  it("the same symbol and side is not announced again within six hours; after that it is", async () => {
    await setAlerts(true);
    await write("BTCUSDT", T0 - 6 * H, T0 - 20 * MIN, () => false);
    const r = make();
    await r.check();
    clock = T0;
    await write("BTCUSDT", T0, T0, () => true);
    expect(await r.check()).toBe(1);
    // it ends, then begins again 30 minutes later: inside the cooldown
    clock = T0 + 10 * MIN;
    await write("BTCUSDT", clock, clock, () => false);
    expect(await r.check()).toBe(0);
    clock = T0 + 40 * MIN;
    await write("BTCUSDT", T0 + 20 * MIN, T0 + 30 * MIN, () => false);
    await write("BTCUSDT", clock, clock, () => true);
    expect(await r.check()).toBe(0);
    expect(toasts.calls).toHaveLength(1);
    // a quiet stretch, then hot again after the cooldown
    const later = T0 + ALERT_COOLDOWN_MS + 30 * MIN;
    clock = later - 10 * MIN;
    await write("BTCUSDT", clock - 10 * MIN, clock, () => false);
    expect(await r.check()).toBe(0);
    clock = later;
    await write("BTCUSDT", clock, clock, () => true);
    expect(await r.check()).toBe(1);
    expect(toasts.calls).toHaveLength(2);
    r.stop();
  });

  it("turning the switch off and on again seeds first", async () => {
    await setAlerts(true);
    await write("BTCUSDT", T0 - 6 * H, T0, () => false);
    const r = make();
    await r.check();
    await setAlerts(false);
    await r.check();
    clock = T0 + 10 * MIN;
    await write("BTCUSDT", clock, clock, () => true);
    await setAlerts(true);
    expect(await r.check()).toBe(0); // already true when switched on
    expect(toasts.calls).toEqual([]);
    r.stop();
  });

  it("remembers its state across a reload (no repeat for what was announced)", async () => {
    await setAlerts(true);
    await write("BTCUSDT", T0 - 6 * H, T0 - 20 * MIN, () => false);
    const a = make();
    await a.check();
    clock = T0;
    await write("BTCUSDT", T0, T0, () => true);
    expect(await a.check()).toBe(1);
    a.stop();
    expect(JSON.parse(localStorage.getItem(SQUEEZE_ALERTS_KEY)!)).toMatchObject({ v: 1, active: { "BTCUSDT|long": true } });
    // a new watcher (a reload) seeds with the stored state: nothing new
    const b = make();
    expect(await b.check()).toBe(0);
    expect(toasts.calls).toHaveLength(1);
    b.stop();
  });

  it("the text names the box context of the live symbol", () => {
    const data = { premium: [{ t: T0, mark: 100, rate: 0.0007 }], oi: [{ t: T0 - 4 * H, oi: 1000 }, { t: T0, oi: 1100 }], ls: [{ t: T0, long: 70 }] };
    const r = evaluateNow(data, DEFAULT_SQUEEZE_CFG, T0, 10);
    const t = alertText("BTCUSDT", r, "long", [{ tf: "4h", phase: "failed", dir: 1 }]);
    expect(t.detail).toContain("Fehlausbruch nach oben (4h) bei überfüllter Long-Seite");
    expect(t.detail.endsWith("– Beobachtung, kein Signal.")).toBe(true);
  });

  it("the watcher checks after every archive tick and stops on cleanup", async () => {
    await setAlerts(true);
    await write("BTCUSDT", T0 - 6 * H, T0 - 20 * MIN, () => false);
    const r = make();
    const spy = vi.spyOn(r, "check");
    const stop = startSqueezeAlerts(r);
    await vi.waitFor(() => expect(spy).toHaveBeenCalledTimes(1));
    bumpArchiveRev();
    await vi.waitFor(() => expect(spy).toHaveBeenCalledTimes(2));
    stop();
    bumpArchiveRev();
    expect(spy).toHaveBeenCalledTimes(2);
  });
});
