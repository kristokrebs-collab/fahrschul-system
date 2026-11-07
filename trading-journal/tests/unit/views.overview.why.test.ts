import { describe, expect, it } from "vitest";
import { explainDecision } from "@/domain/decision";
import type { Signals, SignalCfg } from "@/domain/signals";
import { DEFAULT_SIGNAL_CFG } from "@/domain/signals";
import { plannedStop, triggerClose, whyInput } from "@/views/overview/whyView";

const bar = (time: number, close: number, closed = true) => ({ time, close, closed });

describe("triggerClose – the reference entry is the close of the signal candle", () => {
  const bars = [bar(0, 100), bar(60, 101), bar(120, 102, false)];
  it("finds the closed candle", () => expect(triggerClose(bars, 60)).toBe(101));
  it("a signal on the forming candle (vorläufig) has no trigger yet", () => expect(triggerClose(bars, 120)).toBeNull());
  it("an unknown candle gives null, never the nearest one", () => expect(triggerClose(bars, 90)).toBeNull());
});

describe("plannedStop", () => {
  it("reads the stop of the support/resistance part, null without it", () => {
    expect(plannedStop({ parts: [{ id: "sr", levels: { lean: null, target: null, stop: 98.5, r: 2 } } as never] })).toBe(98.5);
    expect(plannedStop({ parts: [{ id: "traders" } as never] })).toBeNull();
    expect(plannedStop({})).toBeNull();
  });
});

describe("whyInput", () => {
  const verdict = (over = {}) => ({ side: "long", tiers: 2, strength: 2, label: "Long-Einstieg", valid: true, rsiOk: true, zoneOk: true, strongSignal: false, score: 70, reasons: [], state: "confirmed", parts: [{ id: "sr", levels: { lean: null, target: null, stop: 98, r: 2 }, data: true, ok: true, label: "Support", detail: "x", items: [], grade: 1 }], ...over });
  const snap = (over = {}) => ({ long: verdict(), short: verdict({ side: "short", valid: false, strength: 0, label: "Kein Signal" }), best: verdict(), checks: [], zone: null, at: 0, cfg: { ...DEFAULT_SIGNAL_CFG } as SignalCfg, ...over }) as unknown as Signals & { cfg: SignalCfg };

  it("maps the other side, the stop, the Lage input and the price", () => {
    const i = whyInput(snap({ lage: { lage: { state: "green" }, cfg: {} } }), "long", { feed: "ok", lageOn: true, maxLateR: 0.5, trigger: 100, price: 100.2 });
    expect(i.other).toMatchObject({ valid: false, label: "Kein Signal" });
    expect(i.plan).toEqual({ trigger: 100, stop: 98 });
    expect(i.lage).toEqual({ on: true, hasData: true });
    expect(i.price).toBe(100.2);
  });
  it("a Lage gate without Lage data is reported as missing data; no gate input = no Lage row", () => {
    expect(whyInput(snap({ lage: null }), "long", { feed: "ok", lageOn: true, maxLateR: 0.5, trigger: 100, price: 100 }).lage).toEqual({ on: true, hasData: false });
    expect(whyInput(snap(), "long", { feed: "ok", lageOn: true, maxLateR: 0.5, trigger: 100, price: 100 }).lage).toBeNull();
  });
  it("end to end: a confirmed long that already ran 1 R past the trigger is skipped as too late", () => {
    const i = whyInput(snap(), "long", { feed: "ok", lageOn: false, maxLateR: 0.5, trigger: 100, price: 102 });
    const w = explainDecision({ ...i, checks: [], cfg: { ...i.cfg, ladder: ["30m", "45m"], required: 2 } });
    expect(w.decision).toBe("skip");
    expect(w.late.status).toBe("late");
  });
});
