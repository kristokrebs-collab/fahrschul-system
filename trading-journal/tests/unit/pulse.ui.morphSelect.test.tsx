import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it } from "vitest";
import { CONFIG, MorphSelect, placePanel, typeaheadIndex } from "@/motion/pulse/MorphSelect";

const OPTIONS = [
  { value: "all", label: "Alle Grundlagen" },
  { value: "bsl", label: "BSL/EQL Liquidity Sweep", hint: "4" },
  { value: "fvg", label: "FVG Retest" },
  { value: "none", label: "Ohne Grundlage" },
];

function Harness({ onChange }: { onChange?: (v: string) => void }) {
  const [v, setV] = useState("all");
  return (
    <>
      <MorphSelect
        aria-label="Entscheidungsgrundlage"
        value={v}
        options={OPTIONS}
        onChange={(n) => {
          setV(n);
          onChange?.(n);
        }}
      />
      <button type="button">danach</button>
    </>
  );
}

const trigger = () => screen.getByRole("button", { name: "Entscheidungsgrundlage" });
const closed = () =>
  waitFor(() => {
    const panel = document.querySelector<HTMLElement>("[data-pulse-select]");
    expect(panel === null || panel.style.visibility === "hidden").toBe(true);
    expect(screen.queryByRole("listbox")).toBeNull();
  });

