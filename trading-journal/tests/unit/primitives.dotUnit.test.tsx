/**
 * `DotFigure` / `splitUnit` (refinement pass 3): a formatted figure keeps its number in Doto and moves the trailing unit
 * (`%`, `R`, `×`, `€`, `USDT` …) into a Plex Sans `DotUnit` – Doto draws `%` as a checkerboard. Text content unchanged.
 */
import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { DotFigure } from "@/primitives/DotUnit";
import { splitUnit } from "@/primitives/splitUnit";

describe("splitUnit", () => {
  it("splits a trailing unit after a figure", () => {
    expect(splitUnit("−222 USDT")).toEqual(["−222", " USDT"]);
    expect(splitUnit("62,4 %")).toEqual(["62,4", " %"]);
    expect(splitUnit("+1,47R")).toEqual(["+1,47", "R"]);
    expect(splitUnit("10 €")).toEqual(["10", " €"]);
    expect(splitUnit("1,8×")).toEqual(["1,8", "×"]);
    expect(splitUnit("< 0,1 %")).toEqual(["< 0,1", " %"]);
  });

  it("leaves words, symbols and ratios whole", () => {
    for (const t of ["–", "BTCUSDT", "KW 17", "Cloud", "lokal", "Premium", "1:2,0", "3 offen", "4H", "0"]) expect(splitUnit(t)).toEqual([t, ""]);
  });
});

describe("DotFigure", () => {
  it("renders the number as text and the unit in a Plex Sans span – same text content", () => {
    const { container } = render(
      <span className="dot-num" data-testid="f">
        <DotFigure text="−222 USDT" />
      </span>,
    );
    const root = container.querySelector(".dot-num")!;
    expect(root.textContent).toBe("−222 USDT");
    const unit = root.querySelector("span")!;
    expect(unit.textContent).toBe(" USDT");
    expect(unit.className).toMatch(/\bfont-sans\b/);
    expect(root.firstChild?.textContent).toBe("−222");
  });

  it("without a unit there is no unit span", () => {
    const { container } = render(<span className="dot-num"><DotFigure text="–" /></span>);
    expect(container.querySelector(".dot-num span")).toBeNull();
  });
});
