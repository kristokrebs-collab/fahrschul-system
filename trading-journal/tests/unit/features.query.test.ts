/**
 * Questions to the function register: the search tolerates typos, umlauts and endings and understands what people want to do
 * ("warum verliere ich"), the groups come with their sub headings, "Für dich" reads the assistant's own counters (nothing
 * asked → nothing shown), "Zuletzt benutzt" reads the search's recent ids, "Empfohlen / Neu" is never empty, and
 * "Wo finde ich …?" strips the question words and says whether the best hit is clear.
 */
import { describe, expect, it } from "vitest";
import {
  featureQueryOf,
  featureSearchId,
  forYou,
  groupFeatures,
  groupStats,
  interestScore,
  isNewFeature,
  parseFeatureQuery,
  placeText,
  recentFeatures,
  scoreFeature,
  searchFeatures,
  seeAlso,
  STRONG_HIT,
  subGroups,
  suggestFeatures,
  whereIs,
} from "@/app/featureQuery";
import { FEATURE_GROUPS, FEATURE_REGISTRY, featureById } from "@/app/features";

const ids = (xs: readonly { id: string }[]) => xs.map((x) => x.id);

describe("searchFeatures", () => {
  it("finds a function by name, keyword, intent, benefit word and F-ID", () => {
    expect(searchFeatures("belastungstest")[0]!.entry.id).toBe("belastungstest");
    expect(searchFeatures("slippage").map((h) => h.entry.id)).toContain("belastungstest");
    expect(searchFeatures("F37").map((h) => h.entry.id)).toEqual(expect.arrayContaining(["wochenreview", "wochenexperiment"]));
    expect(searchFeatures("Backup")[0]!.entry.id).toBe("backup");
    // an intent: said in the user's words, named nowhere in the title
    expect(searchFeatures("warum verliere ich").map((h) => h.entry.id)).toContain("leaks-edges");
  });

  it("forgives typos, case, umlauts and endings (Üben = ueben = uben, Wochenbericht = Wochenberichte)", () => {
    expect(searchFeatures("belastungstst")[0]?.entry.id).toBe("belastungstest");
    expect(searchFeatures("UEBEN").map((h) => h.entry.id)).toContain("ueben");
    expect(searchFeatures("uben").map((h) => h.entry.id)).toContain("ueben");
    expect(searchFeatures("pruefbericht")[0]!.entry.id).toBe("pruefbericht");
    expect(searchFeatures("Positonsrechner")[0]!.entry.id).toBe("positionsrechner");
    expect(searchFeatures("Wochenberichte").map((h) => h.entry.id).slice(0, 3)).toContain("berichte");
  });

  it("drops filler words, and a word that no function knows does not push a function down", () => {
    const q = parseFeatureQuery("ich will wissen ob mein Setup funktioniert")!;
    expect(q.tokens).not.toContain("ich");
    expect(q.tokens).not.toContain("mein");
    expect(searchFeatures("ich will wissen ob mein Setup funktioniert").map((h) => h.entry.id).slice(0, 3)).toContain("labor");
    expect(searchFeatures("ich will meine Strategie testen blorfzz")[0]!.entry.id).toBe(searchFeatures("ich will meine Strategie testen")[0]!.entry.id);
  });

  it("ranks words that all hit above words that partly hit, a whole phrase above scattered words, and keeps the register order on ties", () => {
    expect(searchFeatures("zzzqqq")).toEqual([]);
    expect(searchFeatures("   ")).toEqual([]);
    const labor = searchFeatures("labor");
    expect(labor.length).toBeGreaterThan(3);
    expect(labor[0]!.entry.name).toMatch(/Labor/);
    expect(labor[0]!.ranges.length).toBeGreaterThan(0);
    expect(searchFeatures("Check-in").map((h) => h.entry.id).slice(0, 3)).toContain("checkin");
    // "Box" is the name of three functions of one group: they come in register order
    const box = searchFeatures("Box").map((h) => h.entry.id);
    expect(box.slice(0, 3)).toEqual(["box-chart", "box-status", "box-einstellungen"]);
    // words that appear nowhere in the register carry no meaning for the lookup: the one that does decides
    expect(searchFeatures("Positionsrechner Zebra")[0]!.entry.id).toBe("positionsrechner");
    // but when two real words point at different functions, half of the words is the least that counts
    const both = searchFeatures("Positionsrechner Backup Kalender").map((h) => h.entry.id);
    expect(both).toEqual([]);
  });

  it("scores on one scale: a clear answer is strong, a guess is not", () => {
    const strong = searchFeatures("Wochenbericht")[0]!;
    expect(strong.score).toBeGreaterThanOrEqual(STRONG_HIT);
    expect(strong.score).toBeLessThanOrEqual(200);
    expect(scoreFeature(featureById("labor")!, parseFeatureQuery("backup"))).toBeNull();
    const guess = searchFeatures("Schrift größer")[0];
    expect(!guess || guess.score < STRONG_HIT).toBe(true);
  });
});

