/**
 * The command navigation's deep links into the function register: the functions opened last appear as chips (the search's
 * recent list, `feature:<id>`), loaded from the lazy register chunk only when there is something recent; without any the
 * section is absent. A chip closes the navigation and opens the function.
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
    expect(within(dialog).getByRole("link", { name: /Funktionen/ })).toHaveAttribute("href", "#funktionen");
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
