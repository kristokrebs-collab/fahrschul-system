/**
 * Shortcut host (P13): real key events on `window` – n opens the editor, g then t switches the page (with the chord
 * hint), t toggles the theme, ? opens the cheat sheet (keys as a MagnifyRow toolbar, the full list), / opens the
 * search; nothing fires from a text field or while a modal dialog is open.
 */
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { ShortcutHost } from "@/app/ShortcutHost";
import { closeShortcutSheet, useShortcutSheet } from "@/app/shortcuts";
import { MotionRoot } from "@/motion/MotionRoot";
import { useSearch } from "@/search/searchStore";
import { useTheme } from "@/store/themeStore";
import { useUi } from "@/store/uiStore";
import { bootFixtureJournal, installDomPolyfills } from "./views.overview.harness";

const press = (key: string, o: Partial<KeyboardEventInit> = {}, target: Element | Window = window) =>
  act(() => {
    fireEvent.keyDown(target, { key, ...o });
  });

describe("ShortcutHost", () => {
  beforeAll(async () => {
    installDomPolyfills();
    await import("@/app/ShortcutSheet");
  });
  beforeEach(async () => {
    await bootFixtureJournal();
    useSearch.setState({ open: false });
    useShortcutSheet.setState({ open: false, loaded: false });
    useTheme.setState({ pref: "dark", resolved: "dark", accent: "signal" });
  });
  afterEach(() => {
    act(() => {
      closeShortcutSheet();
      useUi.setState({ editor: { open: false, fromFab: false } });
    });
    document.querySelectorAll("[data-test-modal]").forEach((n) => n.remove());
  });

  const mount = () =>
    render(
      <MotionRoot>
        <ShortcutHost />
      </MotionRoot>,
    );

  it("n opens the trade editor, / opens the search", () => {
    mount();
    press("n");
    expect(useUi.getState().editor.open).toBe(true);
    act(() => useUi.setState({ editor: { open: false, fromFab: false } }));
    press("/");
    expect(useSearch.getState().open).toBe(true);
  });

  it("g then a letter switches the page and shows the chord hint meanwhile", async () => {
    mount();
    press("g");
    expect(document.querySelector('[data-layer="Tastenkürzel-Hinweis"]')).not.toBeNull();
    press("t");
    expect(useUi.getState().page).toBe("trades");
    await waitFor(() => expect(document.querySelector('[data-layer="Tastenkürzel-Hinweis"]')).toBeNull());
    press("[");
    expect(useUi.getState().page).toBe("overview");
    press("]");
    expect(useUi.getState().page).toBe("trades");
  });

  it("t toggles light / dark", () => {
    mount();
    press("t");
    expect(useTheme.getState().resolved).toBe("light");
    press("t");
    expect(useTheme.getState().resolved).toBe("dark");
  });

  it("? opens the cheat sheet with the key toolbar and every group", async () => {
    mount();
    press("?", { shiftKey: true });
    const sheet = await screen.findByTestId("shortcut-sheet");
    expect(within(sheet).getByRole("toolbar", { name: "Wichtigste Tasten" })).toBeInTheDocument();
    for (const g of ["Navigation", "Aktionen", "Suche & Hilfe"]) expect(within(sheet).getByRole("heading", { name: g })).toBeInTheDocument();
    expect(within(sheet).getAllByText("Neuen Trade eintragen").length).toBeGreaterThan(0);
    expect(within(sheet).getByRole("button", { name: "Einführung noch einmal ansehen" })).toBeInTheDocument();
  });

  it("ignores keys typed into a field and while a modal dialog is open", () => {
    mount();
    const input = document.createElement("input");
    document.body.appendChild(input);
    press("n", {}, input);
    expect(useUi.getState().editor.open).toBe(false);
    input.remove();
    const dlg = document.createElement("div");
    dlg.setAttribute("role", "dialog");
    dlg.setAttribute("aria-modal", "true");
    dlg.setAttribute("data-test-modal", "");
    document.body.appendChild(dlg);
    press("n");
    press("/");
    expect(useUi.getState().editor.open).toBe(false);
    expect(useSearch.getState().open).toBe(false);
  });
});
