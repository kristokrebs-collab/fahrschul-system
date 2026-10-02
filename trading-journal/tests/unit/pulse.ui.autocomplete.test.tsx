import { fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it } from "vitest";
import { Autocomplete, matchRange, type AutocompleteItem } from "@/motion/pulse/Autocomplete";

const SUGGESTIONS: AutocompleteItem[] = [
  { value: "s1", label: "BSL/EQL Liquidity Sweep", group: "Grundlagen" },
  { value: "s2", label: "FVG Retest", group: "Grundlagen" },
  { value: "e1", label: "Gelassen", group: "Emotionen" },
  { value: "e2", label: "Ängstlich", group: "Emotionen" },
  { value: "long", label: "Long", group: "Richtung" },
];

function Harness({ onSelect }: { onSelect?: (it: AutocompleteItem) => void }) {
  const [q, setQ] = useState("");
  return (
    <>
      <Autocomplete type="search" aria-label="Trades durchsuchen" placeholder="Notizen, Begründung …" value={q} onChange={setQ} suggestions={SUGGESTIONS} onSelect={onSelect} inputClassName="pl-9" />
      <output data-testid="q">{q}</output>
    </>
  );
}

const input = () => screen.getByRole("combobox", { name: "Trades durchsuchen" });

describe("Autocomplete", () => {
  it("is an ARIA list combobox on the app input", () => {
    render(<Harness />);
    const el = input();
    expect(el.tagName).toBe("INPUT");
    expect(el).toHaveAttribute("aria-autocomplete", "list");
    expect(el).toHaveAttribute("aria-expanded", "false");
    expect(el.className).toContain("pl-9");
    expect(el.className).toContain("rounded-xl");
  });

  it("typing opens the filtered list with highlighted matches (case/diacritics-insensitive)", () => {
    render(<Harness />);
    fireEvent.change(input(), { target: { value: "angst" } });
    expect(input()).toHaveAttribute("aria-expanded", "true");
    const list = screen.getByRole("listbox");
    expect(input()).toHaveAttribute("aria-controls", list.id);
    const opts = screen.getAllByRole("option");
    expect(opts).toHaveLength(1);
    expect(opts[0]).toHaveTextContent("Ängstlich");
    expect(opts[0]!.querySelector("mark")).toHaveTextContent("Ängst");
  });

  it("shows group headers once and the empty state", () => {
    render(<Harness />);
    fireEvent.change(input(), { target: { value: "e" } });
    expect(screen.getAllByText("Grundlagen")).toHaveLength(1);
    expect(screen.getAllByText("Emotionen")).toHaveLength(1);
    fireEvent.change(input(), { target: { value: "zzz" } });
    expect(screen.getByText("Keine Treffer")).toBeInTheDocument();
    expect(screen.queryAllByRole("option")).toHaveLength(0);
    expect(input().getAttribute("aria-describedby")).toContain("empty");
  });

  it("keyboard: arrows move aria-activedescendant (wrapping), Enter chooses, focus stays in the field", () => {
    const chosen: string[] = [];
    render(<Harness onSelect={(it) => chosen.push(it.value)} />);
    input().focus();
    fireEvent.change(input(), { target: { value: "e" } });
    const opts = screen.getAllByRole("option");
    expect(opts.length).toBeGreaterThan(1);
    expect(input()).not.toHaveAttribute("aria-activedescendant");
    fireEvent.keyDown(input(), { key: "ArrowDown" });
    expect(input()).toHaveAttribute("aria-activedescendant", opts[0]!.id);
    expect(opts[0]).toHaveAttribute("aria-selected", "true");
    fireEvent.keyDown(input(), { key: "ArrowUp" });
    expect(input()).toHaveAttribute("aria-activedescendant", opts[opts.length - 1]!.id);
    fireEvent.keyDown(input(), { key: "ArrowDown" });
    fireEvent.keyDown(input(), { key: "Enter" });
    expect(chosen).toEqual(["s1"]);
    expect(screen.getByTestId("q")).toHaveTextContent("BSL/EQL Liquidity Sweep");
    expect(input()).toHaveAttribute("aria-expanded", "false");
    expect(document.activeElement).toBe(input());
  });

  it("Escape closes without bubbling to a surrounding dialog; ArrowDown on an empty field lists everything", () => {
    let docEscapes = 0;
    const onDoc = (e: KeyboardEvent) => {
      if (e.key === "Escape") docEscapes += 1;
    };
    document.addEventListener("keydown", onDoc);
    render(<Harness />);
    fireEvent.keyDown(input(), { key: "ArrowDown" });
    expect(screen.getAllByRole("option")).toHaveLength(SUGGESTIONS.length);
    fireEvent.keyDown(input(), { key: "Escape" });
    document.removeEventListener("keydown", onDoc);
    expect(docEscapes).toBe(0);
    expect(input()).toHaveAttribute("aria-expanded", "false");
  });

  it("clicking an option selects it; clearing the field closes", () => {
    const chosen: string[] = [];
    render(<Harness onSelect={(it) => chosen.push(it.value)} />);
    fireEvent.change(input(), { target: { value: "long" } });
    fireEvent.click(screen.getByRole("option", { name: "Long" }));
    expect(chosen).toEqual(["long"]);
    fireEvent.change(input(), { target: { value: "x" } });
    fireEvent.change(input(), { target: { value: "" } });
    expect(input()).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("listbox")).toBeNull();
  });

  it("matchRange maps folded matches back onto the original string", () => {
    expect(matchRange("Ängstlich", "ANG")).toEqual([0, 3]);
    expect(matchRange("BSL/EQL Liquidity Sweep", "liq")).toEqual([8, 11]);
    expect(matchRange("Long", "x")).toBeNull();
    expect(matchRange("Long", "  ")).toBeNull();
  });
});
