import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { Button, buttonBase } from "@/primitives/Button";

describe("Button", () => {
  it("renders the bundle base class string and md size by default", () => {
    render(<Button>Speichern</Button>);
    const b = screen.getByRole("button", { name: "Speichern" });
    expect(b).toHaveAttribute("type", "button");
    for (const cls of buttonBase.split(" ")) expect(b.className).toContain(cls);
    expect(b.className).toContain("px-4 py-2 text-[13px]");
    expect(b.className).toContain("border-line-2 bg-white/[0.03] text-fg hover:bg-white/[0.07] hover:border-steel/40");
  });

  it("renders primary and danger variants and the sm size", () => {
    render(
      <>
        <Button variant="primary" size="sm">
          Trade eintragen
        </Button>
        <Button variant="danger">Löschen</Button>
      </>,
    );
    const primary = screen.getByRole("button", { name: "Trade eintragen" });
    // P13 theme tokens: dark values = the former literals (#d6d6d6, inset 0 1px 0 rgb(255 255 255 / 0.6), #ff8a90 – tokens.css)
    expect(primary.className).toContain("border-transparent bg-gradient-to-b from-white to-(--color-primary-btn-to) text-ink-950 shadow-(--shadow-btn-sheen) hover:to-white");
    expect(primary.className).toContain("px-3 py-1.5 text-xs");
    const danger = screen.getByRole("button", { name: "Löschen" });
    expect(danger.className).toContain("border-(--color-danger)/40 bg-(--color-danger)/10 text-(--color-danger-text) hover:bg-(--color-danger)/20");
  });

  it("fires onClick and respects disabled", () => {
    const onClick = vi.fn();
    render(
      <Button onClick={onClick} disabled>
        Aus
      </Button>,
    );
    const b = screen.getByRole("button", { name: "Aus" });
    expect(b).toBeDisabled();
    fireEvent.click(b);
    expect(onClick).not.toHaveBeenCalled();
  });

  it("merges className via cn", () => {
    render(<Button className="w-full">Breit</Button>);
    expect(screen.getByRole("button", { name: "Breit" }).className).toContain("w-full");
  });
});
