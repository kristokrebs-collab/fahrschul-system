import { render, screen } from "@testing-library/react";
import { lazy, type CSSProperties } from "react";
import { describe, expect, it } from "vitest";
import { CardSkeleton, RESERVE_CLASS, Reserve, ReserveFallback, ReserveSuspense, reserveStyle } from "@/primitives/Reserve";

const prop = (s: CSSProperties, name: string): unknown => (s as Record<string, unknown>)[name];

describe("reserveStyle", () => {
  it("a number is the same floor on every breakpoint", () => {
    expect(reserveStyle(360)).toEqual({ "--reserve": "360px", "--reserve-sm": "360px", "--reserve-lg": "360px" });
  });
  it("breakpoints fall back to the one before and round to whole px", () => {
    expect(reserveStyle({ base: 944.4, sm: 744 })).toEqual({ "--reserve": "944px", "--reserve-sm": "744px", "--reserve-lg": "744px" });
    expect(reserveStyle({ base: 600, lg: 500 })).toEqual({ "--reserve": "600px", "--reserve-sm": "600px", "--reserve-lg": "500px" });
  });
  it("never goes negative", () => {
    expect(prop(reserveStyle(-5), "--reserve")).toBe("0px");
  });
});

describe("Reserve", () => {
  it("floor only: the children are always there on a floor of the end size", () => {
    render(
      <Reserve height={{ base: 300, lg: 200 }}>
        <p>Karte</p>
      </Reserve>,
    );
    const box = screen.getByText("Karte").parentElement as HTMLElement;
    expect(box.className).toContain(RESERVE_CLASS);
    expect(box.style.getPropertyValue("--reserve")).toBe("300px");
    expect(box.style.getPropertyValue("--reserve-lg")).toBe("200px");
    expect(document.querySelector("[data-card-skeleton]")).toBeNull();
  });

  it("not ready: a placeholder of the reserved size stands in, the floor is on the swap box", () => {
    const { container } = render(
      <Reserve height={360} ready={false}>
        <p>Karte</p>
      </Reserve>,
    );
    expect(container.querySelector("[data-card-skeleton]")).not.toBeNull();
    expect(screen.queryByText("Karte")).toBeNull();
    expect((container.firstElementChild as HTMLElement).className).toContain(RESERVE_CLASS);
  });

  it("ready: the content is there and the floor is released", () => {
    const { container } = render(
      <Reserve height={360} ready>
        <p>Karte</p>
      </Reserve>,
    );
    expect(screen.getByText("Karte")).toBeInTheDocument();
    expect((container.firstElementChild as HTMLElement).className).not.toContain(RESERVE_CLASS);
  });
});

describe("ReserveFallback / ReserveSuspense", () => {
  it("the fallback is an aria-busy card skeleton on a floor", () => {
    const { container } = render(<ReserveFallback height={{ base: 400, sm: 300 }} />);
    const box = container.firstElementChild as HTMLElement;
    expect(box).toHaveAttribute("aria-busy", "true");
    expect(box.className).toContain(RESERVE_CLASS);
    expect(box.style.getPropertyValue("--reserve-sm")).toBe("300px");
    expect(box.querySelector("[data-card-skeleton]")).not.toBeNull();
  });

  it("shows the fallback while the lazy card loads, then the card", async () => {
    const Late = lazy(() => new Promise<{ default: () => React.JSX.Element }>((res) => setTimeout(() => res({ default: () => <p>Spät</p> }), 20)));
    render(
      <ReserveSuspense height={300}>
        <Late />
      </ReserveSuspense>,
    );
    expect(document.querySelector("[data-card-skeleton]")).not.toBeNull();
    expect(await screen.findByText("Spät")).toBeInTheDocument();
    expect(document.querySelector("[data-card-skeleton]")).toBeNull();
  });

  it("CardSkeleton draws the requested rows and hides from assistive tech", () => {
    const { container } = render(<CardSkeleton rows={3} />);
    const el = container.firstElementChild as HTMLElement;
    expect(el).toHaveAttribute("aria-hidden", "true");
    // the label bar + 3 rows (each a Skeleton, itself aria-hidden)
    expect(el.querySelectorAll(":scope [aria-hidden='true']").length).toBe(4);
  });
});
