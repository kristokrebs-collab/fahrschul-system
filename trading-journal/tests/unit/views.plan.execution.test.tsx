/**
 * Handelsplan · „Ausführbarkeit jetzt (live)“ (F44): the card in the Ticket step reads ONE order book on the click – nothing
 * before it – and shows spread, the walk of the planned size through the book (opening and stop fill), the stop fill against the
 * slippage the plan assumed and the order next to the 24 h turnover, with source and time; a failed read is said with its reason
 * and is no green light; stocks have no source and the card says so. The exchange is replaced by a fixed book; numbers by hand:
 *
 *   plan (page default): long BTCUSDT 0,037 BTC, entry 100.380, stop 100.065 – assumed slippage 0,05 % = 5 bp
 *   bids 100.379,9 × 0,5 · 100.379 × 1          asks 100.380,1 × 0,02 · 100.381 × 0,02 · 100.390 × 5
 *   mid 100.380,0 · spread 0,2 = 0,02 bp
 *   buy 0,037: 0,02 × 100.380,1 + 0,017 × 100.381 = 3.714,079 → Ø 100.380,5154 → 0,04 bp over the best ask, 0,05 bp from the mid
 *   sell 0,037: all at 100.379,9 → 0,01 bp from the mid
 */
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { TicketPlan } from "@/domain/plan";
import { bookOf } from "@/domain/execution";
import type { BookResult } from "@/market/execution/book";
import { ExecutionCheck } from "@/views/plan/ExecutionCheck";
import { mockState, renderPlan, setupPlanTests } from "./views.plan.harness";

const exec = vi.hoisted(() => ({ calls: [] as string[], next: null as null | ((symbol: string) => unknown) }));
vi.mock("@/market/plan/candles", async () => (await import("./views.plan.mock")).candlesMock());
vi.mock("@/market/execution/book", async (orig) => {
  const m = await orig<typeof import("@/market/execution/book")>();
  return {
    ...m,
    loadBook: async (symbol: string) => {
      exec.calls.push(symbol);
      return exec.next ? exec.next(symbol) : { ok: false, symbol, kind: "network", at: Date.now() };
    },
  };
});
setupPlanTests();

const T = 1_793_007_878_106;
const okBook = (over: Partial<Extract<BookResult, { ok: true }>> = {}, bids: Array<[number, number]> = [[100379.9, 0.5], [100379, 1]], asks: Array<[number, number]> = [[100380.1, 0.02], [100381, 0.02], [100390, 5]]): BookResult => ({
  ok: true,
  symbol: "BTCUSDT",
  book: bookOf(bids, asks, T),
  asOf: T,
  receivedAt: Date.now(),
  route: "direct",
  levels: 3,
  quoteVolume24h: 751_670_257.97,
  volumeNote: null,
  ...over,
});

const plan: TicketPlan = {
  symbol: "BTCUSDT",
  side: "long",
  entry: 100380,
  stop: 100065,
  target: 101010,
  qty: 0.037,
  notional: 3714.06,
  maxLoss: 11.7,
  maxLossPct: 0.01,
  rr: 2,
  leverage: 1,
  flatByMs: null,
  light: "green",
  tick: 0.1,
  lot: 0.001,
  currency: "USDT",
  tz: "UTC",
  sessionLabel: "Tagesbeginn UTC",
  entrySource: "signal",
  signalAt: null,
  stopLabel: "x",
  targetLabel: "y",
  sourceLabel: "Binance USDⓈ-M",
  intervalLabel: "5 Minuten",
  candlesUntil: null,
  fetchedAt: null,
};

