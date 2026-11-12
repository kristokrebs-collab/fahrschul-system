/** Overview touch / share-edition behaviour: unset levels, tappable market tiles, tap tooltips. */
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { bootFixtureJournal, installDomPolyfills, type FakeMarket } from "./views.overview.harness";

const fake = vi.hoisted(() => ({ current: null as FakeMarket | null }));

vi.mock("@/market", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/market")>();
  const { fakeMarket } = await import("./views.overview.harness");
  fake.current = fakeMarket(actual);
  return { ...actual, ...fake.current.overrides };
});
vi.mock("@/app/overlays", () => ({
  TradeDetail: () => null,
  TradeEditor: () => null,
  SetupEditor: () => null,
  HyblockForm: () => null,
}));

import { MotionRoot } from "@/motion/MotionRoot";
import { MorphDialogProvider } from "@/motion/MorphDialog";
import { MarketPanel, WEEKLY_TITLE } from "@/views/overview/MarketPanel";
import { DELTA_CANDLES_LABEL, DELTA_HINT, TopTraderCard } from "@/views/overview/TopTraderCard";
import { useJournal } from "@/store/journalStore";
import { useUi } from "@/store/uiStore";

function wrap(node: React.ReactNode) {
  return render(
    <MotionRoot>
      <MorphDialogProvider>{node}</MorphDialogProvider>
    </MotionRoot>,
  );
}

describe("MarketPanel without trigger levels (share edition / fresh journal)", () => {
  beforeAll(() => installDomPolyfills());
  beforeEach(async () => {
    await bootFixtureJournal();
  });

  it("levels 0: no weekly rows or zone warning, and the automatic Lage panel instead of a levels CTA (decision 19)", () => {
    act(() => {
      useJournal.setState((s) => ({ settings: { ...s.settings, market: { ...s.settings.market, longTrigger: 0, shortTrigger: 0, longStop: 0, invalidation: 0, lowerHigh: 0, zoneLow: 0, zoneHigh: 0 } } }));
    });
    wrap(<MarketPanel />);
    expect(screen.queryByTestId("scenario-box")).toBeNull();
    expect(screen.queryByText(/Long-Trigger in/)).toBeNull();
    expect(screen.queryByText(WEEKLY_TITLE)).toBeNull();
    expect(screen.queryByTestId("levels-empty")).toBeNull();
    expect(screen.getByTestId("lage-panel")).toBeInTheDocument();
    expect(useUi.getState().page).not.toBe("settings");
  });

  it("with levels: Lage panel + weekly block, and the weekly block opens its explainer", () => {
    wrap(<MarketPanel />);
    expect(screen.getByTestId("lage-panel")).toBeInTheDocument();
    expect(screen.queryByTestId("scenario-box")).toBeNull();
    const weekly = screen.getByRole("button", { name: new RegExp(WEEKLY_TITLE.replace("?", "\\?")) });
    fireEvent.click(weekly);
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByText("Lower High (Weekly)")).toBeInTheDocument();
  });

  it("a tap on a market tile opens its explainer (funding)", () => {
    wrap(<MarketPanel />);
    const tiles = screen.getByRole("list", { name: "Markt-Kacheln" });
    fireEvent.click(within(tiles).getByRole("button", { name: /Funding/ }));
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByText("Aktuell (8 h)")).toBeInTheDocument();
    expect(within(dialog).getByText(/Funding-Rate hält den Perpetual-Kurs/)).toBeInTheDocument();
  });
});

describe("TopTraderCard on touch", () => {
  beforeAll(() => installDomPolyfills());
  beforeEach(async () => {
    await bootFixtureJournal();
  });

  it("the Delta hint opens on a touch tap and the candle tile no longer reads like an expander", async () => {
    wrap(<TopTraderCard />);
    expect(screen.getByText(DELTA_CANDLES_LABEL)).toBeInTheDocument();
    expect(screen.queryByText("Kerzen +")).toBeNull();
    const delta = screen.getByRole("button", { name: "Delta" });
    fireEvent.pointerDown(delta, { pointerType: "touch" });
    fireEvent.click(delta);
    expect((await screen.findAllByText(DELTA_HINT)).length).toBeGreaterThan(0);
  });
});
