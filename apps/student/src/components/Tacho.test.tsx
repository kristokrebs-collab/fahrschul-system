import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Tacho } from "./Tacho.js";

function mockReducedMotion(matches: boolean) {
  vi.stubGlobal(
    "matchMedia",
    vi.fn().mockImplementation((query: string) => ({
      matches,
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
    })),
  );
}

describe("Tacho gauge", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("renders as an accessible image with a text alternative (no bare canvas/svg without a label)", () => {
    mockReducedMotion(false);
    render(<Tacho value={0.5} label="Pflichtfahrten" sublabel="absolviert / gefordert" />);
    expect(screen.getByRole("img", { name: /Pflichtfahrten/ })).toBeInTheDocument();
  });

  it("disables the needle transition when prefers-reduced-motion is set", () => {
    mockReducedMotion(true);
    const { container } = render(<Tacho value={0.5} label="Test" />);
    const needleGroup = container.querySelector("g");
    expect(needleGroup?.style.transition).toBe("none");
  });

  it("keeps the spring transition when reduced motion is not requested", () => {
    mockReducedMotion(false);
    const { container } = render(<Tacho value={0.5} label="Test" />);
    const needleGroup = container.querySelector("g");
    expect(needleGroup?.style.transition).not.toBe("none");
  });
});
