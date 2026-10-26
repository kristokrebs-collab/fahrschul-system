/**
 * The order and the names of the pages, in one place: the dock, the command navigation (digits and groups), the shortcut sheet
 * (`g` + letter), the search and the assistant read the same list. A page added later must find its place in every one of them.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { PAGE_ICON, PAGE_LABELS } from "@/app/Dock";
import { COMMAND_NAV_STRINGS, markPageVisited, NAV_GROUPS, NEW_PAGES, readVisitedPages } from "@/app/CommandNav";
import { shortcutList } from "@/app/shortcuts";
import { buildSearchIndex } from "@/search/sources";
import { defaultSettings } from "@/domain/defaults";
import { DOCK_PAGES, NAV_ORDER, PAGE_KEYS, PAGES } from "@/store/uiStore";

describe("order of the pages", () => {
  it("starts with the dock tabs in the dock's order: the digits 1–5 of the navigation are the tabs", () => {
    expect(PAGES.slice(0, DOCK_PAGES.length)).toEqual([...DOCK_PAGES]);
    expect([...NAV_ORDER]).toEqual([...PAGES]);
  });

  it("groups every other page of the navigation exactly once, in the order of the digits", () => {
    const rest = PAGES.slice(DOCK_PAGES.length);
    expect(NAV_GROUPS.flatMap((g) => g.pages)).toEqual([...rest]);
    for (const g of NAV_GROUPS) {
      expect(COMMAND_NAV_STRINGS.groups[g.id], g.id).toBeTruthy();
      expect(g.pages.length, g.id).toBeGreaterThanOrEqual(2);
    }
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
