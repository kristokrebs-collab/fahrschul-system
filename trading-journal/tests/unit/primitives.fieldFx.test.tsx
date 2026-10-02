import { fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { tween } from "@/motion/tokens";
import { Field } from "@/primitives/Field";
import { PULSE_OPACITY, SHAKE_X, shakeField, useShake } from "@/primitives/fieldFx";
import { Input } from "@/primitives/Input";

const calls = vi.hoisted(() => [] as { el: Element; keyframes: Record<string, unknown> }[]);
vi.mock("motion/react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("motion/react")>();
  return {
    ...actual,
    animate: (el: unknown, keyframes: unknown, options: unknown) => {
      if (el instanceof Element) calls.push({ el, keyframes: keyframes as Record<string, unknown> });
      return (actual.animate as (...a: unknown[]) => unknown)(el, keyframes, options);
    },
  };
});

beforeEach(() => {
  calls.length = 0;
});

function Form({ initialKey = null }: { initialKey?: number | null }) {
  const [k, setK] = useState<number | null>(initialKey);
  return (
    <>
      <Field label="Startkapital" htmlFor="cap" invalidKey={k}>
        <Input id="cap" numeric />
      </Field>
      <button type="button" onClick={() => setK((n) => (n ?? 0) + 1)}>
        Speichern
      </button>
    </>
  );
}

describe("shakeField", () => {
  it("shakes the whole Field (by id) and pulses its input ring", () => {
    render(<Form />);
    shakeField("cap", { reduced: false });
    const field = screen.getByLabelText("Startkapital").closest("[data-field]");
    const pulse = field?.querySelector("[data-input-pulse]");
    expect(calls.find((c) => c.el === field)?.keyframes).toEqual({ x: SHAKE_X });
    expect(calls.find((c) => c.el === pulse)?.keyframes).toEqual({ opacity: PULSE_OPACITY });
  });

  it("under reduced motion only fades the ring once, without moving the field", () => {
    render(<Form />);
    shakeField(document.getElementById("cap"), { reduced: true });
    const field = screen.getByLabelText("Startkapital").closest("[data-field]");
    expect(calls.some((c) => c.el === field)).toBe(false);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.keyframes).toEqual({ opacity: [0.8, 0] });
  });

  it("ignores unknown targets", () => {
    expect(() => shakeField("nope")).not.toThrow();
    expect(() => shakeField(null)).not.toThrow();
    expect(calls).toHaveLength(0);
  });

  it("uses the shake token for its duration", () => {
    expect(tween.shake.duration).toBeGreaterThan(0);
    expect(SHAKE_X[0]).toBe(0);
    expect(SHAKE_X.at(-1)).toBe(0);
  });
});

describe("Field invalidKey", () => {
  it("never shakes on mount, shakes on every new key", () => {
    render(<Form initialKey={3} />);
    expect(calls).toHaveLength(0);
    fireEvent.click(screen.getByRole("button", { name: "Speichern" }));
    const field = screen.getByLabelText("Startkapital").closest("[data-field]");
    expect(calls.filter((c) => c.el === field)).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: "Speichern" }));
    expect(calls.filter((c) => c.el === field)).toHaveLength(2);
  });
});

describe("useShake", () => {
  it("shakes exactly the referenced element", () => {
    function H() {
      const { ref, shake } = useShake<HTMLDivElement>();
      return (
        <div data-field="">
          <div ref={ref} data-testid="box" />
          <button type="button" onClick={shake}>
            Los
          </button>
        </div>
      );
    }
    render(<H />);
    fireEvent.click(screen.getByRole("button", { name: "Los" }));
    expect(calls.map((c) => c.el)).toEqual([screen.getByTestId("box")]);
  });
});
