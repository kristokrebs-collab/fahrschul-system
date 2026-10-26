/**
 * Die Zeitmaschine mit Aktien-Kerzen, ungestubbt: was der Slot der Plan-Seite der Karte gibt (Stunden- und Tageskerzen einer US-Aktie,
 * Zeitstopp, Startzeit, Kosten ohne Funding) läuft durch die echte Rechnung – ohne Ablehnung, mit den Kosten des Plans, über
 * Nacht-Lücken hinweg, und ohne Blick in die Zukunft.
 */
import { describe, expect, it } from "vitest";
import { assumptionsOf, MIN_POOL_BARS, runTimeMachineSync } from "@/domain/timemachine";
import { stockCosts } from "@/views/plan/slotsImpl";
import { inputOf } from "@/views/timemachine/model";
import { stocksHistory, type HistoryPlan } from "@/views/timemachine/historySources";
import type { TimeMachineProps } from "@/views/timemachine/types";
import { isClosedBar, ok, type StockBars, type StockCandle, type StockInterval } from "@/market/stocks";
import { stockHistoryBars, stockOpen } from "../e2e/mocks/planStockCandles";

const DAY = "2026-10-23";
const OPEN = stockOpen(DAY);
const NOW = Date.UTC(2026, 9, 26, 10, 0);
const plan: HistoryPlan = { intervalMs: 300_000, sessionOpenMs: OPEN, sessionCloseMs: OPEN + 390 * 60_000, entryAt: OPEN + 25 * 60_000, flatByMs: OPEN + 385 * 60_000, now: NOW, past: true };

const source = stocksHistory(async () => ({
  bars: async (_s: string, interval: StockInterval) => {
    const rows = stockHistoryBars(interval === "1d" ? "1d" : "1h", "2026-10-27", interval === "1d" ? 400 : 62);
    const candles = rows.map(([time, open, high, low, close, volume]): StockCandle => ({ time: time!, open: open!, high: high!, low: low!, close: close!, volume: volume!, closed: isClosedBar(interval, time!, NOW) }));
    const data: StockBars = { symbol: "AAPL", interval, range: "2y", candles, meta: { name: null, currency: "USD", exchange: null, price: null, prevClose: null, volume: null, marketTime: null } };
    return ok(data, { source: "yahoo", asOf: NOW, receivedAt: NOW, fetchedAt: NOW });
  },
}) as never);

async function propsFor(id: "1h" | "1d"): Promise<TimeMachineProps> {
  const choice = source.choices(300_000).choices.find((c) => c.id === id)!;
  const res = await source.load({ symbol: "AAPL", interval: id, signal: new AbortController().signal, until: source.until(plan) });
  if (!res.ok) throw new Error(res.message);
  const setup = source.setup(choice, plan, res.candles.length);
  return {
    symbol: "AAPL",
    side: "long",
    entry: 185.9,
    stop: 185.05,
    target: 187.6,
    candles: res.candles,
    interval: res.interval,
    costs: stockCosts(0.0005, 0.0005),
    options: { ...setup.options, runs: 600 },
    startMs: setup.startMs,
    market: "stocks",
    source: res.sourceLabel,
    fetchedAt: res.fetchedAt,
  };
}

describe("Zeitmaschine · eine US-Aktie auf Stunden- und Tageskerzen", () => {
  it("Stunden-Kerzen: die Rechnung läuft, mit 7 Kerzen Zeitstopp, den Kosten des Plans und ohne Funding", async () => {
    const p = await propsFor("1h");
    const prepared = inputOf(p);
    expect(prepared.ok).toBe(true);
    if (!prepared.ok) return;
    expect(prepared.input.bars.length).toBeGreaterThanOrEqual(MIN_POOL_BARS);
    expect(prepared.input.horizon).toBe(7);
    expect(prepared.input.startMs).toBe(OPEN);
    expect(prepared.input.costs).toEqual({ fees: { exchange: "Risiko-Einstellungen", makerBps: 5, takerBps: 5 }, slippage: { kind: "fixed", bps: 5 }, funding: { kind: "none" } });
    const r = runTimeMachineSync(prepared.input);
    expect(r.interval).toBe("1h");
    expect(r.costs.funding.kind).toBe("none");
    expect(r.sim.runs).toBe(600);
    expect(r.sim.target.k + r.sim.stop.k + r.sim.neither.k + r.sim.moved.k).toBe(600);
    expect(r.sim.horizon).toBe(7);
    // kein Blick in die Zukunft: die letzte Kerze, aus der gezogen wird, schloss vor dem Einstieg
    expect(r.pool.toMs).toBeLessThanOrEqual(OPEN + 25 * 60_000);
    expect(r.pool.toMs).toBeGreaterThan(OPEN - 3 * 86_400_000);
    // die Annahmen nennen die Kosten – das Funding-Stück sagt die Karte bei Aktien nicht ("; kein Funding.")
    const costLine = assumptionsOf(r, p.source).find((l) => l.startsWith("Gebühren:"))!;
    expect(costLine).toBe("Gebühren: Taker 5 bp (Einstieg, Stop, Zeitstopp), Maker 5 bp (Ziel); Slippage: 5 bp pro Market-Fill; kein Funding.");
    expect(costLine.replace("; kein Funding.", ".")).not.toContain("Funding");
  });

  it("dieselbe Eingabe, derselbe Seed: dieselben Zahlen (die Rechnung hängt nicht an der Uhr)", async () => {
    const p = await propsFor("1h");
    const a = runTimeMachineSync((inputOf(p) as { ok: true; input: Parameters<typeof runTimeMachineSync>[0] }).input);
    const b = runTimeMachineSync((inputOf(p) as { ok: true; input: Parameters<typeof runTimeMachineSync>[0] }).input);
    expect(a.sim.target.k).toBe(b.sim.target.k);
    expect(a.sim.expectancy.mean).toBe(b.sim.expectancy.mean);
    expect(a.seed).toBe(19);
  });

  it("Tages-Kerzen: die Rechnung läuft über fünf Handelstage, Wochenenden sind Lücken", async () => {
    const p = await propsFor("1d");
    const prepared = inputOf(p);
    expect(prepared.ok).toBe(true);
    if (!prepared.ok) return;
    expect(prepared.input.horizon).toBe(5);
    expect(prepared.input.startMs).toBeNull();
    const r = runTimeMachineSync(prepared.input);
    expect(r.interval).toBe("1d");
    expect(r.pool.bars).toBeGreaterThan(300);
    expect(r.sim.horizon).toBe(5);
    expect(r.pool.toMs).toBeLessThanOrEqual(OPEN);
  });
});
