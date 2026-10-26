import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { HoldButton } from "@/motion/HoldButton";
import { Switch } from "@/motion/Switch";

const fx = vi.hoisted(() => ({ reduced: false }));
vi.mock("@/motion/useReducedFx", () => ({ useReducedFx: () => fx.reduced }));

afterEach(() => {
  fx.reduced = false;
});

const HOLD_S = 0.08;
const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe("<HoldButton>", () => {
  it("keeps a stable accessible name and exact text while idle", () => {
    render(<HoldButton onConfirm={() => {}}>Löschen</HoldButton>);
    const btn = screen.getByRole("button", { name: "Löschen" });
    expect(btn).toHaveTextContent(/^Löschen$/);
    expect(btn).toHaveAttribute("data-state", "idle");
    expect(btn).toHaveAttribute("title", "Gedrückt halten zum Bestätigen");
  });

  it("confirms once after a full pointer hold", async () => {
    const onConfirm = vi.fn();
    render(
      <HoldButton onConfirm={onConfirm} duration={HOLD_S}>
        Löschen
      </HoldButton>,
    );
    const btn = screen.getByRole("button", { name: "Löschen" });
    fireEvent.pointerDown(btn, { button: 0 });
    expect(btn).toHaveAttribute("data-state", "holding");
    expect(screen.getByRole("button", { name: "Löschen" })).toBe(btn); // name unchanged while holding
    await waitFor(() => expect(onConfirm).toHaveBeenCalledTimes(1));
    expect(btn).toHaveAttribute("data-state", "done");
    fireEvent.pointerUp(btn);
    await pause(50);
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it("cancels when released early and does not confirm", async () => {
    const onConfirm = vi.fn();
    render(
      <HoldButton onConfirm={onConfirm} duration={0.3}>
        Löschen
      </HoldButton>,
    );
    const btn = screen.getByRole("button");
    fireEvent.pointerDown(btn, { button: 0 });
    await pause(40);
    fireEvent.pointerUp(btn);
    expect(btn).toHaveAttribute("data-state", "idle");
    await pause(400);
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it("cancels when the pointer leaves and ignores secondary buttons", async () => {
    const onConfirm = vi.fn();
    render(
      <HoldButton onConfirm={onConfirm} duration={0.2}>
        Löschen
      </HoldButton>,
    );
    const btn = screen.getByRole("button");
    fireEvent.pointerDown(btn, { button: 2 });
    expect(btn).toHaveAttribute("data-state", "idle");
    fireEvent.pointerDown(btn, { button: 0 });
    fireEvent.pointerLeave(btn);
    await pause(300);
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it("holds with Enter / Space and cancels on key release", async () => {
    const onConfirm = vi.fn();
    render(
      <HoldButton onConfirm={onConfirm} duration={HOLD_S}>
        Löschen
      </HoldButton>,
    );
    const btn = screen.getByRole("button");
    fireEvent.keyDown(btn, { key: " " });
    fireEvent.keyUp(btn, { key: " " });
    expect(btn).toHaveAttribute("data-state", "idle");
    await pause(150);
    expect(onConfirm).not.toHaveBeenCalled();

    fireEvent.keyDown(btn, { key: "Enter" });
    fireEvent.keyDown(btn, { key: "Enter", repeat: true });
    await waitFor(() => expect(onConfirm).toHaveBeenCalledTimes(1));
  });

  it("arms on an assistive-tech activation and confirms on the second", () => {
    const onConfirm = vi.fn();
    render(<HoldButton onConfirm={onConfirm}>Löschen</HoldButton>);
    const btn = screen.getByRole("button", { name: "Löschen" });
    fireEvent.click(btn, { detail: 1 }); // a pointer click: the hold decides, nothing happens
    expect(btn).toHaveAttribute("data-state", "idle");
    fireEvent.click(btn, { detail: 0 });
    expect(btn).toHaveAttribute("data-state", "armed");
    expect(screen.getByRole("button", { name: "Zum Bestätigen erneut auslösen" })).toBe(btn);
    expect(onConfirm).not.toHaveBeenCalled();
    fireEvent.click(btn, { detail: 0 });
    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(btn).toHaveAttribute("data-state", "done");
  });

  it("reports the end of a press via onRelease (cancels stay silent) and forwards its ref to the native button", async () => {
    const onConfirm = vi.fn();
    const onRelease = vi.fn();
    const ref = { current: null as HTMLButtonElement | null };
    render(
      <HoldButton ref={ref} onConfirm={onConfirm} onRelease={onRelease} fallback={false} duration={HOLD_S}>
        Löschen
      </HoldButton>,
    );
    const btn = screen.getByRole("button", { name: "Löschen" });
    expect(ref.current).toBe(btn);
    // quick pointer press → released early
    fireEvent.pointerDown(btn, { button: 0 });
    fireEvent.pointerUp(btn);
    fireEvent.click(btn, { detail: 1 });
    expect(onRelease.mock.calls).toEqual([[false]]);
    // pointer leaves / Escape cancel without a report
    fireEvent.pointerDown(btn, { button: 0 });
    fireEvent.pointerLeave(btn);
    fireEvent.keyDown(btn, { key: "Enter" });
    fireEvent.keyDown(btn, { key: "Escape" });
    fireEvent.keyUp(btn, { key: "Enter" });
    expect(onRelease).toHaveBeenCalledTimes(1);
    // assistive-tech activation with the fallback off → a press without a hold
    fireEvent.click(btn, { detail: 0 });
    expect(onRelease.mock.calls).toEqual([[false], [false]]);
    // full hold → onConfirm, then onRelease(true); the trailing pointer-up / click report nothing more
    fireEvent.pointerDown(btn, { button: 0 });
    await waitFor(() => expect(onConfirm).toHaveBeenCalledTimes(1));
    fireEvent.pointerUp(btn);
    fireEvent.click(btn, { detail: 1 });
    expect(onRelease.mock.calls).toEqual([[false], [false], [true]]);
  });

  it("does nothing while disabled or with the fallback off", () => {
    const onConfirm = vi.fn();
    const { rerender } = render(
      <HoldButton onConfirm={onConfirm} disabled>
        Löschen
      </HoldButton>,
    );
    const btn = screen.getByRole("button");
    fireEvent.pointerDown(btn, { button: 0 });
    expect(btn).toHaveAttribute("data-state", "idle");
    rerender(
      <HoldButton onConfirm={onConfirm} fallback={false}>
        Löschen
      </HoldButton>,
    );
    fireEvent.click(btn, { detail: 0 });
    expect(btn).toHaveAttribute("data-state", "idle");
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it("keeps the hold mechanic under reduced motion", async () => {
    fx.reduced = true;
    const onConfirm = vi.fn();
    render(
      <HoldButton onConfirm={onConfirm} duration={HOLD_S}>
        Löschen
      </HoldButton>,
    );
    fireEvent.pointerDown(screen.getByRole("button"), { button: 0 });
    await waitFor(() => expect(onConfirm).toHaveBeenCalledTimes(1));
  });
});

function ControlledSwitch({ initial = false, onChange }: { initial?: boolean; onChange?: (v: boolean) => void }) {
  const [on, setOn] = useState(initial);
  return (
    <>
      <label htmlFor="proxy">EU-Proxy verwenden</label>
      <Switch
        id="proxy"
        checked={on}
        onCheckedChange={(v) => {
          setOn(v);
          onChange?.(v);
        }}
      />
    </>
  );
}

describe("<Switch>", () => {
  it("is a labelled native switch reporting aria-checked", () => {
    const onChange = vi.fn();
    render(<ControlledSwitch onChange={onChange} />);
    const sw = screen.getByRole("switch", { name: "EU-Proxy verwenden" });
    expect(sw.tagName).toBe("BUTTON");
    expect(sw).toHaveAttribute("type", "button");
    expect(sw).toHaveAttribute("aria-checked", "false");
    fireEvent.click(sw);
    expect(onChange).toHaveBeenCalledWith(true);
    expect(sw).toHaveAttribute("aria-checked", "true");
    expect(sw).toHaveAttribute("data-state", "on");
    fireEvent.click(screen.getByText("EU-Proxy verwenden")); // the label toggles it too
    expect(sw).toHaveAttribute("aria-checked", "false");
  });

  it("supports aria-label and does not toggle while disabled", () => {
    const onCheckedChange = vi.fn();
    render(<Switch aria-label="Live-Daten" checked onCheckedChange={onCheckedChange} disabled tone="signal" />);
    const sw = screen.getByRole("switch", { name: "Live-Daten" });
    expect(sw).toBeDisabled();
    fireEvent.click(sw);
    expect(onCheckedChange).not.toHaveBeenCalled();
  });

  it("exposes no extra accessible content (decorative parts are hidden)", () => {
    render(<Switch aria-label="Ton" checked={false} onCheckedChange={() => {}} />);
    const sw = screen.getByRole("switch", { name: "Ton" });
    expect(sw.textContent).toBe("");
    for (const child of Array.from(sw.children)) expect(child).toHaveAttribute("aria-hidden", "true");
  });
});
