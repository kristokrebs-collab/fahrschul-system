import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { Profiler } from "react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
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

import { LONG_IN_REACH_LABEL } from "@/domain/trigger";
import { askMv, bidMv, buyVolMv, flowImbalanceMv, markMv, priceMv, priceReceivedAtMv, sellVolMv, tradeCountMv, volAccumMv } from "@/market";
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

  it("renders header, live status, price, the Lage panel and weekly checks for the fixture snapshot", () => {
    const m = useJournal.getState().settings.market;
    expect(m.longTrigger).toBeLessThan(86_200);
    wrap(<MarketPanel />);
    expect(screen.getByText("BTC/USDT · Binance")).toBeInTheDocument();
    // status: live pill (age < 2 s → "Live"), refresh via title
    const pill = screen.getByRole("button", { name: "Jetzt aktualisieren" });
    expect(pill.querySelector("[data-status-pill]")?.textContent).toContain("Live");
    // price 86.100 (RollingDigits) + 24h change
    expect(screen.getByText("86.100")).toBeInTheDocument();
    expect(screen.getByText("+1,20 % 24h")).toBeInTheDocument();
    // decision 19: the automatic Lage panel replaced the manual trigger scenario (the stored levels stay)
    expect(screen.getByTestId("lage-panel")).toBeInTheDocument();
    expect(screen.queryByTestId("scenario-box")).toBeNull();
    // weekly block: closeW 83.000 > lowerHigh 82.829 → ✓
    expect(screen.getByText(WEEKLY_TITLE)).toBeInTheDocument();
    expect(screen.getByText(`Weekly Close über ${n0(m.lowerHigh)}`)).toBeInTheDocument();
    expect(screen.getByText("83.000")).toBeInTheDocument();
    // no manual trigger distance any more (decision 19); decision 13: no general short trigger on the overview (the stored level stays in the settings)
    expect(screen.queryByText(/^Short-Trigger in /)).toBeNull();
    expect(screen.queryByText(/Short-Trigger/)).toBeNull();
    // funding line from markPrice
    expect(screen.getByText(/^Mark 86\.112 · Funding \+0,0100 % · nächstes Funding in /)).toBeInTheDocument();
  });

  it("the stored trigger levels no longer drive the overview: no scenario, no trigger rows, values untouched (decisions 13, 19)", () => {
    const s = useJournal.getState().settings;
    useJournal.setState({ settings: { ...s, market: { ...s.market, longTrigger: 88_000, shortTrigger: 87_000 } } });
    wrap(<MarketPanel />);
    expect(screen.queryByTestId("scenario-box")).toBeNull();
    expect(screen.queryByText(/Range, kein Trigger/)).toBeNull();
    expect(screen.queryByText(/^Long-Trigger in /)).toBeNull();
    expect(screen.queryByText(/Short-Trigger/)).toBeNull();
    // the stored levels are untouched (no data loss)
    expect(useJournal.getState().settings.market.shortTrigger).toBe(87_000);
    expect(useJournal.getState().settings.market.longTrigger).toBe(88_000);
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

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe("MarketPanel live leaves", () => {
  beforeAll(() => installDomPolyfills());
  beforeEach(async () => {
    await bootFixtureJournal();
    priceReceivedAtMv.jump(Date.now());
  });
  afterEach(() => {
    priceMv.jump(86_100);
    for (const mv of [bidMv, askMv, markMv, tradeCountMv, buyVolMv, sellVolMv, volAccumMv, flowImbalanceMv, priceReceivedAtMv]) mv.jump(0);
  });

  it("trade, book, mark and order-flow ticks update the numbers without a single React render", async () => {
    let commits = 0;
    wrap(
      <Profiler id="panel" onRender={() => commits++}>
        <MarketPanel />
      </Profiler>,
    );
    await act(() => sleep(50));
    const mounted = commits;
    await act(async () => {
      for (let i = 1; i <= 30; i++) {
        const p = 86_100 + i * 0.7;
        priceMv.set(p);
        bidMv.set(p - 0.1);
        askMv.set(p);
        markMv.set(86_112 + i);
        tradeCountMv.set(i);
        buyVolMv.set(i);
        sellVolMv.set(i / 2);
        volAccumMv.set(i * 1.5);
        flowImbalanceMv.set(0.3);
        priceReceivedAtMv.set(Date.now());
        await sleep(4);
      }
    });
    await waitFor(() => expect(screen.getByText("86.120,9 / 86.121,0")).toBeInTheDocument());
    await waitFor(() => expect(screen.getByText("Käufe 65 %")).toBeInTheDocument(), { timeout: 2000 });
    await waitFor(() => expect(screen.getByText(/^Mark 86\.142 · Funding /)).toBeInTheDocument(), { timeout: 2000 });
    expect(commits).toBe(mounted);
  });

  it("a price at the stored long trigger shows no reach badge any more (the Lage panel replaced it)", async () => {
    const m = useJournal.getState().settings.market;
    wrap(<MarketPanel />);
    await act(async () => {
      priceMv.set(m.longTrigger * 0.999);
      await sleep(20);
    });
    expect(screen.queryByText(LONG_IN_REACH_LABEL)).not.toBeInTheDocument();
    await act(async () => {
      priceMv.set(86_100);
    });
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
