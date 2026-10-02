import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { closeCommandNav, CommandNav, COMMAND_NAV_STRINGS, CONFIG, isCommandNavShortcut, openCommandNav, rovingIndex } from "@/app/CommandNav";
import { MotionRoot } from "@/motion/MotionRoot";
import { useUi } from "@/store/uiStore";
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

  it("keeps the pack's measured timeline", () => {
    expect(CONFIG.wipeMs).toBe(800);
    expect(CONFIG.wipeEase).toEqual([0.76, 0, 0.24, 1]);
    expect(CONFIG.itemMs).toBe(650);
    expect(CONFIG.itemEase).toEqual([0.22, 1, 0.36, 1]);
    expect(CONFIG.delays.links).toEqual([620, 720, 820, 900]);
  });
});

describe("command navigation", () => {
  beforeAll(() => installDomPolyfills());
  beforeEach(async () => {
    await bootFixtureJournal();
    useUi.setState({ page: "overview", editor: { open: false, fromFab: false } });
  });

  it("Ctrl+K opens a modal dialog with links (live counts) and quick actions; focus starts on the close button", async () => {
    renderNav();
    expect(screen.queryByRole("dialog")).toBeNull();
    act(() => {
      fireEvent.keyDown(window, { key: "k", ctrlKey: true });
    });
    const d = dialog();
    expect(d).toHaveAttribute("aria-modal", "true");
    expect(within(d).getByRole("button", { name: COMMAND_NAV_STRINGS.close })).toHaveFocus();
    const links = within(d).getAllByRole("link");
    expect(links.map((l) => l.textContent?.replace(/^0\d/, ""))).toEqual([expect.stringMatching(/^Übersicht/), "Trades13", "Entscheidungsgrundlagen7", expect.stringMatching(/^Einstellungen\d+$/)]);
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

  it("a page link navigates and closes; digits jump to a page", async () => {
    renderNav();
    act(() => openCommandNav());
    fireEvent.click(within(dialog()).getByRole("link", { name: /^0?2?Trades/ }));
    expect(useUi.getState().page).toBe("trades");
    expect(location.hash).toBe("#trades");
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Navigation" })).toBeNull(), { timeout: 2500 });

    act(() => openCommandNav());
    fireEvent.keyDown(dialog(), { key: "4" });
    expect(useUi.getState().page).toBe("settings");
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Navigation" })).toBeNull(), { timeout: 2500 });
  });

  it("`Trade eintragen` closes at once and opens the editor through the ui store", async () => {
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
