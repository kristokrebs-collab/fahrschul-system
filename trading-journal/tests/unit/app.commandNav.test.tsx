import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { closeCommandNav, CommandNav, COMMAND_NAV_STRINGS, CONFIG, isCommandNavShortcut, MENU_BUDGET_MS, openCommandNav, rovingIndex } from "@/app/CommandNav";
import { MotionRoot } from "@/motion/MotionRoot";
import { PAGE_HINT } from "@/app/navGroups";
import { NAV_ORDER, PAGES, useUi } from "@/store/uiStore";
import { bootFixtureJournal, installDomPolyfills } from "./views.overview.harness";

function Opener() {
  return (
    <button type="button" onClick={() => openCommandNav()}>
      Navigation öffnen
    </button>
  );
}

function renderNav() {
  return render(
    <MotionRoot>
      <main>
        <Opener />
        <button type="button">Anderes</button>
      </main>
      <CommandNav />
    </MotionRoot>,
  );
}

const dialog = () => screen.getByRole("dialog", { name: "Navigation" });
const closeAndSettle = async () => {
  act(() => closeCommandNav());
  await waitFor(() => expect(screen.queryByRole("dialog", { name: "Navigation" })).toBeNull(), { timeout: 2500 });
};

describe("command navigation: pure helpers", () => {
  it("⌘K / Ctrl+K only, never with Shift or Alt", () => {
    const k = { key: "k", metaKey: false, ctrlKey: false, altKey: false, shiftKey: false };
    expect(isCommandNavShortcut({ ...k, metaKey: true })).toBe(true);
    expect(isCommandNavShortcut({ ...k, ctrlKey: true })).toBe(true);
    expect(isCommandNavShortcut({ ...k, key: "K", ctrlKey: true })).toBe(true);
    expect(isCommandNavShortcut(k)).toBe(false);
    expect(isCommandNavShortcut({ ...k, ctrlKey: true, shiftKey: true })).toBe(false);
    expect(isCommandNavShortcut({ ...k, metaKey: true, altKey: true })).toBe(false);
    expect(isCommandNavShortcut({ ...k, key: "j", ctrlKey: true })).toBe(false);
  });

  it("roving focus wraps and enters the list from outside", () => {
    expect(rovingIndex("ArrowDown", -1, 5)).toBe(0);
    expect(rovingIndex("ArrowUp", -1, 5)).toBe(4);
    expect(rovingIndex("ArrowDown", 4, 5)).toBe(0);
    expect(rovingIndex("ArrowUp", 0, 5)).toBe(4);
    expect(rovingIndex("Home", 3, 5)).toBe(0);
    expect(rovingIndex("End", 1, 5)).toBe(4);
    expect(rovingIndex("Tab", 1, 5)).toBeNull();
    expect(rovingIndex("ArrowDown", 0, 0)).toBeNull();
  });

  it("keeps the pack's wipe; the staggered entrance is tight (Runde 10: the last item starts within 0.6 s, it used to be 1.8 s / 2.3 s)", () => {
    // the wipe from the left is the pack's measured timeline and is unchanged
    expect(CONFIG.wipeMs).toBe(800);
    expect(CONFIG.wipeEase).toEqual([0.76, 0, 0.24, 1]);
    expect(CONFIG.itemEase).toEqual([0.22, 1, 0.36, 1]);
    // each item rises 16 px in 0.46 s (was 24 px in 0.65 s)
    expect(CONFIG.itemMs).toBe(460);
    expect(CONFIG.lift).toBe(16);
    // one 14 ms beat per page, in the order of the groups; nothing starts later than the budget
    const d = CONFIG.delays;
    expect(d.links).toHaveLength(PAGES.length);
    expect(d.links.every((v, i, a) => i === 0 || v - (a[i - 1] ?? 0) === 14)).toBe(true);
    const starts = [d.brand, d.finder, ...d.links, ...d.actions, d.display, d.views, d.hints, d.price];
    expect(Math.max(...starts)).toBeLessThanOrEqual(MENU_BUDGET_MS);
    expect(MENU_BUDGET_MS).toBe(600);
    // the footer rows (hint line, live price) come last
    expect(d.price).toBeGreaterThanOrEqual(d.hints);
    expect(d.hints).toBeGreaterThanOrEqual(Math.max(...d.links));
  });
});

