/**
 * Squeeze observation (F07): the three readings against their thresholds, how they combine, the freshness rule, the
 * earlier episodes with what followed (a synthetic archive worked out by hand), the box context and the settings key.
 */
import { describe, expect, it } from "vitest";
import {
  DEFAULT_SQUEEZE_CFG,
  accountsSignal,
  combine,
  coverageHours,
  evaluateNow,
  findEpisodes,
  fundingSignal,
  oiSignal,
  sampleWord,
  situationOf,
  squeezeCfgOf,
  summarize,
  withSqueeze,
  type SqueezeCfg,
  type SqueezeData,
} from "@/domain/squeeze";

const MIN = 60_000;
const H = 60 * MIN;
const CFG = DEFAULT_SQUEEZE_CFG; // funding 0,05 % · OI +5 % in 4 h · Long ≥ 65 % / ≤ 35 % · 2 of 3 · alerts off

describe("squeeze config", () => {
  it("defaults: thresholds as documented, the alert OFF", () => {
    expect(CFG).toEqual({ fundingPct: 0.05, oiRisePct: 5, oiHours: 4, longPct: 65, minMet: 2, alerts: false });
    expect(squeezeCfgOf(undefined)).toEqual(CFG);
    expect(squeezeCfgOf({ alerts: "true" }).alerts).toBe(false);
    expect(squeezeCfgOf({ alerts: true }).alerts).toBe(true);
  });

  it("clamps numbers and falls back on unknown choices", () => {
    expect(squeezeCfgOf({ fundingPct: 9, oiRisePct: 0, longPct: 10, oiHours: 7, minMet: 5 })).toEqual({ ...CFG, fundingPct: 0.5, oiRisePct: 1, longPct: 55 });
  });

  it("withSqueeze keeps unknown keys, writes the version and returns the same object when nothing changes", () => {
    const stored = { v: 1, ...CFG, future: { x: 1 } };
    expect(withSqueeze(stored, { minMet: 2 })).toBe(stored);
    const next = withSqueeze(stored, { minMet: 3, alerts: true });
    expect(next).toMatchObject({ v: 1, minMet: 3, alerts: true, future: { x: 1 } });
    expect(withSqueeze(undefined, {})).toMatchObject({ v: 1, ...CFG });
  });
});

describe("the three readings", () => {
  it("funding: 0,060 % is extreme long; exactly −0,050 % is extreme short; 0,049 % is not; a missing value is 'keine Daten'", () => {
    expect(fundingSignal({ t: 0, mark: 1, rate: 0.0006 }, CFG)).toMatchObject({ met: true, side: "long", text: "+0,060 % je Abrechnung" });
    expect(fundingSignal({ t: 0, mark: 1, rate: -0.0005 }, CFG)).toMatchObject({ met: true, side: "short", text: "−0,050 % je Abrechnung" });
    expect(fundingSignal({ t: 0, mark: 1, rate: 0.00049 }, CFG)).toMatchObject({ met: false, side: null });
    expect(fundingSignal({ t: 0, mark: 1, rate: null }, CFG)).toMatchObject({ met: null, text: "keine Daten" });
    expect(fundingSignal(null, CFG).met).toBeNull();
    expect(fundingSignal(null, CFG).threshold).toBe("≥ 0,050 % oder ≤ −0,050 % je Abrechnung");
  });

  it("open interest: 1 000 → 1 062 in 4 h is +6,2 % (met); 1 049 is +4,9 % (not met)", () => {
    const at = (end: number) => [{ t: 0, oi: 1000 }, { t: 4 * H, oi: end }];
    expect(oiSignal(at(1062), 4 * H, CFG)).toMatchObject({ met: true, text: "+6,2 % in 4 h", side: null });
    expect(oiSignal(at(1049), 4 * H, CFG)).toMatchObject({ met: false, text: "+4,9 % in 4 h" });
    expect(oiSignal(at(1062), 4 * H, CFG).threshold).toBe("≥ +5,0 % in 4 h");
  });

  it("open interest: the value from 4 h earlier is taken within 24 minutes (10 % of the window); further away it is 'keine Daten' with the reason", () => {
    expect(oiSignal([{ t: 24 * MIN, oi: 1000 }, { t: 4 * H + 24 * MIN, oi: 1100 }], 4 * H + 24 * MIN, CFG).met).toBe(true); // exactly on the point
    // nearest earlier point is 25 minutes off
    const far = oiSignal([{ t: 0, oi: 1000 }, { t: 4 * H + 25 * MIN, oi: 1100 }], 4 * H + 25 * MIN, CFG);
    expect(far).toMatchObject({ met: null, text: "keine Daten" });
    expect(far.note).toContain("vor 4 h");
    expect(far.note).toContain("erst 4,4 h");
    // 24 minutes off is still fine
    expect(oiSignal([{ t: 0, oi: 1000 }, { t: 4 * H + 24 * MIN, oi: 1100 }], 4 * H + 24 * MIN, CFG).met).toBe(true);
  });

  it("open interest: the newest value must be fresh (≤ 15 min)", () => {
    expect(oiSignal([{ t: 0, oi: 1000 }, { t: 4 * H, oi: 1100 }], 4 * H + 16 * MIN, CFG).met).toBeNull();
    expect(oiSignal([], 0, CFG).met).toBeNull();
  });

  it("accounts: 67,3 % long is one-sided long; 34 % is one-sided short; 50 % is not; a split older than 20 minutes is 'keine Daten'", () => {
    expect(accountsSignal([{ t: 0, long: 67.3 }], 0, CFG)).toMatchObject({ met: true, side: "long", text: "Long 67,3 % · Short 32,7 %" });
    expect(accountsSignal([{ t: 0, long: 34 }], 0, CFG)).toMatchObject({ met: true, side: "short" });
    expect(accountsSignal([{ t: 0, long: 35 }], 0, CFG)).toMatchObject({ met: true, side: "short" });
    expect(accountsSignal([{ t: 0, long: 50 }], 0, CFG)).toMatchObject({ met: false, side: null });
    expect(accountsSignal([{ t: 0, long: 70 }], 21 * MIN, CFG).met).toBeNull();
    expect(accountsSignal([{ t: 0, long: 70 }], 20 * MIN, CFG).met).toBe(true);
    expect(accountsSignal([], 0, CFG).threshold).toBe("Long ≥ 65 % oder ≤ 35 %");
  });
});

