/** Insights: the effect of "Top-Trader kaufen · Retail rot" (trades without top-trader data are listed, never counted). */
import { render, screen, within } from "@testing-library/react";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { MotionRoot } from "@/motion/MotionRoot";
import { useJournal } from "@/store/journalStore";
import { SignalStrengthCard, whaleEffect } from "@/views/insights/SignalStrengthCard";
import { closedOf, enrich, qt, theirSnap, utc } from "./insights.fixtures";
import { bootFixtureJournal, installDomPolyfills } from "./views.overview.harness";

const W_OK = { ok: true, run: 3, need: 2, period: "30m", topChg: 1.2, retailChg: -0.8, points: 10, periods: [] };
const W_NO = { ...W_OK, ok: false, run: 0, points: 0 };

describe("whaleEffect", () => {
  it("win rate with vs without the condition among trades with a reading; null / missing readings only counted as keine Daten", () => {
    const closed = closedOf(
      enrich([
        qt(utc(2026, 9, 1), { p: 100, risk: 50, signal: theirSnap("long", 2, { whale: W_OK }) }),
        qt(utc(2026, 9, 2), { p: 80, risk: 40, signal: theirSnap("long", 2, { whale: W_OK }) }),
        qt(utc(2026, 9, 3), { p: -50, risk: 50, signal: theirSnap("long", 1, { whale: W_NO }) }),
        qt(utc(2026, 9, 4), { p: 40, risk: 40, signal: theirSnap("long", 1, { whale: W_NO }) }),
        qt(utc(2026, 9, 5), { p: -60, risk: 60, signal: theirSnap("long", 1, { whale: null }) }), // older than 30 days
        qt(utc(2026, 9, 6), { p: -70, risk: 70, signal: theirSnap("long", 1) }), // snapshot from before the condition
        qt(utc(2026, 9, 7), { p: 10 }), // no check at all
      ]),
    );
    const e = whaleEffect(closed)!;
    expect(e.met.n).toBe(2);
    expect(e.missed.n).toBe(2);
    expect(e.noData).toBe(2);
    expect(e.dWin).toBeCloseTo(1 - 0.5, 10);
    expect(e.dR).toBeCloseTo(2 - 0, 10);
    expect(e.label).toContain("Top-Trader kaufen · Retail rot");
  });

  it("null when no trade carries a reading", () => {
    expect(whaleEffect(closedOf(enrich([qt(utc(2026, 9, 1), { p: 5, signal: theirSnap("long", 2, { whale: null }) })])))).toBeNull();
  });
});

describe("SignalStrengthCard row", () => {
  beforeAll(() => installDomPolyfills());
  beforeEach(async () => {
    await bootFixtureJournal();
  });

  it("lists the condition under Wirkung der Bedingungen with the keine-Daten count", () => {
    const trades = useJournal.getState().trades;
    let i = 0;
    useJournal.setState({
      trades: trades.map((t) => ({ ...t, signal: theirSnap(t.side, 2, { whale: i++ % 3 === 0 ? null : i % 3 === 1 ? W_OK : W_NO }) })),
    });
    render(
      <MotionRoot>
        <SignalStrengthCard />
      </MotionRoot>,
    );
    const row = screen.getByTestId("insights-signal-whale");
    expect(within(row).getByText(/Top-Trader kaufen · Retail rot/)).toBeInTheDocument();
    expect(within(row).getByText(/^mit \d+ ·/)).toBeInTheDocument();
    expect(within(row).getByText(/^keine Daten \d+$/)).toBeInTheDocument();
  });
});
