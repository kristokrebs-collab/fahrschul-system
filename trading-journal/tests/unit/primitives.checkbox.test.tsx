import { fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it } from "vitest";
import { CheckboxRow } from "@/primitives/CheckboxRow";

function Harness() {
  const [on, setOn] = useState(false);
  return (
    <CheckboxRow checked={on} onToggle={() => setOn((v) => !v)} sub="Struktur bestätigt">
      Erster Higher Low oder BOS auf 1H/4H
    </CheckboxRow>
  );
}

describe("CheckboxRow", () => {
  it("toggles aria-checked and the checked class strings", () => {
    render(<Harness />);
    const box = screen.getByRole("checkbox", { name: /Erster Higher Low/ });
    expect(box).toHaveAttribute("aria-checked", "false");
    expect(box.className).toContain("flex w-full items-start gap-3 rounded-xl border px-3 py-2.5 text-left transition-colors duration-200");
    expect(box.className).toContain("border-line bg-ink-950/40");
    fireEvent.click(box);
    expect(box).toHaveAttribute("aria-checked", "true");
    expect(box.className).toContain("border-teal/35 bg-teal/[0.07]");
    const inner = box.querySelector("span");
    expect(inner?.className).toContain("size-[18px]");
    expect(inner?.className).toContain("border-teal bg-teal");
    fireEvent.click(box);
    expect(box).toHaveAttribute("aria-checked", "false");
  });

  it("renders the sub line and the check path", () => {
    render(<Harness />);
    expect(screen.getByText("Struktur bestätigt").className).toContain("text-[11px] text-faint");
    const path = document.querySelector("path[d='M3.5 8.5l3 3 6-7']");
    expect(path).not.toBeNull();
  });
});
