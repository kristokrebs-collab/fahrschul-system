import { fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it } from "vitest";
import { Segmented } from "@/primitives/Segmented";

const options = [
  { v: "all", label: "Alle" },
  { v: "makro", label: "Makro" },
  { v: "scalp", label: "Scalp" },
] as const;
type V = (typeof options)[number]["v"];

function Harness({ initial = "all" as V }) {
  const [v, setV] = useState<V>(initial);
  return <Segmented aria-label="Konto" options={options} value={v} onChange={setV} tones={{ makro: "bg-win/15" }} />;
}

describe("Segmented", () => {
  it("renders a radiogroup with one checked radio and the bundle class strings", () => {
    render(<Harness />);
    const group = screen.getByRole("radiogroup", { name: "Konto" });
    expect(group.className).toContain("inline-flex flex-wrap gap-0.5 rounded-xl border border-line bg-ink-950/60 p-1");
    const radios = screen.getAllByRole("radio");
    expect(radios).toHaveLength(3);
    expect(radios[0]).toHaveAttribute("aria-checked", "true");
    expect(radios[0]).toHaveAttribute("data-checked", "true");
    expect(radios[1]).toHaveAttribute("aria-checked", "false");
    expect(radios[0]?.className).toContain("px-3.5 py-1.5 text-[13px]");
  });

  it("uses a roving tabindex", () => {
    render(<Harness initial="makro" />);
    const radios = screen.getAllByRole("radio");
    expect(radios[1]).toHaveAttribute("tabindex", "0");
    expect(radios[0]).toHaveAttribute("tabindex", "-1");
    expect(radios[2]).toHaveAttribute("tabindex", "-1");
  });

  it("moves selection with arrow keys, wraps, and supports Home/End", () => {
    render(<Harness />);
    const group = screen.getByRole("radiogroup");
    fireEvent.keyDown(group, { key: "ArrowRight" });
    expect(screen.getByRole("radio", { name: "Makro" })).toHaveAttribute("aria-checked", "true");
    fireEvent.keyDown(group, { key: "ArrowRight" });
    fireEvent.keyDown(group, { key: "ArrowRight" });
    expect(screen.getByRole("radio", { name: "Alle" })).toHaveAttribute("aria-checked", "true");
    fireEvent.keyDown(group, { key: "ArrowLeft" });
    expect(screen.getByRole("radio", { name: "Scalp" })).toHaveAttribute("aria-checked", "true");
    fireEvent.keyDown(group, { key: "Home" });
    expect(screen.getByRole("radio", { name: "Alle" })).toHaveAttribute("aria-checked", "true");
    fireEvent.keyDown(group, { key: "End" });
    expect(screen.getByRole("radio", { name: "Scalp" })).toHaveAttribute("aria-checked", "true");
  });

  it("selects on click and renders the thumb with the tone class inside the checked item", () => {
    render(<Harness />);
    fireEvent.click(screen.getByRole("radio", { name: "Makro" }));
    const makro = screen.getByRole("radio", { name: "Makro" });
    expect(makro).toHaveAttribute("aria-checked", "true");
    const thumb = makro.querySelector("span[aria-hidden]");
    expect(thumb?.className).toContain("absolute inset-0 rounded-lg border border-line-2");
    // tone overrides the default thumb background via tailwind-merge
    expect(thumb?.className).toContain("bg-win/15");
    expect(thumb?.className).not.toContain("bg-ink-750");
    expect((thumb as HTMLElement).style.borderRadius).toBe("8px");
  });
});
