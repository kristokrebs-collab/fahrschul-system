import { act, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CONFIG, NotchedFrame, notchPath } from "@/motion/pulse/NotchedFrame";

describe("NotchedFrame", () => {
  it("notchPath cuts the notch with two convex ear turns and one concave inner corner", () => {
    const d = notchPath(300, 200, 16, 56);
    const rn = 56 * CONFIG.notchInner;
    expect(d.startsWith("M16 0H284A16 16 0 0 1 300 16")).toBe(true);
    // right edge runs down to the upper ear, ear ends on the notch's top edge
    expect(d).toContain(`V${200 - 56 - 16}A16 16 0 0 1 284 ${200 - 56}`);
    // concave inner corner (sweep 0)
    expect(d).toContain(`A${+rn.toFixed(2)} ${+rn.toFixed(2)} 0 0 0 ${300 - 56} ${+(200 - 56 + rn).toFixed(2)}`);
    // lower ear lands on the bottom edge left of the notch
    expect(d).toContain(`A16 16 0 0 1 ${300 - 56 - 16} 200`);
    expect(d.endsWith("Z")).toBe(true);
  });

  it("clamps the ears so they never exceed the notch", () => {
    const d = notchPath(300, 200, 40, 40);
    const rn = 40 * CONFIG.notchInner;
    const re = 40 - rn - 0.5;
    expect(d).toContain(`A${+re.toFixed(2)} ${+re.toFixed(2)} 0 0 1`);
  });

  it("renders children, a greyscale media slot and an aria-hidden disc; `active` forces the hover state", () => {
    const { container, rerender } = render(
      <NotchedFrame media={<div data-testid="m" />} mediaClassName="h-10" className="bg-ink-900 p-4">
        <a href="#x">Setup</a>
      </NotchedFrame>,
    );
    expect(screen.getByRole("link", { name: "Setup" })).toBeInTheDocument();
    const [grey, colour] = screen.getAllByTestId("m");
    expect(grey!.parentElement).toHaveClass("pn-gray");
    expect(grey!.parentElement).toHaveAttribute("aria-hidden", "true");
    expect(colour!.parentElement).toHaveClass("pn-color");
    expect(colour!.parentElement!.parentElement).toHaveClass("pn-media", "h-10");
    const frame = container.querySelector(".pn-frame")!;
    expect(frame).not.toHaveAttribute("data-active");
    expect(frame.querySelector("[aria-hidden='true'] .pn-disc-hot")).not.toBeNull();
    rerender(
      <NotchedFrame active>
        <span>x</span>
      </NotchedFrame>,
    );
    expect(container.querySelector(".pn-frame")).toHaveAttribute("data-active");
  });

  describe("sizing (perf-120 C)", () => {
    afterEach(() => vi.unstubAllGlobals());

    it("takes its size from the ResizeObserver's first report – no layout read while the page mounts", () => {
      let report: ((entries: unknown[]) => void) | null = null;
      vi.stubGlobal(
        "ResizeObserver",
        class {
          constructor(cb: (entries: unknown[]) => void) {
            report = cb;
          }
          observe() {}
          disconnect() {}
        },
      );
      const read = vi.spyOn(HTMLElement.prototype, "offsetWidth", "get");
      const { container } = render(<NotchedFrame className="p-4">x</NotchedFrame>);
      expect(read).not.toHaveBeenCalled();
      const surface = container.querySelector<HTMLElement>(".pn-frame > div:not([aria-hidden])")!;
      expect(surface.style.maskImage).toBe("");
      act(() => report?.([{ borderBoxSize: [{ inlineSize: 300, blockSize: 200 }] }]));
      expect(surface.style.maskImage).toContain("data:image/svg+xml");
      read.mockRestore();
    });
  });
});
