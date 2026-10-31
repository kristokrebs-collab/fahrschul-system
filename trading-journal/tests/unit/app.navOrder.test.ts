/**
 * The order and the names of the pages, in one place: the dock, the command navigation (digits and groups), the shortcut sheet
 * (`g` + letter), the search and the assistant read the same list. A page added later must find its place in every one of them.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { groupOfPage, PAGE_HINT, PAGE_ICON, PAGE_LABELS } from "@/app/navGroups";
import { COMMAND_NAV_STRINGS, markPageVisited, NAV_GROUPS, NEW_PAGES, readVisitedPages } from "@/app/CommandNav";
import { shortcutList } from "@/app/shortcuts";
import { buildSearchIndex } from "@/search/sources";
import { defaultSettings } from "@/domain/defaults";
import { DOCK_PAGES, NAV_ORDER, PAGE_KEYS, PAGES, SLIDE_ORDER } from "@/store/uiStore";

describe("order of the pages", () => {
  it("keeps the digits of the navigation: the first five of PAGES are the former dock tabs; the bar's tabs are real pages", () => {
    expect(PAGES.slice(0, 5)).toEqual(["overview", "trades", "setups", "markt", "settings"]);
    for (const p of DOCK_PAGES) expect(PAGES).toContain(p);
    expect([...DOCK_PAGES]).toEqual(["overview", "trades", "markt"]);
  });

  it("puts every one of the 19 pages into exactly one of the four groups; the navigation order is the groups flat", () => {
    expect(NAV_GROUPS.map((g) => g.id)).toEqual(["erfassen", "pruefen", "auswerten", "konto"]);
    expect(NAV_GROUPS.map((g) => g.label)).toEqual(["Erfassen", "Prüfen", "Auswerten", "Konto & Rechtliches"]);
    const flat = NAV_GROUPS.flatMap((g) => g.pages);
    expect([...flat].sort()).toEqual([...PAGES].sort());
    expect(new Set(flat).size).toBe(PAGES.length);
    expect([...NAV_ORDER]).toEqual(flat);
    for (const g of NAV_GROUPS) {
      expect(COMMAND_NAV_STRINGS.groups[g.id], g.id).toBeTruthy();
      expect(g.pages.length, g.id).toBeGreaterThanOrEqual(3);
      for (const p of g.pages) expect(groupOfPage(p)).toBe(g.id);
    }
    // the slide direction on a phone: the bar's tabs first, left to right
    expect(SLIDE_ORDER.slice(0, DOCK_PAGES.length)).toEqual([...DOCK_PAGES]);
    expect([...SLIDE_ORDER].sort()).toEqual([...PAGES].sort());
  });

  it("gives every page a plain-word hint (no empty, no duplicates) – what a beginner understands", () => {
    const hints = PAGES.map((p) => PAGE_HINT[p]);
    for (const h of hints) expect(h.length).toBeGreaterThan(5);
    expect(new Set(hints).size).toBe(PAGES.length);
  });

  it("gives each page a label, an icon and one letter of its own for `g`, and shows the letters in the sheet", () => {
    const keys = PAGES.map((p) => PAGE_KEYS[p]);
    expect(new Set(keys).size, "the letters are unique").toBe(PAGES.length);
    for (const k of keys) expect(k).toMatch(/^[a-z]$/);
    expect(new Set(PAGES.map((p) => PAGE_LABELS[p])).size, "the labels are unique").toBe(PAGES.length);
    for (const p of PAGES) {
      expect(PAGE_LABELS[p], p).toBeTruthy();
      expect(PAGE_ICON[p], p).toBeTruthy();
    }
    const list = shortcutList();
    const combos = list.map((d) => d.keys.join("+"));
    expect(new Set(combos).size, "no two shortcuts share their keys").toBe(combos.length);
    // every page has its chord in the sheet, in the order of the pages
    expect(list.filter((d) => d.id.startsWith("go-")).map((d) => d.id)).toEqual(PAGES.map((p) => `go-${p}`));
    // the single keys the sheet names are not a page letter after `g`: a chord letter only counts right after `g`
    const single = list.filter((d) => d.keys.length === 1 && /^[a-z]$/.test(d.keys[0]!)).map((d) => d.keys[0]);
    expect(single.sort()).toEqual(["a", "n", "t"]);
  });

  it("lets the search tie-break pages in the same order (workflow first)", () => {
    const items = buildSearchIndex({ trades: [], settings: defaultSettings(), days: {}, pages: PAGES, labels: PAGE_LABELS, pageKeys: PAGE_KEYS, now: 0 });
    const pages = items.filter((i) => i.kind === "page");
    expect(pages.map((i) => i.id)).toEqual(PAGES.map((p) => `page:${p}`));
    for (let i = 1; i < pages.length; i++) expect(pages[i]!.boost).toBeLessThan(pages[i - 1]!.boost);
    // and each shows its chord
    for (const i of pages) expect(i.keys).toMatch(/^g [a-z]$/);
  });
});

describe("the 'Neu' tag of the pages that came last", () => {
  beforeEach(() => localStorage.clear());

  it("names real pages and forgets a page once it has been opened", () => {
    for (const p of NEW_PAGES) expect(PAGES as readonly string[]).toContain(p);
    expect(readVisitedPages()).toEqual([]);
    expect(markPageVisited("plan")).toBe(true);
    expect(markPageVisited("plan")).toBe(false);
    expect(markPageVisited("trades"), "other pages are not remembered").toBe(false);
    expect(readVisitedPages()).toEqual(["plan"]);
  });

  it("reads damaged storage as 'nothing opened yet'", () => {
    localStorage.setItem("tj2-visited-pages", "{not json");
    expect(readVisitedPages()).toEqual([]);
    localStorage.setItem("tj2-visited-pages", JSON.stringify(["plan", "hacked", 3]));
    expect(readVisitedPages()).toEqual(["plan"]);
  });
});
