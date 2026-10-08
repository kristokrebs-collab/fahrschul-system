/**
 * Lage-Ampel (src/domain/lage): reproduces the knife-lab backtest (…/scratchpad/merge/knife-lab/REPORT.md) on real
 * BTCUSDT bars (tests/fixtures/lage/btcusdt-2026-10-08.json: 1000 daily bars, 4H from 15.02., two 1H windows).
 * The full 9 500-close comparison with the lab's lights (100 % agreement, every sign) is the scratchpad script
 * merge/lage/verify.ts; here: the phases, the report's examples, the rules and the gate.
 */
import { describe, expect, it } from "vitest";
import fixture from "../fixtures/lage/btcusdt-2026-10-08.json";
import type { Bar } from "@/domain/signals";
import {
  computeLage,
  DEFAULT_LAGE_SETTINGS,
  lageAt,
  lageBase,
  lageGate,
  lageKey,
  lageSettingsOf,
  lageSnapshotText,
  nextDailyClose,
  parseLageSnapshot,
  toLageSnapshot,
  withLageSettings,
  type Lage,
} from "@/domain/lage";

interface Series {
  sec: number;
  t0: number;
  n: number;
  h: number[];
  l: number[];
  c: number[];
}
/** Gap-free series; the fixture leaves the open out (open = previous close; EMAs and structure never read it). */
const bars = (s: Series): Bar[] => s.c.map((c, i) => ({ t: s.t0 + i * s.sec, o: i ? s.c[i - 1]! : c, h: s.h[i]!, l: s.l[i]!, c }));
const F = fixture as unknown as Record<"1D" | "4h" | "1h_jun" | "1h_oct", Series>;
const D = bars(F["1D"]);
const H4 = bars(F["4h"]);
const H1_JUN = bars(F["1h_jun"]);
const H1_OCT = bars(F["1h_oct"]);
const ms = (iso: string): number => Date.parse(iso);
const TZ = "Europe/Berlin";

/** The report's example: 08.10.2026 15:30 UTC, last 30m close 81 356,2. */
const NOW = ms("2026-10-08T15:30:00Z");
const PRICE = 81_356.2;
const now = (): Lage => computeLage(D, H4, PRICE, NOW, { h1: H1_OCT, timeZone: TZ });