describe("command navigation", () => {
  beforeAll(() => installDomPolyfills());
  beforeEach(async () => {
    await bootFixtureJournal();
    useUi.setState({ page: "overview", editor: { open: false, fromFab: false } });
  });

  it("Ctrl+K opens a modal dialog with links (live counts) and quick actions; focus starts on the close button", { timeout: 30_000 }, async () => {
    renderNav();
    expect(screen.queryByRole("dialog")).toBeNull();
    act(() => {
      fireEvent.keyDown(window, { key: "k", ctrlKey: true });
    });
    const d = dialog();
    expect(d).toHaveAttribute("aria-modal", "true");
    expect(within(d).getByRole("button", { name: COMMAND_NAV_STRINGS.close })).toHaveFocus();
    // the finder's way to the full list first, then all 19 pages in four groups (Erfassen, Prüfen, Auswerten, Konto & Rechtliches);
    // each link: name, plain-word hint, live count, digit (only the first nine pages have one)
    const links = within(d).getAllByRole("link").filter((l) => l.getAttribute("href")?.startsWith("#"));
    expect(links.map((l) => l.getAttribute("href"))).toEqual(["#funktionen", ...NAV_ORDER.map((p) => `#${p}`)]);
    expect(within(d).getAllByTestId("cmd-hint").map((h) => h.textContent)).toEqual(NAV_ORDER.map((p) => PAGE_HINT[p]));
    expect(links[1]?.textContent).toMatch(/^TradesDeine Einträge/);
    // the groups by what you are doing
    expect(within(d).getAllByTestId("cmd-group").map((g) => g.getAttribute("data-group"))).toEqual(["erfassen", "pruefen", "auswerten", "konto"]);
    expect(within(d).getByRole("link", { name: /Übersicht/ })).toHaveAttribute("aria-current", "page");
    expect(within(d).getByRole("button", { name: COMMAND_NAV_STRINGS.newTrade })).toBeInTheDocument();
    // ⌘K again toggles it closed
    act(() => {
      fireEvent.keyDown(window, { key: "k", metaKey: true });
    });
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Navigation" })).toBeNull(), { timeout: 2500 });
  });

  it("arrow keys rove over links and actions, Escape closes and focus returns to the opener", async () => {
    renderNav();
    const opener = screen.getByRole("button", { name: "Navigation öffnen" });
    opener.focus();
    fireEvent.click(opener);
    const d = dialog();
    const items = Array.from(d.querySelectorAll<HTMLElement>("[data-cmd-item]"));
    expect(items.length).toBeGreaterThanOrEqual(5);
    fireEvent.keyDown(d, { key: "ArrowDown" });
    expect(items[0]).toHaveFocus();
    fireEvent.keyDown(d, { key: "ArrowDown" });
    expect(items[1]).toHaveFocus();
    fireEvent.keyDown(d, { key: "ArrowUp" });
    fireEvent.keyDown(d, { key: "ArrowUp" });
    expect(items[items.length - 1]).toHaveFocus();
    fireEvent.keyDown(d, { key: "Home" });
    expect(items[0]).toHaveFocus();
    // Tab stays inside (trap): from the last focusable it wraps to the first
    items[items.length - 1]?.focus();
    fireEvent.keyDown(document, { key: "Tab" });
    expect(d.contains(document.activeElement)).toBe(true);

    fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Navigation" })).toBeNull(), { timeout: 2500 });
    await waitFor(() => expect(opener).toHaveFocus());
  });

  it("a page link navigates and closes; digits jump to a page", { timeout: 30_000 }, async () => {
    renderNav();
    act(() => openCommandNav());
    fireEvent.click(within(dialog()).getByRole("link", { name: /^0?2?Trades/ }));
    expect(useUi.getState().page).toBe("trades");
    expect(location.hash).toBe("#trades");
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Navigation" })).toBeNull(), { timeout: 2500 });

    act(() => openCommandNav());
    fireEvent.keyDown(dialog(), { key: "4" });
    // the digits 1–9 are the first nine of `PAGES` (they never moved): 4 = Markt
    expect(useUi.getState().page).toBe("markt");
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Navigation" })).toBeNull(), { timeout: 2500 });
  });

  it("`Trade eintragen` closes at once and opens the editor through the ui store", { timeout: 30_000 }, async () => {
    renderNav();
    act(() => openCommandNav());
    fireEvent.click(within(dialog()).getByRole("button", { name: COMMAND_NAV_STRINGS.newTrade }));
    expect(useUi.getState().editor).toEqual({ open: true, tradeId: undefined, fromFab: false });
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Navigation" })).toBeNull(), { timeout: 2500 });
  });

  it("the shortcut is ignored while another modal dialog is open", async () => {
    render(
      <MotionRoot>
        <div role="dialog" aria-modal="true" aria-label="Trade eintragen" />
        <CommandNav />
      </MotionRoot>,
    );
    act(() => {
      fireEvent.keyDown(window, { key: "k", ctrlKey: true });
    });
    expect(screen.queryByRole("dialog", { name: "Navigation" })).toBeNull();
    await closeAndSettle();
  });
});