describe("ExecutionCheck (the card)", () => {
  it("nothing is read before the click; then the numbers, each with a word, and source and time", async () => {
    exec.calls.length = 0;
    exec.next = () => okBook();
    render(<ExecutionCheck plan={plan} slippagePct={0.0005} crypto />);
    expect(screen.getByTestId("hplan-exec")).toHaveTextContent("Ein Blick ins Orderbuch");
    expect(exec.calls).toEqual([]);
    expect(screen.queryByTestId("hplan-exec-result")).toBeNull();
    fireEvent.click(screen.getByTestId("hplan-exec-run"));
    const res = await screen.findByTestId("hplan-exec-result");
    expect(exec.calls).toEqual(["BTCUSDT"]);
    expect(res).toHaveAttribute("data-tone", "ok");
    expect(screen.getByTestId("hplan-exec-headline")).toHaveTextContent("Das Orderbuch von jetzt trägt die Größe");
    expect(screen.getByTestId("hplan-exec-spread")).toHaveTextContent("Spread 0,02 bp (0,2) – Kauf 100.380,1, Verkauf 100.379,9 · eng");
    expect(screen.getByTestId("hplan-exec-spread")).toHaveAttribute("data-tone", "ok");
    expect(screen.getByTestId("hplan-exec-entry")).toHaveTextContent("Einstieg (Kauf 0,037 BTC): Ø-Preis 100.380,5 · 0,04 bp über den besten Preis hinaus · 0,05 bp von der Mitte · 2 Stufen");
    expect(screen.getByTestId("hplan-exec-stop")).toHaveTextContent("Stop-Ausstieg (Verkauf 0,037 BTC): Ø-Preis 100.379,9 · 0,00 bp über den besten Preis hinaus · 0,01 bp von der Mitte · 1 Stufe");
    expect(screen.getByTestId("hplan-exec-assumption")).toHaveTextContent("Annahme im Plan: Slippage am Stop 5,00 bp. Das Orderbuch jetzt: 0,01 bp von der Mitte – die Annahme deckt es.");
    expect(screen.getByTestId("hplan-exec-turnover")).toHaveTextContent("Die Order (≈ 3.714 USDT) ist 0,00 % des 24-h-Umsatzes (751,7 Mio USDT).");
    for (const id of ["spread", "entry", "stop", "assumption", "turnover"]) expect(screen.getByTestId(`hplan-exec-${id}`)).toHaveTextContent(/in Ordnung/);
    // the bands: ±0,1 % of 100.380 = ±100,4 → bids from 100.279,6: both levels; asks to 100.480,4: the first two levels (the third at 100.390 too)
    expect(screen.getByTestId("hplan-exec-depth")).toHaveTextContent("±0,1 %");
    expect(screen.getByTestId("hplan-exec-depth")).toHaveTextContent("der Ausschnitt reicht nicht bis zum Rand"); // 3 levels do not reach ±1 %
    // source, snapshot time, receipt time, the standing sentence
    const stand = screen.getByTestId("hplan-exec-stand");
    expect(stand).not.toHaveTextContent("Finanzberatung");
    expect(stand).toHaveTextContent("Quelle: Binance USDⓈ-M · Orderbuch /fapi/v1/depth (3 Stufen, direkt)");
    expect(stand).toHaveTextContent("Stand 09:44:38 Uhr"); // 1793007878106 = 2026-10-26 09:44:38 UTC; the plan zone is UTC here
    expect(screen.getByTestId("hplan-exec")).toHaveTextContent("Eine Momentaufnahme");
    expect(screen.getByTestId("hplan-exec")).toHaveTextContent("Richtwerte dieser App");
    expect(screen.queryByTestId("hplan-exec-old")).toBeNull();
  });

  it("a thin book: the size does not fit – a problem, the assumption cannot be judged", async () => {
    exec.next = () => okBook({}, [[100379.9, 0.01]], [[100380.1, 0.01]]);
    render(<ExecutionCheck plan={plan} slippagePct={0.0005} crypto />);
    fireEvent.click(screen.getByTestId("hplan-exec-run"));
    const res = await screen.findByTestId("hplan-exec-result");
    expect(res).toHaveAttribute("data-tone", "bad");
    expect(screen.getByTestId("hplan-exec-headline")).toHaveTextContent("trägt die Größe nicht");
    expect(screen.getByTestId("hplan-exec-entry")).toHaveTextContent("reicht nicht – nur 0,010 von 0,037 BTC (27,0 %) würden gefüllt");
    expect(screen.getByTestId("hplan-exec-entry")).toHaveAttribute("data-tone", "bad");
    expect(screen.getByTestId("hplan-exec-assumption")).toHaveTextContent("kein Vergleich möglich");
    expect(screen.getByTestId("hplan-exec-assumption")).toHaveAttribute("data-tone", "unknown");
  });

  it("measured slippage above the plan's assumption: a warning that the loss at the stop would be larger", async () => {
    // the stop fill (sell 0,037) walks bids 0,01 @ 100.379,9 + 0,027 @ 100.300 → Ø 100.321,6 → 5,8 bp from the mid; the plan assumed 0,01 % = 1 bp
    exec.next = () => okBook({}, [[100379.9, 0.01], [100300, 5]], [[100380.1, 5]]);
    render(<ExecutionCheck plan={plan} slippagePct={0.0001} crypto />);
    fireEvent.click(screen.getByTestId("hplan-exec-run"));
    await screen.findByTestId("hplan-exec-result");
    expect(screen.getByTestId("hplan-exec-assumption")).toHaveTextContent("Annahme im Plan: Slippage am Stop 1,00 bp.");
    expect(screen.getByTestId("hplan-exec-assumption")).toHaveTextContent("mehr als angenommen; der Verlust am Stop wäre größer als geplant");
    expect(screen.getByTestId("hplan-exec-assumption")).toHaveAttribute("data-tone", "warn");
    expect(screen.getByTestId("hplan-exec-result")).toHaveAttribute("data-tone", "warn");
  });

  it("a failed read is named and is no green light: no numbers, the attempt time, no result block", async () => {
    exec.next = (symbol) => ({ ok: false, symbol, kind: "blocked_451", at: Date.now() });
    render(<ExecutionCheck plan={plan} slippagePct={0.0005} crypto />);
    fireEvent.click(screen.getByTestId("hplan-exec-run"));
    const failed = await screen.findByTestId("hplan-exec-failed");
    expect(failed).toHaveTextContent("Das Orderbuch ließ sich nicht lesen: Binance sperrt den Standort (451)");
    expect(failed).toHaveTextContent("Das ist keine Freigabe");
    expect(failed).toHaveTextContent("Stand: keine Daten");
    expect(screen.queryByTestId("hplan-exec-result")).toBeNull();
    expect(screen.getByTestId("hplan-exec-run")).toHaveTextContent("Erneut prüfen");
  });

  it("a reading older than a minute is called old", async () => {
    exec.next = () => okBook({ receivedAt: Date.now() - 120_000 });
    render(<ExecutionCheck plan={plan} slippagePct={0.0005} crypto />);
    fireEvent.click(screen.getByTestId("hplan-exec-run"));
    expect(await screen.findByTestId("hplan-exec-old")).toHaveTextContent("Älter als eine Minute");
  });

  it("another symbol in the plan shows none of the old reading", async () => {
    exec.next = () => okBook();
    const { rerender } = render(<ExecutionCheck plan={plan} slippagePct={0.0005} crypto />);
    fireEvent.click(screen.getByTestId("hplan-exec-run"));
    await screen.findByTestId("hplan-exec-result");
    rerender(<ExecutionCheck plan={{ ...plan, symbol: "ETHUSDT" }} slippagePct={0.0005} crypto />);
    expect(screen.queryByTestId("hplan-exec-result")).toBeNull();
  });

  it("stocks: no order-book source – it says so and offers no button", () => {
    render(<ExecutionCheck plan={plan} slippagePct={0.0005} crypto={false} />);
    expect(screen.getByTestId("hplan-exec-stocks")).toHaveTextContent("keine Orderbuch-Quelle angebunden");
    expect(screen.queryByTestId("hplan-exec-run")).toBeNull();
  });
});