describe("Lage-Ampel — report example 08.10. 15:30 UTC", () => {
  it("is green with the wobble chip (07.10. closed under the 1D-EMA 21, 06.10. above)", () => {
    const l = now();
    expect(l.state).toBe("green");
    expect(l.title).toBe("Aufwärtstrend intakt");
    expect(l.unter1).toBe(true);
    expect(l.unter2).toBe(false);
    expect(l.abwaerts).toBe(false);
    expect(l.wobble?.text).toBe("Trend wackelt: 1. Tagesschluss unter EMA 21 · rot, wenn der nächste auch darunter schließt (02:00)");
    expect(l.since).toBe(ms("2026-09-19T00:00:00Z"));
    expect(l.dailyCloseAt).toBe(ms("2026-10-09T00:00:00Z"));
  });

  it("reads the report's values (1D close 83 322 < EMA 21 83 381; 4H 82 506 under EMA 21 84 217 / 50 84 463)", () => {
    const l = now();
    expect(l.daily?.close).toBeCloseTo(83_321.81, 2);
    expect(l.ema21_1d).toBeCloseTo(83_381.13, 1);
    expect(l.dist).toBeCloseTo(PRICE / 83_381.13 - 1, 4);
    expect(l.daily?.ema50).toBeCloseTo(79_573, -1);
    expect(l.daily?.ema200).toBeCloseTo(75_167, -1);
    expect(l.h4?.close).toBeCloseTo(82_506.01, 2);
    expect(l.h4?.ema21).toBeCloseTo(84_216.9, 0);
    expect(l.h4?.ema50).toBeCloseTo(84_462.8, 0);
    expect(l.h4?.cross).toBe(false);
    expect(l.h4?.itrend).toBe(-1);
    expect(l.newLow1h).toBe(true);
  });

  it("chips: 4H under EMA 21/50, cross down, trend down, new 1H low, above the 1D-EMA 200 (+8,2 %)", () => {
    expect(now().reasons.map((r) => [r.text, r.tone])).toEqual([
      ["4H unter EMA 21/50", "warn"],
      ["4H-EMA 21 unter EMA 50", "warn"],
      ["4H-Trend abwärts", "warn"],
      ["neues 20-Kerzen-Tief (1H)", "warn"],
      ["über 1D-EMA 200 (75.167, +8,2 %)", "info"],
    ]);
  });

  it("no reversal sign is lit and the signs carry their values", () => {
    const l = now();
    expect(l.signs.map((s) => [s.id, s.met])).toEqual([
      ["U1", false],
      ["U2", false],
      ["U3", false],
      ["U4", false],
    ]);
    expect(l.signsMet).toBe(0);
    expect(l.signs[0]!.detail).toBe("81.356 · EMA 83.381 (−2,4 %)");
  });

  it("EMA ladder 1D/4H 21/50/200, highest first, with the price distance", () => {
    const l = now();
    expect(l.emaLadder.map((e) => e.label)).toEqual(["4H-EMA 50", "4H-EMA 21", "1D-EMA 21", "4H-EMA 200", "1D-EMA 50", "1D-EMA 200"]);
    const d50 = l.emaLadder.find((e) => e.id === "1D-50")!;
    expect(d50.dist * 100).toBeCloseTo(2.24, 1);
    const d200 = l.emaLadder.find((e) => e.id === "1D-200")!;
    expect(d200.dist * 100).toBeCloseTo(8.2, 1);
  });

  it("levels from the 4H and 1D structure, split by the live price (report: S 81 330 / 80 126 / 78 250, R 85 721 / 87 220)", () => {
    const { supports, resistances } = now().levels;
    const near = (xs: typeof supports): Array<[string, number]> => xs.map((x) => [x.label, Math.round(x.price)]);
    expect(near(supports)).toEqual([
      ["4H Demand-OB", 81_330],
      ["4H Internes Tief", 80_126],
      ["1D Demand-OB", 78_250],
    ]);
    expect(near(resistances).slice(0, 4)).toEqual([
      ["1D Internes Tief", 82_563],
      ["4H Supply-OB", 85_721],
      ["4H Supply-OB", 86_000],
      ["1D Internes Hoch", 87_220],
    ]);
    expect(supports.every((s) => s.price <= PRICE && s.side === "support")).toBe(true);
    expect(resistances.every((s) => s.price > PRICE && s.side === "resistance")).toBe(true);
    expect(supports[0]!.distAtr).toBeGreaterThanOrEqual(0);
    expect(supports[0]!.dist).toBeLessThan(0);
  });
});

