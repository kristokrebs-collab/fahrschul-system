import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MotionRoot } from "@/motion/MotionRoot";
import { Sheet } from "@/motion/Sheet";
import { hasMorphBack } from "@/overlays/TradeDetail";
import { toastFlingExit } from "@/primitives/Toast";

// ── pointer helpers: explicit timeStamps (jsdom stamps events with Date.now()) ─────────────────────────────────

let clock = 80_000;

function ptr(el: Element, type: string, x: number, y: number, t: number, pointerType = "touch") {
  const e = new PointerEvent(type, { bubbles: true, cancelable: true, pointerId: 1, pointerType, isPrimary: true, button: 0, clientX: x, clientY: y });
  Object.defineProperty(e, "timeStamp", { value: t, configurable: true });
  act(() => {
    el.dispatchEvent(e);
  });
}

/** Press, move `dy` in `steps` over `ms`, rest `hold`, release. */
function drag(el: Element, dy: number, ms: number, { steps = 8, hold = 0, pointerType = "touch" } = {}) {
  const t0 = (clock += 1000);
  ptr(el, "pointerdown", 200, 100, t0, pointerType);
  for (let i = 1; i <= steps; i++) ptr(el, "pointermove", 200, 100 + (dy * i) / steps, t0 + (ms * i) / steps, pointerType);
  ptr(el, "pointerup", 200, 100 + dy, t0 + ms + hold, pointerType);
}

const onClose = vi.fn();
const onAttempt = vi.fn();

function Harness({ guard = false }: { guard?: boolean }) {
  const [open, setOpen] = useState(true);
  return (
    <MotionRoot>
      <button type="button">Draußen</button>
      <Sheet
        open={open}
        onClose={() => {
          onClose();
          setOpen(false);
        }}
        title="Trade eintragen"
        dismissGuard={() => guard}
        onDismissAttempt={onAttempt}
        footer={<span>Fuß</span>}
      >
        <p>Formular</p>
      </Sheet>
    </MotionRoot>
  );
}

const handle = () => document.querySelector("[data-sheet-handle]") as HTMLElement;

afterEach(() => {
  onClose.mockClear();
  onAttempt.mockClear();
});

describe("Sheet – swipe to dismiss (touch / pen, every width)", () => {
  it("the header is the swipe handle: touch-action none, grabber pill for coarse pointers", () => {
    render(<Harness />);
    expect(handle().style.touchAction).toBe("none");
    expect(handle().querySelector("span[aria-hidden='true']")?.className).toContain("pointer-coarse:block");
    // the body scrolls without chaining into the page / pull-to-refresh
    expect(screen.getByText("Formular").closest(".overflow-y-auto")?.className).toContain("overscroll-y-contain");
  });

  it("a flick down closes; a slow short drag does not", async () => {
    render(<Harness />);
    await waitFor(() => expect(handle()).toBeTruthy());
    drag(handle(), 60, 400, { steps: 20, hold: 60 });
    expect(onClose).not.toHaveBeenCalled();
    drag(handle(), 90, 48, { steps: 6 });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("mouse drags never dismiss (close button / Escape stay the mouse path)", () => {
    render(<Harness />);
    drag(handle(), 120, 40, { steps: 6, pointerType: "mouse" });
    expect(onClose).not.toHaveBeenCalled();
  });

  it("a guarded (dirty) sheet resists: a flick, Escape, the backdrop and the close button ask instead of closing", () => {
    render(<Harness guard />);
    fireEvent.click(screen.getByRole("button", { name: "Schließen" }));
    expect(onAttempt).toHaveBeenLastCalledWith("close");
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onAttempt).toHaveBeenLastCalledWith("escape");
    const overlay = screen.getByRole("dialog").closest(".fixed") as HTMLElement;
    fireEvent.pointerDown(overlay);
    expect(onAttempt).toHaveBeenLastCalledWith("backdrop");
    // the flick is resisted (rubber band) and reports the attempt instead of committing
    drag(handle(), 160, 48, { steps: 6 });
    expect(onAttempt).toHaveBeenLastCalledWith("swipe");
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog", { name: "Trade eintragen" })).toBeInTheDocument();
  });

  it("unguarded Escape / close button close at once", () => {
    render(<Harness />);
    fireEvent.click(screen.getByRole("button", { name: "Schließen" }));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onAttempt).not.toHaveBeenCalled();
  });

  it("a click that ends a drag on the header is swallowed (the close button does not fire)", () => {
    render(<Harness guard />);
    const btn = screen.getByRole("button", { name: "Schließen" });
    drag(btn, 40, 300, { steps: 10 });
    act(() => {
      btn.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    });
    expect(onAttempt).not.toHaveBeenCalledWith("close");
  });
});

