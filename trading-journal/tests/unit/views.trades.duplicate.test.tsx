import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { MotionRoot } from "@/motion/MotionRoot";
import { useJournal } from "@/store/journalStore";
import { DEFAULT_TRADE_FILTER, DEFAULT_TRADE_SORT, useUi } from "@/store/uiStore";
import { TradesView } from "@/views/trades";
import { SAMPLE, settings } from "./domain.fixtures";

function seed(trades = SAMPLE) {
  sessionStorage.setItem("tj2-fill-trades", "1");
  useJournal.setState({ trades, settings: settings(), loaded: true, mode: "local" });
  useUi.setState({ tradeFilter: DEFAULT_TRADE_FILTER, tradeSort: DEFAULT_TRADE_SORT, detail: { id: null, source: null }, editor: { open: false, fromFab: false }, transitioning: false, toasts: [] });
}
const mount = () =>
  render(
    <MotionRoot>
      <TradesView />
    </MotionRoot>,
  );

describe("Trades page – Letzten Trade duplizieren", () => {
  beforeEach(() => seed());

  it("opens a new trade pre-filled with the newest trade's setting and says what was taken", () => {
    mount();
    fireEvent.click(screen.getByTestId("trades-duplicate-last"));
    const { editor, toasts } = useUi.getState();
    expect(editor.open).toBe(true);
    expect(editor.tradeId).toBeUndefined();
    // F is the newest trade of the sample
    expect(editor.draft).toEqual({ account: "scalp", pair: "BTC/USDT", side: "long", setups: ["s_bt"], size: 8000, timeframe: "4h" });
    expect(editor.draft).not.toHaveProperty("entry");
    expect(editor.draft).not.toHaveProperty("date");
    expect(toasts).toHaveLength(1);
    expect(toasts[0]).toMatchObject({ kind: "info", title: "Neuer Trade vorbereitet" });
    expect(toasts[0]?.detail).toMatch(/^Vom letzten Trade übernommen: .+ – ohne Preise, Ergebnis, Zeiten und Notizen\.$/);
  });

  it("is not offered while the journal is empty", () => {
    seed([]);
    mount();
    expect(screen.queryByTestId("trades-duplicate-last")).not.toBeInTheDocument();
    expect(screen.getByTestId("trades-shot-import")).toBeInTheDocument();
  });
});