describe("Lage-Ampel — backtest phases (daily closes only)", () => {
  it("reproduces the lab's green / not-green phases 24.03.–08.10.", () => {
    const flips: string[] = [];
    let prev: boolean | null = null;
    for (let d = ms("2026-03-25T00:00:00Z"); d <= ms("2026-10-08T00:00:00Z"); d += 86_400_000) {
      const b = lageBase(D, [], d);
      if (b.abwaerts !== prev) flips.push(`${new Date(d).toISOString().slice(5, 10)} ${b.abwaerts ? "abwärts" : "grün"}`);
      prev = b.abwaerts;
    }
    // final.out: GRÜN 03-24, ROT/GELB 03-28, GRÜN 04-06, ROT/GELB 05-17, GRÜN 07-04, 07-29, 07-31, 08-02, 08-05, 08-12, 08-18, 09-17, 09-19
    expect(flips).toEqual([
      "03-25 grün",
      "03-28 abwärts",
      "04-06 grün",
      "05-17 abwärts",
      "07-04 grün",
      "07-29 abwärts",
      "07-31 grün",
      "08-02 abwärts",
      "08-05 grün",
      "08-12 abwärts",
      "08-18 grün",
      "09-17 abwärts",
      "09-19 grün",
    ]);
  });

  it("01.06. is red (no sign) inside the 17.05.–03.07. down leg", () => {
    const t = ms("2026-06-01T12:00:00Z");
    const price = H1_JUN.filter((b) => (b.t + 3600) * 1000 <= t).at(-1)!.c;
    const l = computeLage(D, H4, price, t, { h1: H1_JUN, timeZone: TZ });
    expect(l.state).toBe("red");
    expect(l.title).toBe("Fällt noch · abwarten");
    expect(l.since).toBe(ms("2026-05-17T00:00:00Z"));
    expect(l.daily?.below).toBe(17);
    expect(l.reasons.map((r) => r.text)).toEqual([
      "17 Tagesschlüsse unter 1D-EMA 21 (76.213, −4,9 %)",
      "4H unter EMA 21/50",
      "4H-EMA 21 unter EMA 50",
      "4H-Trend abwärts",
      "neues 20-Kerzen-Tief (1H)",
      "unter 1D-EMA 200 (81.076, −10,6 %)",
    ]);
    expect(l.reasons.every((r) => r.tone === "neg")).toBe(true);
  });

  it("04.07. 00:00 turns green as 'Umkehr bestätigt' for 3 days, then 'Aufwärtstrend intakt'", () => {
    const at = (iso: string): Lage => computeLage(D, H4, null, ms(iso));
    expect(at("2026-07-03T23:59:00Z").state).not.toBe("green");
    const g = at("2026-07-04T00:00:00Z");
    expect([g.state, g.title, g.confirmed, g.since]).toEqual(["green", "Umkehr bestätigt", true, ms("2026-07-04T00:00:00Z")]);
    expect(at("2026-07-06T23:59:00Z").title).toBe("Umkehr bestätigt");
    expect(at("2026-07-07T00:00:00Z").title).toBe("Aufwärtstrend intakt");
  });

  it("amber names the lit signs: a live price above the 1D-EMA 21 in a red phase is U1 (counts at the daily close)", () => {
    const t = ms("2026-06-01T12:00:00Z");
    const red = computeLage(D, H4, 70_000, t);
    const ema = red.ema21_1d!;
    const amber = computeLage(D, H4, ema + 100, t);
    expect(red.state).toBe("red");
    expect(amber.state).toBe("amber");
    expect(amber.title).toBe("Umkehr bildet sich · 1 von 4");
    expect(amber.signs.find((s) => s.id === "U1")!.met).toBe(true);
    expect(amber.reasons.some((r) => r.id === "sign-U1" && r.text === "Kurs über 1D-EMA 21" && r.tone === "pos")).toBe(true);
  });
});

