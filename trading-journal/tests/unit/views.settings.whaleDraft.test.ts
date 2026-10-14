import { describe, expect, it } from "vitest";
import { defaultSettings } from "@/domain/defaults";
import { DEFAULT_DIV_CFG } from "@/domain/signals";
import { changedKeys, defaultSignalDraft, draftToSettings, settingsToDraft } from "@/views/settings/draft";
import { partsFromDraft, partsToDraft } from "@/views/settings/signalPartsDraft";
describe("settings draft: Top-Trader kaufen · Retail rot", () => {
  it("round trip, merge, refusal, defaults, changed keys", () => {
    const s = { ...defaultSettings(), signals: { foo: 1, whale: { keep: 2, on: true } } };
    const d = settingsToDraft(s);
    expect([d.sgWhale, d.sgWhalePeriods, d.sgWhaleMin, d.sgWhaleWeight]).toEqual(["on", "30m,1h", "2", "10"]);
    const untouched = draftToSettings(d, s);
    expect(untouched.ok && untouched.settings.signals).toBe(s.signals);
    const r = draftToSettings({ ...d, sgWhale: "", sgWhalePeriods: "4h,1h", sgWhaleMin: "3", sgWhaleWeight: "0" }, s);
    expect(r.ok).toBe(true);
    if (r.ok) expect((r.settings.signals as { whale?: unknown }).whale).toEqual({ keep: 2, on: false, periods: ["1h", "4h"], minRun: 3, weight: 0, topPct: 64, retailPeriod: "5m", bonusParts: 3, deltaRed: 0, deltaFall: 1, deltaWindow: "1h" });
    if (r.ok) expect((r.settings.signals as { foo?: unknown }).foo).toBe(1);
    expect(draftToSettings({ ...d, sgWhalePeriods: "" }, s)).toEqual({ ok: false, error: "numeric", field: "sgWhalePeriods" });
    expect(defaultSignalDraft(d).sgWhale).toBe("on");
    expect(changedKeys({ ...d, sgWhalePeriods: "1h,30m" }, d).size).toBe(0);
    expect([...changedKeys({ ...d, sgWhaleMin: "4" }, d)]).toContain("sgWhaleMin");
  });
});

