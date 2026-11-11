/**
 * Kaufthese (F69), domain part: `settings.theses` (versioned, passthrough, per-id cloud merge), the scenarios through the DCF
 * (hand-worked numbers), the refutation criteria against filed numbers (triggered / clear / unknown), the check state and its
 * "new quarter" logic, versions as immutable snapshots.
 */
import { describe, expect, it } from "vitest";
import { analyse } from "@/domain/analyst";
import {
  actualText,
  checkDue,
  checkThesis,
  diffSnapshots,
  computeAll,
  computeScenario,
  criterionText,
  evaluateCriteria,
  newThesis,
  saveVersion,
  snapshotOfThesis,
  thesesCfgOf,
  thesisOf,
  updateThesis,
  versusPrice,
  whatMustHold,
  withTheses,
  type Criterion,
  type Thesis,
} from "@/domain/thesis";
import { merge3 } from "@/store/merge3";
import { factsPayload } from "../fixtures/sec";

const NOW = Date.UTC(2026, 9, 25, 12);
const nwin = analyse(factsPayload("NWIN"), { now: NOW });
const aapl = analyse(factsPayload("AAPL"), { now: NOW });

/** the hand case of `dcf.test.ts` as a thesis: 24.35 per share in the base scenario */
function handThesis(id = "t1"): Thesis {
  const t = newThesis({ id, ticker: "NWIN" }, 1000);
  return updateThesis(
    t,
    {
      horizonYears: 3,
      base: { revenue: 1000, ebitMargin: 0.2, taxRate: 0.25, netDebt: 200, shares: 50, currency: "USD", sourceNote: "eigene Eingabe" },
      scenarios: {
        bear: { growthStart: 0.02, growthEnd: 0.02, marginEnd: 0.15, reinvest: 0.4, wacc: 0.1, terminalGrowth: 0.02, note: "" },
        base: { growthStart: 0.1, growthEnd: 0.1, marginEnd: 0.2, reinvest: 0.4, wacc: 0.1, terminalGrowth: 0.02, note: "" },
        bull: { growthStart: 0.15, growthEnd: 0.15, marginEnd: 0.25, reinvest: 0.4, wacc: 0.1, terminalGrowth: 0.02, note: "" },
      },
    },
    2000,
  );
}

describe("scenarios through the DCF", () => {
  it("base scenario = the hand-worked 24.35 per share, with a range around it", () => {
    const v = computeScenario(handThesis(), "base");
    expect(v.missing).toEqual([]);
    expect(v.perShare).toBeCloseTo(24.35, 9);
    expect(v.range!.low).toBeCloseTo(20.0198, 3);
    expect(v.range!.high).toBeCloseTo(30.6727, 3);
    expect(v.result!.value!.terminalShare!).toBeGreaterThan(0.5);
  });

  it("orders bear < base < bull for the same horizon and names what is missing, never fills it", () => {
    const all = computeAll(handThesis());
    expect(all.bear.perShare!).toBeLessThan(all.base.perShare!);
    expect(all.base.perShare!).toBeLessThan(all.bull.perShare!);
    const t = updateThesis(handThesis(), { scenarios: { ...handThesis().scenarios, bull: { growthStart: 0.15, growthEnd: null, marginEnd: null, reinvest: 0.4, wacc: null, terminalGrowth: 0.02, note: "" } } }, 3000);
    const bull = computeAll(t).bull;
    expect(bull.perShare).toBeNull();
    expect(bull.missing).toEqual(["Wachstum letztes Jahr", "EBIT-Marge letztes Jahr", "WACC"]);
    expect(computeAll(newThesis({ id: "x" }, 1)).base.missing).toContain("Umsatz im Basisjahr");
  });

  it("compares with the typed price only when it comes with a source", () => {
    const price = { value: 20, date: "2026-10-24", source: "eigene Eingabe, Broker-Kurs" };
    expect(versusPrice(24.35, price)).toBeCloseTo(0.2175, 9);
    expect(versusPrice(24.35, { ...price, source: " " })).toBeNull();
    expect(versusPrice(24.35, null)).toBeNull();
    expect(versusPrice(null, price)).toBeNull();
  });

  it("'was müsste stimmen': the growth that doubles the value of the base scenario", () => {
    const t = handThesis();
    const r = whatMustHold(t, "base", 24.35 * 2);
    expect(r.reason).toBe("ok");
    expect(r.growth!).toBeGreaterThan(0.1);
    const check = computeScenario(updateThesis(t, { scenarios: { ...t.scenarios, base: { ...t.scenarios.base, growthStart: r.growth, growthEnd: r.growth } } }, 5000), "base");
    expect(check.perShare!).toBeCloseTo(48.7, 3);
  });
});