describe("Handelsplan · the card sits in the Ticket step", () => {
  it("shown with the ticket, quiet until clicked; the click reads the plan's symbol; the plan itself is not changed", async () => {
    exec.calls.length = 0;
    exec.next = () => okBook();
    renderPlan();
    await screen.findByTestId("hplan-ticket-rows");
    const card = screen.getByTestId("hplan-exec");
    expect(within(screen.getByTestId("hplan-ticket-body")).getByTestId("hplan-exec")).toBe(card);
    expect(exec.calls).toEqual([]);
    const rowsBefore = screen.getByTestId("hplan-ticket-rows").textContent;
    fireEvent.click(screen.getByTestId("hplan-exec-run"));
    await waitFor(() => expect(screen.getByTestId("hplan-exec-result")).toBeInTheDocument());
    expect(exec.calls).toEqual(["BTCUSDT"]);
    // the plan's assumption (the risk limits' 0,05 %) is what the card holds the book against
    expect(screen.getByTestId("hplan-exec-assumption")).toHaveTextContent("Slippage am Stop 5,00 bp");
    expect(screen.getByTestId("hplan-ticket-rows").textContent).toBe(rowsBefore);
    // still no way to send anything
    expect(screen.queryByRole("button", { name: /senden|order|kaufen|verkaufen/i })).toBeNull();
    expect(mockState.loads.length).toBeGreaterThan(0);
  });
});
