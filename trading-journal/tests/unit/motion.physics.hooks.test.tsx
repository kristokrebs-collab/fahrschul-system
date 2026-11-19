import { act, render, waitFor } from "@testing-library/react";
import { useMotionValue, type MotionValue } from "motion/react";
import { useEffect, useRef } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  consumeNavTempo,
  haptic,
  inputSpeed,
  installTempo,
  lastPointerType,
  lastPressMs,
  physics,
  pointerSpeed,
  rubberBand,
  rubberClamp,
  setNavTempo,
  tempoInstalled,
  useAxisDrag,
  useSwipeDismiss,
  type AxisDragRelease,
  type SwipeDismiss,
  type UseAxisDragOptions,
  type UseSwipeDismissOptions,
} from "@/motion/physics";

// ── pointer helpers: explicit timeStamps (jsdom stamps events with Date.now()) ─────────────────────────────────

let clock = 50_000;
type Init = Partial<PointerEventInit> & { pointerType?: string };

function ptr(el: Element | Window, type: string, x: number, y: number, t: number, extra: Init = {}) {
  const e = new PointerEvent(type, { bubbles: true, cancelable: true, pointerId: 1, pointerType: "touch", isPrimary: true, button: 0, clientX: x, clientY: y, ...extra });
  Object.defineProperty(e, "timeStamp", { value: t, configurable: true });
  act(() => {
    el.dispatchEvent(e);
  });
}

/** Press at `from`, move to `to` in `steps` equal steps over `ms`, rest `hold` ms, release. Returns the release time. */
function swipe(el: Element, from: [number, number], to: [number, number], ms: number, opts: { steps?: number; hold?: number; up?: boolean; extra?: Init } = {}) {
  const { steps = Math.max(2, Math.round(ms / (1000 / 120))), hold = 0, up = true, extra = {} } = opts;
  const t0 = (clock += 1000);
  ptr(el, "pointerdown", from[0], from[1], t0, extra);
  for (let i = 1; i <= steps; i++) {
    const f = i / steps;
    ptr(el, "pointermove", from[0] + (to[0] - from[0]) * f, from[1] + (to[1] - from[1]) * f, t0 + ms * f, extra);
  }
  const tUp = t0 + ms + hold;
  if (up) ptr(el, "pointerup", to[0], to[1], tUp, extra);
  return tUp;
}

function click(el: Element) {
  act(() => {
    el.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, detail: 1 }));
  });
}

// ── harnesses ─────────────────────────────────────────────────────────────────────────────────────────────────

let api: SwipeDismiss | null = null;

function SwipeHarness(props: Partial<UseSwipeDismissOptions> & { onButton?: () => void }) {
  const { onButton, ...rest } = props;
  const s = useSwipeDismiss({ measure: () => 600, onDismiss: () => {}, ...rest });
  useEffect(() => {
    api = s;
  });
  return (
    <div data-testid="wrap">
      <div data-testid="handle" {...s.handle}>
        <button type="button" onClick={onButton}>
          Schließen
        </button>
        <input aria-label="Feld" />
      </div>
    </div>
  );
}

function TargetHarness(props: Partial<UseSwipeDismissOptions>) {
  const panel = useRef<HTMLDivElement>(null);
  const s = useSwipeDismiss({ onDismiss: () => {}, target: panel, ...props });
  useEffect(() => {
    api = s;
  });
  return (
    <div data-testid="panel" ref={panel}>
      <div data-testid="handle" {...s.handle} />
    </div>
  );
}

let xmv: MotionValue<number> | null = null;

function DragHarness(props: Partial<UseAxisDragOptions>) {
  const x = useMotionValue(0);
  const d = useAxisDrag({ axis: "x", x, ...props });
  useEffect(() => {
    xmv = x;
  });
  return (
    <div data-testid="handle" {...d.handlers} style={d.style}>
      <input aria-label="Feld" />
    </div>
  );
}

const handleOf = (c: ReturnType<typeof render>) => c.getByTestId("handle");

