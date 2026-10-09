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
    expect(primary.className).toContain("border-transparent bg-gradient-to-b from-white to-[#d6d6d6] text-ink-950 shadow-[inset_0_1px_0_rgb(255_255_255/0.6)] hover:to-white");
    expect(primary.className).toContain("px-3 py-1.5 text-xs");
    const danger = screen.getByRole("button", { name: "Löschen" });
    expect(danger.className).toContain("border-signal/40 bg-signal/10 text-[#ff8a90] hover:bg-signal/20");
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