describe("settings draft: Einstiegs-Check v2 thresholds (candle close, Top-Trader-Kombi, divergences, S/R)", () => {
  it("shows the engine's values, writes them merged over the stored objects, clamps, refuses non-numbers", () => {
    const s = { ...defaultSettings(), signals: { foo: 1, whale: { keep: 2, periods: ["4h"], minRun: 4 }, div: { mine: "x", left: 3 }, sr: { other: true } } };
    const d = settingsToDraft(s);
    expect([d.sgStrong, d.sgWhaleTop, d.sgWhaleRetail, d.sgWhaleBonus, d.sgWhaleDeltaRed, d.sgWhaleDeltaFall, d.sgWhaleWindow]).toEqual(["2", "64", "5m", "3", "0", "1", "1h"]);
    expect([d.sgDiv, d.sgDivRsi, d.sgDivWt, d.sgDivHidden, d.sgDivMid, d.sgDivLeft, d.sgDivRight, d.sgDivMin, d.sgDivMax, d.sgDivAge, d.sgDivWeight]).toEqual(["on", "on", "on", "on", "on", "3", "2", "3", "60", String(DEFAULT_DIV_CFG.maxAge), "10"]);
    expect([d.sgSr, d.sgSrInt, d.sgSrNear, d.sgSrMinR, d.sgSrEqLen, d.sgSrEqThr, d.sgSrWeight]).toEqual(["on", "5", "1", "2", "3", "0,1", "10"]);
    // untouched → stored value as is
    const untouched = draftToSettings(d, s);
    expect(untouched.ok && untouched.settings.signals).toBe(s.signals);
    const r = draftToSettings({ ...d, sgStrong: "9", sgWhaleTop: "70", sgWhaleRetail: "1h", sgWhaleBonus: "2", sgDivHidden: "", sgDivMin: "50", sgDivMax: "10", sgDivWeight: "20", sgSr: "", sgSrNear: "0,5", sgSrMinR: "3" }, s);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const sig = r.settings.signals as Record<string, Record<string, unknown> | number>;
    expect(sig.strongCloses).toBe(6);
    expect(sig.whale).toMatchObject({ keep: 2, periods: ["4h"], minRun: 4, topPct: 70, retailPeriod: "1h", bonusParts: 2, deltaRed: 0, deltaFall: 1, deltaWindow: "1h" });
    expect(sig.div).toMatchObject({ mine: "x", on: true, hidden: false, left: 3, rangeMin: 50, rangeMax: 50, weight: 20 });
    expect(sig.sr).toMatchObject({ other: true, on: false, nearAtr: 0.5, minR: 3 });
    expect(sig.foo).toBe(1);
    // the saved settings read back as the same draft strings
    const back = settingsToDraft(r.settings);
    expect([back.sgStrong, back.sgWhaleTop, back.sgDivMax, back.sgSrNear]).toEqual(["6", "70", "50", "0,5"]);
    expect(draftToSettings({ ...d, sgSrMinR: "" }, s)).toEqual({ ok: false, error: "numeric", field: "sgSrMinR" });
    expect([...changedKeys({ ...d, sgDivAge: "7" }, d)]).toEqual(["sgDivAge"]);
    expect(changedKeys({ ...d, sgSrNear: "1,0" }, d).size).toBe(0);
    // defaults reset the v2 values too
    const d5 = settingsToDraft({ ...s, signals: { strongCloses: 5 } });
    expect(d5.sgStrong).toBe("5");
    expect(defaultSignalDraft(d5).sgStrong).toBe("2");
  });

  it("Whale–Retail-Delta: round trip of threshold / fall / window, clamped, unknown window falls back, changed by value", () => {
    const s = { ...defaultSettings(), signals: { whale: { keep: 1, retailPeriod: "30m", deltaRed: -2.5, deltaFall: 0.5, deltaWindow: "2h" } } };
    const d = settingsToDraft(s);
    expect([d.sgWhaleDeltaRed, d.sgWhaleDeltaFall, d.sgWhaleWindow, d.sgWhaleRetail]).toEqual(["-2,5", "0,5", "2h", "30m"]);
    const untouched = draftToSettings(d, s);
    expect(untouched.ok && untouched.settings.signals).toBe(s.signals);
    const r = draftToSettings({ ...d, sgWhaleDeltaRed: "-1", sgWhaleDeltaFall: "2", sgWhaleWindow: "4h" }, s);
    expect(r.ok && (r.settings.signals as { whale: unknown }).whale).toMatchObject({ keep: 1, retailPeriod: "30m", deltaRed: -1, deltaFall: 2, deltaWindow: "4h" });
    if (!r.ok) return;
    const back = settingsToDraft(r.settings);
    expect([back.sgWhaleDeltaRed, back.sgWhaleDeltaFall, back.sgWhaleWindow]).toEqual(["-1", "2", "4h"]);
    // clamps like the engine; an unknown window falls back to 1h
    const c = partsFromDraft({ sgWhaleDeltaRed: "-99", sgWhaleDeltaFall: "-3", sgWhaleWindow: "45m" }, undefined);
    expect(c.ok && [c.patch.whale.deltaRed, c.patch.whale.deltaFall, c.patch.whale.deltaWindow]).toEqual([-20, 0, "1h"]);
    // not a number → refused with the field
    expect(draftToSettings({ ...d, sgWhaleDeltaFall: "x" }, s)).toEqual({ ok: false, error: "numeric", field: "sgWhaleDeltaFall" });
    // compared by value ("-2,5" = "-2.5"), the window by text
    expect(changedKeys({ ...d, sgWhaleDeltaRed: "-2.5" }, d).size).toBe(0);
    expect([...changedKeys({ ...d, sgWhaleWindow: "1h" }, d)]).toEqual(["sgWhaleWindow"]);
    // defaults reset the delta rule too
    expect([defaultSignalDraft(d).sgWhaleDeltaRed, defaultSignalDraft(d).sgWhaleDeltaFall, defaultSignalDraft(d).sgWhaleWindow]).toEqual(["0", "1", "1h"]);
  });

  it("pure helpers: an unknown retail period falls back, partial drafts use the stored values", () => {
    expect(partsToDraft(undefined).sgWhaleRetail).toBe("5m");
    const res = partsFromDraft({ sgWhaleRetail: "2h" }, { sr: { nearAtr: 2 } });
    expect(res.ok && res.patch.whale.retailPeriod).toBe("5m");
    expect(res.ok && res.patch.sr.nearAtr).toBe(2);
  });
});
