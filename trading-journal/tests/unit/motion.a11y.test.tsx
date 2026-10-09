import { act, fireEvent, render, screen } from "@testing-library/react";
import { useRef } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SETTLE_FALLBACK_MS, useDialogBehaviour, useEscape } from "@/motion/a11y";

function Harness({ open, settled, onClose = () => {}, muted = false, exiting = false }: { open: boolean; settled?: boolean; onClose?: () => void; muted?: boolean; exiting?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  useDialogBehaviour(ref, open, onClose, settled === undefined ? undefined : { settled });
  return (
    <div>
      <button type="button">Auslöser</button>
      <div data-testid="outside">
        <button type="button">Draußen</button>
      </div>
      <div aria-live="polite" data-testid="live" />
      {/* a muted status (the candle chart's OHLC legend): no live region */}
      {muted && (
        <div role="status" aria-live="off" data-testid="muted">
          OHLC
        </div>
      )}
      {/* `exiting`: the panel stays mounted while it animates out (AnimatePresence), like every real dialog */}
      {(open || exiting) && (
        <div ref={ref} role="dialog" aria-label="Dialog">
          <button type="button">Erster</button>
          <button type="button">Letzter</button>
        </div>
      )}
    </div>
  );
}

// by text: an aria-hidden button has no accessible name (the page behind an open dialog is aria-hidden)
const trigger = () => screen.getByText("Auslöser", { selector: "button" });
const outside = () => screen.getByTestId("outside");
/** The page behind an open dialog (deliberately changed, perf-120 C: aria-hidden + data-modal-behind + focus guard, not `inert`). */
const behind = (el: HTMLElement) => el.getAttribute("aria-hidden") === "true" && el.hasAttribute("data-modal-behind");

/** Two dialogs: B opens from a button inside A while A closes (the detail's `Bearbeiten` → the trade editor). */
function Pane({ open, exiting = false, settled, name }: { open: boolean; exiting?: boolean; settled: boolean; name: string }) {
  const ref = useRef<HTMLDivElement>(null);
  useDialogBehaviour(ref, open, () => {}, { settled });
  if (!open && !exiting) return null;
  return (
    <div ref={ref} role="dialog" aria-label={name}>
      <button type="button">{`${name} bearbeiten`}</button>
    </div>
  );
}

function HandOff({ a, b }: { a: { open: boolean; exiting?: boolean; settled: boolean }; b: { open: boolean; exiting?: boolean; settled: boolean } }) {
  return (
    <div>
      <button type="button">Zeile</button>
      <Pane name="A" {...a} />
      <Pane name="B" {...b} />
    </div>
  );
}

describe("useDialogBehaviour", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("without a settle signal: focus, isolation, scroll lock at once; everything released on close", () => {
    const { rerender } = render(<Harness open={false} />);
    trigger().focus();
    rerender(<Harness open />);
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Erster" }));
    expect(behind(outside())).toBe(true);
    expect(outside().hasAttribute("inert")).toBe(false); // no restyle of the page behind
    expect(screen.getByTestId("live")).not.toHaveAttribute("aria-hidden"); // live regions stay announced
    expect(document.body.style.overflow).toBe("hidden");
    rerender(<Harness open={false} />);
    expect(outside()).not.toHaveAttribute("aria-hidden");
    expect(outside()).not.toHaveAttribute("data-modal-behind");
    expect(document.activeElement).toBe(trigger());
    expect(document.body.style.overflow).toBe("");
  });

  it("morph-aware: focus moves at once, isolation waits for `settled`; release + focus return wait for the exit", () => {
    const { rerender } = render(<Harness open={false} settled />);
    trigger().focus();
    rerender(<Harness open settled={false} />);
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Erster" }));
    expect(document.body.style.overflow).toBe("hidden");
    expect(behind(outside())).toBe(false);

    rerender(<Harness open settled />);
    expect(behind(outside())).toBe(true);

    // closing: the exit animation is still running
    rerender(<Harness open={false} settled={false} />);
    expect(document.body.style.overflow).toBe("");
    expect(behind(outside())).toBe(true);
    expect(document.activeElement).not.toBe(trigger());

    rerender(<Harness open={false} settled />);
    expect(behind(outside())).toBe(false);
    expect(document.activeElement).toBe(trigger());
  });

  it("falls back after SETTLE_FALLBACK_MS when the settle signal never arrives", () => {
    vi.useFakeTimers();
    const { rerender } = render(<Harness open={false} settled />);
    trigger().focus();
    rerender(<Harness open settled={false} />);
    expect(behind(outside())).toBe(false);
    act(() => vi.advanceTimersByTime(SETTLE_FALLBACK_MS));
    expect(behind(outside())).toBe(true);

    rerender(<Harness open={false} settled={false} />);
    expect(behind(outside())).toBe(true);
    act(() => vi.advanceTimersByTime(SETTLE_FALLBACK_MS));
    expect(behind(outside())).toBe(false);
    expect(document.activeElement).toBe(trigger());
  });

  it("does not steal focus back when the user moved it elsewhere before the release", () => {
    const { rerender } = render(<Harness open={false} settled />);
    trigger().focus();
    rerender(<Harness open settled />);
    rerender(<Harness open={false} settled={false} />);
    // the page is still isolated during the exit – focus an element outside the isolated tree
    const elsewhere = document.createElement("button");
    document.body.appendChild(elsewhere);
    try {
      elsewhere.focus();
      rerender(<Harness open={false} settled />);
      expect(document.activeElement).toBe(elsewhere);
    } finally {
      elsewhere.remove();
    }
  });

  it("closing: focus the user puts into the page during the exit stays there (the guard ends with the close, the release waits)", () => {
    const { rerender } = render(<Harness open={false} settled />);
    trigger().focus();
    rerender(<Harness open settled />);
    // open: guarded
    act(() => screen.getByText("Draußen", { selector: "button" }).focus());
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Erster" }));
    // closing (the exit runs, e.g. the navigation's wipe has uncovered the page): a tap into the page keeps its focus
    rerender(<Harness open={false} settled={false} exiting />);
    expect(behind(outside())).toBe(true);
    const out = screen.getByText("Draußen", { selector: "button" });
    act(() => out.focus());
    expect(document.activeElement).toBe(out);
    // released after the exit; the user's focus is not taken back to the opener
    rerender(<Harness open={false} settled exiting />);
    expect(behind(outside())).toBe(false);
    expect(document.activeElement).toBe(out);
  });

  it("hand-off: a dialog opened from inside a closing one returns focus to that one's opener, not to its removed button", () => {
    const closed = { open: false, settled: true };
    const { rerender } = render(<HandOff a={closed} b={closed} />);
    const row = screen.getByText("Zeile", { selector: "button" });
    row.focus();
    rerender(<HandOff a={{ open: true, settled: true }} b={closed} />);
    expect(document.activeElement).toBe(screen.getByText("A bearbeiten"));
    // one update: A closes (still fading out, focus on its button), B opens
    rerender(<HandOff a={{ open: false, exiting: true, settled: false }} b={{ open: true, settled: true }} />);
    expect(document.activeElement).toBe(screen.getByText("B bearbeiten"));
    // A is gone; B closes and settles: focus is back on the row that opened A
    rerender(<HandOff a={closed} b={{ open: true, settled: true }} />);
    rerender(<HandOff a={closed} b={{ open: false, exiting: true, settled: true }} />);
    rerender(<HandOff a={closed} b={closed} />);
    expect(document.activeElement).toBe(row);
  });

  it("a dialog opened from inside a dialog that stays open returns focus into that one", () => {
    const closed = { open: false, settled: true };
    const { rerender } = render(<HandOff a={closed} b={closed} />);
    screen.getByText("Zeile", { selector: "button" }).focus();
    rerender(<HandOff a={{ open: true, settled: true }} b={closed} />);
    const inA = screen.getByText("A bearbeiten");
    expect(document.activeElement).toBe(inA);
    rerender(<HandOff a={{ open: true, settled: true }} b={{ open: true, settled: true }} />);
    rerender(<HandOff a={{ open: true, settled: true }} b={closed} />);
    expect(document.activeElement).toBe(inA);
  });

  it("a muted status (aria-live=off) is hidden with the page; real live regions stay announced", () => {
    const { rerender } = render(<Harness open={false} muted />);
    rerender(<Harness open muted />);
    expect(behind(screen.getByTestId("muted"))).toBe(true);
    expect(screen.getByTestId("live")).not.toHaveAttribute("aria-hidden");
    rerender(<Harness open={false} muted />);
    expect(screen.getByTestId("muted")).not.toHaveAttribute("aria-hidden");
    expect(screen.getByTestId("muted")).not.toHaveAttribute("data-modal-behind");
  });

  it("focus that lands behind the dialog (Tab in from the browser UI, a programmatic focus) returns into the panel", () => {
    const { rerender } = render(<Harness open={false} />);
    trigger().focus();
    rerender(<Harness open />);
    const first = screen.getByRole("button", { name: "Erster" });
    act(() => screen.getByText("Draußen", { selector: "button" }).focus());
    expect(document.activeElement).toBe(first);
    // released with the session: the page is reachable again
    rerender(<Harness open={false} />);
    const out = screen.getByRole("button", { name: "Draußen" });
    act(() => out.focus());
    expect(document.activeElement).toBe(out);
  });

  it("keeps an aria-hidden it did not set and restores an explicit aria-hidden value", () => {
    const { rerender } = render(<Harness open={false} />);
    outside().setAttribute("aria-hidden", "false");
    const deco = document.createElement("span");
    deco.setAttribute("aria-hidden", "true");
    document.body.appendChild(deco);
    try {
      rerender(<Harness open />);
      expect(behind(outside())).toBe(true);
      expect(deco).not.toHaveAttribute("data-modal-behind");
      rerender(<Harness open={false} />);
      expect(outside()).toHaveAttribute("aria-hidden", "false");
      expect(outside()).not.toHaveAttribute("data-modal-behind");
      expect(deco).toHaveAttribute("aria-hidden", "true");
    } finally {
      deco.remove();
      outside().removeAttribute("aria-hidden");
    }
  });

  it("traps Tab inside the dialog and closes on Escape", () => {
    const onClose = vi.fn();
    render(<Harness open onClose={onClose} />);
    const first = screen.getByRole("button", { name: "Erster" });
    const last = screen.getByRole("button", { name: "Letzter" });
    last.focus();
    fireEvent.keyDown(document, { key: "Tab" });
    expect(document.activeElement).toBe(first);
    fireEvent.keyDown(document, { key: "Tab", shiftKey: true });
    expect(document.activeElement).toBe(last);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

function EscapeHarness({ open, tick, onClose }: { open: boolean; tick: number; onClose: (tick: number) => void }) {
  // an inline closure per render, like every caller passes
  useEscape(open, () => onClose(tick));
  return <span>{tick}</span>;
}

describe("useEscape", () => {
  it("subscribes once per open session (re-renders never swap the listener mid-dispatch) and calls the latest onClose", () => {
    const add = vi.spyOn(document, "addEventListener");
    const remove = vi.spyOn(document, "removeEventListener");
    const keydowns = (spy: typeof add) => spy.mock.calls.filter(([type]) => type === "keydown").length;
    const onClose = vi.fn();
    const { rerender } = render(<EscapeHarness open tick={1} onClose={onClose} />);
    for (let tick = 2; tick <= 5; tick++) rerender(<EscapeHarness open tick={tick} onClose={onClose} />);
    expect(keydowns(add)).toBe(1);
    expect(keydowns(remove)).toBe(0);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalledExactlyOnceWith(5);
    rerender(<EscapeHarness open={false} tick={6} onClose={onClose} />);
    expect(keydowns(remove)).toBe(1);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
    add.mockRestore();
    remove.mockRestore();
  });
});