describe("refutation criteria", () => {
  const c = (id: string, metric: Criterion["metric"], op: Criterion["op"], value: number): Criterion => ({ id, metric, op, value, note: "" });

  it("reads each condition as a sentence", () => {
    expect(criterionText(c("a", "revenueYoY", "<", 5))).toBe("Umsatzwachstum zum Vorjahresquartal unter 5 %");
    expect(criterionText(c("b", "grossMargin", ">=", 43.5))).toBe("Bruttomarge mindestens 43,5 %");
    expect(criterionText(c("c", "netDebt", ">", 100))).toBe("Nettoverschuldung über 100 Mio.");
    expect(criterionText(c("d", "epsDiluted", "<=", 1.2))).toBe("Verwässertes EPS des Quartals höchstens 1,2 je Aktie");
  });

  it("checks the newest quarter of NWIN: triggered, clear, unknown – with the actual numbers", () => {
    const list = [
      c("g", "revenueYoY", "<", 5), // +12.5 % → clear
      c("m", "grossMargin", "<", 43), // 42.2 % → triggered
      c("n", "netDebt", ">", 100), // 130 Mio. → triggered
      c("f", "freeCashFlow", "<", 20), // 24 Mio. → clear
      c("e", "epsYoY", "<", 0), // +8.3 % → clear
      c("s", "sharesYoY", ">", 3), // 0 % → clear
      c("o", "operatingMargin", "<", 10), // 14.1 % → clear
    ];
    const r = evaluateCriteria(list, nwin);
    const by = Object.fromEntries(r.map((x) => [x.id, x]));
    expect(by.g).toMatchObject({ status: "clear" });
    expect(by.g!.actual!).toBeCloseTo(12.5, 6);
    expect(by.m).toMatchObject({ status: "triggered" });
    expect(by.m!.actual!).toBeCloseTo((57 / 135) * 100, 6);
    expect(by.m!.text).toBe("Ausgelöst: Bruttomarge ist 42,2 % (Bedingung: unter 43 %), Quartal bis 30.09.2025.");
    expect(by.n).toMatchObject({ status: "triggered", actual: 130 });
    expect(by.n!.text).toContain("130,0 Mio. USD");
    expect(by.f).toMatchObject({ status: "clear", actual: 24 });
    expect(by.e!.status).toBe("clear");
    expect(by.s).toMatchObject({ status: "clear", actual: 0 });
    expect(by.o!.status).toBe("clear");
  });

  it("is 'unknown' – not 'clear' – when the number is not in the data, and says why", () => {
    const r = evaluateCriteria([c("a", "operatingMargin", "<", 20), c("b", "netDebt", ">", 1), c("c", "freeCashFlow", "<", 0)], aapl);
    for (const x of r) expect(x.status).toBe("unknown");
    expect(r[0]!.text).toBe("Keine Daten für das Quartal bis 27.06.2026: Operative Marge unter 20 %. (nicht in den Daten)");
    // a percentage against a zero or negative base would mislead
    const p = structuredClone(factsPayload("NWIN"));
    for (const row of p.facts["us-gaap:NetIncomeLoss"]!.rows) if (row.end === "2024-09-30") row.val = -1e6;
    const neg = analyse(p, { now: NOW });
    const u = evaluateCriteria([c("x", "netIncomeYoY", "<", 5)], neg)[0]!;
    expect(u.status).toBe("unknown");
    expect(u.note).toContain("null oder negativ");
    expect(evaluateCriteria([c("y", "revenueYoY", "<", 1)], { ...nwin, quarters: [], comparisons: [] })[0]!.status).toBe("unknown");
  });

  it("covers every comparison operator at the threshold", () => {
    const rev = (op: Criterion["op"], v: number) => evaluateCriteria([c("r", "freeCashFlow", op, v)], nwin)[0]!.status; // actual = 24
    expect([rev("<", 24), rev("<=", 24), rev(">", 24), rev(">=", 24)]).toEqual(["clear", "triggered", "clear", "triggered"]);
    expect(actualText("revenueYoY", 12.5, "USD")).toBe("12,5 %");
    expect(actualText("epsDiluted", 1.3, "USD")).toBe("1,30 USD");
    expect(actualText("netDebt", null, "USD")).toBe("keine Daten");
  });
});

