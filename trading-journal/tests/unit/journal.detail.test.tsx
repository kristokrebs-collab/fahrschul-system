/**
 * Journal-v3 block of the trade detail (P06): execution facts, fills, MAE / MFE, tags / rating, psyche, the actions –
 * and a legacy trade showing none of it except the actions.
 */
import { fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Trade } from "@/domain/types";
import { executionFacts } from "@/journal/ui/JournalDetail";
import type { Candle } from "@/market/types";
import { MotionRoot } from "@/motion/MotionRoot";
import { TradeDetail } from "@/overlays/TradeDetail";
import { useJournal } from "@/store/journalStore";
import { useUi } from "@/store/uiStore";
import { useReplay } from "@/views/trades/replay/replayStore";
import { SAMPLE, enriched, mkTrade, settings } from "./domain.fixtures";

vi.mock("@/chart/MiniTradeChart", () => ({ MiniTradeChart: (_p: { candles: Candle[] }) => <div data-testid="mini-chart" /> }));

const V3: Trade = mkTrade({
  id: "v3",
  date: "2026-10-01T10:00",
  exitDate: "2026-10-01T14:00",
  pair: "SOL/USDT",
  side: "short",
  entry: 101,
  stop: 103,
  exit: 98,
  size: 202,
  market: "perp",
  exchange: "Bitunix",
  exchangeAccount: "Haupt",
  fundingFees: 1.2,
  margin: 50,
  marginMode: "isolated",
  liqPrice: 120,
  atrPct: 0.8,
  fills: [
    { id: "a", at: "2026-10-01T10:00", side: "open", price: 101, qty: 1, kind: "entry" },
    { id: "b", at: "2026-10-01T11:00", side: "open", price: 103, qty: 1, kind: "add" },
    { id: "c", at: "2026-10-01T12:00", side: "close", price: 99, qty: 1, kind: "partial" },
    { id: "d", at: "2026-10-01T14:00", side: "close", price: 97, qty: 1, kind: "exit" },
  ],
  mae: 2,
  mfe: 6,
  maeR: 1,
  mfeR: 3,
  tags: ["London", "Fade"],
  rating: 4,
  psych: { stress: 4, confidence: 2, flags: ["tilt", "eigener"], exitReason: "Ziel erreicht", preNote: "Unruhig." },
});

function seed(id: string, trades: Trade[] = [...SAMPLE, V3]) {
  useJournal.setState({ trades, settings: settings(), loaded: true, mode: "local" });
  useUi.setState({ detail: { id, source: "table" }, editor: { open: false, fromFab: false }, toasts: [], transitioning: false });
  useReplay.setState({ id: null, back: false });
}

const mount = () =>
  render(
    <MotionRoot>
      <TradeDetail />
    </MotionRoot>,
  );

describe("JournalDetail", () => {
  beforeEach(() => seed("v3"));

  it("execution facts list only what the trade has", () => {
    const facts = Object.fromEntries(executionFacts(enriched([V3])[0]!, "USDT"));
    expect(facts).toMatchObject({ Haltedauer: "4 Std", Börse: "Perp · Bitunix · Haupt", Funding: "−1,20 USDT", Margin: "50,00 USDT · Isoliert", "ATR Einstieg": "0,80 %" });
    expect(facts["Slippage"]).toBeUndefined();
    expect(executionFacts(enriched([SAMPLE[0]!])[0]!, "USDT")).toEqual([]);
  });

  it("renders fills, DCA, MAE / MFE, tags, rating and psyche of a v3 trade", () => {
    mount();
    const d = screen.getByRole("dialog", { name: "Trade-Details" });
    expect(within(d).getByText("Ausführung")).toBeInTheDocument();
    expect(within(within(d).getByRole("list", { name: "Fills der Position" })).getAllByRole("listitem")).toHaveLength(4);
    expect(d).toHaveTextContent("DCA mit 2 Einstiegen: Ø besser als der erste um 0,99 %.");
    expect(d).toHaveTextContent("Mitgenommen: 67 % der besten Bewegung."); // short: Ø 102 → Ø 98 = 4 of 6
    expect(within(d).getByLabelText("Tags")).toHaveTextContent("#London#Fade");
    expect(within(d).getByRole("img", { name: "Bewertung: 4 von 5 · Stark" })).toBeInTheDocument();
    expect(d).toHaveTextContent("4 · Gestresst");
    expect(d).toHaveTextContent("2 · Unsicher");
    expect(within(d).getByLabelText("Verhalten")).toHaveTextContent("Tilteigener");
    expect(d).toHaveTextContent("Unruhig.");
  });

  it("Replay steps the detail aside and opens the replay of this trade", () => {
    mount();
    fireEvent.click(screen.getByRole("button", { name: "Replay" }));
    expect(useReplay.getState()).toEqual({ id: "v3", back: true });
    expect(useUi.getState().detail.id).toBeNull();
  });

  it("a legacy trade shows no v3 section, only the actions", () => {
    seed("A");
    mount();
    const d = screen.getByRole("dialog", { name: "Trade-Details" });
    expect(within(d).queryByText("Ausführung")).toBeNull();
    expect(within(d).queryByRole("list", { name: "Fills der Position" })).toBeNull();
    expect(within(d).queryByText("Psyche")).toBeNull();
    expect(within(d).getByRole("button", { name: "Replay" })).toBeInTheDocument();
    expect(within(d).getByRole("button", { name: "Als Bild" })).toBeInTheDocument();
  });
});
