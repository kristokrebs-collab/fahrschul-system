/**
 * „Flat by close“ – der dritte Alarm eines Plans: eine Erinnerung zur Uhrzeit. Sie meldet sich einmal zur Zeit (Toast, Zeile im
 * Zustellprotokoll), respektiert die aktiven Zeiten der Alarm-Einstellungen, meldet sich nicht mehr, wenn sie erst Stunden später
 * gefunden wird, und schließt nichts.
 */
import { act, render } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_FORM, planOfSettings, withPlanCfg, type SavedPlan } from "@/domain/plan";
import { __resetDeliveryLog, getDeliveryLog } from "@/market/keylevels/deliveryLog";
import { PlanClockHost, runFlatBy } from "@/market/plan/clock";
import { useJournal } from "@/store/journalStore";
import { useUi } from "@/store/uiStore";
import { bootFixtureJournal, installDomPolyfills } from "./views.overview.harness";

const AT = Date.UTC(2026, 9, 19, 19, 55); // 15:55 New York
const plan = (id: string, at: number, state: "pending" | "fired" | "missed" = "pending"): SavedPlan => ({
  id,
  savedAt: AT - 3_600_000,
  symbol: "BTCUSDT",
  side: "long",
  entry: 100380,
  stop: 100065,
  target: 101010,
  qty: 0.037,
  notional: 3714.06,
  maxLoss: 17.21,
  rr: 2,
  tick: 0.1,
  lot: 0.001,
  light: "green",
  currency: "USDT",
  sourceLabel: "Binance USDⓈ-M",
  candlesUntil: AT - 3_000_000,
  fetchedAt: AT - 3_500_000,
  signalAt: AT - 3_300_000,
  flatByMs: at,
  tz: "America/New_York",
  sessionLabel: "Mo 19.10. · New York 9:30 (UTC−4)",
  stopLabel: "Mitte der Range",
  targetLabel: "2R",
  form: { ...DEFAULT_FORM },
  alarms: { stopId: "k_a", targetId: "k_b", flatBy: { at, state, firedAt: null }, createdAt: AT - 3_000_000 },
  journalAt: null,
});

async function seedPlans(plans: SavedPlan[], alerts?: unknown): Promise<void> {
  const { settings, saveSettings } = useJournal.getState();
  await saveSettings({ ...settings, plan: withPlanCfg(undefined, { plans }), ...(alerts ? { keyLevels: { v: 1, levels: [], alerts } } : {}) });
}
const stored = () => planOfSettings(useJournal.getState().settings).plans;

beforeAll(() => installDomPolyfills());
beforeEach(async () => {
  await bootFixtureJournal();
  localStorage.clear();
  __resetDeliveryLog();
  useUi.setState({ toasts: [] });
});
afterEach(() => {
  vi.useRealTimers();
});

describe("Flat by close · die Erinnerung zur Uhrzeit", () => {
  it("vor der Zeit nichts; zur Zeit ein Toast und eine Zeile im Zustellprotokoll – einmal", async () => {
    await seedPlans([plan("p1", AT)]);
    expect(await runFlatBy(AT - 1)).toBe(0);
    expect(getDeliveryLog()).toHaveLength(0);
    expect(await runFlatBy(AT + 5_000)).toBe(1);
    const toast = useUi.getState().toasts[0]!;
    expect(toast.title).toBe("Flat by close: BTCUSDT");
    expect(toast.detail).toBe("Es ist 15:55 Uhr. Wenn dein Long-Trade noch offen ist, schließ ihn. Das ist eine Erinnerung – die App tut nichts für dich.");
    const log = getDeliveryLog();
    expect(log).toHaveLength(1);
    expect(log[0]).toMatchObject({ source: "key", outcome: "sent", title: "Flat by close: BTCUSDT", channels: ["toast"], dedupeKey: `plan-flat|p1|${AT}` });
    expect(stored()[0]!.alarms!.flatBy).toMatchObject({ state: "fired", firedAt: AT + 5_000 });
    // ein zweiter Lauf meldet nichts mehr
    expect(await runFlatBy(AT + 60_000)).toBe(0);
    expect(getDeliveryLog()).toHaveLength(1);
  });

  it("eine verspätet gefundene Erinnerung sagt, wie spät; eine zu alte (über 12 Stunden) gilt still als verpasst", async () => {
    await seedPlans([plan("late", AT), plan("old", AT - 14 * 3_600_000)]);
    await runFlatBy(AT + 12 * 60_000);
    const titles = useUi.getState().toasts.map((t) => t.detail);
    expect(titles).toHaveLength(1);
    expect(titles[0]).toContain("(fällig war 15:55 Uhr, 12 Minuten her)");
    const byId = Object.fromEntries(stored().map((p) => [p.id, p.alarms!.flatBy!.state]));
    expect(byId).toEqual({ late: "fired", old: "missed" });
    expect(getDeliveryLog()).toHaveLength(1);
  });

  it("außerhalb der aktiven Zeiten wird nichts gezeigt, die Zeile im Protokoll sagt warum", async () => {
    const local = new Date(AT);
    const h = local.getHours();
    // aktive Zeit: eine Stunde, die NICHT die der Erinnerung ist (Ortszeit des Geräts)
    const from = `${String((h + 2) % 24).padStart(2, "0")}:00`;
    const to = `${String((h + 4) % 24).padStart(2, "0")}:00`;
    await seedPlans([plan("q", AT)], { hours: { on: true, from, to } });
    await runFlatBy(AT + 1000);
    expect(useUi.getState().toasts).toHaveLength(0);
    expect(getDeliveryLog()[0]).toMatchObject({ outcome: "hours", channels: [] });
    expect(stored()[0]!.alarms!.flatBy!.state).toBe("fired");
  });

  it("ein Plan ohne Alarm oder mit schon gemeldeter Erinnerung bleibt unberührt", async () => {
    await seedPlans([{ ...plan("none", AT), alarms: null }, plan("done", AT, "fired")]);
    expect(await runFlatBy(AT + 1000)).toBe(0);
    expect(useUi.getState().toasts).toHaveLength(0);
  });

  it("der Wächter wartet mit EINEM Timer auf die nächste Zeit und meldet sich dann (kein Takt)", async () => {
    vi.useFakeTimers({ now: AT - 5 * 60_000 });
    await seedPlans([plan("t", AT)]);
    render(<PlanClockHost />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(4 * 60_000);
    });
    expect(useUi.getState().toasts).toHaveLength(0);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(61_000);
    });
    expect(useUi.getState().toasts[0]?.title).toBe("Flat by close: BTCUSDT");
    expect(stored()[0]!.alarms!.flatBy!.state).toBe("fired");
  });
});