describe("check state and monitoring", () => {
  it("stores where and when: quarter, filing, source, time; the first check is not a 'new quarter'", () => {
    const t = updateThesis(handThesis(), { criteria: [{ id: "k1", metric: "grossMargin", op: "<", value: 43, note: "" }], monitoring: true }, 3000);
    const ck = checkThesis(t, nwin, NOW);
    expect(ck).toMatchObject({ at: NOW, quarterEnd: "2025-09-30", filed: "2025-11-04", source: "SEC EDGAR (XBRL)", sourceUrl: "https://data.sec.gov/api/xbrl/companyfacts/CIK0000999001.json", newQuarter: false, seen: false });
    expect(ck.url).toMatch(/^https:\/\/www\.sec\.gov\/Archives\/edgar\/data\/999001\/.+-index\.htm$/);
    expect(ck.results).toEqual([{ id: "k1", status: "triggered", actual: expect.closeTo(42.2222, 3) }]);
  });

  it("recognises a quarter that is newer than the one of the last check", () => {
    const t = { ...handThesis(), check: { ...checkThesis(handThesis(), nwin, NOW), quarterEnd: "2025-06-30" } };
    expect(checkThesis(t, nwin, NOW + 1).newQuarter).toBe(true);
    const same = { ...handThesis(), check: { ...checkThesis(handThesis(), nwin, NOW), quarterEnd: "2025-09-30" } };
    expect(checkThesis(same, nwin, NOW + 1).newQuarter).toBe(false);
  });

  it("is due only for a monitored thesis with a ticker and criteria, once a day", () => {
    const base = { monitoring: true, ticker: "NWIN", criteria: [{ id: "a", metric: "grossMargin", op: "<", value: 1, note: "" } as Criterion], check: null };
    expect(checkDue(base, NOW)).toBe(true);
    expect(checkDue({ ...base, monitoring: false }, NOW)).toBe(false);
    expect(checkDue({ ...base, ticker: "" }, NOW)).toBe(false);
    expect(checkDue({ ...base, criteria: [] }, NOW)).toBe(false);
    const ck = checkThesis({ ...handThesis(), criteria: base.criteria }, nwin, NOW);
    expect(checkDue({ ...base, check: ck }, NOW + 3_600_000)).toBe(false);
    expect(checkDue({ ...base, check: ck }, NOW + 25 * 3_600_000)).toBe(true);
  });
});

