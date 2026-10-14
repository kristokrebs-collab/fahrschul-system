import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { bootFixtureJournal, installDomPolyfills } from "./views.overview.harness";

vi.mock("@/market", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/market")>();
  const { fakeMarket } = await import("./views.overview.harness");
  return { ...actual, ...fakeMarket(actual).overrides };
});

import { tradeTime } from "@/lib/dates";
import { MotionRoot } from "@/motion/MotionRoot";
import { getAccountView, getEnriched, useJournal } from "@/store/journalStore";
import { useUi } from "@/store/uiStore";
import { RECENT_COUNT, RecentTrades } from "@/views/overview";

describe("RecentTrades", () => {
  beforeAll(() => installDomPolyfills());
  beforeEach(async () => {
    await bootFixtureJournal();
  });

  it("lists the newest trades and opens the detail with source `recent`", async () => {
    const { trades, settings } = useJournal.getState();
    const view = getAccountView(getEnriched(trades, settings), settings, "all");
    const newest = [...view.list].sort((a, b) => +tradeTime(b) - +tradeTime(a));
    render(
      <MotionRoot>
        <RecentTrades />
      </MotionRoot>,
    );
    expect(screen.getByText("Letzte Trades")).toBeInTheDocument();
    const rows = screen.getAllByRole("button").filter((b) => /Long|Short/.test(b.textContent ?? ""));
    expect(rows).toHaveLength(Math.min(RECENT_COUNT, newest.length));
    await act(async () => {
      fireEvent.click(rows[0]!);
    });
    expect(useUi.getState().detail).toEqual({ id: newest[0]!.id, source: "recent" });
  });

  it("`Alle ansehen →` navigates to the trades tab", async () => {
    render(
      <MotionRoot>
        <RecentTrades />
      </MotionRoot>,
    );
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Alle ansehen →" }));
    });
    expect(useUi.getState().page).toBe("trades");
    expect(location.hash).toBe("#trades");
  });

  it("does not open a detail while a page transition is running", async () => {
    useUi.getState().setTransitioning(true);
    render(
      <MotionRoot>
        <RecentTrades />
      </MotionRoot>,
    );
    const rows = screen.getAllByRole("button").filter((b) => /Long|Short/.test(b.textContent ?? ""));
    await act(async () => {
      fireEvent.click(rows[0]!);
    });
    expect(useUi.getState().detail.id).toBeNull();
  });
});
