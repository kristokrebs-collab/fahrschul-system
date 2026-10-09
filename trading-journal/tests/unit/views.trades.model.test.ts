import { describe, expect, it } from "vitest";
import { DEFAULT_TRADE_FILTER } from "@/store/uiStore";
import { countLabel, filterTrades, frequentWords, listKey, rowsKey, searchSuggestions, setupNameOf, sortArrow, sortTrades } from "@/views/trades/tradesModel";
import { enriched, settings } from "./domain.fixtures";

const s = settings();
const all = enriched();
const ids = (list: { id: string }[]) => list.map((t) => t.id);

describe("tradesModel.filterTrades (bundle H$)", () => {
  it("returns everything with the default filter", () => {
    expect(ids(filterTrades(all, DEFAULT_TRADE_FILTER, s.setups))).toEqual(["A", "B", "C", "D", "E", "F"]);
  });
  it("account: missing account counts as scalp", () => {
    expect(ids(filterTrades(all, { ...DEFAULT_TRADE_FILTER, acc: "scalp" }, s.setups))).toEqual(["A", "B", "C", "E", "F"]);
    expect(ids(filterTrades(all, { ...DEFAULT_TRADE_FILTER, acc: "makro" }, s.setups))).toEqual(["D"]);
  });
  it("result incl. NEW break-even, side", () => {
    expect(ids(filterTrades(all, { ...DEFAULT_TRADE_FILTER, result: "be" }, s.setups))).toEqual(["E"]);
    expect(ids(filterTrades(all, { ...DEFAULT_TRADE_FILTER, result: "open" }, s.setups))).toEqual(["D"]);
    expect(ids(filterTrades(all, { ...DEFAULT_TRADE_FILTER, side: "short" }, s.setups))).toEqual(["B"]);
  });
  it("setup id and `__none` (= no known setup)", () => {
    expect(ids(filterTrades(all, { ...DEFAULT_TRADE_FILTER, setup: "s_ml" }, s.setups))).toEqual(["D"]);
    expect(ids(filterTrades(all, { ...DEFAULT_TRADE_FILTER, setup: "s_bo" }, s.setups))).toEqual(["A"]);
    expect(ids(filterTrades(all, { ...DEFAULT_TRADE_FILTER, setup: "__none" }, s.setups))).toEqual(["C", "E"]);
  });
  it("free text over pair, reason, notes, emotion, timeframe (case-insensitive)", () => {
    expect(ids(filterTrades(all, { ...DEFAULT_TRADE_FILTER, q: "fomo" }, s.setups))).toEqual(["B"]);
    expect(ids(filterTrades(all, { ...DEFAULT_TRADE_FILTER, q: "breakout" }, s.setups))).toEqual(["A"]);
    expect(ids(filterTrades(all, { ...DEFAULT_TRADE_FILTER, q: "  " }, s.setups))).toHaveLength(6);
  });
});

describe("tradesModel.sortTrades", () => {
  it("date desc by default, flips with dir", () => {
    expect(ids(sortTrades(all, { k: "date", dir: -1 }, s.setups))).toEqual(["F", "E", "D", "C", "B", "A"]);
    expect(ids(sortTrades(all, { k: "date", dir: 1 }, s.setups))).toEqual(["A", "B", "C", "D", "E", "F"]);
  });
  it("pnl: null sorts as −∞", () => {
    const desc = ids(sortTrades(all, { k: "pnl", dir: -1 }, s.setups));
    expect(desc[0]).toBe("A");
    expect(desc[desc.length - 1]).toBe("D");
    expect(ids(sortTrades(all, { k: "pnl", dir: 1 }, s.setups))[0]).toBe("D");
  });
  it("setup: first matching setup name with localeCompare de (`~` = unassigned, ICU sorts it before letters – bundle parity)", () => {
    expect(setupNameOf({ setups: ["s_ml"] }, s.setups)).toBe("Makro-Long Support-Zone");
    expect(setupNameOf({ setups: ["nope"] }, s.setups)).toBe("~");
    const asc = ids(sortTrades(all, { k: "setup", dir: 1 }, s.setups));
    expect(asc.slice(0, 2).sort()).toEqual(["C", "E"]);
    expect(asc[2]).toBe("A"); // "4H-Breakout …" before "B…"/"M…"
    expect(ids(sortTrades(all, { k: "setup", dir: -1 }, s.setups)).slice(-2).sort()).toEqual(["C", "E"]);
  });
  it("does not mutate the input", () => {
    const copy = [...all];
    sortTrades(all, { k: "pnl", dir: 1 }, s.setups);
    expect(ids(all)).toEqual(ids(copy));
  });
});