describe("settings.theses – versioned passthrough", () => {
  it("round-trips a thesis through the stored form", () => {
    const t = handThesis();
    const raw = withTheses(undefined, [t]);
    expect(raw.v).toBe(1);
    const back = thesesCfgOf(raw).theses[0]!;
    expect(back).toEqual(t);
    expect(withTheses(raw, [back])).toBe(raw); // nothing changed: the SAME object, the caller skips the save
  });

  it("keeps unknown keys of the root, of a thesis and entries it cannot read", () => {
    const raw = {
      v: 1,
      futureRoot: { a: 1 },
      theses: [
        { id: "t1", name: "X", futureKey: [1, 2], criteria: [{ id: "ok", metric: "grossMargin", op: "<", value: 40 }, { id: "new", metric: "someNewMetric", op: "~", value: 1 }] },
        { noId: true },
        "garbage",
      ],
    };
    const cfg = thesesCfgOf(raw);
    expect(cfg.theses).toHaveLength(1);
    expect(cfg.rejected).toEqual([{ noId: true }, "garbage"]);
    expect(cfg.theses[0]!.criteria).toHaveLength(1);
    expect(cfg.theses[0]!.criteriaExtra).toEqual([{ id: "new", metric: "someNewMetric", op: "~", value: 1 }]);
    const written = withTheses(raw, cfg.theses) as { futureRoot: unknown; theses: Record<string, unknown>[] };
    expect(written.futureRoot).toEqual({ a: 1 });
    expect(written.theses[0]!.futureKey).toEqual([1, 2]);
    expect(written.theses[0]!.criteria).toEqual([expect.objectContaining({ id: "ok", note: "" }), { id: "new", metric: "someNewMetric", op: "~", value: 1 }]);
    expect(written.theses.slice(1)).toEqual([{ noId: true }, "garbage"]);
  });

  it("cleans typed values instead of trusting them", () => {
    const t = thesisOf({ id: "t1", ticker: " aapl ", name: "  Meine\u0007 These  ", text: "x".repeat(5000), horizonYears: 99, base: { revenue: "12", netDebt: Number.NaN, currency: "usd" }, price: { value: -4, date: "2026-10-24", source: "s" }, reviewAt: "morgen", nextReport: { date: "2026-13-01", source: "s" }, catalysts: ["  a ", "", 5, "b"] })!;
    expect(t.ticker).toBe("AAPL");
    expect(t.name).toBe("Meine  These");
    expect(t.text).toHaveLength(4000);
    expect(t.horizonYears).toBe(5);
    expect(t.base).toMatchObject({ revenue: null, netDebt: null, currency: "USD" });
    expect(t.price).toBeNull();
    expect(t.reviewAt).toBeNull();
    expect(t.nextReport).toBeNull();
    expect(t.catalysts).toEqual(["a", "b"]);
  });

  it("an invalid ticker is dropped, a thesis without a ticker is fine (manual numbers)", () => {
    expect(thesisOf({ id: "a", ticker: "<script>" })!.ticker).toBe("");
    expect(newThesis({ id: "b" }, 1).ticker).toBe("");
    expect(newThesis({ id: "b", ticker: "aapl" }, 1).name).toBe("These AAPL");
  });

  it("limits the number of theses and ignores a duplicated id", () => {
    const many = Array.from({ length: 40 }, (_, i) => ({ id: `t${i}`, name: String(i) }));
    expect(thesesCfgOf({ v: 1, theses: many }).theses).toHaveLength(30);
    expect(thesesCfgOf({ v: 1, theses: [{ id: "a", name: "first" }, { id: "a", name: "second" }] }).theses.map((t) => t.name)).toEqual(["first"]);
    expect(thesesCfgOf(null).theses).toEqual([]);
    expect(thesesCfgOf("x").theses).toEqual([]);
  });

  it("updateThesis returns the same thesis when nothing differs and never touches check or versions", () => {
    const t = handThesis();
    expect(updateThesis(t, { text: "" }, 9999)).toBe(t);
    const changed = updateThesis(t, { text: "Warum ich investiere" }, 9999);
    expect(changed).not.toBe(t);
    expect(changed.updatedAt).toBe(9999);
    expect(changed.text).toBe("Warum ich investiere");
    const withCheck: Thesis = { ...t, check: checkThesis(t, nwin, NOW) };
    expect(updateThesis(withCheck, { name: "Neu" }, 1).check).toBe(withCheck.check);
  });

  it("two devices add theses and versions at the same time: the cloud merge keeps both", () => {
    const base = withTheses(undefined, [handThesis("t1")]);
    const a = thesisOf((base as { theses: unknown[] }).theses[0])!;
    const mineT = saveVersion(updateThesis(a, { text: "Meine Fassung" }, 5000), "A", 6000, "aaa");
    const mine = withTheses(base, [mineT, newThesis({ id: "t2", name: "Von Gerät A" }, 6000)]);
    const theirsT = saveVersion(updateThesis(a, { catalysts: ["Neues Produkt"] }, 5500), "B", 6500, "bbb");
    const theirs = withTheses(base, [theirsT, newThesis({ id: "t3", name: "Von Gerät B" }, 6500)]);
    const merged = thesesCfgOf(merge3(base, mine, theirs));
    expect(merged.theses.map((t) => t.id).sort()).toEqual(["t1", "t2", "t3"]);
    const t1 = merged.theses.find((t) => t.id === "t1")!;
    expect(t1.versions.map((v) => v.note).sort()).toEqual(["A", "B"]);
    expect(t1.versions.map((v) => v.n).sort()).toEqual([1, 2]); // both saved "version 1" offline: the later one is renumbered when read
    expect(t1.text).toBe("Meine Fassung");
    expect(t1.catalysts).toEqual(["Neues Produkt"]);
  });
});

