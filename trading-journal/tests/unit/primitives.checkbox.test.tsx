import { fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it } from "vitest";
import { CheckboxRow } from "@/primitives/CheckboxRow";

function Harness({ strike, label = "Erster Higher Low oder BOS auf 1H/4H" }: { strike?: boolean; label?: string }) {
  const [on, setOn] = useState(false);
  return (
    <CheckboxRow checked={on} onToggle={() => setOn((v) => !v)} sub="Struktur bestätigt" strike={strike}>
      {label}
    </CheckboxRow>
  );
}

describe("CheckboxRow", () => {
  it("toggles aria-checked, the box state and crossfades the pre-rendered row tint", () => {
    render(<Harness />);
    const box = screen.getByRole("checkbox", { name: /Erster Higher Low/ });
    expect(box).toHaveAttribute("aria-checked", "false");
    expect(box.className).toContain("flex w-full items-start gap-3 rounded-xl border border-line bg-ink-950/40 px-3 py-2.5 text-left transition-colors duration-200");
    const tint = box.querySelector("[data-tint]");
    expect(tint?.className).toContain("border-teal/35 bg-teal/[0.07]");
    expect(tint?.className).toContain("opacity-0");
    expect(tint).toHaveAttribute("aria-hidden", "true");

    fireEvent.click(box);
    expect(box).toHaveAttribute("aria-checked", "true");
    expect(box).toHaveAttribute("data-checked", "true");
    expect(tint?.className).toContain("opacity-100");
    const inner = box.querySelector("[data-box]");
    expect(inner?.className).toContain("size-[18px]");
    expect(inner?.className).toContain("border-teal");
    expect(inner?.querySelector(".bg-teal")?.className).toContain("opacity-100");

    fireEvent.click(box);
    expect(box).toHaveAttribute("aria-checked", "false");
    expect(tint?.className).toContain("opacity-0");
  });

  it("renders the sub line and the check path", () => {
    render(<Harness />);
    expect(screen.getByText("Struktur bestätigt").className).toContain("text-[11px] text-faint");
    const path = document.querySelector("path[d='M3.5 8.5l3 3 6-7']");
    expect(path).not.toBeNull();
  });

  it("`strike` draws the line over plain-text labels without duplicating the text node", () => {
    render(<Harness strike />);
    // the label appears exactly once in the accessible name (the strike copy is CSS-generated with empty alt text)
    const box = screen.getByRole("checkbox", { name: /^Erster Higher Low oder BOS auf 1H\/4H\s*Struktur bestätigt$/ });
    const label = screen.getByText("Erster Higher Low oder BOS auf 1H/4H");
    expect(label.className).toContain("fx-strike");
    expect(label).toHaveAttribute("data-strike", "Erster Higher Low oder BOS auf 1H/4H");
    expect(label).toHaveAttribute("data-struck", "false");
    fireEvent.click(box);
    expect(label).toHaveAttribute("data-struck", "true");
    expect(label.className).toContain("opacity-55");
    expect(screen.getAllByText("Erster Higher Low oder BOS auf 1H/4H")).toHaveLength(1);
  });
});
