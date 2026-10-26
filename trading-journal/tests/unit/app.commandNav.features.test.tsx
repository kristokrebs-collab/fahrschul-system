/**
 * The command navigation's deep links into the function register: a finder ("Was willst du tun?") that answers with
 * functions – not only pages – and a clear way to "Alle Funktionen"; the functions opened last appear as chips (the search's
 * recent list, `feature:<id>`), loaded from the lazy register chunk only when there is something recent; without any the
 * section is absent. A chip or a hit closes the navigation and opens the function.
 */
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const open = vi.hoisted(() => vi.fn());
vi.mock("@/app/featureOpen", () => ({ openFeature: open }));

import { closeCommandNav, CommandNav, openCommandNav } from "@/app/CommandNav";
import { featureSearchId } from "@/app/featureQuery";
import { MotionRoot } from "@/motion/MotionRoot";
import { useSearch } from "@/search/searchStore";
import { useUi } from "@/store/uiStore";
import { bootFixtureJournal, installDomPolyfills } from "./views.overview.harness";

describe("command navigation: recent functions", () => {
  beforeAll(() => installDomPolyfills());
  beforeEach(async () => {
    await bootFixtureJournal();
    useUi.setState({ page: "overview" });
    open.mockClear();
  });

  it("shows no section without a recent function, and the page link 'Funktionen' is a link like the others", async () => {
    useSearch.setState({ recent: ["page:coach", "trade:t1"] });
    render(
      <MotionRoot>
        <CommandNav />
      </MotionRoot>,
    );
    act(() => openCommandNav());
    const dialog = await screen.findByRole("dialog", { name: "Navigation" });
    expect(within(dialog).queryByTestId("cmd-recent-features")).toBeNull();
    // the page link ("Funktionen", Index) and the finder's clear way to the full list lead to the same page
    const links = within(dialog).getAllByRole("link", { name: /Funktionen/ });
    expect(links).toHaveLength(2);
    for (const l of links) expect(l).toHaveAttribute("href", "#funktionen");
    expect(within(dialog).getByTestId("nav-all-functions")).toHaveTextContent("Alle Funktionen");
    act(() => closeCommandNav(true));
  });

  it("finds a function by what you want to do, not only a page: typing lists hits, Enter opens the best, a hit closes the navigation", async () => {
    useSearch.setState({ recent: [] });
    render(
      <MotionRoot>
        <CommandNav />
      </MotionRoot>,
    );
    act(() => openCommandNav());
    const dialog = await screen.findByRole("dialog", { name: "Navigation" });
    const input = within(dialog).getByRole("searchbox", { name: "Was willst du tun?" });
    expect(within(dialog).queryByTestId("nav-finder-results")).toBeNull();
    fireEvent.change(input, { target: { value: "Wochenbericht" } });
    const list = await within(dialog).findByTestId("nav-finder-results", undefined, { timeout: 10_000 });
    const hits = within(list).getAllByRole("button");
    expect(hits.length).toBeGreaterThan(0);
    expect(hits.length).toBeLessThanOrEqual(5);
    expect(hits[0]).toHaveAttribute("data-feature", "berichte");
    expect(hits[0]).toHaveTextContent("Einen Bericht für Woche, Monat oder Jahr lesen");
    // the digits are text in the field, never a jump to a page
    fireEvent.keyDown(input, { key: "3" });
    expect(open).not.toHaveBeenCalled();
    expect(dialog).toBeInTheDocument();
    fireEvent.keyDown(input, { key: "Enter" });
    await waitFor(() => expect(open).toHaveBeenCalledWith("berichte"));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Navigation" })).toBeNull(), { timeout: 3000 });
  });

  it("says honestly when nothing fits and points to the full list; Escape clears the field before it closes the navigation", async () => {
    render(
      <MotionRoot>
        <CommandNav />
      </MotionRoot>,
    );
    act(() => openCommandNav());
    const dialog = await screen.findByRole("dialog", { name: "Navigation" });
    const input = within(dialog).getByRole("searchbox", { name: "Was willst du tun?" });
    fireEvent.change(input, { target: { value: "zzzqqq" } });
    const none = await within(dialog).findByTestId("nav-finder-none", undefined, { timeout: 10_000 });
    expect(none).toHaveTextContent("Dazu steht nichts in der Liste");
    fireEvent.keyDown(input, { key: "Escape" });
    expect(input).toHaveValue("");
    expect(screen.getByRole("dialog", { name: "Navigation" })).toBeInTheDocument();
    act(() => closeCommandNav(true));
  });

  it("lists the recently used functions as chips; a chip opens the function and closes the navigation", async () => {
    useSearch.setState({ recent: [featureSearchId("belastungstest"), "page:coach", featureSearchId("ueben"), featureSearchId("gibt-es-nicht")] });
    render(
      <MotionRoot>
        <CommandNav />
      </MotionRoot>,
    );
    act(() => openCommandNav());
    const dialog = await screen.findByRole("dialog", { name: "Navigation" });
    const group = await within(dialog).findByTestId("cmd-recent-features", undefined, { timeout: 10_000 });
    const chips = within(group).getAllByRole("button");
    expect(chips.map((c) => c.getAttribute("data-feature"))).toEqual(["belastungstest", "ueben"]);
    expect(chips[0]).toHaveTextContent("Kosten- und Belastungstest");
    fireEvent.click(chips[0]!);
    await waitFor(() => expect(open).toHaveBeenCalledWith("belastungstest"));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Navigation" })).toBeNull(), { timeout: 3000 });
  });
});
