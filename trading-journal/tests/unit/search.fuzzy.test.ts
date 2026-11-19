import { describe, expect, it } from "vitest";
import { digraphFold, fold, haystack, matchText, mergeRanges, normalize, scoreFields, tokenize } from "@/search/fuzzy";

describe("search fuzzy", () => {
  it("folds umlauts, ß and diacritics and keeps a map back into the original", () => {
    expect(normalize("Gebühren Größe Straße Café")).toBe("gebuhren grosse strasse cafe");
    const f = fold("Größe");
    expect(f.text).toBe("grosse");
    // "ß" became two characters, both pointing at index 3 of the original
    expect(f.map).toEqual([0, 1, 2, 3, 3, 4]);
  });

  it("tokenizes on whitespace and punctuation, at most six tokens", () => {
    expect(tokenize("  Long, BTC / Sweep · 2R ")).toEqual(["long", "btc", "sweep", "2r"]);
    expect(tokenize("a b c d e f g h")).toHaveLength(6);
    expect(tokenize("   ")).toEqual([]);
  });

  it("ranks whole word > word prefix > substring > subsequence", () => {
    const whole = matchText("sweep", "Liquidity Sweep")!.score;
    const prefix = matchText("swe", "Liquidity Sweep")!.score;
    const sub = matchText("eep", "Liquidity Sweep")!.score;
    const seq = matchText("lqsw", "Liquidity Sweep")!.score;
    expect(whole).toBeGreaterThan(prefix);
    expect(prefix).toBeGreaterThan(sub);
    expect(sub).toBeGreaterThan(seq);
    expect(seq).toBeGreaterThan(0);
    expect(matchText("xyz", "Liquidity Sweep")).toBeNull();
  });

  it("forgives missing umlauts and returns highlight ranges in the original text", () => {
    const m = matchText("gebuhren", "Hohe Gebühren")!;
    expect(m).not.toBeNull();
    expect(m.ranges).toEqual([{ start: 5, end: 13 }]);
    expect("Hohe Gebühren".slice(5, 13)).toBe("Gebühren");
  });

  it("scoreFields: every token must hit; title hits weigh double and are highlighted", () => {
    const h = haystack("Long BTC/USDT · 26.04.26", ["BSL/EQL Liquidity Sweep", "Gewinn", "Makro"]);
    const both = scoreFields(tokenize("long sweep"), h)!;
    expect(both).not.toBeNull();
    expect(both.title).toEqual([{ start: 0, end: 4 }]);
    expect(scoreFields(tokenize("long verlust"), h)).toBeNull();
    const titleOnly = scoreFields(tokenize("btc"), h)!.score;
    const keywordOnly = scoreFields(tokenize("makro"), h)!.score;
    expect(titleOnly).toBeGreaterThan(keywordOnly);
  });

  it("umlauts typed as digraphs still find the word (ue → ü, oe → ö, ae → ä)", () => {
    expect(digraphFold("uebersicht")).toBe("ubersicht");
    expect(digraphFold("btc")).toBeNull();
    const h = haystack("Gebühren", ["Übersicht", "Börse"]);
    expect(scoreFields(tokenize("gebuehren"), h)!.title).toEqual([{ start: 0, end: 8 }]);
    expect(scoreFields(tokenize("boerse"), h)).not.toBeNull();
    // the literal spelling wins when it matches on its own
    expect(scoreFields(tokenize("queue"), haystack("Queue"))!.score).toBe(200);
  });

  it("merges overlapping ranges", () => {
    expect(mergeRanges([{ start: 4, end: 6 }, { start: 0, end: 2 }, { start: 1, end: 3 }])).toEqual([
      { start: 0, end: 3 },
      { start: 4, end: 6 },
    ]);
  });
});
