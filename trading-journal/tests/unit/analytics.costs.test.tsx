/**
 * Costs (Review MM-7, F05, F12, F13): fill fees that the P&L carries are reported as fees, the P&L before fees and
 * funding ("Brutto vor Kosten") is shown in Analyse and Berichte, fees / funding are custom-stat metrics per exchange.
 */
import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { aggregate } from "@/domain/agg";
import { evalCustomStat, feesPctOf, CUSTOM_METRICS } from "@/domain/analytics/customStats";
import { buildReport, reportToMarkdown, periodOf } from "@/domain/reports";
import { MotionRoot } from "@/motion/MotionRoot";
import { CostsCard } from "@/views/analyse/CostsCard";
import { formatCustom } from "@/views/analyse/CustomStatCard";
import { enriched, mkTrade, settings } from "./domain.fixtures";

// the review's probe: long 1 BTC 60 000 → 61 000, fill fees 30 + 30,5, trade.fees empty
const FILLS = mkTrade({
  id: "fx",
  date: "2026-03-02T10:00",
  entry: 60000,
  exit: 61000,
  size: null,
  fees: null,
  exchange: "Bitunix",
  fills: [
    { id: "f1", at: "2026-03-02T10:00", side: "open", price: 60000, qty: 1, fee: 30, kind: "entry" },
    { id: "f2", at: "2026-03-02T12:00", side: "close", price: 61000, qty: 1, fee: 30.5, kind: "exit" },
  ],
} as never);
const FUNDED = mkTrade({ id: "fu", date: "2026-03-03T10:00", entry: 100, exit: 110, size: 1000, fees: 2, fundingFees: 3, exchange: "Binance" } as never);
const RECEIVED = mkTrade({ id: "fr", date: "2026-03-04T10:00", side: "short", entry: 100, exit: 95, size: 1000, fees: 1, fundingFees: -4, exchange: "Binance" } as never);

describe("aggregate carries the real costs", () => {
  it("fill fees count as fees (they were deducted from the P&L), funding paid / received, gross before costs", () => {
    const [fx, fu, fr] = enriched([FILLS, FUNDED, RECEIVED]);
    expect(fx!.pnl).toBeCloseTo(939.5, 9);
    const one = aggregate([fx!]);
    expect(one.fees).toBeCloseTo(60.5, 9);
    expect(one.gross).toBeCloseTo(1000, 9);
    const g = aggregate([fx!, fu!, fr!]);
    expect(g.fees).toBeCloseTo(63.5, 9);
    expect(g.fundingPaid).toBe(3);
    expect(g.fundingReceived).toBe(4);
    expect(g.funding).toBe(-1);
    expect(g.gross).toBeCloseTo(g.net + 63.5 - 1, 9);
    // without fills nothing changes: fees = trade.fees
    expect(aggregate([fu!]).fees).toBe(2);
  });

  it("custom stats: fees, fees in % of the position value and funding per exchange", () => {
    const list = enriched([FILLS, FUNDED, RECEIVED]);
    const ctx = { settings: settings() };
    const now = new Date(2026, 3, 1).getTime();
    const stat = (metric: "fees" | "funding" | "gross" | "feesPct") => evalCustomStat(list, { id: "x", metric, filter: {}, groupBy: "exchange", createdAt: "" }, ctx, 0, now);
    const fees = stat("fees");
    expect(fees.value).toBeCloseTo(-63.5, 9);
    expect(Object.fromEntries((fees.groups ?? []).map((g) => [g.label, g.value]))).toMatchObject({ Bitunix: -60.5, Binance: -3 });
    expect(stat("funding").value).toBe(1); // 4 received − 3 paid
    expect(stat("gross").value).toBeCloseTo(aggregate(list).gross, 9);
    expect(feesPctOf(list)).toBeCloseTo(63.5 / (60000 + 1000 + 1000), 9);
    expect(formatCustom(0.000512, CUSTOM_METRICS.feesPct.format, "USDT")).toBe("0,051 %");
  });
});

describe("Analyse „Kosten“ and the report", () => {
  it("the card shows Brutto vor Kosten, Gebühren, Funding and Netto", () => {
    const list = enriched([FILLS, FUNDED, RECEIVED]);
    const g = aggregate(list);
    render(
      <MotionRoot>
        <CostsCard closed={list} cur="USDT" />
      </MotionRoot>,
    );
    const card = screen.getByTestId("ana-costs");
    expect(within(card).getByText("Brutto vor Kosten")).toBeInTheDocument();
    expect(Number(screen.getByTestId("ana-cost-gross").dataset.value)).toBeCloseTo(Math.round(g.gross * 100) / 100, 2);
    expect(Number(screen.getByTestId("ana-cost-fees").dataset.value)).toBeCloseTo(-63.5, 2);
    expect(Number(screen.getByTestId("ana-cost-funding").dataset.value)).toBe(1);
    expect(Number(screen.getByTestId("ana-cost-net").dataset.value)).toBeCloseTo(Math.round(g.net * 100) / 100, 2);
    expect(screen.getByTestId("ana-costs-share").textContent).toMatch(/Kosten = \d+ % vom Brutto-Gewinn/);
  });

  it("the report's performance block and export name the gross P&L and the costs", () => {
    const list = enriched([FILLS, FUNDED, RECEIVED]);
    const now = new Date(2026, 3, 15).getTime();
    const period = periodOf("month", new Date(2026, 2, 10).getTime());
    const r = buildReport({ list, settings: settings(), events: [], start: 10_000, currency: "USDT", period, now });
    expect(r.performance.g.gross).toBeCloseTo(aggregate(list).gross, 9);
    const md = reportToMarkdown(r);
    expect(md).toMatch(/\| Brutto vor Kosten \| \+?[\d.]+ USDT \|/);
    expect(md).toMatch(/\| Gebühren \| [−-]64 USDT \|/);
  });
});
