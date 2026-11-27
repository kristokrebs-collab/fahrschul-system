/**
 * Die Karte der Zeitmaschine für eine Aktie (`market: "stocks"`): dieselbe Rechnung, aber kein Wort über Funding – eine Aktie hat keins.
 * Für Krypto (Standard) bleiben die Worte, wie sie waren.
 */
import { render, screen, waitFor } from "@testing-library/react";
import type { ReactElement } from "react";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { defaultOptions } from "@/domain/timemachine";
import { MotionRoot } from "@/motion/MotionRoot";
import { __forgetTimeMachine } from "@/views/timemachine/lastResult";
import type { TimeMachineCandle, TimeMachineProps } from "@/views/timemachine/types";
import { latticeBars, latticePlan, ZERO_COSTS } from "./timemachine.helpers";
import { installDomPolyfills } from "./views.overview.harness";

const { TimeMachineCard } = await import("@/views/timemachine/TimeMachineCard");

const candles: TimeMachineCandle[] = latticeBars(600, 0.5).map((b) => ({ time: b.t * 1000, open: b.o, high: b.h, low: b.l, close: b.c, closed: true }));
const plan = latticePlan(5, 10);
const props = (over: Partial<TimeMachineProps> = {}): TimeMachineProps => ({
  symbol: "AAPL",
  side: "long",
  entry: plan.entry,
  stop: plan.stop,
  target: plan.target,
  candles,
  interval: "1d",
  costs: ZERO_COSTS,
  options: { ...defaultOptions("1d"), runs: 400, horizon: 80, method: "single", vol: "history" },
  source: "Yahoo Finance (inoffiziell)",
  fetchedAt: 1_700_000_000_000,
  ...over,
});
const wrap = (ui: ReactElement) => render(<MotionRoot>{ui}</MotionRoot>);
const done = async () => waitFor(() => expect(screen.getByTestId("tm-card")).toHaveAttribute("data-status", "done"), { timeout: 30_000 });

beforeAll(() => installDomPolyfills());
afterEach(() => __forgetTimeMachine());

describe("Karte der Zeitmaschine · Aktie", { timeout: 60_000 }, () => {
  it("Erwartungswert und Kosten sprechen von Gebühren und Slippage, nicht von Funding; die Annahmen auch nicht", async () => {
    wrap(<TimeMachineCard {...props({ market: "stocks" })} />);
    await done();
    expect(screen.getByTestId("tm-expectancy")).toHaveTextContent("Durchschnitt aller Läufe in R nach Gebühren und Slippage.");
    expect(screen.getByTestId("tm-expectancy")).not.toHaveTextContent("Funding");
    expect(screen.getByTestId("tm-e-cost")).toHaveTextContent("Gebühren und Slippage je Trade");
    const assumptions = screen.getByTestId("tm-assumptions");
    expect(assumptions.textContent).toContain("Gebühren: Taker 0 bp");
    expect(assumptions.textContent).not.toMatch(/Funding/);
    expect(screen.getByTestId("tm-source")).toHaveTextContent("Yahoo Finance (inoffiziell)");
  });

  it("Krypto (Standard) behält die Worte mit Funding", async () => {
    wrap(<TimeMachineCard {...props({ symbol: "BTCUSDT", source: "Binance USDⓈ-M" })} />);
    await done();
    expect(screen.getByTestId("tm-expectancy")).toHaveTextContent("nach Gebühren, Slippage und Funding.");
    expect(screen.getByTestId("tm-e-cost")).toHaveTextContent("Gebühren, Slippage, Funding je Trade");
    expect(screen.getByTestId("tm-assumptions").textContent).toContain("kein Funding");
  });

  it("die Notiz des Hosts steht über der Plan-Zeile", async () => {
    wrap(<TimeMachineCard {...props({ market: "stocks", note: "Dein Handelsplan, durchgespielt auf 420 Stunden-Kerzen (1h)." })} />);
    expect(await screen.findByText("Dein Handelsplan, durchgespielt auf 420 Stunden-Kerzen (1h).")).toBeInTheDocument();
    await done();
  });
});