describe("Sheet – default unsaved-input guard (callers without `dismissGuard`)", () => {
  function Plain({ guard }: { guard?: false }) {
    const [open, setOpen] = useState(true);
    return (
      <MotionRoot>
        <Sheet
          open={open}
          onClose={() => {
            onClose();
            setOpen(false);
          }}
          title="Grundlage bearbeiten"
          dismissGuard={guard}
        >
          <input aria-label="Name" />
        </Sheet>
      </MotionRoot>
    );
  }

  it("untouched closes at once; after typing, Escape asks inline and `Verwerfen` closes", async () => {
    const { unmount } = render(<Plain />);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
    unmount();
    onClose.mockClear();
    render(<Plain />);
    fireEvent.input(screen.getByLabelText("Name"), { target: { value: "x" } });
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).not.toHaveBeenCalled();
    expect(await screen.findByTestId("sheet-discard-confirm")).toHaveTextContent("Änderungen verwerfen?");
    fireEvent.click(screen.getByRole("button", { name: "Weiter bearbeiten" }));
    await waitFor(() => expect(screen.queryByTestId("sheet-discard-confirm")).toBeNull());
    fireEvent.click(screen.getByRole("button", { name: "Schließen" }));
    fireEvent.click(await screen.findByRole("button", { name: "Verwerfen" }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("`dismissGuard={false}` opts out (import dialog)", () => {
    render(<Plain guard={false} />);
    fireEvent.input(screen.getByLabelText("Name"), { target: { value: "x" } });
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

describe("TradeDetail – morph back target", () => {
  it("recent rows always morph back; table only through a mounted trade card; marker / insights never", () => {
    expect(hasMorphBack("A", "recent")).toBe(true);
    expect(hasMorphBack("A", "marker")).toBe(false);
    expect(hasMorphBack("A", "insights")).toBe(false);
    expect(hasMorphBack("A", "table")).toBe(false);
    const span = document.createElement("span");
    span.setAttribute("data-trade-morph", "A");
    document.body.appendChild(span);
    // jsdom has no layout: getClientRects() is empty → treated as not shown
    expect(hasMorphBack("A", "table")).toBe(false);
    span.getClientRects = () => [{ width: 1 }] as unknown as DOMRectList;
    expect(hasMorphBack("A", "table")).toBe(true);
    span.remove();
  });
});

describe("Toast – thrown exit", () => {
  it("flies on the release velocity in the throw direction; reduced motion fades", () => {
    const info = { direction: -1 as const, velocity: -1500, offset: -40, size: 240, tempo: 0.8, pointerType: "touch" as const };
    const exit = toastFlingExit(info, false) as unknown as { x: number; opacity: number; transition: { x: { velocity: number; stiffness: number } } };
    expect(exit.x).toBeLessThan(-300);
    expect(exit.opacity).toBe(0);
    expect(exit.transition.x.velocity).toBe(-1500);
    expect(exit.transition.x.stiffness).toBeGreaterThan(0);
    expect(toastFlingExit(info, true)).toEqual({ opacity: 0, transition: { duration: 0 } });
  });
});
