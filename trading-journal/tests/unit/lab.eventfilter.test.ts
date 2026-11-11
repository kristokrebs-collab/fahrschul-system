/**
 * F43 – the Labor filter "Keine Einstiege X Minuten vor/nach einem Termin": the stored choice (versioned, limited), the
 * listing among the filters (only once chosen, like the pattern filter), the mask on REAL BTCUSDT 4h bars (counted by hand)
 * and one pass through the filter comparison.
 */
import { describe, expect, it } from "vitest";
import { createExtraJob } from "@/domain/lab/extras/job";
import { activeFilters, DEFAULT_FILTERS, FAIL, filterInfos, PASS, sanitizeFilters, variantPlan, type FilterSelection } from "@/domain/lab/filters";
import { eventMask } from "@/domain/events";
import { H4, realInput } from "./lab.extras.helpers";

describe("the stored choice", () => {
  it("keeps minutes and kinds only when they are valid, rounds the minutes to the step and does not add keys on its own", () => {
    expect(sanitizeFilters(null)).toEqual(DEFAULT_FILTERS);
    expect(sanitizeFilters({ v: 1, on: ["event"], eventMinutes: 100, eventKinds: ["usOpen", "nope", "funding"] })).toMatchObject({ on: ["event"], eventMinutes: 105, eventKinds: ["funding", "usOpen"] });
    expect(sanitizeFilters({ v: 1, on: ["event"], eventMinutes: 5000 }).eventMinutes).toBe(240);
    expect(sanitizeFilters({ v: 1, on: ["event"], eventMinutes: 1 }).eventMinutes).toBe(15);
    const bad = sanitizeFilters({ v: 1, on: ["event"], eventMinutes: "x", eventKinds: ["fomc"] });
    expect("eventMinutes" in bad).toBe(false);
    expect("eventKinds" in bad).toBe(false);
  });

  it("is listed among the filters only once chosen – with its sentence – and then counts as active on every strategy", () => {
    expect(filterInfos("custom", "4h").some((f) => f.id === "event")).toBe(false);
    const sel = sanitizeFilters({ v: 1, on: ["event"], eventMinutes: 90, eventKinds: ["funding", "expiry"] });
    const info = filterInfos("custom", "4h", sel).find((f) => f.id === "event")!;
    expect(info).toMatchObject({ available: true, reason: null, label: "Keine Einstiege rund um Termine" });
    expect(info.sub).toContain("90 Minuten");
    expect(info.sub).toContain("Funding, Verfall");
    for (const s of ["box", "mcb", "rules", "custom"] as const) expect(activeFilters(sel, s, "4h")).toEqual(["event"]);
    expect(variantPlan(["rsi", "event"]).map((v) => v.label)).toEqual(["Ohne Filter", "Nur RSI-Zone", "Nur Terminfilter", "Alle gewählten"]);
  });
});

describe("the mask on real 4h bars", () => {
  const sec = 14_400;
  const mask = eventMask(H4, sec, 60, ["funding"]);

  it("blocks exactly the entries that fall within an hour of 00:00, 08:00 or 16:00 UTC – on a 4h grid those at 00, 08 and 16 o'clock", () => {
    // the entry is the next bar's open (t + 4 h); a 4h bar opens at 00/04/08/12/16/20: the three on the grid are inside ±60 min
    const expected = H4.filter((b) => (((b.t + sec) % 28_800) === 0)).length;
    expect(expected).toBeGreaterThan(100);
    let fail = 0;
    for (let i = 0; i < H4.length; i++) {
      const open = (H4[i]!.t + sec) % 86_400;
      const onGrid = open === 0 || open === 28_800 || open === 57_600;
      expect(mask.long[i], `bar ${i}`).toBe(onGrid ? FAIL : PASS);
      expect(mask.short[i]).toBe(mask.long[i]);
      if (mask.long[i] === FAIL) fail++;
    }
    expect(fail).toBe(expected);
  });

  it("with all three kinds blocks more, never fewer, and never answers 'unknown'", () => {
    const all = eventMask(H4, sec, 60, ["funding", "expiry", "usOpen"]);
    let more = 0;
    for (let i = 0; i < H4.length; i++) {
      if (mask.long[i] === FAIL) expect(all.long[i]).toBe(FAIL);
      if (all.long[i] === FAIL && mask.long[i] === PASS) more++;
      expect([PASS, FAIL]).toContain(all.long[i]);
    }
    // the US open (09:30 ET = 13:30 / 14:30 UTC) lies 1,5 – 2,5 h after the 12:00 bar open: ±60 min catches no 4h entry; the expiry at 08:00 UTC coincides with a funding entry
    expect(more).toBe(0);
    // ±240 minutes around the US open does catch the 12:00 and 16:00 UTC entries on trading days
    const wide = eventMask(H4, sec, 240, ["usOpen"]);
    expect([...wide.long].filter((v) => v === FAIL).length).toBeGreaterThan(100);
  });

  it("is built by the filter comparison from the stored choice", () => {
    const sel: FilterSelection = { ...DEFAULT_FILTERS, on: ["event"], eventMinutes: 60, eventKinds: ["funding"] };
    const input = realInput();
    const job = createExtraJob({ base: input, what: "filters", filters: sel });
    const out = job.result();
    if (out.what !== "filters") throw new Error("filters expected");
    expect(out.compare.active).toEqual(["event"]);
    expect(out.compare.rows.map((r) => r.id)).toEqual(["base", "only:event"]);
    const only = out.compare.rows[1]!;
    expect(only.label).toBe("Nur Terminfilter");
    expect(only.asked).toBeGreaterThan(0);
    // signals of the run on the funding grid are rejected; the others pass
    expect(only.blocked).toBeGreaterThan(0);
    expect(only.blocked).toBeLessThanOrEqual(only.asked);
    expect(only.unknown).toBe(0);
    // deterministic and JSON-safe
    expect(JSON.parse(JSON.stringify(out))).toEqual(out);
    expect(createExtraJob({ base: input, what: "filters", filters: sel }).result()).toEqual(out);
  }, 60_000);
});
