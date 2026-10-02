import { act, fireEvent, render, screen } from "@testing-library/react";
import { useRef } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SETTLE_FALLBACK_MS, useDialogBehaviour } from "@/motion/a11y";

function Harness({ open, settled, onClose = () => {} }: { open: boolean; settled?: boolean; onClose?: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useDialogBehaviour(ref, open, onClose, settled === undefined ? undefined : { settled });
  return (
    <div>
      <button type="button">Auslöser</button>
      <div data-testid="outside">
        <button type="button">Draußen</button>
      </div>
      <div aria-live="polite" data-testid="live" />
      {open && (
        <div ref={ref} role="dialog" aria-label="Dialog">
          <button type="button">Erster</button>
          <button type="button">Letzter</button>
        </div>
      )}
    </div>
  );
}

const trigger = () => screen.getByRole("button", { name: "Auslöser", hidden: true });
const outside = () => screen.getByTestId("outside");

describe("useDialogBehaviour", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("without a settle signal: focus, inert, scroll lock at once; everything released on close", () => {
    const { rerender } = render(<Harness open={false} />);
    trigger().focus();
    rerender(<Harness open />);
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Erster" }));
    expect(outside()).toHaveAttribute("inert");
    expect(screen.getByTestId("live")).not.toHaveAttribute("inert"); // live regions stay announced
    expect(document.body.style.overflow).toBe("hidden");
    rerender(<Harness open={false} />);
    expect(outside()).not.toHaveAttribute("inert");
    expect(document.activeElement).toBe(trigger());
    expect(document.body.style.overflow).toBe("");
  });

  it("morph-aware: focus moves at once, inert waits for `settled`; release + focus return wait for the exit", () => {
    const { rerender } = render(<Harness open={false} settled />);
    trigger().focus();
    rerender(<Harness open settled={false} />);
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Erster" }));
    expect(document.body.style.overflow).toBe("hidden");
    expect(outside()).not.toHaveAttribute("inert");

    rerender(<Harness open settled />);
    expect(outside()).toHaveAttribute("inert");

    // closing: the exit animation is still running
    rerender(<Harness open={false} settled={false} />);
    expect(document.body.style.overflow).toBe("");
    expect(outside()).toHaveAttribute("inert");
    expect(document.activeElement).not.toBe(trigger());

    rerender(<Harness open={false} settled />);
    expect(outside()).not.toHaveAttribute("inert");
    expect(document.activeElement).toBe(trigger());
  });

  it("falls back after SETTLE_FALLBACK_MS when the settle signal never arrives", () => {
    vi.useFakeTimers();
    const { rerender } = render(<Harness open={false} settled />);
    trigger().focus();
    rerender(<Harness open settled={false} />);
    expect(outside()).not.toHaveAttribute("inert");
    act(() => vi.advanceTimersByTime(SETTLE_FALLBACK_MS));
    expect(outside()).toHaveAttribute("inert");

    rerender(<Harness open={false} settled={false} />);
    expect(outside()).toHaveAttribute("inert");
    act(() => vi.advanceTimersByTime(SETTLE_FALLBACK_MS));
    expect(outside()).not.toHaveAttribute("inert");
    expect(document.activeElement).toBe(trigger());
  });

  it("does not steal focus back when the user moved it elsewhere before the release", () => {
    const { rerender } = render(<Harness open={false} settled />);
    trigger().focus();
    rerender(<Harness open settled />);
    rerender(<Harness open={false} settled={false} />);
    // the page is still inert during the exit – focus an element outside the inerted tree
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
