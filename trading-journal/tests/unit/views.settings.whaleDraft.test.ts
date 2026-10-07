import { describe, expect, it } from "vitest";
import { defaultSettings } from "@/domain/defaults";
import { changedKeys, defaultSignalDraft, draftToSettings, settingsToDraft } from "@/views/settings/draft";
describe("settings draft: Top-Trader kaufen · Retail rot", () => {
  it("round trip, merge, refusal, defaults, changed keys", () => {
    const s = { ...defaultSettings(), signals: { foo: 1, whale: { keep: 2, on: true } } };
    const d = settingsToDraft(s);
    expect([d.sgWhale, d.sgWhalePeriods, d.sgWhaleMin, d.sgWhaleWeight]).toEqual(["on", "30m,1h", "2", "10"]);
    const untouched = draftToSettings(d, s);
    expect(untouched.ok && untouched.settings.signals).toBe(s.signals);
    const r = draftToSettings({ ...d, sgWhale: "", sgWhalePeriods: "4h,1h", sgWhaleMin: "3", sgWhaleWeight: "0" }, s);
    expect(r.ok).toBe(true);
    if (r.ok) expect((r.settings.signals as { whale?: unknown }).whale).toEqual({ keep: 2, on: false, periods: ["1h", "4h"], minRun: 3, weight: 0 });
    if (r.ok) expect((r.settings.signals as { foo?: unknown }).foo).toBe(1);
    expect(draftToSettings({ ...d, sgWhalePeriods: "" }, s)).toEqual({ ok: false, error: "numeric", field: "sgWhalePeriods" });
    expect(defaultSignalDraft(d).sgWhale).toBe("on");
    expect(changedKeys({ ...d, sgWhalePeriods: "1h,30m" }, d).size).toBe(0);
    expect([...changedKeys({ ...d, sgWhaleMin: "4" }, d)]).toContain("sgWhaleMin");
  });
});
