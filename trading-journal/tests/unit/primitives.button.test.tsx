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
    // default = secondary: a whisper of a rim, the fill carries the shape, hover only brightens the fill
    expect(b.className).toContain("border-line bg-white/[0.05] text-fg hover:bg-white/[0.09]");
    expect(b.className).toContain("focus-visible:shadow-(--ring-glow-btn)");
  });

  it("ghost has no rim and no fill until hover", () => {
    render(<Button variant="ghost">Abbrechen</Button>);
    const b = screen.getByRole("button", { name: "Abbrechen" });
    expect(b.className).toContain("border-transparent text-mute hover:bg-white/[0.06] hover:text-fg");
    expect(b.className).not.toContain("bg-white/[0.05]");
  });

  it("loading keeps the size (transparent label + spinner), is busy and ignores clicks", () => {
    const onClick = vi.fn();
    render(
      <Button variant="primary" loading onClick={onClick}>
        Speichern
      </Button>,
    );
    const b = screen.getByRole("button", { name: "Speichern" });
    expect(b).toHaveAttribute("aria-busy", "true");
    expect(b.className).toContain("text-transparent");
    expect(b.querySelector("span[aria-hidden] > span")).not.toBeNull();
    fireEvent.click(b);
    expect(onClick).not.toHaveBeenCalled();
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
    expect(primary.className).toContain("focus-visible:shadow-[var(--shadow-btn-sheen),var(--ring-glow-btn)]");
    expect(primary.className).toContain("px-3 py-1.5 text-xs");
    const danger = screen.getByRole("button", { name: "Löschen" });
    expect(danger.className).toContain("border-(--color-danger)/40 bg-(--color-danger)/10 text-(--color-danger-text) hover:bg-(--color-danger)/20");
    expect(danger.className).toContain("focus-visible:shadow-(--ring-glow-btn-danger)");
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