describe("groups", () => {
  it("groups in the order of a trader's day and drops empty groups", () => {
    const all = groupFeatures(FEATURE_REGISTRY);
    expect(all.map((g) => g.group.id)).toEqual(FEATURE_GROUPS.map((g) => g.id));
    expect(all.reduce((n, g) => n + g.items.length, 0)).toBe(FEATURE_REGISTRY.length);
    const some = groupFeatures(searchFeatures("alarm").map((h) => h.entry));
    expect(some.every((g) => g.items.length > 0)).toBe(true);
    expect(some.length).toBeLessThan(all.length);
  });

  it("splits a group under its sub headings in the order they first appear, and counts the unfinished", () => {
    const testen = groupFeatures(FEATURE_REGISTRY).find((g) => g.group.id === "testen")!;
    const subs = subGroups(testen.items);
    expect(subs.map((s) => s.sub)).toEqual(["Idee bauen", "Test & Ergebnis", "Härtetest", "Live prüfen & teilen"]);
    expect(subs.reduce((n, s) => n + s.items.length, 0)).toBe(testen.items.length);
    const stats = groupStats(testen.items);
    expect(stats.total).toBe(testen.items.length);
    expect(stats.partial).toBe(testen.items.filter((f) => f.status === "teilweise").length);
    expect(stats.partial).toBeGreaterThan(0);
    // functions without a heading stay in one block without a title
    expect(subGroups(groupFeatures(FEATURE_REGISTRY).find((g) => g.group.id === "heute")!.items)).toHaveLength(1);
  });

  it("resolves 'Siehe auch' and names the place", () => {
    expect(ids(seeAlso(featureById("tagesplan")!))).toEqual(["schluesselmarken", "checkin"]);
    expect(placeText(featureById("tagesplan")!)).toBe("Markt › Tagesplan");
    expect(placeText(featureById("labor")!)).toBe("Labor");
    expect(placeText(featureById("eigene-idee")!)).toBe("Labor › Strategie & Kosten");
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
    // the counters for the lab and the idea builder point at the lab's functions
    expect(mine.some((m) => m.entry.page === "labor")).toBe(true);
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

describe("Empfohlen / Neu", () => {
  const OCT = Date.parse("2026-10-24T12:00:00Z");

  it("calls a function new for two months after the month of its release, not before and not after", () => {
    const f = featureById("tagesplan")!;
    expect(f.since).toBe("2026-10");
    expect(isNewFeature(f, OCT)).toBe(true);
    expect(isNewFeature(f, Date.parse("2026-09-30T12:00:00Z"))).toBe(false);
    expect(isNewFeature(f, Date.parse("2026-12-15T12:00:00Z"))).toBe(false);
    expect(isNewFeature(featureById("backup")!, OCT)).toBe(false);
  });

  it("is never empty: without counters and releases the few starting points stand there", () => {
    const later = Date.parse("2030-01-01T00:00:00Z");
    const picks = suggestFeatures({ interests: {}, now: later });
    expect(picks.length).toBeGreaterThanOrEqual(4);
    expect(picks.every((p) => p.reason === "tipp" && p.entry.star)).toBe(true);
  });

  it("puts what the assistant's counters point at first, then the new, then the starting points – each once, never what 'Zuletzt benutzt' shows", () => {
    const picks = suggestFeatures({ interests: { train: 5 }, now: OCT, k: 6 });
    expect(picks[0]).toMatchObject({ reason: "fuer-dich" });
    expect(picks[0]!.entry.id).toBe("ueben");
    expect(picks.some((p) => p.reason === "neu")).toBe(true);
    expect(new Set(ids(picks.map((p) => p.entry))).size).toBe(picks.length);
    const skipped = suggestFeatures({ interests: { train: 5 }, now: OCT, skip: ["ueben"], k: 6 });
    expect(ids(skipped.map((p) => p.entry))).not.toContain("ueben");
  });
});
