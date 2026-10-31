import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { openFoldsAround } from "@/app/reveal";
import { chipClass } from "@/primitives/chip";
import { FOLD_ALL, FOLDS_KEY, Fold, isFoldOpen } from "@/primitives/Fold";

beforeEach(() => localStorage.removeItem(FOLDS_KEY));

describe("Fold", () => {
  it("starts closed: one row (title + hint), the card stays in the DOM", () => {
    const { container } = render(
      <Fold id="t1" title="Ereignisphasen" hint="Wie deine Trades rund um Termine liefen">
        <p>Inhalt der Karte</p>
      </Fold>,
    );
    const d = container.querySelector("details[data-fold='t1']") as HTMLDetailsElement;
    expect(d.open).toBe(false);
    expect(screen.getByText("Ereignisphasen")).toBeInTheDocument();
    expect(screen.getByText("Wie deine Trades rund um Termine liefen")).toBeInTheDocument();
    expect(screen.getByText("Inhalt der Karte")).toBeInTheDocument();
    expect(d.querySelector("summary")?.className).toContain("min-h-14");
  });

  it("remembers the open ids per browser and forgets them on close", () => {
    const { container } = render(
      <Fold id="t2" title="A" hint="a">
        <p>x</p>
      </Fold>,
    );
    const d = container.querySelector("details") as HTMLDetailsElement;
    d.open = true;
    fireEvent(d, new Event("toggle"));
    expect(JSON.parse(localStorage.getItem(FOLDS_KEY)!)).toEqual(["t2"]);
    expect(isFoldOpen("t2")).toBe(true);
    d.open = false;
    fireEvent(d, new Event("toggle"));
    expect(JSON.parse(localStorage.getItem(FOLDS_KEY)!)).toEqual([]);
  });

  it("starts open when the id is stored, or when '*' (all) is", () => {
    localStorage.setItem(FOLDS_KEY, JSON.stringify(["t3"]));
    const a = render(
      <Fold id="t3" title="A" hint="a">
        <p>x</p>
      </Fold>,
    );
    expect((a.container.querySelector("details") as HTMLDetailsElement).open).toBe(true);
    a.unmount();
    localStorage.setItem(FOLDS_KEY, JSON.stringify([FOLD_ALL]));
    const b = render(
      <Fold id="other" title="B" hint="b">
        <p>y</p>
      </Fold>,
    );
    expect((b.container.querySelector("details") as HTMLDetailsElement).open).toBe(true);
  });

  it("a broken store counts as nothing open", () => {
    localStorage.setItem(FOLDS_KEY, "{not json");
    expect(isFoldOpen("x")).toBe(false);
  });

  it("openFoldsAround opens every fold around an element, at any depth", () => {
    const { container } = render(
      <Fold id="outer" title="Außen" hint="a">
        <Fold id="inner" title="Innen" hint="b">
          <p data-testid="target">Ziel</p>
        </Fold>
      </Fold>,
    );
    openFoldsAround(screen.getByTestId("target"));
    const all = container.querySelectorAll("details[data-fold]");
    expect(all).toHaveLength(2);
    for (const d of all) expect((d as HTMLDetailsElement).open).toBe(true);
  });
});

describe("chipClass", () => {
  it("off = a quiet outline, on = a plain fill without a rim", () => {
    expect(chipClass(false)).toContain("border-line-2 text-mute");
    expect(chipClass(true)).toContain("border-transparent bg-white/[0.12] text-fg");
    expect(chipClass(true, { tone: "loss" })).toContain("bg-signal/15");
  });
  it("keeps the 32 px row and gives coarse pointers 44 px", () => {
    for (const size of ["sm", "md"] as const) {
      const c = chipClass(false, { size });
      expect(c).toContain("min-h-8");
      expect(c).toContain("pointer-coarse:min-h-11");
    }
  });
  it("lets a caller override the height", () => {
    expect(chipClass(false, { className: "min-h-9" })).toContain("min-h-9");
    expect(chipClass(false, { className: "min-h-9" })).not.toContain("min-h-8");
  });
});