afterEach(() => {
  api = null;
  xmv = null;
});

// ── useSwipeDismiss ───────────────────────────────────────────────────────────────────────────────────────────

describe("useSwipeDismiss", () => {
  it("a quick downward flick dismisses once, with direction, velocity and size; the panel stays where it was let go", () => {
    const onDismiss = vi.fn();
    const c = render(<SwipeHarness onDismiss={onDismiss} reduced />);
    swipe(handleOf(c), [100, 100], [100, 180], 40);
    expect(onDismiss).toHaveBeenCalledTimes(1);
    const info = onDismiss.mock.calls[0]![0];
    expect(info.direction).toBe(1);
    expect(info.velocity).toBeGreaterThan(1200);
    expect(info.size).toBe(600);
    expect(info.pointerType).toBe("touch");
    expect(info.tempo).toBeGreaterThan(0.4);
    // anchored at the engagement point (first move past 10 px): 1:1 from there, no jump
    expect(api!.y.get()).toBeCloseTo(80 - 80 / 5, 6);
    expect(api!.lastDismiss()).toEqual(info);
  });

  it("a slow drag that rests before lifting does not dismiss and springs home (reduced: jumps)", () => {
    const onDismiss = vi.fn();
    const c = render(<SwipeHarness onDismiss={onDismiss} reduced />);
    swipe(handleOf(c), [100, 100], [100, 250], 600, { up: false });
    expect(api!.y.get()).toBeGreaterThan(100); // tracks 1:1 while held
    ptr(handleOf(c), "pointerup", 100, 250, clock + 600 + 60);
    expect(onDismiss).not.toHaveBeenCalled();
    expect(api!.y.get()).toBe(0);
  });

  it("dragged past the threshold and held there dismisses even without speed", () => {
    const onDismiss = vi.fn();
    const c = render(<SwipeHarness onDismiss={onDismiss} reduced />);
    swipe(handleOf(c), [100, 100], [100, 400], 700, { hold: 80 });
    expect(onDismiss).toHaveBeenCalledTimes(1);
    expect(onDismiss.mock.calls[0]![0].velocity).toBe(0);
  });

  it("flicking back up cancels a long pull", () => {
    const onDismiss = vi.fn();
    const c = render(<SwipeHarness onDismiss={onDismiss} reduced />);
    const el = handleOf(c);
    const t0 = (clock += 1000);
    ptr(el, "pointerdown", 0, 0, t0);
    for (let i = 1; i <= 30; i++) ptr(el, "pointermove", 0, i * 10, t0 + i * 16);
    for (let i = 1; i <= 6; i++) ptr(el, "pointermove", 0, 300 - i * 15, t0 + 480 + i * 8);
    ptr(el, "pointerup", 0, 210, t0 + 530);
    expect(onDismiss).not.toHaveBeenCalled();
    expect(api!.y.get()).toBe(0);
  });

  it("springs home with physics when motion is allowed (velocity hand-off, settles at 0)", async () => {
    const c = render(<SwipeHarness reduced={false} />);
    swipe(handleOf(c), [100, 100], [100, 160], 300, { hold: 0 });
    await waitFor(() => expect(Math.abs(api!.y.get())).toBeLessThan(0.5), { timeout: 3000 });
  });

  it("a tap while the panel springs home does not freeze it; a flick back past the edge overshoots only rubber-banded", async () => {
    const c = render(<SwipeHarness reduced={false} />);
    const el = handleOf(c);
    const onDismiss = vi.fn();
    c.rerender(<SwipeHarness reduced={false} onDismiss={onDismiss} />);
    swipe(el, [100, 100], [100, 160], 500, { hold: 0 }); // 50 px + project(120 px/s) < 198: returns
    expect(onDismiss).not.toHaveBeenCalled();
    expect(api!.y.get()).toBeGreaterThan(40);
    // tap (no travel) during the spring: nothing is stopped
    swipe(el, [50, 50], [51, 51], 30);
    await waitFor(() => expect(Math.abs(api!.y.get())).toBeLessThan(0.5), { timeout: 3000 });
    // pull 120 px slowly, flick back hard: cancels, overshoots above home, but banded (≤ stretch)
    let min = 0;
    const off = api!.y.on("change", (v) => (min = Math.min(min, v)));
    const t0 = (clock += 1000);
    ptr(el, "pointerdown", 0, 0, t0);
    for (let i = 1; i <= 20; i++) ptr(el, "pointermove", 0, i * 6, t0 + i * 16);
    for (let i = 1; i <= 6; i++) ptr(el, "pointermove", 0, 120 - i * 15, t0 + 320 + i * 8);
    ptr(el, "pointerup", 0, 30, t0 + 376);
    await waitFor(() => expect(Math.abs(api!.y.get())).toBeLessThan(0.5), { timeout: 3000 });
    off();
    expect(onDismiss).not.toHaveBeenCalled();
    expect(min).toBeLessThan(-2);
    expect(min).toBeGreaterThan(-physics.stretch / 2);
  });

  it("ignores the mouse by default (precise clicks / selection keep working)", () => {
    const onDismiss = vi.fn();
    const c = render(<SwipeHarness onDismiss={onDismiss} reduced />);
    swipe(handleOf(c), [100, 100], [100, 400], 60, { extra: { pointerType: "mouse" } });
    expect(onDismiss).not.toHaveBeenCalled();
    expect(api!.y.get()).toBe(0);
  });

  it("pulling against the dismissal rubber-bands (iOS edge stretch, ≤ 60 px)", () => {
    const c = render(<SwipeHarness reduced />);
    swipe(handleOf(c), [100, 400], [100, 100], 400, { up: false });
    const y = api!.y.get();
    // 48 steps of 6.25 px: engages at the 2nd (12.5 px ≥ 10 px), then 287.5 px of finger against the edge
    expect(y).toBeCloseTo(-rubberBand(300 - 12.5, physics.stretch), 6);
    expect(y).toBeGreaterThan(-physics.stretch);
    ptr(handleOf(c), "pointerup", 100, 100, clock + 400 + 60);
    expect(api!.y.get()).toBe(0);
  });

  it("guard (unsaved input): resisted, never dismisses, asks via onAttempt, springs back", () => {
    const onDismiss = vi.fn();
    const onAttempt = vi.fn();
    const c = render(<SwipeHarness onDismiss={onDismiss} onAttempt={onAttempt} guard={() => true} reduced />);
    swipe(handleOf(c), [100, 100], [100, 420], 80, { up: false });
    const y = api!.y.get();
    expect(y).toBeLessThan(physics.guardStretch);
    expect(y).toBeGreaterThan(40);
    ptr(handleOf(c), "pointerup", 100, 420, clock + 80);
    expect(onDismiss).not.toHaveBeenCalled();
    expect(onAttempt).toHaveBeenCalledTimes(1);
    expect(api!.y.get()).toBe(0);
    // a small guarded pull does not even ask
    swipe(handleOf(c), [100, 100], [100, 130], 400, { hold: 60 });
    expect(onAttempt).toHaveBeenCalledTimes(1);
  });

  it("hysteresis and angle lock: < 10 px is a tap, a sideways start leaves the gesture to the browser", () => {
    const onButton = vi.fn();
    const c = render(<SwipeHarness onButton={onButton} reduced />);
    const el = handleOf(c);
    const button = c.getByRole("button", { name: "Schließen" });
    // tap with a 6 px wobble on the close button: the click goes through
    swipe(button, [10, 10], [12, 16], 80);
    expect(api!.y.get()).toBe(0);
    click(button);
    expect(onButton).toHaveBeenCalledTimes(1);
    // sideways first → rejected, later vertical travel does nothing
    const t0 = (clock += 1000);
    ptr(el, "pointerdown", 0, 0, t0);
    ptr(el, "pointermove", 20, 4, t0 + 16);
    ptr(el, "pointermove", 20, 200, t0 + 32);
    expect(api!.y.get()).toBe(0);
    ptr(el, "pointerup", 20, 200, t0 + 48);
  });

  it("swallows the click that ends a drag started on a header button", () => {
    const onButton = vi.fn();
    const c = render(<SwipeHarness onButton={onButton} reduced />);
    const button = c.getByRole("button", { name: "Schließen" });
    swipe(button, [10, 10], [10, 60], 300, { hold: 60 });
    click(button);
    expect(onButton).not.toHaveBeenCalled();
    click(button); // only the one click after the drag
    expect(onButton).toHaveBeenCalledTimes(1);
  });

  it("never starts on form fields inside the handle", () => {
    const c = render(<SwipeHarness reduced />);
    swipe(c.getByRole("textbox", { name: "Feld" }), [10, 10], [10, 300], 300, { up: false });
    expect(api!.y.get()).toBe(0);
  });

  it("progress and dim follow the offset; zoom mode scales and lets the cross axis follow at 0.5×", () => {
    const c = render(<SwipeHarness mode="zoom" measure={() => 400} reduced={false} />);
    const el = handleOf(c);
    const t0 = (clock += 1000);
    ptr(el, "pointerdown", 100, 100, t0);
    ptr(el, "pointermove", 100, 120, t0 + 16); // engages on y
    ptr(el, "pointermove", 140, 320, t0 + 200);
    expect(api!.y.get()).toBe(200);
    expect(api!.x.get()).toBe(20);
    expect(api!.progress.get()).toBeCloseTo(0.5, 9);
    expect(api!.scale.get()).toBeCloseTo(0.94, 9);
    expect(api!.dim.get()).toBeCloseTo(1 - 0.75 * 0.5, 9);
    ptr(el, "pointercancel", 140, 320, t0 + 220);
  });

  it("slide mode and reduced motion never scale", () => {
    const c = render(<SwipeHarness mode="zoom" measure={() => 400} reduced />);
    swipe(handleOf(c), [100, 100], [140, 320], 400, { up: false });
    expect(api!.scale.get()).toBe(1);
    expect(api!.x.get()).toBe(0);
    expect(api!.progress.get()).toBeGreaterThan(0.4);
  });

  it("toast: axis x, either direction, threshold 80, mouse allowed", () => {
    const onDismiss = vi.fn();
    const c = render(<SwipeHarness axis="x" direction={0} threshold={80} minOffset={12} pointerTypes={["mouse", "touch", "pen"]} touchAction="pan-y" onDismiss={onDismiss} reduced />);
    expect(handleOf(c).style.touchAction).toBe("pan-y");
    swipe(handleOf(c), [200, 20], [140, 22], 40, { extra: { pointerType: "mouse" } });
    expect(onDismiss).toHaveBeenCalledTimes(1);
    expect(onDismiss.mock.calls[0]![0].direction).toBe(-1);
    // a slow 40 px nudge returns
    swipe(handleOf(c), [200, 20], [240, 20], 500, { hold: 60 });
    expect(onDismiss).toHaveBeenCalledTimes(1);
    expect(api!.x.get()).toBe(0);
  });

  it("reopening resets values a previous exit left off-screen; disabled surfaces ignore gestures", () => {
    const onDismiss = vi.fn();
    const c = render(<SwipeHarness open onDismiss={onDismiss} reduced />);
    swipe(handleOf(c), [100, 100], [100, 200], 40);
    expect(api!.y.get()).toBeGreaterThan(50);
    c.rerender(<SwipeHarness open={false} enabled={false} onDismiss={onDismiss} reduced />);
    expect(api!.y.get()).toBeGreaterThan(50); // exit animations may still use it
    swipe(handleOf(c), [100, 100], [100, 400], 40);
    expect(onDismiss).toHaveBeenCalledTimes(1);
    c.rerender(<SwipeHarness open onDismiss={onDismiss} reduced />);
    expect(api!.y.get()).toBe(0);
    expect(api!.lastDismiss()).toBeNull();
  });

  it("measures the target once per gesture and keeps it on its own layer until it is home", async () => {
    const onDismiss = vi.fn();
    const c = render(<TargetHarness reduced onDismiss={onDismiss} />);
    const panel = c.getByTestId("panel");
    const rect = vi.spyOn(panel, "getBoundingClientRect").mockReturnValue({ x: 0, y: 0, width: 400, height: 300, top: 0, left: 0, right: 400, bottom: 300, toJSON: () => ({}) } as DOMRect);
    swipe(c.getByTestId("handle"), [10, 10], [10, 60], 300, { up: false });
    expect(panel.style.willChange).toBe("transform");
    expect(rect).toHaveBeenCalledTimes(1);
    expect(api!.progress.get()).toBeCloseTo((50 - (8 * 50) / 36) / 300, 6); // 36 steps of 1.39 px, engaged at the 8th
    ptr(c.getByTestId("handle"), "pointerup", 10, 60, clock + 360);
    await waitFor(() => expect(panel.style.willChange).toBe(""));
    // threshold from the measured size: clamp(0.33·300, 140, 260) = 140 → a held 150 px pull commits
    swipe(c.getByTestId("handle"), [10, 10], [10, 170], 500, { hold: 60 });
    expect(onDismiss).toHaveBeenCalledTimes(1);
    expect(panel.style.willChange).toBe("transform"); // kept for the exit
  });

  it("reset() brings back a value an exit animation moved directly", () => {
    const c = render(<SwipeHarness reduced />);
    void c;
    act(() => api!.y.set(640));
    act(() => api!.reset({ instant: true }));
    expect(api!.y.get()).toBe(0);
    expect(api!.progress.get()).toBe(0);
    expect(api!.dim.get()).toBe(1);
  });

  it("a hard flick crossing the projected threshold ticks the haptic once", () => {
    const vibrate = vi.fn(() => true);
    vi.stubGlobal("navigator", { ...navigator, vibrate, userActivation: { hasBeenActive: true } });
    try {
      const c = render(<SwipeHarness reduced />);
      swipe(handleOf(c), [100, 100], [100, 260], 60);
      expect(vibrate).toHaveBeenCalledTimes(1);
      expect(vibrate).toHaveBeenCalledWith(physics.haptic);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

// ── useAxisDrag ───────────────────────────────────────────────────────────────────────────────────────────────

describe("useAxisDrag", () => {
  it("drives the MotionValue through `map` (rubberClamp) and springs to the target returned by onRelease", () => {
    const onRelease = vi.fn((r: AxisDragRelease) => (r.vx > 500 ? { x: 50 } : undefined));
    const c = render(<DragHarness reduced map={(raw) => ({ x: rubberClamp(raw.x, -50, 50, 40) })} onRelease={onRelease} />);
    swipe(handleOf(c), [0, 0], [200, 0], 100, { up: false });
    const x = xmv!.get();
    expect(x).toBeGreaterThan(50);
    expect(x).toBeLessThan(90);
    ptr(handleOf(c), "pointerup", 200, 0, clock + 100);
    const r = onRelease.mock.calls[0]![0];
    expect(r.vx).toBeGreaterThan(1500);
    expect(r.vy).toBe(0);
    expect(r.durationMs).toBe(100);
    expect(r.tempo).toBeGreaterThan(0.5);
    expect(xmv!.get()).toBe(50);
  });

  it("onTap for a press without engagement; pointercancel springs home and calls onCancel", () => {
    const onTap = vi.fn();
    const onCancel = vi.fn();
    const onStart = vi.fn();
    const c = render(<DragHarness reduced onTap={onTap} onCancel={onCancel} onStart={onStart} />);
    swipe(handleOf(c), [0, 0], [3, 0], 50);
    expect(onTap).toHaveBeenCalledTimes(1);
    expect(onStart).not.toHaveBeenCalled();
    swipe(handleOf(c), [0, 0], [120, 0], 100, { up: false });
    expect(onStart).toHaveBeenCalledTimes(1);
    expect(xmv!.get()).toBeGreaterThan(90);
    ptr(handleOf(c), "pointercancel", 120, 0, clock + 120);
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(xmv!.get()).toBe(0);
  });

  it("disabling mid-gesture aborts; a grab catches a moving value where it is", () => {
    const onCancel = vi.fn();
    const c = render(<DragHarness reduced onCancel={onCancel} />);
    swipe(handleOf(c), [0, 0], [100, 0], 100, { up: false });
    c.rerender(<DragHarness reduced onCancel={onCancel} enabled={false} />);
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(xmv!.get()).toBe(0);
    // base = current value: set it, grab, move 30 px past engagement → base + 30
    c.rerender(<DragHarness reduced onRelease={() => "none"} />);
    act(() => xmv!.set(40));
    swipe(handleOf(c), [0, 0], [50, 0], 100, { steps: 5 });
    expect(xmv!.get()).toBe(40 + 40);
  });

  it("default touch-action keeps the cross axis with the browser; form fields never start a drag", () => {
    const c = render(<DragHarness reduced />);
    expect(handleOf(c).style.touchAction).toBe("pan-y");
    swipe(c.getByRole("textbox", { name: "Feld" }), [0, 0], [100, 0], 100, { up: false });
    expect(xmv!.get()).toBe(0);
  });
});

// ── tempo probe ───────────────────────────────────────────────────────────────────────────────────────────────

describe("pointer tempo probe", () => {
  it("reads the live pointer speed passively, decays to 0 after 40 ms at rest, tracks presses and hand-offs", async () => {
    expect(pointerSpeed()).toBe(0); // lazily installs
    expect(tempoInstalled()).toBe(true);
    const uninstall = installTempo();
    const t0 = (clock += 1000);
    for (let i = 0; i <= 12; i++) ptr(window, "pointermove", i * 10, 0, t0 + i * 8, { pointerType: "mouse" });
    expect(inputSpeed.get()).toBeCloseTo(1250, 3);
    expect(pointerSpeed()).toBeCloseTo(1250, 3);
    expect(lastPointerType()).toBe("mouse");
    await new Promise((r) => setTimeout(r, 70));
    expect(pointerSpeed()).toBe(0);
    expect(inputSpeed.get()).toBe(0);

    // a new touch contact never measures the jump from the mouse position
    ptr(window, "pointerdown", 900, 900, t0 + 500, { pointerType: "touch" });
    ptr(window, "pointermove", 901, 900, t0 + 508, { pointerType: "touch" });
    expect(pointerSpeed()).toBeLessThan(200);
    await new Promise((r) => setTimeout(r, 25));
    ptr(window, "pointerup", 901, 900, t0 + 540, { pointerType: "touch" });
    expect(lastPressMs()).toBeGreaterThanOrEqual(20);
    expect(lastPressMs()).toBeLessThan(500);

    setNavTempo(0.8);
    expect(consumeNavTempo()).toBe(0.8);
    expect(consumeNavTempo()).toBe(0);
    setNavTempo(7);
    expect(consumeNavTempo()).toBe(1);

    uninstall();
    uninstall(); // idempotent
  });

  it("haptic only after a user activation and only where vibrate exists", () => {
    vi.stubGlobal("navigator", { userAgent: "x" });
    expect(haptic()).toBe(false);
    const vibrate = vi.fn(() => true);
    vi.stubGlobal("navigator", { vibrate, userActivation: { hasBeenActive: false } });
    expect(haptic()).toBe(false);
    vi.stubGlobal("navigator", { vibrate, userActivation: { hasBeenActive: true } });
    expect(haptic()).toBe(true);
    expect(vibrate).toHaveBeenCalledWith(6);
    vi.stubGlobal("navigator", {
      vibrate: () => {
        throw new Error("blocked");
      },
    });
    expect(haptic()).toBe(false);
    vi.unstubAllGlobals();
  });
});
