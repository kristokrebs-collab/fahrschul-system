/**
 * F32 The start trigger of the automatic outcomes (`SignalOutcomeHost`): once after the app started, and only when entry signals
 * are stored – a device without signals fetches nothing (not even the module). The evaluation itself is tested in
 * `views.coach.signalAuto.test.ts`.
 */
import { act, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SIGNAL_ARCHIVE_KEY } from "@/market/signalArchive";
import { useJournal } from "@/store/journalStore";
import { OUTCOME_START_WAIT_MS, SignalOutcomeHost } from "@/views/coach/SignalOutcomeHost";

const request = vi.fn();
vi.mock("@/views/coach/signalAuto", () => ({ requestAutoOutcomes: (r: string) => request(r) }));

const stored = (entry: boolean) => localStorage.setItem(SIGNAL_ARCHIVE_KEY, JSON.stringify({ v: 1, items: [{ id: "s_a", key: "a", at: 1, entry }] }));

beforeEach(() => {
  vi.useFakeTimers();
  request.mockReset();
  localStorage.removeItem(SIGNAL_ARCHIVE_KEY);
  useJournal.setState({ loaded: true });
});
afterEach(() => vi.useRealTimers());

describe("SignalOutcomeHost", () => {
  it("asks once, after the wait, when entry signals are stored", async () => {
    stored(true);
    render(<SignalOutcomeHost />);
    await vi.advanceTimersByTimeAsync(OUTCOME_START_WAIT_MS - 1000);
    expect(request).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(2000);
    expect(request).toHaveBeenCalledTimes(1);
    expect(request).toHaveBeenCalledWith("start");
    await vi.advanceTimersByTimeAsync(10 * OUTCOME_START_WAIT_MS);
    expect(request).toHaveBeenCalledTimes(1);
  });

  it("does nothing without a stored archive or with context events only", async () => {
    render(<SignalOutcomeHost />);
    await vi.advanceTimersByTimeAsync(2 * OUTCOME_START_WAIT_MS);
    expect(request).not.toHaveBeenCalled();
    stored(false);
    render(<SignalOutcomeHost />);
    await vi.advanceTimersByTimeAsync(2 * OUTCOME_START_WAIT_MS);
    expect(request).not.toHaveBeenCalled();
  });

  it("waits for the journal to be loaded, and a closed host never asks", async () => {
    stored(true);
    act(() => useJournal.setState({ loaded: false }));
    const { unmount } = render(<SignalOutcomeHost />);
    await vi.advanceTimersByTimeAsync(2 * OUTCOME_START_WAIT_MS);
    expect(request).not.toHaveBeenCalled();
    act(() => useJournal.setState({ loaded: true }));
    await vi.advanceTimersByTimeAsync(OUTCOME_START_WAIT_MS / 2);
    unmount();
    await vi.advanceTimersByTimeAsync(2 * OUTCOME_START_WAIT_MS);
    expect(request).not.toHaveBeenCalled();
  });
});
