import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, render } from "@testing-library/react";
import { bootJournal, PUBLISH_AFTER_CLOSE_MS, resetJournal, useJournal, useShownTrades } from "@/store/journalStore";
import { useUi } from "@/store/uiStore";
import { seedV0 } from "./store.fixture";

function Count() {
  const trades = useShownTrades();
  return <output data-testid="n">{trades.length}</output>;
}
const shown = (c: HTMLElement) => Number(c.querySelector("[data-testid=n]")?.textContent);

describe("trades shown in the views", () => {
  beforeEach(async () => {
    resetJournal();
    useUi.setState({ toasts: [], editor: { open: false, fromFab: false } });
    seedV0();
    await bootJournal({ autoBackup: false, probeCloud: false });
  });
  afterEach(() => {
    vi.useRealTimers();
    useUi.setState({ editor: { open: false, fromFab: false } });
    resetJournal();
  });

  it("follow a write in a transition; the store and storage have it at once", async () => {
    const { container } = render(<Count />);
    const n = useJournal.getState().trades.length;
    expect(shown(container)).toBe(n);
    await act(async () => {
      await useJournal.getState().saveTrade({ ...useJournal.getState().trades[0]!, id: undefined, notes: "neu" });
    });
    expect(useJournal.getState().trades).toHaveLength(n + 1);
    expect(JSON.parse(localStorage.getItem("tj2-trades")!)).toHaveLength(n + 1);
    expect(shown(container)).toBe(n + 1);
  });

  it("a save from the open editor shows once the editor closed and its sheet left", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const { container } = render(<Count />);
    const n = useJournal.getState().trades.length;
    act(() => useUi.getState().openEditor({ fromFab: true }));
    await act(async () => {
      await useJournal.getState().saveTrade({ ...useJournal.getState().trades[0]!, id: undefined, notes: "neu" });
    });
    // persisted and in the store at once, the views wait for the sheet
    expect(useJournal.getState().trades).toHaveLength(n + 1);
    expect(JSON.parse(localStorage.getItem("tj2-trades")!)).toHaveLength(n + 1);
    expect(shown(container)).toBe(n);
    act(() => useUi.getState().closeEditor());
    act(() => vi.advanceTimersByTime(PUBLISH_AFTER_CLOSE_MS - 10));
    expect(shown(container)).toBe(n);
    act(() => vi.advanceTimersByTime(10));
    expect(shown(container)).toBe(n + 1);
    // a reader mounting later takes the published list
    const late = render(<Count />);
    expect(shown(late.container)).toBe(n + 1);
  });
});