describe("combining", () => {
  const sig = (key: "funding" | "oi" | "accounts", met: boolean | null, side: "long" | "short" | null = null) => ({ key, label: key, value: null, text: "", threshold: "", met, side, at: null, note: null });
  const cfg = (minMet: SqueezeCfg["minMet"]): SqueezeCfg => ({ ...CFG, minMet });

  it("all three on one side: watch, 3 of 3", () => {
    expect(combine([sig("funding", true, "long"), sig("oi", true), sig("accounts", true, "long")], cfg(2))).toEqual({ state: "watch", side: "long", met: 3, known: 3 });
  });
  it("two directional readings agree without the open interest: 2 of 3 – watch at minimum 2, calm at minimum 3", () => {
    const s = [sig("funding", true, "short"), sig("oi", false), sig("accounts", true, "short")];
    expect(combine(s, cfg(2))).toMatchObject({ state: "watch", side: "short", met: 2 });
    expect(combine(s, cfg(3))).toMatchObject({ state: "calm", side: "short", met: 2 });
  });
  it("funding and accounts pointing to opposite sides: conflict, no observation", () => {
    expect(combine([sig("funding", true, "long"), sig("oi", true), sig("accounts", true, "short")], cfg(1))).toMatchObject({ state: "conflict", side: null });
  });
  it("open interest alone never makes an observation", () => {
    expect(combine([sig("funding", false), sig("oi", true), sig("accounts", false)], cfg(1))).toMatchObject({ state: "calm", side: null, met: 0 });
  });
  it("one directional reading plus the rise: 2 of 3", () => {
    expect(combine([sig("funding", true, "long"), sig("oi", true), sig("accounts", false)], cfg(2))).toMatchObject({ state: "watch", met: 2 });
    expect(combine([sig("funding", true, "long"), sig("oi", false), sig("accounts", false)], cfg(2))).toMatchObject({ state: "calm", met: 1 });
    expect(combine([sig("funding", true, "long"), sig("oi", false), sig("accounts", false)], cfg(1))).toMatchObject({ state: "watch", met: 1 });
  });
  it("readings without data are not counted as met; with no data at all there is nothing to read", () => {
    expect(combine([sig("funding", true, "long"), sig("oi", null), sig("accounts", null)], cfg(2))).toMatchObject({ state: "calm", known: 1 });
    expect(combine([sig("funding", null), sig("oi", null), sig("accounts", null)], cfg(2)).state).toBe("nodata");
  });
});