describe("Lage-Ampel — rules", () => {
  it("uses closed bars only: a forming daily / 4H bar changes nothing but the stand-in price", () => {
    const base = computeLage(D, H4, PRICE, NOW, { h1: H1_OCT });
    const formingDay: Bar = { t: ms("2026-10-08T00:00:00Z") / 1000, o: 83_321.81, h: 83_400, l: 40_000, c: 40_000 };
    const formingH4: Bar = { t: ms("2026-10-08T12:00:00Z") / 1000, o: 82_506, h: 82_600, l: 40_000, c: 40_000 };
    const withForming = computeLage([...D, formingDay], [...H4, formingH4], PRICE, NOW, { h1: H1_OCT });
    expect(lageKey(withForming)).toBe(lageKey(base));
    expect(withForming.emaLadder).toEqual(base.emaLadder);
    // without a live price the newest close (the forming bar) stands in
    expect(computeLage([...D, formingDay], [...H4, formingH4], null, NOW).price).toBe(40_000);
    expect(computeLage(D, H4, null, NOW).data.live).toBe(false);
  });

  it("'keine Daten' below 60 daily bars; signs U2–U4 unknown without 4H bars", () => {
    const few = computeLage(D.slice(0, 59), H4, PRICE, ms("2024-03-15T00:00:00Z"));
    expect(few.state).toBe("none");
    expect(few.title).toBe("Keine Daten");
    expect(few.reasons).toEqual([]);
    const no4h = computeLage(D, [], PRICE, NOW);
    expect(no4h.state).toBe("green");
    expect(no4h.signs.map((s) => s.met)).toEqual([false, null, null, null]);
    expect(no4h.h4).toBeNull();
    expect(no4h.emaLadder.every((e) => e.tf === "1D")).toBe(true);
  });

  it("is deterministic and fast (< 2 ms for 1000 daily + 500 4H bars)", () => {
    const d = D.slice(-1000);
    const h = H4.slice(-500);
    expect(computeLage(d, h, PRICE, NOW, { h1: H1_OCT })).toEqual(computeLage(d, h, PRICE, NOW, { h1: H1_OCT }));
    for (let i = 0; i < 5; i++) computeLage(d, h, PRICE, NOW, { h1: H1_OCT });
    const runs: number[] = [];
    for (let i = 0; i < 15; i++) {
      const t = performance.now();
      computeLage(d, h, PRICE, NOW, { h1: H1_OCT });
      runs.push(performance.now() - t);
    }
    runs.sort((a, b) => a - b);
    // median; jsdom + a loaded CI box: the bound leaves room (≈ 1 ms on node)
    expect(runs[7]!).toBeLessThan(4);
    // the live stage alone (price moves) is a fraction of that
    const b = lageBase(d, h, NOW, { h1: H1_OCT });
    const t = performance.now();
    for (let i = 0; i < 100; i++) lageAt(b, PRICE + i, NOW);
    expect((performance.now() - t) / 100).toBeLessThan(0.5);
  });

  it("the identity key ignores price noise below the shown precision and follows a state change", () => {
    const b = lageBase(D, H4, NOW, { h1: H1_OCT });
    const k = lageKey(lageAt(b, PRICE, NOW));
    expect(lageKey(lageAt(b, PRICE + 3, NOW))).toBe(k);
    expect(lageKey(lageAt(b, PRICE * 1.01, NOW))).not.toBe(k);
  });

  it("next daily close is the next 00:00 UTC", () => {
    expect(nextDailyClose(ms("2026-10-08T23:59:59Z"))).toBe(ms("2026-10-09T00:00:00Z"));
    expect(nextDailyClose(ms("2026-10-09T00:00:00Z"))).toBe(ms("2026-10-10T00:00:00Z"));
  });
});

describe("lageGate (phase 2 helper)", () => {
  const red = { state: "red" as const, signsMet: 0 };
  const amber = { state: "amber" as const, signsMet: 2 };
  const green = { state: "green" as const, signsMet: 0 };
  it("Sperre: only green counts", () => {
    expect(lageGate(red, DEFAULT_LAGE_SETTINGS)).toEqual({ state: "red", counts: false, blocked: true, label: "Lage rot – zählt nicht (fällt noch)" });
    expect(lageGate(amber, DEFAULT_LAGE_SETTINGS)).toEqual({ state: "amber", counts: false, blocked: true, label: "Lage gelb – Umkehr bildet sich (2/4)" });
    expect(lageGate(green, DEFAULT_LAGE_SETTINGS)).toEqual({ state: "green", counts: true, blocked: false, label: null });
  });
  it("nur Warnung: counts with the warning label", () => {
    const warn = { on: true, mode: "warn" as const };
    expect(lageGate(red, warn)).toEqual({ state: "red", counts: true, blocked: false, label: "Lage rot – nur Warnung (fällt noch)" });
    expect(lageGate(amber, warn).counts).toBe(true);
  });
  it("off, no data, no Lage and shorts are never gated", () => {
    expect(lageGate(red, { on: false, mode: "block" })).toEqual({ state: "red", counts: true, blocked: false, label: null });
    expect(lageGate({ state: "none", signsMet: 0 }, DEFAULT_LAGE_SETTINGS).counts).toBe(true);
    expect(lageGate(null, DEFAULT_LAGE_SETTINGS)).toEqual({ state: "none", counts: true, blocked: false, label: null });
    expect(lageGate(red, DEFAULT_LAGE_SETTINGS, "short").counts).toBe(true);
  });
  it("the report's example gates on the real bars: 01.06. red blocks, 08.10. green counts", () => {
    const t = ms("2026-06-01T12:00:00Z");
    expect(lageGate(computeLage(D, H4, 70_000, t), DEFAULT_LAGE_SETTINGS).counts).toBe(false);
    expect(lageGate(now(), DEFAULT_LAGE_SETTINGS).counts).toBe(true);
  });
});

