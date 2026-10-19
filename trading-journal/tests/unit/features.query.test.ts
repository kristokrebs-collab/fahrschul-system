/**
 * Questions to the function register: the search tolerates typos and umlauts, the filters are exact, "Für dich" reads the
 * assistant's own counters (nothing asked → nothing shown), "Zuletzt benutzt" reads the search's recent ids, and
 * "Wo finde ich …?" strips the question words and says whether the best hit is clear.
 */
import { describe, expect, it } from "vitest";
import { featureQueryOf, featureSearchId, filterFeatures, forYou, groupFeatures, interestScore, isFiltered, NO_FILTER, recentFeatures, searchFeatures, whereIs } from "@/app/featureQuery";
import { FEATURE_GROUPS, FEATURE_REGISTRY, featureById } from "@/app/features";

const ids = (xs: readonly { id: string }[]) => xs.map((x) => x.id);

describe("searchFeatures", () => {
  it("finds a function by name, keyword, benefit word and F-ID", () => {
    expect(searchFeatures("belastungstest")[0]!.entry.id).toBe("belastungstest");
    expect(searchFeatures("slippage").map((h) => h.entry.id)).toContain("belastungstest");
    expect(searchFeatures("F37").map((h) => h.entry.id)).toEqual(expect.arrayContaining(["wochenreview", "wochenexperiment"]));
    expect(searchFeatures("Backup")[0]!.entry.id).toBe("backup");
  });

  it("forgives typos, case and umlauts (Üben = ueben = uben)", () => {
    expect(searchFeatures("belastungstst")[0]?.entry.id).toBe("belastungstest");
    expect(searchFeatures("UEBEN").map((h) => h.entry.id)).toContain("ueben");
    expect(searchFeatures("uben").map((h) => h.entry.id)).toContain("ueben");
    expect(searchFeatures("pruefbericht")[0]!.entry.id).toBe("pruefbericht");
  });

  it("needs every word to hit, ranks the title first and keeps the register order on ties", () => {
    expect(searchFeatures("zzzqqq")).toEqual([]);
    expect(searchFeatures("   ")).toEqual([]);
    const labor = searchFeatures("labor");
    expect(labor.length).toBeGreaterThan(3);
    expect(labor[0]!.entry.name).toMatch(/Labor/);
    expect(labor[0]!.ranges.length).toBeGreaterThan(0);
    expect(searchFeatures("Check-in").map((h) => h.entry.id).slice(0, 3)).toContain("checkin");
  });
});

describe("filter + group", () => {
  it("is exact on status and plan, and a query scores inside the filtered set", () => {
    const partial = filterFeatures({ ...NO_FILTER, status: "teilweise" });
    expect(partial.length).toBeGreaterThan(5);
    expect(partial.every((f) => f.status === "teilweise")).toBe(true);
    const premium = filterFeatures({ ...NO_FILTER, tier: "premium" });
    expect(premium.length).toBeGreaterThan(5);
    expect(premium.every((f) => f.gate && ["backtestLab", "shotExtract", "mentor", "customDashboards", "coachAi", "reportsPdf", "apiAccess"].includes(f.gate))).toBe(true);
    const free = filterFeatures({ ...NO_FILTER, tier: "frei" });
    expect(free.some((f) => f.id === "csv-import")).toBe(true);
    expect(free.some((f) => f.id === "labor")).toBe(false);
    const both = filterFeatures({ q: "labor", status: "teilweise", tier: "premium" });
    expect(both.length).toBeGreaterThan(0);
    expect(both.every((f) => f.status === "teilweise" && f.page === "labor")).toBe(true);
    expect(filterFeatures(NO_FILTER)).toHaveLength(FEATURE_REGISTRY.length);
    expect(isFiltered(NO_FILTER)).toBe(false);
    expect(isFiltered({ ...NO_FILTER, q: "x" })).toBe(true);
  });

  it("groups in the order of a trader's day and drops empty groups", () => {
    const all = groupFeatures(FEATURE_REGISTRY);
    expect(all.map((g) => g.group.id)).toEqual(FEATURE_GROUPS.map((g) => g.id));
    expect(all.reduce((n, g) => n + g.items.length, 0)).toBe(FEATURE_REGISTRY.length);
    const some = groupFeatures(filterFeatures({ ...NO_FILTER, q: "alarm" }));
    expect(some.every((g) => g.items.length > 0)).toBe(true);
    expect(some.length).toBeLessThan(all.length);
  });
});

describe("Für dich + Zuletzt benutzt", () => {
  it("shows nothing without counters, and never invents a topic", () => {
    expect(forYou({})).toEqual([]);
    expect(forYou({ "metric:nothing-we-map": 0 })).toEqual([]);
    expect(forYou({ hello: 9, memory: 4 })).toEqual([]);
  });

  it("orders by the asked counters, supports prefixes and caps the list", () => {
    const mine = forYou({ lab: 7, idea: 2, train: 5, "behavior:revenge": 3, "behavior:fomo": 2 }, 4);
    expect(mine.length).toBeLessThanOrEqual(4);
    expect(mine[0]!.score).toBeGreaterThanOrEqual(mine[mine.length - 1]!.score);
    const names = ids(mine.map((m) => m.entry));
    expect(names).toContain("labor");
    // the prefix `behavior:*` adds up both behaviours
    const revenge = interestScore(featureById("verhalten")!, { "behavior:revenge": 3, "behavior:fomo": 2 });
    expect(revenge).toBe(5);
    expect(forYou({ train: 5 }).map((m) => m.entry.id)).toEqual(["ueben"]);
  });

  it("reads the search's recent ids: only feature ids, newest first, unknown ones dropped", () => {
    const recent = [featureSearchId("labor"), "page:coach", featureSearchId("gibt-es-nicht"), featureSearchId("ueben"), "trade:t1", featureSearchId("labor")];
    expect(ids(recentFeatures(recent))).toEqual(["labor", "ueben"]);
    expect(recentFeatures([])).toEqual([]);
    expect(recentFeatures(recent, 1)).toHaveLength(1);
  });
});

describe("Wo finde ich …?", () => {
  it("strips the question words", () => {
    expect(featureQueryOf("Wo finde ich den Belastungstest?")).toBe("belastungstest");
    expect(featureQueryOf("Wie komme ich zum Positionsrechner")).toBe("positionsrechner");
    expect(featureQueryOf("Wo kann ich ein Backup machen?")).toBe("backup machen");
    expect(featureQueryOf("Welche Funktionen gibt es?")).toBe("");
  });

  it("answers a named function clearly, an ambiguous word with a short list, and nonsense with nothing", () => {
    const named = whereIs("Wo finde ich den Belastungstest?");
    expect(named.hits[0]!.entry.id).toBe("belastungstest");
    expect(named.clear).toBe(true);
    const vague = whereIs("Wo finde ich Alarme");
    expect(vague.hits.length).toBeGreaterThan(0);
    expect(vague.hits.length).toBeLessThanOrEqual(3);
    expect(whereIs("Wo finde ich zzzqqq?")).toEqual({ hits: [], clear: false });
    expect(whereIs("Wo finde ich das?")).toEqual({ hits: [], clear: false });
  });
});