describe("versions are immutable snapshots", () => {
  it("saves one only when something changed since the newest, numbers them, and keeps the check result", () => {
    const t0 = { ...handThesis(), check: checkThesis({ ...handThesis(), criteria: [{ id: "k1", metric: "grossMargin", op: "<", value: 43, note: "" }] }, nwin, NOW) };
    const t1 = saveVersion(t0, "Start", 10_000, "k3f9");
    expect(t1.versions).toHaveLength(1);
    expect(t1.versions[0]).toMatchObject({ n: 1, id: "v1-k3f9", note: "Start", at: 10_000 });
    expect(saveVersion(t1, "nochmal", 11_000)).toBe(t1);
    const t2 = saveVersion(updateThesis(t1, { text: "Neue Begründung" }, 12_000), "Text geändert", 13_000, "z");
    expect(t2.versions.map((v) => v.n)).toEqual([1, 2]);
    expect(t2.versions[0]!.snapshot.text).toBe("");
    expect(t2.versions[1]!.snapshot.text).toBe("Neue Begründung");
    // the snapshot holds the scenarios and base too – a changed target price can be traced to its assumptions
    expect(t2.versions[1]!.snapshot.scenarios.base.growthStart).toBe(0.1);
  });

  it("keeps at most 30 versions, newest last", () => {
    let t = handThesis();
    for (let i = 0; i < 33; i++) t = saveVersion(updateThesis(t, { text: `v${i}` }, 100 + i), `n${i}`, 200 + i, String(i));
    expect(t.versions).toHaveLength(30);
    expect(t.versions[29]!.snapshot.text).toBe("v32");
    expect(t.versions[0]!.snapshot.text).toBe("v3");
  });
});

describe("what changed between two versions", () => {
  it("lists each changed assumption and the value per share before → after, and nothing for an unchanged state", () => {
    const a = snapshotOfThesis(handThesis());
    expect(diffSnapshots(a, a)).toEqual([]);
    const t = updateThesis(handThesis(), { text: "neu", horizonYears: 3, scenarios: { ...handThesis().scenarios, base: { ...handThesis().scenarios.base, growthStart: 0.12, note: "optimistischer" } }, catalysts: ["Neues Werk"], criteria: [{ id: "k", metric: "grossMargin", op: "<", value: 40, note: "" }] }, 5000);
    const lines = diffSnapshots(a, snapshotOfThesis(t));
    expect(lines).toContain("Begründung geändert.");
    expect(lines).toContain("Basis: Wachstum Jahr 1 10,0 % → 12,0 %.");
    expect(lines).toContain("Basis: Notiz geändert.");
    expect(lines).toContain("Katalysator neu: Neues Werk");
    expect(lines).toContain("Bedingung neu: Bruttomarge unter 40 %");
    expect(lines.find((l) => l.startsWith("Basis: Wert je Aktie"))).toMatch(/^Basis: Wert je Aktie 24,35 → 2[5-9],\d\d USD\.$/);
    // the bear and bull values did not change: no line for them
    expect(lines.some((l) => l.startsWith("Bär: Wert"))).toBe(false);
  });

  it("names a changed price with its source and a changed buy zone", () => {
    const a = snapshotOfThesis(handThesis());
    const b = snapshotOfThesis(updateThesis(handThesis(), { price: { value: 20, date: "2026-10-24", source: "Broker" }, buyZone: { low: 18, high: 22 } }, 9));
    const lines = diffSnapshots(a, b);
    expect(lines).toContain("Eingegebener Kurs: keiner → 20,00 (Broker).");
    expect(lines).toContain("Kaufzone: keine → 18 – 22.");
  });
});
