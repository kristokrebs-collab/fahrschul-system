/**
 * Source lines of the Risiko page (F27): the calculator's live price names its source and the time of the last price, rounded
 * down to the minute („keine Daten“ without a price); the liquidation card says which positions it is built from (journal trades /
 * venue positions, with the time of the last venue request) and for each price whether the venue gave it or the app calculated it.
 */
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ddmmHHmm } from "@/market/format";
import type { ExposureLeg } from "@/domain/risk";
import { LiquidationCard, liqSourceText } from "@/views/risiko/LiquidationCard";
import { LivePriceStand } from "@/views/risiko/LivePriceStand";
import { liqBasis, type LiqRow } from "@/views/risiko/model";

const MIN = 60_000;
const T = Date.UTC(2026, 9, 26, 14, 3, 41, 500);
const feeds = vi.hoisted(() => ({ aggTrade: undefined as undefined | { source: string; receivedAt: number }, ticker24h: undefined as undefined | { source: string; receivedAt: number } }));
vi.mock("@/market", () => ({
  useFeedSelect: (feed: "aggTrade" | "ticker24h", select: (v: unknown) => unknown) => select(feeds[feed]),
}));

const leg = (id: string, source: "journal" | "exchange"): ExposureLeg => ({ id, source }) as ExposureLeg;
const row = (id: string, given: boolean, liq: number | null = 50_000): LiqRow => ({ id, label: id, side: "long", price: 60_000, liq, given, distPct: 0.1, distAtr: null, beforeStop: false, leverage: 5 });

describe("LivePriceStand", () => {
  it("names the source and the last price rounded down to the minute", () => {
    feeds.aggTrade = { source: "binance", receivedAt: T };
    feeds.ticker24h = undefined;
    render(<LivePriceStand />);
    expect(screen.getByTestId("risk-live-stand")).toHaveTextContent(`Quelle: Binance USDⓈ-M · letzter Kurs ${ddmmHHmm(Math.floor(T / MIN) * MIN)}`);
  });

  it("with two feeds the newer one names the source (the EU proxy served the ticker later)", () => {
    feeds.aggTrade = { source: "binance", receivedAt: T };
    feeds.ticker24h = { source: "proxy", receivedAt: T + 5 * MIN };
    render(<LivePriceStand />);
    expect(screen.getByTestId("risk-live-stand")).toHaveTextContent("Quelle: Binance USDⓈ-M (EU-Proxy)");
    expect(screen.getByTestId("risk-live-stand")).toHaveTextContent(ddmmHHmm(Math.floor((T + 5 * MIN) / MIN) * MIN));
  });

  it("no price yet: keine Daten, nothing estimated", () => {
    feeds.aggTrade = undefined;
    feeds.ticker24h = undefined;
    render(<LivePriceStand />);
    expect(screen.getByTestId("risk-live-stand")).toHaveTextContent("Quelle: keine Daten · letzter Kurs keine Daten");
  });
});

describe("liqBasis / liqSourceText", () => {
  it("counts the legs that have a row by origin and the prices by given / calculated; a row without a price is neither", () => {
    const legs = [leg("a", "journal"), leg("b", "journal"), leg("c", "exchange"), leg("d", "exchange")];
    const b = liqBasis(legs, [row("a", false), row("c", true), row("d", false, null)]);
    expect(b).toEqual({ journal: 1, exchange: 2, given: 1, approx: 1 });
    expect(liqBasis([], [])).toEqual({ journal: 0, exchange: 0, given: 0, approx: 0 });
  });

  it("the sentence: singular and plural, given and calculated, the planned position on its own", () => {
    expect(liqSourceText({ journal: 1, exchange: 2, given: 2, approx: 1 }, false)).toBe("1 Journal-Trade und 2 Börsen-Positionen · Liquidationspreis: 2 von Börse oder Trade, 1 gerechnet (Näherung mit deiner Tier-Tabelle)");
    expect(liqSourceText({ journal: 0, exchange: 0, given: 0, approx: 0 }, true)).toBe("geplante Position: gerechnet aus dem Rechner (Näherung mit deiner Tier-Tabelle)");
    expect(liqSourceText({ journal: 3, exchange: 0, given: 0, approx: 3 }, true)).toContain("3 Journal-Trades · Liquidationspreis: 3 gerechnet");
  });
});

describe("LiquidationCard source line", () => {
  it("shows the origin and, with venue positions, the time of the last venue request", () => {
    render(<LiquidationCard rows={[row("a", true), row("b", false)]} planned={null} basis={{ journal: 1, exchange: 1, given: 1, approx: 1 }} exchangeAt={T} />);
    const line = screen.getByTestId("liq-source");
    expect(line).toHaveTextContent("1 Journal-Trade und 1 Börsen-Position");
    expect(line).toHaveTextContent(`Börsen-Abruf ${ddmmHHmm(T)}`);
  });

  it("without venue positions no venue time is shown; the line does not appear on the empty card", () => {
    const { rerender } = render(<LiquidationCard rows={[row("a", false)]} planned={null} basis={{ journal: 1, exchange: 0, given: 0, approx: 1 }} exchangeAt={null} />);
    expect(screen.getByTestId("liq-source")).not.toHaveTextContent("Börsen-Abruf");
    rerender(<LiquidationCard rows={[]} planned={null} />);
    expect(screen.queryByTestId("liq-source")).toBeNull();
  });

  it("venue positions but no request time yet say keine Daten", () => {
    render(<LiquidationCard rows={[row("c", true)]} planned={null} basis={{ journal: 0, exchange: 1, given: 1, approx: 0 }} exchangeAt={null} />);
    expect(screen.getByTestId("liq-source")).toHaveTextContent("Börsen-Abruf keine Daten");
  });
});
