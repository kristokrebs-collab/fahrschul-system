/**
 * Etappe 1a: the sidebar (from 768 px) and the bottom bar (below) are never both there; the sidebar holds the four groups with all
 * 19 pages, the primary action on top, and remembers open / closed.
 */
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Dock } from "@/app/Dock";
import { NAV_GROUPS, PAGE_LABELS } from "@/app/navGroups";
import { closedGroups, Sidebar, SIDEBAR_WIDTH, sidebarExpanded } from "@/app/Sidebar";
import { MotionRoot } from "@/motion/MotionRoot";
import { PAGES, useUi } from "@/store/uiStore";

const realMatchMedia = window.matchMedia;
/** A `matchMedia` of a screen `width` px wide (min-width / max-width queries only). */
function screenOf(width: number) {
  window.matchMedia = ((q: string) => {
    const min = /min-width:\s*(\d+)px/.exec(q);
    const max = /max-width:\s*([\d.]+)px/.exec(q);
    // a tall screen: the short-screen query (max-height) never matches
    const matches = (min ? width >= Number(min[1]) : true) && (max ? width <= Number(max[1]) : true) && !/hover|pointer|reduce|max-height/.test(q);
    return { matches, media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, onchange: null, dispatchEvent: () => false } as unknown as MediaQueryList;
  }) as typeof window.matchMedia;
}

function mount() {
  return render(
    <MotionRoot>
      <Sidebar />
      <Dock />
    </MotionRoot>,
  );
}

describe("sidebar vs bottom bar", () => {
  beforeEach(() => {
    sessionStorage.clear();
    localStorage.clear();
    useUi.setState({ page: "overview", sidebar: "auto", editor: { open: false, fromFab: false } });
  });
  afterEach(() => {
    window.matchMedia = realMatchMedia;
    document.documentElement.style.removeProperty("--sidebar-w");
  });

  it("below 768 px: the bar (Übersicht, Trades, + Trade, Markt, Mehr), no sidebar", () => {
    screenOf(390);
    mount();
    expect(screen.queryByTestId("sidebar-group")).toBeNull();
    const bar = screen.getByRole("toolbar", { name: "Navigation" });
    expect(within(bar).getAllByRole("button").map((b) => b.getAttribute("aria-label"))).toEqual(["Übersicht", "Trades", "Trade eintragen", "Markt", "Mehr"]);
  });

  it("from 768 px: the sidebar with four groups and all 19 pages, no bottom bar", () => {
    screenOf(1440);
    mount();
    expect(screen.queryByRole("toolbar", { name: "Navigation" })).toBeNull();
    const groups = screen.getAllByTestId("sidebar-group");
    expect(groups.map((g) => g.getAttribute("data-group"))).toEqual(["erfassen", "pruefen", "auswerten", "konto"]);
    expect(groups.map((g) => g.getAttribute("aria-label"))).toEqual(NAV_GROUPS.map((g) => g.label));
    const links = screen.getAllByRole("link").filter((l) => l.hasAttribute("data-nav-page"));
    expect(links.map((l) => l.getAttribute("data-nav-page"))).toEqual(NAV_GROUPS.flatMap((g) => [...g.pages]));
    expect(links).toHaveLength(PAGES.length);
    // the wide sidebar names every page and says what it is for
    expect(within(links[0]!).getByText("Deine Einträge")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /^Übersicht/ })).toHaveAttribute("aria-current", "page");
    // the primary action is the first thing in it
    expect(within(screen.getByRole("complementary", { name: "Hauptnavigation" })).getByRole("button", { name: "Trade eintragen" })).toBeInTheDocument();
    expect(document.documentElement.style.getPropertyValue("--sidebar-w")).toBe(`${SIDEBAR_WIDTH.wide}px`);
  });

  it("a click on a page navigates; the page you are on again does not break", () => {
    screenOf(1440);
    mount();
    fireEvent.click(screen.getByRole("link", { name: /^Trades/ }));
    expect(useUi.getState().page).toBe("trades");
    expect(location.hash).toBe("#trades");
    expect(screen.getByRole("link", { name: /^Trades/ })).toHaveAttribute("aria-current", "page");
  });

  it("collapses to the rail, keeps the choice in `tj2-ui`, and the rail names every page by `aria-label`", () => {
    screenOf(1440);
    mount();
    fireEvent.click(screen.getByTestId("sidebar-toggle"));
    expect(useUi.getState().sidebar).toBe("closed");
    expect(JSON.parse(localStorage.getItem("tj2-ui") ?? "{}").sidebar).toBe("closed");
    const aside = screen.getByRole("complementary", { name: "Hauptnavigation" });
    expect(aside.hasAttribute("data-expanded")).toBe(false);
    expect(document.documentElement.style.getPropertyValue("--sidebar-w")).toBe(`${SIDEBAR_WIDTH.rail}px`);
    for (const p of PAGES) expect(within(aside).getByRole("link", { name: PAGE_LABELS[p] })).toBeInTheDocument();
    expect(screen.getByTestId("sidebar-toggle")).toHaveAttribute("aria-label", "Seitenleiste ausklappen");
    act(() => useUi.getState().setPref("sidebar", "open"));
    expect(aside.hasAttribute("data-expanded")).toBe(true);
  });

  it("a group folds and unfolds; the choice is stored; a short screen folds all but the current group and Konto until the reader chooses", () => {
    expect(closedGroups(null, false, "pruefen")).toEqual([]);
    expect(closedGroups(null, true, "pruefen")).toEqual(["erfassen", "auswerten"]);
    expect(closedGroups(["konto"], true, "pruefen")).toEqual(["konto"]);
    screenOf(1440);
    mount();
    const toggles = screen.getAllByTestId("sidebar-group-toggle");
    expect(toggles).toHaveLength(4);
    expect(toggles.every((t) => t.getAttribute("aria-expanded") === "true")).toBe(true);
    fireEvent.click(toggles[3]!);
    expect(useUi.getState().sidebarClosed).toEqual(["konto"]);
    expect(JSON.parse(localStorage.getItem("tj2-ui") ?? "{}").sidebarClosed).toEqual(["konto"]);
    expect(screen.getAllByTestId("sidebar-group-toggle")[3]).toHaveAttribute("aria-expanded", "false");
    // going to a page of the folded group opens it again
    act(() => useUi.getState().setPage("settings"));
    expect(useUi.getState().sidebarClosed).toEqual([]);
  });

  it("`auto` is a rail below 1280 px and wide from there; the reader's choice wins", () => {
    expect(sidebarExpanded("auto", false)).toBe(false);
    expect(sidebarExpanded("auto", true)).toBe(true);
    expect(sidebarExpanded("open", false)).toBe(true);
    expect(sidebarExpanded("closed", true)).toBe(false);
    screenOf(1024);
    mount();
    expect(screen.getByRole("complementary", { name: "Hauptnavigation" }).hasAttribute("data-expanded")).toBe(false);
  });
});
