/**
 * Global search overlay (P13): opens from the store, combobox + listbox semantics, the "Stärkste zuerst" suggestions,
 * typing filters, arrows move the active option, Enter closes with the chosen action and the host runs it after the
 * exit (here: a page switch and a trade detail), Escape closes without one.
 */
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { MotionRoot } from "@/motion/MotionRoot";
import { GlobalSearchHost } from "@/search/GlobalSearchHost";
import { closeSearch, openSearch, useSearch } from "@/search/searchStore";
import { useJournal } from "@/store/journalStore";
import { useUi } from "@/store/uiStore";
import { bootFixtureJournal, installDomPolyfills } from "./views.overview.harness";

function renderHost() {
  return render(
    <MotionRoot>
      <GlobalSearchHost />
    </MotionRoot>,
  );
}

describe("GlobalSearch", () => {
  beforeAll(async () => {
    installDomPolyfills();
    // the overlay and its actions are lazy chunks: load them once up front
    await import("@/search/GlobalSearch");
    await import("@/search/actions");
  });
  beforeEach(async () => {
    await bootFixtureJournal();
    localStorage.removeItem("tj2-search-recent");
    useSearch.setState({ open: false, seed: "", pending: null, recent: [] });
  });
  afterEach(() => {
    act(() => closeSearch());
  });

  it("opens as a modal dialog with a combobox, focuses the field and shows the strongest first", async () => {
    renderHost();
    act(() => openSearch());
    const dialog = await screen.findByRole("dialog", { name: "Suche" });
    expect(dialog).toHaveAttribute("aria-modal", "true");
    const box = within(dialog).getByRole("combobox", { name: "Suche" });
    await waitFor(() => expect(box).toHaveFocus());
    const list = within(dialog).getByRole("listbox");
    expect(list).toHaveAccessibleName("Stärkste zuerst");
    expect(within(dialog).getByText("Stärkste zuerst")).toBeInTheDocument();
    const options = within(list).getAllByRole("option");
    expect(options.length).toBeGreaterThan(3);
    expect(options[0]).toHaveAttribute("aria-selected", "true");
    expect(box).toHaveAttribute("aria-activedescendant", options[0]!.id);
  });

  it("filters while typing, arrows move the active option, Enter runs it after the exit (page switch)", async () => {
    renderHost();
    act(() => openSearch());
    const box = await screen.findByRole("combobox", { name: "Suche" });
    fireEvent.change(box, { target: { value: "einst" } });
    const options = await screen.findAllByRole("option");
    expect(options[0]).toHaveTextContent("Einstellungen");
    fireEvent.keyDown(box, { key: "ArrowDown" });
    expect(screen.getAllByRole("option")[1]).toHaveAttribute("aria-selected", "true");
    fireEvent.keyDown(box, { key: "ArrowUp" });
    expect(screen.getAllByRole("option")[0]).toHaveAttribute("aria-selected", "true");
    fireEvent.keyDown(box, { key: "Enter" });
    expect(useSearch.getState().open).toBe(false);
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Suche" })).toBeNull());
    await waitFor(() => expect(useUi.getState().page).toBe("settings"));
    expect(useSearch.getState().recent[0]).toBe("page:settings");
  });

  it("a trade hit opens the trade detail; nothing found shows an honest empty state", async () => {
    const trade = useJournal.getState().trades.find((t) => t.status === "closed" && t.notes)!;
    renderHost();
    act(() => openSearch());
    const box = await screen.findByRole("combobox", { name: "Suche" });
    fireEvent.change(box, { target: { value: "zzzzqqqq" } });
    expect(await screen.findByText("Nichts gefunden")).toBeInTheDocument();
    expect(box).toHaveAttribute("aria-expanded", "false");
    fireEvent.change(box, { target: { value: trade.notes.split(/\s+/).slice(0, 2).join(" ") } });
    const opt = (await screen.findAllByRole("option")).find((o) => o.getAttribute("data-search-kind") === "trade")!;
    expect(opt).toBeDefined();
    fireEvent.click(opt);
    await waitFor(() => expect(useUi.getState().detail.id).not.toBeNull());
    useUi.setState({ detail: { id: null, source: null } });
  });

  it("Escape closes without an action", async () => {
    renderHost();
    act(() => openSearch());
    const dialog = await screen.findByRole("dialog", { name: "Suche" });
    fireEvent.keyDown(dialog, { key: "Escape" });
    await waitFor(() => expect(useSearch.getState().open).toBe(false));
    expect(useSearch.getState().pending).toBeNull();
    expect(useUi.getState().page).toBe("overview");
  });
});