describe("evaluateNow", () => {
  const data = (lastAt: number): SqueezeData => ({
    premium: [{ t: lastAt - 4 * H, mark: 99, rate: 0.0001 }, { t: lastAt, mark: 100, rate: 0.0007 }],
    oi: [{ t: lastAt - 4 * H, oi: 1000 }, { t: lastAt, oi: 1100 }],
    ls: [{ t: lastAt, long: 70 }],
    top: [{ t: lastAt, long: 45 }],
  });

  it("reads the newest sample when it is recent: funding 0,07 %, OI +10 %, 70 % long → long side crowded, 3 of 3", () => {
    const r = evaluateNow(data(10 * H), CFG, 10 * H + 5 * MIN, 10);
    expect(r).toMatchObject({ state: "watch", side: "long", met: 3, known: 3, stale: false, mark: 100, topLong: { pct: 45, at: 10 * H } });
    expect(r.signals.map((s) => s.met)).toEqual([true, true, true]);
  });

  it("an archive that is not being written (newest sample older than 2,5 intervals, at least 30 minutes) gives no reading", () => {
    // interval 10 min → limit max(30, 25) = 30 min
    expect(evaluateNow(data(10 * H), CFG, 10 * H + 30 * MIN, 10).state).toBe("watch");
    const stale = evaluateNow(data(10 * H), CFG, 10 * H + 31 * MIN, 10);
    expect(stale).toMatchObject({ state: "nodata", stale: true, known: 0, at: 10 * H });
    // interval 15 min → limit 37,5 min
    expect(evaluateNow(data(10 * H), CFG, 10 * H + 37 * MIN, 15).state).toBe("watch");
    expect(evaluateNow(data(10 * H), CFG, 10 * H + 38 * MIN, 15).state).toBe("nodata");
  });

  it("an empty archive: nodata, not stale", () => {
    expect(evaluateNow({ premium: [], oi: [], ls: [] }, CFG, 0, 10)).toMatchObject({ state: "nodata", stale: false, at: null });
  });
});

