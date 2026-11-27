/**
 * The arrival note (A4): what a finder leaves where it landed. It is a polite live region (not a toast), keeps its place until it is
 * dismissed, the page changes or something else opens, offers the next step as buttons, and closes by itself only when it asks to.
 */
import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { dismissArrival, showArrival, useArrival } from "@/app/arrival";
import { ArrivalNote } from "@/app/ArrivalNote";
import { MotionRoot } from "@/motion/MotionRoot";
import { useUi } from "@/store/uiStore";

const mount = () =>
  render(
    <MotionRoot>
      <ArrivalNote />
    </MotionRoot>,
  );

beforeEach(() => {
  useArrival.setState({ current: null, seq: 0 });
  useUi.setState({ page: "labor", toasts: [] });
});
afterEach(() => vi.useRealTimers());

describe("ArrivalNote", () => {
  it("renders nothing without a note; a note is a polite live region with title, text and its buttons", async () => {
    mount();
    expect(screen.queryByTestId("arrival-note")).toBeNull();
    const run = vi.fn();
    act(() => showArrival({ featureId: "diagnose", page: "labor", title: "Diagnose: noch nicht zu sehen", text: "Erscheint, sobald ein Test fertig ist.", tone: "warn", actions: [{ id: "assistant", label: "Assistent fragen", run }] }));
    const note = await screen.findByTestId("arrival-note");
    expect(note).toHaveAttribute("aria-live", "polite");
    expect(note).not.toHaveAttribute("role", "status");
    expect(note).toHaveAttribute("data-feature", "diagnose");
    expect(note).toHaveAttribute("data-tone", "warn");
    expect(note).toHaveTextContent("Erscheint, sobald ein Test fertig ist.");
    fireEvent.click(screen.getByTestId("arrival-assistant"));
    expect(run).toHaveBeenCalledTimes(1);
    // a button on the note closes it (the step is taken)
    expect(useArrival.getState().current).toBeNull();
  });

  it("the close button dismisses; leaving the page the note belongs to dismisses; a new note replaces the old one", async () => {
    mount();
    act(() => showArrival({ featureId: "a", page: "labor", title: "A", text: "a", tone: "info", actions: [] }));
    fireEvent.click(await screen.findByTestId("arrival-close"));
    expect(useArrival.getState().current).toBeNull();

    act(() => showArrival({ featureId: "b", page: "labor", title: "B", text: "b", tone: "info", actions: [] }));
    act(() => useUi.setState({ page: "markt" }));
    expect(useArrival.getState().current).toBeNull();

    useUi.setState({ page: "labor" });
    act(() => showArrival({ featureId: "c", page: "labor", title: "C", text: "c", tone: "info", actions: [] }));
    act(() => showArrival({ featureId: "d", page: "labor", title: "D", text: "d", tone: "info", actions: [] }));
    expect(useArrival.getState().current?.featureId).toBe("d");
  });

  it("closes by itself only when the note asks to; an older timer never closes a newer note", () => {
    vi.useFakeTimers();
    mount();
    act(() => showArrival({ featureId: "a", page: "labor", title: "A", text: "a", tone: "info", actions: [], autoCloseMs: 1000 }));
    act(() => showArrival({ featureId: "b", page: "labor", title: "B", text: "b", tone: "warn", actions: [] }));
    act(() => void vi.advanceTimersByTime(5000));
    expect(useArrival.getState().current?.featureId).toBe("b");
    act(() => showArrival({ featureId: "c", page: "labor", title: "C", text: "c", tone: "info", actions: [], autoCloseMs: 1000 }));
    act(() => void vi.advanceTimersByTime(1100));
    expect(useArrival.getState().current).toBeNull();
  });

  it("dismissArrival(seq) closes only that very note", () => {
    showArrival({ featureId: "a", page: "labor", title: "A", text: "a", tone: "info", actions: [] });
    const seq = useArrival.getState().current!.seq;
    dismissArrival(seq + 5);
    expect(useArrival.getState().current).not.toBeNull();
    dismissArrival(seq);
    expect(useArrival.getState().current).toBeNull();
  });
});
