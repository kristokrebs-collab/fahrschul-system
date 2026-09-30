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
import { MarketPanel, TopTraderCard, WEEKLY_TITLE } from "@/views/overview";
import { n0 } from "@/lib/format";
import { useJournal } from "@/store/journalStore";

function wrap(node: React.ReactNode) {
  return render(
    <MotionRoot>
      <MorphDialogProvider>{node}</MorphDialogProvider>
    </MotionRoot>,
  );
}

describe("MarketPanel", () => {
  beforeAll(() => installDomPolyfills());
  beforeEach(async () => {
    await bootFixtureJournal();
    fake.current?.refresh.mockClear();
  });

  it("renders header, live status, price, scenario and weekly checks for the fixture snapshot", () => {
    const m = useJournal.getState().settings.market;
    expect(m.longTrigger).toBeLessThan(86_200);
    wrap(<MarketPanel />);
    expect(screen.getByText("BTC/USDT · Binance")).toBeInTheDocument();
    // status: live pill (age < 2 s → "Live"), refresh via title
    const pill = screen.getByRole("button", { name: "Jetzt aktualisieren" });
    expect(within(pill).getByRole("status").textContent).toContain("Live");
    // price 86.100 (RollingDigits) + 24h change
    expect(screen.getByRole("text", { name: "86.100" })).toBeInTheDocument();
    expect(screen.getByText("+1,20 % 24h")).toBeInTheDocument();
    // scenario: close4h 86.200 > longTrigger 85.900 → long
    const box = screen.getByTestId("scenario-box");
    expect(within(box).getByText("Long-Trigger aktiv")).toBeInTheDocument();
    expect(within(box).getByText(`4H-Schluss über ${n0(m.longTrigger)}. Ziel 87.200, dann 89.000–90.000. Invalidierung unter ${n0(m.longStop)}.`)).toBeInTheDocument();
    expect(within(box).getByText("4H 86.200")).toBeInTheDocument();
    expect(within(box).getByText(/Letzter geschlossener 4H-Schluss · /)).toBeInTheDocument();
    // weekly block: closeW 83.000 > lowerHigh 82.829 → ✓
    expect(screen.getByText(WEEKLY_TITLE)).toBeInTheDocument();
    expect(screen.getByText(`Weekly Close über ${n0(m.lowerHigh)}`)).toBeInTheDocument();
    expect(screen.getByText("83.000")).toBeInTheDocument();
    // trigger distance rows
    expect(screen.getByText(/^Long-Trigger in /)).toBeInTheDocument();
    expect(screen.getByText(/^Short-Trigger in /)).toBeInTheDocument();
    // funding line from markPrice
    expect(screen.getByText(/^Mark 86\.112 · Funding \+0,0100 % · nächstes Funding in /)).toBeInTheDocument();
  });

  it("`Jetzt aktualisieren` forces the five market-card feeds once per 5 s", async () => {
    wrap(<MarketPanel />);
    const pill = screen.getByRole("button", { name: "Jetzt aktualisieren" });
    await act(async () => {
      fireEvent.click(pill);
    });
    const feeds = fake.current!.refresh.mock.calls.map((c) => (c as unknown as [string, { force?: boolean }])[0]).sort();
    expect(feeds).toEqual(["kline_1h", "kline_1w", "kline_4h", "markPrice", "ticker24h"]);
    expect((fake.current!.refresh.mock.calls[0] as unknown as [string, { force?: boolean }])[1]).toEqual({ force: true });
    await act(async () => {
      fireEvent.click(pill);
    });
    expect(fake.current!.refresh).toHaveBeenCalledTimes(5);
  });
});

describe("TopTraderCard", () => {
  beforeAll(() => installDomPolyfills());
  beforeEach(async () => {
    await bootFixtureJournal();
  });

  it("renders the last manual reading with the Falling-Knife filter and the Binance title", () => {
    wrap(<TopTraderCard />);
    expect(screen.getByText("Top Trader · Binance")).toBeInTheDocument();
    expect(screen.getByText("Long %")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Falling-Knife-Filter/ })).toHaveAttribute("aria-haspopup", "dialog");
    expect(screen.getByText(/^\d+ Ablesung(en)?$/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Hyblock ↗" })).toHaveAttribute("href", expect.stringContaining("hyblockcapital.com"));
  });
});