describe("earlier episodes and what followed (synthetic archive, 10-minute samples, 0 … 36 h)", () => {
  const hours = (n: number) => n * H;
  const at = (t: number, a: number, b: number) => t >= hours(a) && t <= hours(b);
  const mark = (t: number): number => (t <= hours(12) ? 100 : t <= hours(23.5) ? 97 : t <= hours(35.5) ? 98 : 101);
  const samples = Array.from({ length: 36 * 6 + 1 }, (_, i) => i * 10 * MIN);
  const data: SqueezeData = {
    premium: samples.map((t) => ({ t, mark: mark(t), rate: at(t, 12, 13) ? 0.0007 : at(t, 20, 21) ? -0.0007 : 0.0001 })),
    oi: samples.map((t) => ({ t, oi: t < hours(10) ? 1000 : 1080 })),
    ls: samples.map((t) => ({ t, long: at(t, 12, 13) ? 70 : at(t, 20, 21) ? 30 : 50 })),
  };

  it("finds two episodes, each counted once", () => {
    const eps = findEpisodes(data, CFG);
    // 12:00 … 13:00 = 7 samples: funding +0,07 %, 70 % long, OI +8 % (1 080 / 1 000) → 3 of 3 long
    // 20:00 … 21:00 = 7 samples: funding −0,07 %, 30 % long (short), OI flat since 16:00 → 2 of 3 short
    // from 10:00 to 11:50 only the OI rises → no side → no episode
    expect(eps.map((e) => [e.side, e.start / H, e.end / H, e.samples])).toEqual([
      ["long", 12, 13, 7],
      ["short", 20, 21, 7],
    ]);
    expect(eps[0]!.mark0).toBe(100);
    expect(eps[1]!.mark0).toBe(97);
  });

  it("price after 4 h and after 24 h, in favour of the crowd", () => {
    const [a, b] = findEpisodes(data, CFG);
    // long crowd from 100 (12:00) to 97 (16:00): −3 % → against it; after 24 h (36:00) 101: +1 % → with it
    expect(a!.edge[4]).toBeCloseTo(-0.03, 10);
    expect(a!.edge[24]).toBeCloseTo(0.01, 10);
    // short crowd from 97 (20:00) to 98 (24:00): the price rose 1,03 % → against the shorts: −1,03 %; 44:00 is beyond the archive → no outcome
    expect(b!.edge[4]).toBeCloseTo(-(98 / 97 - 1), 10);
    expect(b!.edge[24]).toBeNull();
  });

  it("summary with sample word, counter-examples and spread", () => {
    const eps = findEpisodes(data, CFG);
    const s4 = summarize(eps, 4);
    expect(s4).toMatchObject({ hours: 4, n: 2, against: 2, withCrowd: 0, word: "zu wenig" });
    expect(s4.median).toBeCloseTo((-0.03 - (98 / 97 - 1)) / 2, 10);
    expect(s4.min).toBeCloseTo(-0.03, 10);
    expect(s4.max).toBeCloseTo(-(98 / 97 - 1), 10);
    const s24 = summarize(eps, 24);
    expect(s24).toMatchObject({ n: 1, against: 0, withCrowd: 1, word: "zu wenig" });
    expect(summarize(eps, 4, "long")).toMatchObject({ n: 1, against: 1 });
    expect(summarize([], 4)).toMatchObject({ n: 0, median: null, min: null, word: "keine" });
  });

  it("a gap breaks an episode (samples further than 40 minutes apart are not one episode)", () => {
    const gapped: SqueezeData = { ...data, premium: data.premium.filter((p) => !(p.t > hours(12.2) && p.t < hours(12.8))) };
    // 12:00, 12:10 | 12:50, 13:00 – 12:10 to 12:50 is exactly 40 minutes, still one episode (4 samples)
    expect(findEpisodes(gapped, CFG)[0]!.samples).toBe(4);
    const wide: SqueezeData = { ...data, premium: data.premium.filter((p) => !(p.t > hours(12.1) && p.t < hours(12.9))) };
    // 12:00 | 13:00 – 60 minutes apart → two episodes of one sample each
    const eps = findEpisodes(wide, CFG).filter((e) => e.side === "long");
    expect(eps.map((e) => [e.start / H, e.samples])).toEqual([[12, 1], [13, 1]]);
  });

  it("sample words and coverage", () => {
    expect([0, 1, 4, 5, 9, 10].map(sampleWord)).toEqual(["keine", "zu wenig", "zu wenig", "dünn", "dünn", "tragfähig"]);
    expect(coverageHours(data)).toBe(36);
    expect(coverageHours({ premium: [], oi: [], ls: [] })).toBe(0);
  });
});

describe("box context", () => {
  it("a breakout up with crowded longs is 'with the crowd'; with crowded shorts 'against'", () => {
    const up = [{ tf: "4h" as const, phase: "breakout" as const, dir: 1 as const }];
    expect(situationOf("long", up)).toMatchObject({ tf: "4h", timing: "after", relation: "with" });
    expect(situationOf("long", up)!.text).toContain("Ausbruch nach oben (4h) in Richtung der überfüllten Long-Seite");
    expect(situationOf("short", up)).toMatchObject({ timing: "after", relation: "against" });
    expect(situationOf("short", up)!.text).toContain("gegen die überfüllte Short-Seite");
    expect(situationOf("short", up)!.text).toContain("Squeeze ist möglich");
  });

  it("a failed breakout names its direction; the box was left upward by the crowd's side → 'with'", () => {
    const failed = [{ tf: "1d" as const, phase: "failed" as const, dir: 1 as const }];
    expect(situationOf("long", failed)).toMatchObject({ timing: "failed", relation: "with" });
    expect(situationOf("long", failed)!.text).toContain("Fehlausbruch nach oben (1D) bei überfüllter Long-Seite");
    expect(situationOf("short", failed)).toMatchObject({ timing: "failed", relation: "against" });
  });

  it("an event beats 'still inside', 4h beats 1D beats 1W; without a box there is no context", () => {
    const ctx = [{ tf: "4h" as const, phase: "inside" as const, dir: 0 as const }, { tf: "1d" as const, phase: "retest" as const, dir: -1 as const }, { tf: "1w" as const, phase: "breakout" as const, dir: 1 as const }];
    expect(situationOf("short", ctx)).toMatchObject({ tf: "1d", timing: "after", relation: "with" });
    expect(situationOf("long", [{ tf: "4h", phase: "inside", dir: 0 }])).toMatchObject({ tf: "4h", timing: "before", relation: null });
    expect(situationOf("long", [{ tf: "4h", phase: "none", dir: 0 }])).toBeNull();
    expect(situationOf("long", [])).toBeNull();
  });
});