describe("helpers", () => {
  it("listKey changes with filter and sort", () => {
    const a = listKey(DEFAULT_TRADE_FILTER, { k: "date", dir: -1 });
    expect(listKey(DEFAULT_TRADE_FILTER, { k: "date", dir: 1 })).not.toBe(a);
    expect(listKey({ ...DEFAULT_TRADE_FILTER, side: "long" }, { k: "date", dir: -1 })).not.toBe(a);
  });
  it("countLabel", () => {
    expect(countLabel(1)).toBe("1 Trade");
    expect(countLabel(0)).toBe("0 Trades");
    expect(countLabel(6)).toBe("6 Trades");
  });
  it("rowsKey changes with the visible set and order, not only with filter/sort", () => {
    const key = listKey(DEFAULT_TRADE_FILTER, { k: "date", dir: -1 });
    const base = rowsKey(key, all);
    expect(base.startsWith(`${key}#6:`)).toBe(true);
    expect(rowsKey(key, all.slice(1))).not.toBe(base); // deleted from the detail
    expect(rowsKey(key, [...all].reverse())).not.toBe(base); // re-sorted by an edit
    expect(rowsKey(key, [...all])).toBe(base); // same rows, new array → same key
    expect(rowsKey(key, [{ id: "ab" }, { id: "c" }])).not.toBe(rowsKey(key, [{ id: "a" }, { id: "bc" }])); // id boundaries count
    expect(rowsKey(key, [])).toBe(rowsKey(key, []));
    expect(rowsKey("x", all)).not.toBe(base);
  });
  it("sortArrow", () => {
    expect(sortArrow(1)).toBe(" ↑");
    expect(sortArrow(-1)).toBe(" ↓");
  });
});

describe("tradesModel search suggestions", () => {
  const notes = (reason: string, notes = "") => ({ reason, notes });

  it("frequentWords: ≥ 4 letters, no stop words, counted once per trade, most frequent first, common spelling kept", () => {
    const words = frequentWords([notes("Liquidity Sweep über dem Hoch", "sweep sauber"), notes("Sweep am Tief, Delta rot"), notes("Delta grün, Sweep"), notes("nichts")]);
    expect(words[0]).toBe("Sweep");
    expect(words).toContain("Delta");
    expect(words).not.toContain("über");
    expect(words.filter((w) => w.toLowerCase() === "sweep")).toHaveLength(1);
  });

  it("frequentWords falls back to the top words of a small journal", () => {
    expect(frequentWords([notes("Breakout Retest")])).toEqual(["Breakout", "Retest"]);
  });

  it("searchSuggestions: setups and sides are filter shortcuts, emotions and words fill the search (grouped, in order)", () => {
    const out = searchSuggestions(all, s.setups, ["FOMO", "Ruhig"]);
    const groups = [...new Set(out.map((o) => o.group))];
    expect(groups.slice(0, 3)).toEqual(["Grundlagen", "Richtung", "Gefühl"]);
    expect(out.filter((o) => o.kind === "setup").map((o) => o.target)).toEqual(s.setups.map((x) => x.id));
    expect(out.find((o) => o.label === "Short")).toMatchObject({ kind: "side", target: "short" });
    expect(out.find((o) => o.label === "FOMO")).toMatchObject({ kind: "emotion" });
    expect(new Set(out.map((o) => o.value)).size).toBe(out.length);
  });
});