describe("MorphSelect", () => {
  it("renders a listbox popup button showing the selected label", () => {
    render(<Harness />);
    const t = trigger();
    expect(t).toHaveAttribute("aria-haspopup", "listbox");
    expect(t).toHaveAttribute("aria-expanded", "false");
    expect(t).toHaveAttribute("data-value", "all");
    expect(t).toHaveTextContent("Alle Grundlagen");
    expect(screen.queryByRole("listbox")).toBeNull();
  });

  it("opens on click with the selected option active and focus in the listbox", () => {
    render(<Harness />);
    fireEvent.click(trigger());
    const list = screen.getByRole("listbox");
    expect(trigger()).toHaveAttribute("aria-expanded", "true");
    expect(trigger()).toHaveAttribute("aria-controls", list.id);
    expect(document.activeElement).toBe(list);
    const opts = screen.getAllByRole("option");
    expect(opts).toHaveLength(4);
    expect(opts[0]).toHaveAttribute("aria-selected", "true");
    expect(list).toHaveAttribute("aria-activedescendant", opts[0]!.id);
  });

  it("keyboard: ArrowDown opens, arrows/Home/End move, Enter selects and returns focus", async () => {
    const changes: string[] = [];
    render(<Harness onChange={(v) => changes.push(v)} />);
    fireEvent.keyDown(trigger(), { key: "ArrowDown" });
    const list = screen.getByRole("listbox");
    const opts = () => screen.getAllByRole("option");
    fireEvent.keyDown(list, { key: "ArrowDown" });
    expect(list).toHaveAttribute("aria-activedescendant", opts()[1]!.id);
    fireEvent.keyDown(list, { key: "End" });
    expect(list).toHaveAttribute("aria-activedescendant", opts()[3]!.id);
    fireEvent.keyDown(list, { key: "Home" });
    expect(list).toHaveAttribute("aria-activedescendant", opts()[0]!.id);
    fireEvent.keyDown(list, { key: "ArrowUp" });
    expect(list).toHaveAttribute("aria-activedescendant", opts()[0]!.id);
    fireEvent.keyDown(list, { key: "ArrowDown" });
    fireEvent.keyDown(list, { key: "ArrowDown" });
    fireEvent.keyDown(list, { key: "Enter" });
    expect(changes).toEqual(["fvg"]);
    expect(document.activeElement).toBe(trigger());
    expect(trigger()).toHaveAttribute("aria-expanded", "false");
    expect(trigger()).toHaveTextContent("FVG Retest");
    await closed();
  });

  it("typeahead jumps to the first matching label (diacritics/case-insensitive)", () => {
    render(<Harness />);
    fireEvent.click(trigger());
    const list = screen.getByRole("listbox");
    fireEvent.keyDown(list, { key: "o" });
    expect(list).toHaveAttribute("aria-activedescendant", screen.getAllByRole("option")[3]!.id);
  });

  it("Escape closes without change, stops propagation and refocuses the trigger", async () => {
    const changes: string[] = [];
    let docEscapes = 0;
    const onDoc = (e: KeyboardEvent) => {
      if (e.key === "Escape") docEscapes += 1;
    };
    document.addEventListener("keydown", onDoc);
    render(<Harness onChange={(v) => changes.push(v)} />);
    fireEvent.click(trigger());
    fireEvent.keyDown(screen.getByRole("listbox"), { key: "ArrowDown" });
    fireEvent.keyDown(screen.getByRole("listbox"), { key: "Escape" });
    document.removeEventListener("keydown", onDoc);
    expect(changes).toEqual([]);
    expect(docEscapes).toBe(0);
    expect(document.activeElement).toBe(trigger());
    await closed();
  });

  it("Tab closes and hands focus back to the trigger; clicking an option selects it", async () => {
    const changes: string[] = [];
    render(<Harness onChange={(v) => changes.push(v)} />);
    fireEvent.click(trigger());
    fireEvent.keyDown(screen.getByRole("listbox"), { key: "Tab" });
    expect(document.activeElement).toBe(trigger());
    await closed();
    fireEvent.click(trigger());
    fireEvent.click(screen.getByRole("option", { name: /BSL/ }));
    expect(changes).toEqual(["bsl"]);
    await closed();
  });

  it("outside pointerdown closes; the closing panel is inert", async () => {
    render(<Harness />);
    fireEvent.click(trigger());
    act(() => {
      fireEvent.pointerDown(document.body);
    });
    expect(trigger()).toHaveAttribute("aria-expanded", "false");
    await closed();
  });

  it("labels via <label for> on the id and links the listbox to the trigger", () => {
    render(
      <>
        <label htmlFor="f-tf">Timeframe</label>
        <MorphSelect id="f-tf" value="" options={[{ value: "", label: "–" }, { value: "15m", label: "15m" }]} onChange={() => {}} />
      </>,
    );
    const t = screen.getByLabelText("Timeframe");
    expect(t.tagName).toBe("BUTTON");
    fireEvent.click(t);
    expect(screen.getByRole("listbox", { name: "Timeframe" })).toBeInTheDocument();
  });

  it("placement: below, flipped above without room, clamped to the viewport", () => {
    const below = placePanel({ left: 20, top: 100, width: 150, height: 38 }, 4, false, 400, 800);
    expect(below.up).toBe(false);
    expect(below.top).toBe(100 + 38 + CONFIG.gap);
    expect(below.w).toBe(CONFIG.panelMinW);
    expect(below.scrollable).toBe(false);
    const above = placePanel({ left: 300, top: 700, width: 150, height: 38 }, 12, false, 400, 800);
    expect(above.up).toBe(true);
    expect(above.top + above.h).toBe(700 - CONFIG.gap);
    expect(above.h).toBeLessThanOrEqual(CONFIG.panelMaxH);
    expect(above.scrollable).toBe(true);
    expect(above.left + above.w).toBeLessThanOrEqual(400 - CONFIG.edge);
    // origin keeps the start box exactly under the field even when shifted left
    expect(above.left + above.ox * (1 - above.sx0)).toBeCloseTo(300);
  });

  it("typeaheadIndex cycles repeated letters", () => {
    const labels = ["Alpha", "Beta", "Bravo", "Ärger"];
    expect(typeaheadIndex(labels, "b", 0)).toBe(1);
    expect(typeaheadIndex(labels, "b", 1)).toBe(2);
    expect(typeaheadIndex(labels, "bb", 2)).toBe(1);
    expect(typeaheadIndex(labels, "ar", 0)).toBe(3);
  });
});
