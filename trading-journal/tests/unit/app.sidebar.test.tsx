/**
 * Etappe 1a: the sidebar (from 768 px) and the bottom bar (below) are never both there; the sidebar holds the four groups with all
 * 19 pages, the primary action on top, and remembers whether it is pinned. Runde 11: compact on every width; „Anheften“ (`sidebar: "open"`) is the choice.
 */
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Dock } from "@/app/Dock";
import { NAV_GROUPS, PAGE_LABELS } from "@/app/navGroups";
import { closedGroups, offsetTopWithin, Sidebar, SIDEBAR_WIDTH, sidebarExpanded } from "@/app/Sidebar";
import { MotionRoot } from "@/motion/MotionRoot";
import { loadPrefs, PAGES, useUi } from "@/store/uiStore";

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
    screenOf(1700);
    useUi.setState({ sidebar: "open" });
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
    screenOf(1700);
    useUi.setState({ sidebar: "open" });
    mount();
    fireEvent.click(screen.getByRole("link", { name: /^Trades/ }));
    expect(useUi.getState().page).toBe("trades");
    expect(location.hash).toBe("#trades");
    expect(screen.getByRole("link", { name: /^Trades/ })).toHaveAttribute("aria-current", "page");
  });

  it("unpins to the rail, keeps the choice in `tj2-ui`, and the rail names every page by `aria-label`", () => {
    screenOf(1700);
    useUi.setState({ sidebar: "open" });
    mount();
    const aside = screen.getByRole("complementary", { name: "Hauptnavigation" });
    expect(aside.hasAttribute("data-expanded")).toBe(true);
    expect(screen.getByTestId("sidebar-toggle")).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(screen.getByTestId("sidebar-toggle"));
    expect(useUi.getState().sidebar).toBe("auto");
    expect(JSON.parse(localStorage.getItem("tj2-ui") ?? "{}").sidebar).toBe("auto");
    expect(aside.hasAttribute("data-expanded")).toBe(false);
    expect(document.documentElement.style.getPropertyValue("--sidebar-w")).toBe(`${SIDEBAR_WIDTH.rail}px`);
    for (const p of PAGES) expect(within(aside).getByRole("link", { name: PAGE_LABELS[p] })).toBeInTheDocument();
    expect(screen.getByTestId("sidebar-toggle")).toHaveAttribute("aria-label", "Seitenleiste anheften");
    expect(screen.getByTestId("sidebar-toggle")).toHaveAttribute("aria-pressed", "false");
    act(() => useUi.getState().setPref("sidebar", "open"));
    expect(aside.hasAttribute("data-expanded")).toBe(true);
    expect(screen.getByTestId("sidebar-toggle")).toHaveAttribute("aria-label", "Seitenleiste lösen");
  });

  it("the marker's place is the row's top inside the list – also while the first-load wave makes every `li` a containing block", () => {
    // `offsetTop` / `offsetParent` as the browser reports them: at rest the row hangs under the list (top 429) …
    const node = (offsetTop: number, offsetParent: unknown) => ({ offsetTop, offsetParent }) as unknown as HTMLElement;
    const list = node(0, null);
    expect(offsetTopWithin(node(429, list), list)).toBe(429);
    // … during the wave the animated `li` is in between: the row says 0, the `li` carries the 429 (the plate used to be parked at 0)
    const li = node(429, list);
    expect(offsetTopWithin(node(0, li), list)).toBe(429);
    // a row without a positioned list above it (detached) never loops
    expect(offsetTopWithin(node(7, null), list)).toBe(7);
  });

  it("a very low screen (a phone held sideways): the whole sidebar scrolls as one column – the page list is not squeezed between head and foot", () => {
    // tall: the list scrolls between the fixed head and foot
    screenOf(1700);
    const tall = mount();
    const nav = () => screen.getByRole("navigation", { name: "Hauptnavigation" });
    expect(nav().className).toContain("overflow-y-auto");
    expect(nav().closest("aside")?.hasAttribute("data-tiny")).toBe(false);
    tall.unmount();
    // 844 × 390: head (two tiles) and foot (four rows) left 22 px for 19 pages
    window.matchMedia = ((q: string) => {
      const min = /min-width:\s*(\d+)px/.exec(q);
      const maxH = /max-height:\s*(\d+)px/.exec(q);
      const matches = (min ? 844 >= Number(min[1]) : true) && (maxH ? 390 <= Number(maxH[1]) : true) && !/hover|pointer|reduce|max-width/.test(q);
      return { matches, media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, onchange: null, dispatchEvent: () => false } as unknown as MediaQueryList;
    }) as typeof window.matchMedia;
    mount();
    const aside = nav().closest("aside") as HTMLElement;
    expect(aside.hasAttribute("data-tiny")).toBe(true);
    expect(aside.className).toContain("overflow-y-auto");
    expect(nav().className).not.toContain("overflow-y-auto");
    expect(nav().className).toContain("shrink-0");
  });

  it("a group folds and unfolds; the choice is stored; a short screen folds Auswerten and Konto (unless current) until the reader chooses", () => {
    expect(closedGroups(null, false, "pruefen")).toEqual([]);
    expect(closedGroups(null, true, "pruefen")).toEqual(["auswerten", "konto"]);
    expect(closedGroups(null, true, "auswerten")).toEqual(["konto"]);
    expect(closedGroups(["konto"], true, "pruefen")).toEqual(["konto"]);
    screenOf(1700);
    useUi.setState({ sidebar: "open" });
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

  it("compact is the default at EVERY width (no auto-open from 1624 px); only the reader's pin opens it, the old `closed` reads as the rail", () => {
    expect(sidebarExpanded("auto")).toBe(false);
    expect(sidebarExpanded("closed")).toBe(false);
    expect(sidebarExpanded("open")).toBe(true);
    for (const width of [1024, 1440, 1700, 2560]) {
      screenOf(width);
      const { unmount } = mount();
      expect(screen.getByRole("complementary", { name: "Hauptnavigation" }).hasAttribute("data-expanded")).toBe(false);
      expect(document.documentElement.style.getPropertyValue("--sidebar-w")).toBe(`${SIDEBAR_WIDTH.rail}px`);
      unmount();
    }
  });

  it("migration: a stored `closed` or `auto` loads as `auto`, `open` stays pinned", () => {
    for (const [stored, want] of [["closed", "auto"], ["auto", "auto"], ["open", "open"], ["x", "auto"], [undefined, "auto"]] as const) {
      localStorage.setItem("tj2-ui", JSON.stringify({ sidebar: stored }));
      expect(loadPrefs().sidebar).toBe(want);
    }
  });

  it("the search sits on top as the shared field (a combobox), the foot has the night switch, the user card and the pin; Trades carries its count", () => {
    screenOf(1700);
    useUi.setState({ sidebar: "open" });
    mount();
    const aside = screen.getByRole("complementary", { name: "Hauptnavigation" });
    expect(within(aside).getByRole("combobox", { name: "Seiten und Funktionen suchen" })).toBeInTheDocument();
    expect(within(aside).getByRole("switch", { name: "Nachtmodus" })).toBeInTheDocument();
    expect(within(aside).getByTestId("sidebar-user")).toHaveAccessibleName(/^Konto: Dieses Gerät, Nur auf diesem Gerät$/);
    expect(within(aside).getByTestId("sidebar-toggle")).toBeInTheDocument();
  });

  it("the arrow keys move between the rows, Home and End jump", () => {
    screenOf(1700);
    useUi.setState({ sidebar: "open" });
    mount();
    const links = screen.getAllByRole("link").filter((l) => l.hasAttribute("data-nav-page"));
    act(() => links[0]!.focus());
    fireEvent.keyDown(links[0]!, { key: "ArrowDown" });
    expect(document.activeElement).toBe(links[1]);
    fireEvent.keyDown(links[1]!, { key: "End" });
    expect(document.activeElement?.getAttribute("data-nav-page")).toBe(links[links.length - 1]!.getAttribute("data-nav-page"));
    // Home: the first stop is the title of the first group
    fireEvent.keyDown(document.activeElement!, { key: "Home" });
    expect(document.activeElement?.getAttribute("data-testid")).toBe("sidebar-group-toggle");
  });

  it("the sections of Einstellungen nest under its row, only while pinned and on that page", () => {
    screenOf(1700);
    useUi.setState({ sidebar: "open", page: "settings" });
    mount();
    const sub = screen.getByTestId("sidebar-sub");
    expect(sub.querySelectorAll("[data-sub]")).toHaveLength(7);
    expect(sub.querySelector("ul")!.hasAttribute("inert")).toBe(false);
    act(() => useUi.getState().setPage("trades"));
    expect(screen.getByTestId("sidebar-sub").querySelector("ul")!.hasAttribute("inert")).toBe(true);
  });
});