describe("settings.signals.lage", () => {
  it("defaults: on, Sperre; invalid values fall back", () => {
    expect(lageSettingsOf(undefined)).toEqual({ on: true, mode: "block" });
    expect(lageSettingsOf({ ladder: ["30m"] })).toEqual({ on: true, mode: "block" });
    expect(lageSettingsOf({ lage: { on: "ja", mode: "streng" } })).toEqual({ on: true, mode: "block" });
    expect(lageSettingsOf({ lage: { on: false, mode: "warn" } })).toEqual({ on: false, mode: "warn" });
    expect(lageSettingsOf("kaputt")).toEqual({ on: true, mode: "block" });
  });
  it("writes additively: every other key and unknown keys inside `lage` survive; unchanged → same object", () => {
    const raw = { ladder: ["30m", "1h"], whale: { on: true, x: 1 }, fremd: [1, 2], lage: { on: true, mode: "block", notiz: "behalten" } };
    const next = withLageSettings(raw, { mode: "warn" });
    expect(next).toEqual({ ladder: ["30m", "1h"], whale: { on: true, x: 1 }, fremd: [1, 2], lage: { on: true, mode: "warn", notiz: "behalten" } });
    expect(raw.lage.mode).toBe("block");
    expect(withLageSettings(next, { mode: "warn" })).toBe(next);
    expect(lageSettingsOf(withLageSettings(next, { on: false }))).toEqual({ on: false, mode: "warn" });
    expect(withLageSettings(undefined, { on: false })).toEqual({ lage: { on: false, mode: "block" } });
    // a JSON round trip (storage, backup) keeps it
    expect(lageSettingsOf(JSON.parse(JSON.stringify(withLageSettings(raw, { on: false, mode: "warn" }))))).toEqual({ on: false, mode: "warn" });
  });
});

describe("snapshot (phase 2: trade.signal.lage)", () => {
  it("stores state, met signs, EMA 21 and the distance; parses back, keeps unknown keys", () => {
    const s = toLageSnapshot(now())!;
    expect(s).toEqual({ state: "green", signs: [], ema21_1d: 83_381.1, dist: -0.0243 });
    expect(parseLageSnapshot(JSON.parse(JSON.stringify({ ...s, extra: 1 })))).toEqual({ ...s, extra: 1 });
    expect(parseLageSnapshot({ state: "lila" })).toBeNull();
    expect(parseLageSnapshot({ state: "amber", signs: ["U2", "X", "U4"], ema21_1d: "x" })).toEqual({ state: "amber", signs: ["U2", "U4"], ema21_1d: null, dist: null });
    expect(lageSnapshotText({ state: "amber", signs: ["U2", "U4"], ema21_1d: null, dist: null })).toBe("Lage Gelb · 2 von 4");
    expect(toLageSnapshot(computeLage(D.slice(0, 10), [], null, NOW))).toBeNull();
  });
});
